import { lazy, Suspense, useState } from 'react'
import VisitedPane from '../VisitedPane'
import { useSportView } from '../useSportView'
import { useAuth } from '../AuthContext'
import Paywall from '../Paywall'
import SportSwitcher from '../SportSwitcher'
import { PageMenu, PageMenuButton, usePageMenu } from '../PageMenu'
import NflPlayerSearch from './NflPlayerSearch'
import RouteFallback from '../RouteFallback'
import { GuideNavLinks } from '../GuideLinks'
import CheatsheetsNavLink from '../CheatsheetsNavLink'
import './nfl.css'

const NflGameMarkets = lazy(() => import('./NflGameMarkets'))
const NflLineups = lazy(() => import('./NflLineups'))
const NflProjections = lazy(() => import('./NflProjections'))
const NflPropLines = lazy(() => import('./NflPropLines'))
const NflSharpOdds = lazy(() => import('./NflSharpOdds'))
const NflPlayerPage = lazy(() => import('./NflPlayerPage'))

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'projections', label: 'PrizePicks Board' },
  { id: 'sharp', label: 'PP Odds' },
  { id: 'markets', label: 'Game Markets' },
  { id: 'lineups', label: 'Starting Lineups' },
  { id: 'slip', label: 'Slip Builder' },
]

const SlipBoard = lazy(() => import('../SlipBoard'))

export default function NflApp({ sport, setSport, onSlipSport, onNavigateHome, onNavigatePricing, entry, forceHome, homeTick = 0 }) {
  const { tier } = useAuth()
  const menu = usePageMenu()
  const [view, setView] = useSportView({ sport: 'nfl', entry, forceHome, homeTick })
  const [previousView, setPreviousView] = useState('dashboard')
  const [selectedPlayer, setSelectedPlayer] = useState(entry?.view === 'player' && entry.player ? { player: entry.player, prop: entry.prop || null } : null)

  const openPlayer = (player, prop) => {
    setPreviousView(view)
    setSelectedPlayer({ player, prop })
    setView('player')
  }

  // The dashboard gates itself (top 3 free, rest blurred by membership), so it skips the full-page paywall.
  // Sharp Odds, Game Markets, the PrizePicks board, and lineups are paid boards.
  const paid = (node) => <Paywall onNavigate={onNavigatePricing} sport="nfl">{node}</Paywall>

  return (
    <div className="nfl-root">
      <nav className="nfl-nav" onClick={(event) => { if (event.target.closest('#cg-page-menu button, #cg-page-menu a')) menu.close() }}>
        <button className="nfl-logo" onClick={onNavigateHome}>cgpropz</button>
        <PageMenuButton open={menu.open} onToggle={menu.toggle} />
        <SportSwitcher sport={sport} setSport={setSport} />
        <PageMenu open={menu.open}>
          <div className="nfl-nav-links">
            <CheatsheetsNavLink />
            {NAV_ITEMS.map((item) => (
              <button key={item.id} data-testid={item.id === 'slip' ? 'nfl-slip-nav' : undefined} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>
                {item.label}
              </button>
            ))}
            <GuideNavLinks />
          </div>
          <NflPlayerSearch onSelect={openPlayer} />
          <button className="nfl-pro-badge" onClick={onNavigatePricing}>NFL PRO</button>
        </PageMenu>
      </nav>
      <main className="nfl-content" key={tier || 'free'}>
        {view === 'player' && selectedPlayer && (
          <Suspense fallback={<RouteFallback inset />}>
            {paid(<NflPlayerPage player={selectedPlayer.player} prop={selectedPlayer.prop} onBack={() => setView(previousView)} />)}
          </Suspense>
        )}
        {view === 'slip' && (
          <Suspense fallback={<p style={{ color: '#9fb5a8', textAlign: 'center', padding: 24 }}>Loading slip builder…</p>}>
            {paid(<SlipBoard sport="nfl" onSport={onSlipSport} drawer={entry?.drawer === true} />)}
          </Suspense>
        )}
        <VisitedPane active={view === 'dashboard'}>
          <Suspense fallback={<RouteFallback inset />}>
            <NflPropLines onSelectPlayer={openPlayer} onNavigatePricing={onNavigatePricing} />
          </Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'projections'}>
          <Suspense fallback={<RouteFallback inset />}>{paid(<NflProjections onSelectPlayer={openPlayer} />)}</Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'sharp'}>
          <Suspense fallback={<RouteFallback inset />}>{paid(<NflSharpOdds onSelectPlayer={openPlayer} />)}</Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'markets'}>
          <Suspense fallback={<RouteFallback inset />}>{paid(<NflGameMarkets />)}</Suspense>
        </VisitedPane>
        <VisitedPane active={view === 'lineups'}>
          <Suspense fallback={<RouteFallback inset />}>{paid(<NflLineups />)}</Suspense>
        </VisitedPane>
      </main>
    </div>
  )
}