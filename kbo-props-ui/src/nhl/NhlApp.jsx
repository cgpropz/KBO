import { useState } from 'react'
import SportSwitcher from '../SportSwitcher'
import '../nfl/nfl.css'
import NhlLineups from './NhlLineups'
import NhlProjections from './NhlProjections'
import NhlPropLines from './NhlPropLines'
import NhlSharpOdds from './NhlSharpOdds'
import './nhl.css'

const NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'projections', label: 'Board' },
  { id: 'sharp', label: 'PP Odds' },
  { id: 'lineups', label: 'Lineups' },
]

function PlayerSheet({ item, onBack }) {
  if (!item) return null
  const recent = Array.isArray(item.recent) ? item.recent : []
  return (
    <section>
      <button className="nfl-player-link" onClick={onBack}>Back</button>
      <div className="nfl-board-header">
        <div>
          <p>NHL / {item.team}</p>
          <h1>{item.player}</h1>
        </div>
      </div>
      <p className="nhl-note">
        {item.prop} line {item.line ?? item.pp_line}. Projection {item.projection}.
        {item.chartIncludesPriorSeason ? ' The last-10 chart includes 2025-26.' : ' The chart is this season.'}
        {item.seasonLabel ? ` The ${item.seasonLabel} hit rate is this season only.` : ''}
      </p>
      <div className="nfl-history-bars">
        {recent.map((value, index) => (
          <span key={index} className={value > (item.line || item.pp_line || 0) ? 'hit' : 'miss'} style={{ height: '40px' }}>{value}</span>
        ))}
      </div>
    </section>
  )
}

export default function NhlApp({ sport, setSport, onNavigateHome, onNavigatePricing }) {
  const [view, setView] = useState('dashboard')
  const [selected, setSelected] = useState(null)

  const openPlayer = (item) => {
    setSelected(item)
    setView('player')
  }

  let content = <NhlPropLines onSelectPlayer={openPlayer} />
  if (view === 'player') content = <PlayerSheet item={selected} onBack={() => setView('dashboard')} />
  else if (view === 'projections') content = <NhlProjections onSelectPlayer={openPlayer} />
  else if (view === 'sharp') content = <NhlSharpOdds onSelectPlayer={openPlayer} />
  else if (view === 'lineups') content = <NhlLineups />

  return (
    <div className="nfl-root nhl-root">
      <nav className="nfl-nav">
        <button className="nfl-logo" onClick={onNavigateHome}>cgpropz</button>
        <SportSwitcher sport={sport} setSport={setSport} />
        <div className="nfl-nav-links">
          {NAV.map((item) => (
            <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>{item.label}</button>
          ))}
        </div>
        <button className="nfl-pro-badge" onClick={onNavigatePricing}>NHL</button>
      </nav>
      <main className="nfl-content">{content}</main>
    </div>
  )
}
