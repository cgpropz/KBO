import { useState } from 'react'
import { useAuth } from './AuthContext'
import { isBoardView } from './appRoute'
import Paywall from './Paywall'
import SportSwitcher from './SportSwitcher'
import KboPropBoard from './KboPropBoard'
import StrikeoutProjections from './StrikeoutProjections'
import BatterProjections from './BatterProjections'
import PitcherRankings from './PitcherRankings'
import PropTracker from './PropTracker'
import SlipOptimizer from './SlipOptimizer'
import MatchupDeepDive from './MatchupDeepDive'
import SubscriptionPage from './SubscriptionPage'
import TutorialPage from './TutorialPage'
import KboPlayerPage from './KboPlayerPage'
import PlayerSearch from './PlayerSearch'
import './KboPropBoard.css'

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

/* Views that require a paid subscription (mirrors the pre-redesign App.jsx gate).
   'board' is excluded: it self-gates with a top-3-free / rest-locked preview,
   matching the WNBA and NFL dashboards. */
const PAID_VIEWS = new Set(['projections', 'batters', 'optimizer', 'matchups'])

export default function KboApp({ sport, setSport, onNavigateHome, routeView, onViewChange }) {
  const { signOut, user, tier } = useAuth()
  const view = isBoardView('kbo', routeView) ? routeView : 'board'
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [playerBoard, setPlayerBoard] = useState(view)
  if (playerBoard !== view) {
    setPlayerBoard(view)
    setSelectedPlayer(null)
  }
  const isPaid = tier && tier !== 'free'

  const setView = (next) => {
    const resolved = next === 'home' ? 'board' : next
    setSelectedPlayer(null)
    onViewChange?.(resolved)
  }

  const openPlayer = (name) => {
    setSelectedPlayer(name)
  }

  const content = (() => {
    if (selectedPlayer) {
      return <KboPlayerPage playerName={selectedPlayer} onBack={() => setSelectedPlayer(null)} />
    }
    switch (view) {
      case 'projections': return <StrikeoutProjections onNavigate={setView} />
      case 'batters':     return <BatterProjections />
      case 'rankings':    return <PitcherRankings />
      case 'tracker':     return <PropTracker />
      case 'optimizer':   return <SlipOptimizer onNavigate={setView} />
      case 'matchups':    return <MatchupDeepDive />
      case 'pricing':     return <SubscriptionPage />
      case 'tutorial':    return <TutorialPage onNavigate={setView} />
      default:            return <KboPropBoard onNavigatePricing={() => setView('pricing')} onSelectPlayer={openPlayer} />
    }
  })()

  // Player pages were never in PAID_VIEWS, including when opened from a paid board.
  const needsPaywall = PAID_VIEWS.has(view) && !selectedPlayer

  return (
    <div className="kbo-app-root">
      <nav className="kbo-app-nav">
        <button className="kbo-app-logo" onClick={onNavigateHome}>cgpropz</button>
        <SportSwitcher sport={sport} setSport={setSport} />
        <div className="kbo-app-nav-links">
          {NAV_ITEMS.map((item) => (
            <button key={item.id} className={!selectedPlayer && view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <PlayerSearch onSelect={openPlayer} />
        <button className="kbo-app-pro-badge" onClick={() => setView('pricing')}>{isPaid ? 'MANAGE' : 'UPGRADE'}</button>
        {user && <button className="kbo-app-signout" onClick={signOut} title={user.email}>Sign Out</button>}
      </nav>
      {/* keyed on tier so data views refetch (full vs. preview) when the tier changes */}
      <main className="kbo-app-content" key={tier || 'free'}>
        {needsPaywall ? <Paywall onNavigate={setView} sport="kbo">{content}</Paywall> : content}
      </main>
    </div>
  )
}
