import { useState } from 'react'
import { useAuth } from '../AuthContext'
import Paywall from '../Paywall'
import SportSwitcher from '../SportSwitcher'
import NflGameMarkets from './NflGameMarkets'
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
  { id: 'markets', label: 'Game Markets' },
  { id: 'lineups', label: 'Starting Lineups' },
]

export default function NflApp({ sport, setSport, onNavigateHome, onNavigatePricing }) {
  const { tier } = useAuth()
  const [view, setView] = useState('dashboard')
  const [previousView, setPreviousView] = useState('dashboard')
  const [selectedPlayer, setSelectedPlayer] = useState(null)

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
            : <NflPropLines onSelectPlayer={openPlayer} onNavigatePricing={onNavigatePricing} />

  // The dashboard gates itself (top 3 free, rest blurred by membership), so it skips the full-page paywall.
  // Sharp Odds, Game Markets, the PrizePicks board, and lineups are paid boards.
  const isDashboard = view === 'dashboard'

  return (
    <div className="nfl-root">
      <nav className="nfl-nav">
        <button className="nfl-logo" onClick={onNavigateHome}>cgpropz</button>
        <SportSwitcher sport={sport} setSport={setSport} />
        <div className="nfl-nav-links">
          {NAV_ITEMS.map((item) => (
            <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>
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