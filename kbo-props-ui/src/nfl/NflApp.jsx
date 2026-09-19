import { useState } from 'react'
import Paywall from '../Paywall'
import SportSwitcher from '../SportSwitcher'
import NflDashboard from './NflDashboard'
import NflProjections from './NflProjections'
import './nfl.css'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'projections', label: 'PrizePicks Board' },
]

export default function NflApp({ sport, setSport, onNavigateHome, onNavigatePricing }) {
  const [view, setView] = useState('dashboard')
  const content = view === 'projections'
    ? <NflProjections />
    : <NflDashboard onOpenBoard={() => setView('projections')} />

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
        <button className="nfl-pro-badge" onClick={onNavigatePricing}>NFL PRO</button>
      </nav>
      <main className="nfl-content">
        <Paywall onNavigate={onNavigatePricing} sport="nfl">{content}</Paywall>
      </main>
    </div>
  )
}