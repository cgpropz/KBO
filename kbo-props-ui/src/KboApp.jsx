import { lazy, Suspense, useState } from 'react'
import VisitedPane from './VisitedPane'
import { useSportView } from './useSportView'
import { useAuth } from './AuthContext'
import { hasAnyPaidAccess } from './entitlements'
import Paywall from './Paywall'
import SportSwitcher from './SportSwitcher'
import { PageMenu, PageMenuButton, usePageMenu } from './PageMenu'
import PlayerSearch from './PlayerSearch'
import RouteFallback from './RouteFallback'
import { GuideNavLinks } from './GuideLinks'
import CheatsheetsNavLink from './CheatsheetsNavLink'
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

export default function KboApp({ sport, setSport, onSlipSport, onNavigateHome, initialView, entry, forceHome, homeTick = 0 }) {
  const { signOut, user, tier } = useAuth()
  const menu = usePageMenu()
  const [view, setView] = useSportView({
    sport: 'kbo',
    entry,
    forceHome,
    homeTick,
    initialView: !forceHome && initialView === 'pricing' ? 'pricing' : null,
  })
  const [previousView, setPreviousView] = useState('board')
  const [selectedPlayer, setSelectedPlayer] = useState(entry?.view === 'player' ? entry.player : null)
  const isPaid = hasAnyPaidAccess(tier)

  const openPlayer = (name) => {
    setPreviousView(view)
    setSelectedPlayer(name)
    setView('player')
  }

  const paid = (node) => <Paywall onNavigate={setView} sport="kbo">{node}</Paywall>

  return (
    <div className="kbo-app-root">
      <nav className="kbo-app-nav" onClick={(event) => { if (event.target.closest('#cg-page-menu button, #cg-page-menu a')) menu.close() }}>
        <button className="kbo-app-logo" onClick={onNavigateHome}>cgpropz</button>
        <PageMenuButton open={menu.open} onToggle={menu.toggle} />
        <SportSwitcher sport={sport} setSport={setSport} />
        <PageMenu open={menu.open}>
          <div className="kbo-app-nav-links">
            <CheatsheetsNavLink />
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
        {view === 'player' && (
          <Suspense fallback={<RouteFallback inset />}>
            <KboPlayerPage playerName={selectedPlayer} onBack={() => setView(previousView)} />
          </Suspense>
        )}
        {view === 'optimizer' && (
          <Suspense fallback={<p style={{ color: '#888', textAlign: 'center', padding: 24 }}>Loading slip builder…</p>}>
            {paid(<SlipBoard sport="kbo" onSport={onSlipSport} drawer={entry?.drawer === true} />)}
          </Suspense>
        )}
        {view === 'pricing' && (
          <Suspense fallback={<RouteFallback inset />}>
            <SubscriptionPage />
          </Suspense>
        )}
        {view === 'tutorial' && (
          <Suspense fallback={<RouteFallback inset />}>
            <TutorialPage onNavigate={setView} />
          </Suspense>
        )}
        <VisitedPane active={view === 'board'}>
          <Suspense fallback={<RouteFallback inset />}>
            <KboPropBoard onNavigatePricing={() => setView('pricing')} onSelectPlayer={openPlayer} />
          </Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'projections'}>
          <Suspense fallback={<RouteFallback inset />}>{paid(<StrikeoutProjections onNavigate={setView} />)}</Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'batters'}>
          <Suspense fallback={<RouteFallback inset />}>{paid(<BatterProjections />)}</Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'rankings'}>
          <Suspense fallback={<RouteFallback inset />}>
            <PitcherRankings />
          </Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'tracker'}>
          <Suspense fallback={<RouteFallback inset />}>
            <PropTracker />
          </Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'matchups'}>
          <Suspense fallback={<RouteFallback inset />}>{paid(<MatchupDeepDive />)}</Suspense>
        </VisitedPane>
      </main>
    </div>
  )
}
