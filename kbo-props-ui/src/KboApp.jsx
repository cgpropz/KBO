import { useState } from 'react'
import { useAuth } from './AuthContext'
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

export default function KboApp({ sport, setSport, onNavigateHome, initialView }) {
  const { signOut, user, tier } = useAuth()
  const [view, setView] = useState(NAV_ITEMS.some((item) => item.id === initialView) || initialView === 'pricing' ? initialView : 'board')
  const isPaid = tier && tier !== 'free'

  const content = (() => {
    switch (view) {
      case 'projections': return <StrikeoutProjections onNavigate={setView} />
      case 'batters':     return <BatterProjections />
      case 'rankings':    return <PitcherRankings />
      case 'tracker':     return <PropTracker />
      case 'optimizer':   return <SlipOptimizer onNavigate={setView} />
      case 'matchups':    return <MatchupDeepDive />
      case 'pricing':     return <SubscriptionPage />
      case 'tutorial':    return <TutorialPage onNavigate={setView} />
      default:            return <KboPropBoard onNavigatePricing={() => setView('pricing')} />
    }
  })()

  const needsPaywall = PAID_VIEWS.has(view)

  return (
    <div className="kbo-app-root">
      <nav className="kbo-app-nav">
        <button className="kbo-app-logo" onClick={onNavigateHome}>cgpropz</button>
        <SportSwitcher sport={sport} setSport={setSport} />
        <div className="kbo-app-nav-links">
          {NAV_ITEMS.map((item) => (
            <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <button className="kbo-app-pro-badge" onClick={() => setView('pricing')}>{isPaid ? 'MANAGE' : 'UPGRADE'}</button>
        <button className="kbo-app-signout" onClick={signOut} title={user?.email}>Sign Out</button>
      </nav>
      {/* keyed on tier so data views refetch (full vs. preview) when the tier changes */}
      <main className="kbo-app-content" key={tier || 'free'}>
        {needsPaywall ? <Paywall onNavigate={setView} sport="kbo">{content}</Paywall> : content}
      </main>
    </div>
  )
}
