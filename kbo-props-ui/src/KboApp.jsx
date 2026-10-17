import { lazy, Suspense, useState } from 'react'
import { useAuth } from './AuthContext'
import { hasAnyPaidAccess } from './entitlements'
import Paywall from './Paywall'
import SportSwitcher from './SportSwitcher'
import { PageMenu, PageMenuButton, usePageMenu } from './PageMenu'
import PlayerSearch from './PlayerSearch'
import RouteFallback from './RouteFallback'
import { GuideNavLinks } from './GuideLinks'
import { viewOnLoad } from './memberNav'
import './KboPropBoard.css'

const KboPropBoard = lazy(() => import('./KboPropBoard'))
const StrikeoutProjections = lazy(() => import('./StrikeoutProjections'))
const BatterProjections = lazy(() => import('./BatterProjections'))
const PitcherRankings = lazy(() => import('./PitcherRankings'))
const PropTracker = lazy(() => import('./PropTracker'))
const MatchupDeepDive = lazy(() => import('./MatchupDeepDive'))
const SubscriptionPage = lazy(() => import('./SubscriptionPage'))
const TutorialPage = lazy(() => import('./TutorialPage'))
const KboPlayerPage = lazy(() => import('./KboPlayerPage'))

const NAV_ITEMS = [
  { id: 'board', label: 'PrizePicks Board' },
  { id: 'projections', label: 'Pitcher Props' },
  { id: 'batters', label: 'Batter Props' },
  { id: 'rankings', label: 'Pitcher Rankings' },
  { id: 'tracker', label: 'Tracker' },
  { id: 'optimizer', label: 'Slip Builder' },
  { id: 'matchups', label: 'Matchups' },
]
if (import.meta.env.DEV) NAV_ITEMS.push({ id: 'tutorial', label: 'Tutorial' })

const SlipBoard = lazy(() => import('./SlipBoard'))

/* Views that require a paid subscription (mirrors the pre-redesign App.jsx gate).
   'board' is excluded: it self-gates with a top-3-free / rest-locked preview,
   matching the WNBA and NFL dashboards. */
const PAID_VIEWS = new Set(['projections', 'batters', 'optimizer', 'matchups'])

export default function KboApp({ sport, setSport, onSlipSport, onNavigateHome, initialView, entry, forceHome }) {
  const { signOut, user, tier } = useAuth()
  const menu = usePageMenu()
  const [view, setView] = useState(() => {
    if (!forceHome && initialView === 'pricing') return 'pricing'
    return viewOnLoad({
      sport: 'kbo',
      entry,
      search: typeof window === 'undefined' ? '' : window.location.search,
      forceHome,
    })
  })
  const [previousView, setPreviousView] = useState('board')
  const [selectedPlayer, setSelectedPlayer] = useState(entry?.view === 'player' ? entry.player : null)
  const isPaid = hasAnyPaidAccess(tier)

  const openPlayer = (name) => {
    setPreviousView(view)
    setSelectedPlayer(name)
    setView('player')
  }

  const content = (() => {
    switch (view) {
      case 'projections': return <StrikeoutProjections onNavigate={setView} />
      case 'batters':     return <BatterProjections />
      case 'rankings':    return <PitcherRankings />
      case 'tracker':     return <PropTracker />
      case 'optimizer':   return (
        <Suspense fallback={<p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Loading slip builder…</p>}>
          <SlipBoard sport="kbo" onSport={onSlipSport} drawer={entry?.drawer === true} />
        </Suspense>
      )
      case 'matchups':    return <MatchupDeepDive />
      case 'pricing':     return <SubscriptionPage />
      case 'tutorial':    return <TutorialPage onNavigate={setView} />
      case 'player':      return <KboPlayerPage playerName={selectedPlayer} onBack={() => setView(previousView)} />
      default:            return <KboPropBoard onNavigatePricing={() => setView('pricing')} onSelectPlayer={openPlayer} />
    }
  })()

  const needsPaywall = PAID_VIEWS.has(view)

  return (
    <div className="kbo-app-root">
      <nav className="kbo-app-nav" onClick={(event) => { if (event.target.closest('#cg-page-menu button, #cg-page-menu a')) menu.close() }}>
        <button className="kbo-app-logo" onClick={onNavigateHome}>cgpropz</button>
        <PageMenuButton open={menu.open} onToggle={menu.toggle} />
        <SportSwitcher sport={sport} setSport={setSport} />
        <PageMenu open={menu.open}>
          <div className="kbo-app-nav-links">
            {NAV_ITEMS.map((item) => (
              <button key={item.id} data-testid={item.id === 'optimizer' ? 'kbo-slip-nav' : undefined} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>
                {item.label}
              </button>
            ))}
            <GuideNavLinks />
          </div>
          <PlayerSearch onSelect={openPlayer} />
          <button className="kbo-app-pro-badge" onClick={() => setView('pricing')}>{isPaid ? 'MANAGE' : 'UPGRADE'}</button>
          {user && <button className="kbo-app-signout" onClick={signOut} title={user.email}>Sign Out</button>}
        </PageMenu>
      </nav>
      {/* keyed on tier so data views refetch (full vs. preview) when the tier changes */}
      <main className="kbo-app-content" key={tier || 'free'}>
        <Suspense fallback={<RouteFallback inset />}>
          {needsPaywall ? <Paywall onNavigate={setView} sport="kbo">{content}</Paywall> : content}
        </Suspense>
      </main>
    </div>
  )
}
