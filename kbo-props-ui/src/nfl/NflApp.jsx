import { lazy, Suspense, useState } from 'react'
import { useAuth } from '../AuthContext'
import Paywall from '../Paywall'
import SportSwitcher from '../SportSwitcher'
import { PageMenu, PageMenuButton, usePageMenu } from '../PageMenu'
import NflPlayerSearch from './NflPlayerSearch'
import RouteFallback from '../RouteFallback'
import { GuideNavLinks } from '../GuideLinks'
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

export default function NflApp({ sport, setSport, onSlipSport, onNavigateHome, onNavigatePricing, entry }) {
  const { tier } = useAuth()
  const menu = usePageMenu()
  const [view, setView] = useState(entry?.view === 'slip' ? 'slip' : entry?.view === 'player' && entry.player ? 'player' : 'dashboard')
  const [previousView, setPreviousView] = useState('dashboard')
  const [selectedPlayer, setSelectedPlayer] = useState(entry?.view === 'player' && entry.player ? { player: entry.player, prop: entry.prop || null } : null)

  const openPlayer = (player, prop) => {
    setPreviousView(view)
    setSelectedPlayer({ player, prop })
    setView('player')
  }

  const content = view === 'player' && selectedPlayer
    ? <NflPlayerPage player={selectedPlayer.player} prop={selectedPlayer.prop} onBack={() => setView(previousView)} />
    : view === 'projections'
      ? <NflProjections onSelectPlayer={openPlayer} />
      : view === 'sharp'
        ? <NflSharpOdds onSelectPlayer={openPlayer} />
        : view === 'markets'
          ? <NflGameMarkets />
          : view === 'lineups'
            ? <NflLineups />
            : view === 'slip'
              ? (
                <Suspense fallback={<p style={{ color: '#9fb5a8', textAlign: 'center', padding: 24 }}>Loading slip builder…</p>}>
                  <SlipBoard sport="nfl" onSport={onSlipSport} drawer={entry?.drawer === true} />
                </Suspense>
              )
            : <NflPropLines onSelectPlayer={openPlayer} onNavigatePricing={onNavigatePricing} />

  // The dashboard gates itself (top 3 free, rest blurred by membership), so it skips the full-page paywall.
  // Sharp Odds, Game Markets, the PrizePicks board, and lineups are paid boards.
  const isDashboard = view === 'dashboard'

  return (
    <div className="nfl-root">
      <nav className="nfl-nav" onClick={(event) => { if (event.target.closest('#cg-page-menu button, #cg-page-menu a')) menu.close() }}>
        <button className="nfl-logo" onClick={onNavigateHome}>cgpropz</button>
        <PageMenuButton open={menu.open} onToggle={menu.toggle} />
        <SportSwitcher sport={sport} setSport={setSport} />
        <PageMenu open={menu.open}>
          <div className="nfl-nav-links">
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
        <Suspense fallback={<RouteFallback inset />}>
          {isDashboard ? content : <Paywall onNavigate={onNavigatePricing} sport="nfl">{content}</Paywall>}
        </Suspense>
      </main>
    </div>
  )
}