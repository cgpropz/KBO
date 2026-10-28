import { lazy, Suspense, useState } from 'react'
import VisitedPane from '../VisitedPane'
import { useSportView } from '../useSportView'
import { useAuth } from '../AuthContext'
import './wnba.css'
import WnbaPlayerSearch from './WnbaPlayerSearch'
import SportSwitcher from '../SportSwitcher'
import { PageMenu, PageMenuButton, usePageMenu } from '../PageMenu'
import Paywall from '../Paywall'
import RouteFallback from '../RouteFallback'
import { GuideNavLinks } from '../GuideLinks'
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

export default function WnbaApp({ sport, setSport, onSlipSport, onNavigateKbo, entry, forceHome, homeTick = 0 }) {
  const { tier } = useAuth()
  const menu = usePageMenu()
  const [view, setView] = useSportView({ sport: 'wnba', entry, forceHome, homeTick })
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

  const paid = (node) => <Paywall onNavigate={onNavigateKbo} sport="wnba">{node}</Paywall>

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
        {view === 'playerDetail' && (
          <Suspense fallback={<RouteFallback inset />}>
            <WnbaPlayerPage playerName={selectedPlayer} onBack={() => setView(returnView)} />
          </Suspense>
        )}
        {view === 'slip' && (
          <Suspense fallback={<p style={{ color: '#8b94a9', textAlign: 'center', padding: 24 }}>Loading slip builder…</p>}>
            {paid(
              <SlipBoard sport="wnba" onSport={onSlipSport} drawer={entry?.drawer === true} />
            )}
          </Suspense>
        )}
        <VisitedPane active={view === 'dashboard'}>
          <Suspense fallback={<RouteFallback inset />}>
            <Dashboard onSelectPlayer={handleSelectPlayer} onNavigate={setView} onNavigatePricing={() => onNavigateKbo('pricing')} />
          </Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'projections'}>
          <Suspense fallback={<RouteFallback inset />}>{paid(<Projections onSelectPlayer={handleSelectPlayer} />)}</Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'players'}>
          <Suspense fallback={<RouteFallback inset />}>
            <PlayerMap key={teamFilter} onSelectPlayer={handleSelectPlayer} initialTeam={teamFilter} />
          </Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'teams'}>
          <Suspense fallback={<RouteFallback inset />}>
            <Teams onSelectTeam={handleSelectTeam} />
          </Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'lineups'}>
          <Suspense fallback={<RouteFallback inset />}>{paid(<Lineups />)}</Suspense>
        </VisitedPane>
      </div>
    </div>
  )
}
