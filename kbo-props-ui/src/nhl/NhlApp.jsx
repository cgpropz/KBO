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

const RANGES = [
  { id: 'season', label: '2026-27', rate: 'seasonHitRate', games: 'seasonGames' },
  { id: 'prior', label: '2025-26', rate: 'priorSeasonHitRate', games: 'priorSeasonGames' },
  { id: 'h2h', label: 'H2H', rate: 'h2hHitRate', games: 'h2hGames' },
  { id: 'l5', label: 'L5', rate: 'hitRateL5', games: 'gamesL5' },
  { id: 'l10', label: 'L10', rate: 'hitRate', games: 'gamesL10' },
  { id: 'l20', label: 'L20', rate: 'hitRateL20', games: 'gamesL20' },
  { id: 'l30', label: 'L30', rate: 'hitRateL30', games: 'gamesL30' },
]

function chartWindow(item, range) {
  const values = Array.isArray(item.log) && item.log.length ? item.log : (Array.isArray(item.recent) ? item.recent : [])
  const dates = Array.isArray(item.logDates) && item.logDates.length ? item.logDates : (Array.isArray(item.gameDates) ? item.gameDates : [])
  const seasons = Array.isArray(item.logSeasons) ? item.logSeasons : (Array.isArray(item.chartSeasons) ? item.chartSeasons : [])
  const opponents = Array.isArray(item.logOpponents) ? item.logOpponents : []
  const teams = Array.isArray(item.logTeams) ? item.logTeams : []
  const indexes = []
  values.forEach((_, index) => {
    if (range === 'season' && seasons[index] !== '2026-27') return
    if (range === 'prior' && seasons[index] !== '2025-26') return
    if (range === 'h2h' && opponents[index] !== item.opponent) return
    indexes.push(index)
  })
  const windowIndexes = range === 'l5' || range === 'l10' || range === 'l20' || range === 'l30'
    ? indexes.slice(-(range === 'l5' ? 5 : range === 'l20' ? 20 : range === 'l30' ? 30 : 10))
    : indexes
  return windowIndexes.map((index) => ({
    value: values[index],
    date: dates[index] || '',
    season: seasons[index] || '',
    team: teams[index] || '',
  }))
}

function PlayerSheet({ item, onBack }) {
  const [range, setRange] = useState('l10')
  if (!item) return null
  const line = Number(item.line ?? item.pp_line)
  const bars = chartWindow(item, range)
  const maxValue = Math.max(line || 0, ...bars.map((bar) => Number(bar.value) || 0), 1)
  const selected = RANGES.find((option) => option.id === range) || RANGES[4]
  const includesPrior = bars.some((bar) => bar.season === '2025-26')
  return (
    <section className="nhl-player-sheet">
      <button className="nfl-player-link" onClick={onBack}>Back</button>
      <div className="nfl-board-header">
        <div>
          <p>NHL / {item.team}{item.opponent ? ` vs ${item.opponent}` : ''}</p>
          <h1>{item.player}</h1>
        </div>
      </div>
      <p className="nhl-note">
        {item.prop} line {item.line ?? item.pp_line}. Projection {item.projection}.
        {item.latestGame ? ` Latest game ${item.latestGame}.` : ''}
        {' '}2026-27 is this season only. 2025-26 is last season, including a previous team.
      </p>
      <div className="nfl-player-range-strip">
        {RANGES.map((option) => {
          const rate = item[option.rate]
          const games = item[option.games]
          return (
            <button key={option.id} className={range === option.id ? 'active' : ''} onClick={() => setRange(option.id)}>
              <span>{option.label}</span>
              <b className={rate == null ? '' : rate >= 50 ? 'over' : 'under'}>{rate == null ? '—' : `${rate}%`}</b>
              <small>{games ? `${games} gm` : ''}</small>
            </button>
          )
        })}
      </div>
      <div className="nfl-history-label">
        <span>{selected.label}{includesPrior && range !== 'prior' && range !== 'season' ? ' · includes 2025-26' : ''}</span>
        <span>{item[selected.rate] == null ? '' : `${item[selected.rate]}% over`}</span>
      </div>
      {bars.length ? (
        <div className="nhl-chart-scroll">
          <div className="nfl-history-bars nhl-hit-chart">
            {bars.map((bar, index) => (
              <span key={`${bar.date}-${bar.team}-${index}`} className={bar.value > line ? 'hit' : 'miss'} style={{ height: `${Math.max(18, (Number(bar.value) / maxValue) * 96)}px` }}>
                <i>{bar.value}{bar.date ? ` · ${bar.date}` : ''}{bar.team && bar.team !== item.team ? ` ${bar.team}` : ''}</i>
              </span>
            ))}
          </div>
          <div className="nfl-history-dates">
            {bars.map((bar, index) => (
              <span key={`${bar.date}-d-${index}`}>{bar.date}{bar.team && bar.team !== item.team ? ` ${bar.team}` : ''}</span>
            ))}
          </div>
        </div>
      ) : (
        <p className="nhl-note">No games in this window.</p>
      )}
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
