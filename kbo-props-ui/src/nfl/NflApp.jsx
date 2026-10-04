import { useState } from 'react'
import { useAuth } from '../AuthContext'
import Paywall from '../Paywall'
import SportSwitcher from '../SportSwitcher'
import { isBoardView } from '../appRoute'
import NflLineups from './NflLineups'
import NflProjections from './NflProjections'
import NflPropLines from './NflPropLines'
import NflSharpOdds from './NflSharpOdds'
import NflPlayerPage from './NflPlayerPage'
import NflPlayerSearch from './NflPlayerSearch'
import './nfl.css'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'projections', label: 'PrizePicks Board' },
  { id: 'sharp', label: 'PP Odds' },
  { id: 'lineups', label: 'Starting Lineups' },
]

export default function NflApp({ sport, setSport, onNavigateHome, onNavigatePricing, routeView, onViewChange }) {
  const { tier } = useAuth()
  const view = isBoardView('nfl', routeView) ? routeView : 'dashboard'
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  // Drop an open player when the address bar moves to a different board.
  const [playerBoard, setPlayerBoard] = useState(view)
  if (playerBoard !== view) {
    setPlayerBoard(view)
    setSelectedPlayer(null)
  }

  const openPlayer = (player, prop) => {
    setSelectedPlayer({ player, prop })
  }

  const selectView = (next) => {
    setSelectedPlayer(null)
    onViewChange(next)
  }

  const content = selectedPlayer
    ? <NflPlayerPage player={selectedPlayer.player} prop={selectedPlayer.prop} onBack={() => setSelectedPlayer(null)} />
    : view === 'projections'
      ? <NflProjections onSelectPlayer={openPlayer} />
      : view === 'sharp'
        ? <NflSharpOdds onSelectPlayer={openPlayer} />
        : view === 'lineups'
          ? <NflLineups />
          : <NflPropLines onSelectPlayer={openPlayer} onNavigatePricing={onNavigatePricing} />

  // The dashboard gates itself (top 3 free, rest blurred by membership), so it skips the full-page paywall.
  // Sharp Odds is a paid board, same as the PrizePicks board and lineups.
  // A player page stays behind the paywall, same as before it was its own view.
  const isDashboard = view === 'dashboard' && !selectedPlayer

  return (
    <div className="nfl-root">
      <nav className="nfl-nav">
        <button className="nfl-logo" onClick={onNavigateHome}>cgpropz</button>
        <SportSwitcher sport={sport} setSport={setSport} />
        <div className="nfl-nav-links">
          {NAV_ITEMS.map((item) => (
            <button key={item.id} className={!selectedPlayer && view === item.id ? 'active' : ''} onClick={() => selectView(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <NflPlayerSearch onSelect={openPlayer} />
        <button className="nfl-pro-badge" onClick={onNavigatePricing}>NFL PRO</button>
      </nav>
      <main className="nfl-content" key={tier || 'free'}>
        {isDashboard ? content : <Paywall onNavigate={onNavigatePricing} sport="nfl">{content}</Paywall>}
      </main>
    </div>
  )
}