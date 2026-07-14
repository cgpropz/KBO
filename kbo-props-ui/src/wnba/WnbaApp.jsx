import { useState } from 'react'
import './wnba.css'
import Projections from './Projections'
import Dashboard from './Dashboard'
import PlayerMap from './PlayerMap'
import Teams from './Teams'
import Lineups from './Lineups'
import SportSwitcher from '../SportSwitcher'
import Paywall from '../Paywall'

const NAV_ITEMS = [
  { id: 'projections', label: 'PrizePicks Edge' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'players', label: 'Players' },
  { id: 'teams', label: 'Teams' },
  { id: 'lineups', label: 'Lineups' },
]

// Paid WNBA views (mirrors KBO's PAID_VIEWS). Dashboard/Players/Teams stay free.
const WNBA_PAID_VIEWS = new Set(['projections', 'lineups'])

function ComingSoon({ label }) {
  return (
    <div className="card" style={{ padding: 40, textAlign: 'center', color: '#8b94a9' }}>
      <h2 style={{ margin: '0 0 8px', color: '#e6f3ce' }}>{label}</h2>
      <p style={{ margin: 0, fontSize: 13 }}>This WNBA view is being migrated into the unified site.</p>
    </div>
  )
}

export default function WnbaApp({ sport, setSport, onNavigateKbo }) {
  const [view, setView] = useState('projections')
  const [teamFilter, setTeamFilter] = useState('All')

  // Player detail is not ported yet; route player clicks to the Player Map.
  const handleSelectPlayer = name => {
    if (name) setTeamFilter('All')
    setView('players')
  }

  const handleSelectTeam = team => {
    setTeamFilter(team || 'All')
    setView('players')
  }

  const content = (() => {
    switch (view) {
      case 'projections': return <Projections onSelectPlayer={handleSelectPlayer} />
      case 'dashboard':   return <Dashboard onSelectPlayer={handleSelectPlayer} onNavigate={setView} />
      case 'players':     return <PlayerMap onSelectPlayer={handleSelectPlayer} initialTeam={teamFilter} />
      case 'teams':       return <Teams onSelectTeam={handleSelectTeam} />
      case 'lineups':     return <Lineups />
      default:            return <ComingSoon label="WNBA" />
    }
  })()

  const needsPaywall = WNBA_PAID_VIEWS.has(view)

  return (
    <div className="wnba-root">
      <nav className="wnba-nav">
        <button className="wnba-nav-logo" onClick={() => onNavigateKbo('hub')} title="cgpropz home">cgpropz</button>
        <SportSwitcher sport={sport} setSport={setSport} />
        <div className="wnba-nav-links">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`btn-ghost${view === item.id ? ' active' : ''}`}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </nav>
      <div className="wnba-content">
        {needsPaywall
          ? <Paywall onNavigate={onNavigateKbo} sport="wnba">{content}</Paywall>
          : content}
      </div>
    </div>
  )
}
