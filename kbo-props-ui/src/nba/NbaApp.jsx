import { useState } from 'react'
import { useAuth } from '../AuthContext'
import '../wnba/wnba.css'
import './nba.css'
import SportSwitcher from '../SportSwitcher'
import NbaTeams from './NbaTeams'

const NAV_ITEMS = [
  { id: 'projections', label: 'PrizePicks Edge' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'players', label: 'Players' },
  { id: 'teams', label: 'Teams' },
  { id: 'lineups', label: 'Lineups' },
]

const EMPTY_COPY = {
  projections: {
    title: 'PrizePicks Edge',
    body: 'NBA lines and projections are not loaded yet.',
  },
  dashboard: {
    title: 'Dashboard',
    body: 'The NBA dashboard fills in once rosters and logs are published.',
  },
  players: {
    title: 'Players',
    body: 'Current rosters and 2025-26 player stats land in the next data pass.',
  },
  lineups: {
    title: 'Lineups',
    body: 'Lineups are not part of this preview.',
  },
}

function EmptyTab({ title, body }) {
  return (
    <div className="card" style={{ padding: 40, textAlign: 'center', color: '#8b94a9' }}>
      <h2 style={{ margin: '0 0 8px', color: '#e6f3ce' }}>{title}</h2>
      <p style={{ margin: 0, fontSize: 13 }}>{body}</p>
    </div>
  )
}

export default function NbaApp({ sport, setSport, onNavigateHome }) {
  const { tier } = useAuth()
  const [view, setView] = useState('dashboard')

  const content = view === 'teams'
    ? <NbaTeams />
    : <EmptyTab {...(EMPTY_COPY[view] || EMPTY_COPY.dashboard)} />

  return (
    <div className="wnba-root nba-root">
      <nav className="wnba-nav">
        <button className="wnba-nav-logo" onClick={onNavigateHome} title="cgpropz home">cgpropz</button>
        <SportSwitcher sport={sport} setSport={setSport} />
        <div className="wnba-nav-links">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`btn-ghost${view === item.id ? ' active' : ''}`}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="wnba-player-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className="search-input"
            type="search"
            placeholder="Search players"
            aria-label="Search players"
            disabled
          />
        </div>
      </nav>
      <div className="wnba-content" key={tier || 'free'}>
        {content}
      </div>
    </div>
  )
}
