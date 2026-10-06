import { useState } from 'react'
import { useAuth } from '../AuthContext'
import '../wnba/wnba.css'
import './nba.css'
import SportSwitcher from '../SportSwitcher'
import NbaPlayers from './NbaPlayers'
import NbaTeams from './NbaTeams'
import NbaEdge from './NbaEdge'

const NAV_ITEMS = [
  { id: 'projections', label: 'PrizePicks Edge' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'teams', label: 'Teams' },
  { id: 'lineups', label: 'Lineups' },
]

const NAV_IDS = new Set(NAV_ITEMS.map((item) => item.id))

// The player-card grid moved onto Dashboard. A stored or linked "players"
// tab (cg_nba_tab / nba_tab, or ?nbaTab=players) opens Dashboard instead.
const STORED_TAB_KEYS = ['cg_nba_tab', 'nba_tab']

function resolveNbaView(view) {
  if (view === 'players') return 'dashboard'
  return NAV_IDS.has(view) ? view : 'dashboard'
}

function readLinkedNbaView() {
  if (typeof window === 'undefined') return 'dashboard'
  try {
    const params = new URLSearchParams(window.location.search)
    const linked = params.get('nbaTab')
    let stored = ''
    for (const key of STORED_TAB_KEYS) {
      const value = localStorage.getItem(key)
      if (value === 'players') localStorage.setItem(key, 'dashboard')
      if (!stored && value) stored = value
    }
    return resolveNbaView(linked || stored || 'dashboard')
  } catch {
    return 'dashboard'
  }
}

const EMPTY_COPY = {
  projections: {
    title: 'PrizePicks Edge',
    body: 'NBA lines and projections are not loaded yet.',
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
  const [view, setView] = useState(readLinkedNbaView)
  const openView = (next) => setView(resolveNbaView(next))

  let content
  if (view === 'teams') content = <NbaTeams />
  else if (view === 'dashboard') content = <NbaPlayers />
  else if (view === 'projections') content = <NbaEdge />
  else content = <EmptyTab {...(EMPTY_COPY[view] || EMPTY_COPY.lineups)} />

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
              onClick={() => openView(item.id)}
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
