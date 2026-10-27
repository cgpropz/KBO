import { lazy, Suspense, useState } from 'react'
import { useAuth } from '../AuthContext'
import './wnba.css'
import WnbaPlayerSearch from './WnbaPlayerSearch'
import SportSwitcher from '../SportSwitcher'
import { PageMenu, PageMenuButton, usePageMenu } from '../PageMenu'
import Paywall from '../Paywall'
import RouteFallback from '../RouteFallback'
import { GuideNavLinks } from '../GuideLinks'
import { viewOnLoad } from '../memberNav'
import CheatsheetsNavLink from '../CheatsheetsNavLink'

const Projections = lazy(() => import('./Projections'))
const Dashboard = lazy(() => import('./Dashboard'))
const PlayerMap = lazy(() => import('./PlayerMap'))
const Teams = lazy(() => import('./Teams'))
const Lineups = lazy(() => import('./Lineups'))
const WnbaPlayerPage = lazy(() => import('./WnbaPlayerPage'))

const NAV_ITEMS = [
  { id: 'projections', label: 'PrizePicks Edge' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'players', label: 'Players' },
  { id: 'teams', label: 'Teams' },
  { id: 'lineups', label: 'Lineups' },
  { id: 'slip', label: 'Slip Builder' },
]

const SlipBoard = lazy(() => import('../SlipBoard'))

// Paid WNBA views (mirrors KBO's PAID_VIEWS). Dashboard/Players/Teams stay free.
const WNBA_PAID_VIEWS = new Set(['projections', 'lineups', 'slip'])

function ComingSoon({ label }) {
  return (
    <div className="card" style={{ padding: 40, textAlign: 'center', color: '#8b94a9' }}>
      <h2 style={{ margin: '0 0 8px', color: '#e6f3ce' }}>{label}</h2>
      <p style={{ margin: 0, fontSize: 13 }}>This WNBA view is being migrated into the unified site.</p>
    </div>
  )
}

export default function WnbaApp({ sport, setSport, onSlipSport, onNavigateKbo, entry, forceHome }) {
  const { tier } = useAuth()
  const menu = usePageMenu()
  const [view, setView] = useState(() => viewOnLoad({
    sport: 'wnba',
    entry,
    search: typeof window === 'undefined' ? '' : window.location.search,
    forceHome,
  }))
  const [teamFilter, setTeamFilter] = useState('All')
  const [selectedPlayer, setSelectedPlayer] = useState(entry?.player || null)
  const [returnView, setReturnView] = useState('players')

  const handleSelectPlayer = name => {
    if (!name) return
    setReturnView(view)
    setSelectedPlayer(name)
    setView('playerDetail')
  }

  const handleSelectTeam = team => {
    setTeamFilter(team || 'All')
    setView('players')
  }

  const content = (() => {
    switch (view) {
      case 'projections': return <Projections onSelectPlayer={handleSelectPlayer} />
      case 'dashboard':   return <Dashboard onSelectPlayer={handleSelectPlayer} onNavigate={setView} onNavigatePricing={() => onNavigateKbo('pricing')} />
      case 'players':     return <PlayerMap onSelectPlayer={handleSelectPlayer} initialTeam={teamFilter} />
      case 'teams':       return <Teams onSelectTeam={handleSelectTeam} />
      case 'lineups':     return <Lineups />
      case 'slip':        return (
        <Suspense fallback={<p style={{ color: '#8b94a9', textAlign: 'center', padding: 24 }}>Loading slip builder…</p>}>
          <SlipBoard sport="wnba" onSport={onSlipSport} drawer={entry?.drawer === true} />
        </Suspense>
      )
      case 'playerDetail': return <WnbaPlayerPage playerName={selectedPlayer} onBack={() => setView(returnView)} />
      default:            return <ComingSoon label="WNBA" />
    }
  })()

  const needsPaywall = WNBA_PAID_VIEWS.has(view)


  return (
    <div className="wnba-root">
      <nav className="wnba-nav" onClick={(event) => { if (event.target.closest('#cg-page-menu button, #cg-page-menu a')) menu.close() }}>
        <button className="wnba-nav-logo" onClick={() => onNavigateKbo('hub')} title="cgpropz home">cgpropz</button>
        <PageMenuButton open={menu.open} onToggle={menu.toggle} />
        <SportSwitcher sport={sport} setSport={setSport} />
        <PageMenu open={menu.open}>
          <div className="wnba-nav-links">
            <CheatsheetsNavLink />
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                className={`btn-ghost${view === item.id ? ' active' : ''}`}
                data-testid={item.id === 'slip' ? 'wnba-slip-nav' : undefined}
                onClick={() => setView(item.id)}
              >
                {item.label}
              </button>
            ))}
            <GuideNavLinks />
          </div>
          <WnbaPlayerSearch onSelect={handleSelectPlayer} />
        </PageMenu>
      </nav>
      <div className="wnba-content" key={tier || 'free'}>
        <Suspense fallback={<RouteFallback inset />}>
          {needsPaywall
            ? <Paywall onNavigate={onNavigateKbo} sport="wnba">{content}</Paywall>
            : content}
        </Suspense>
      </div>
    </div>
  )
}
