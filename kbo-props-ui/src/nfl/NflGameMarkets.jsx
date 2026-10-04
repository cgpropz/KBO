import { useEffect, useMemo, useState } from 'react'
import { fetchNflGameMarkets } from './nflData'
import { teamLogoUrl } from './nflTeams'

const SORT_OPTIONS = ['Kickoff', 'Spread edge', 'Total edge']
const SIDE_OPTIONS = ['All', 'Spread +', 'Total +']
const DEFAULT_FILTERS = { sortBy: 'Kickoff', side: 'All', edgeMin: '', edgeMax: '', team: '', day: 'All' }

function finite(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function formatPoints(value, signed = false) {
  const number = finite(value)
  if (number == null) return '—'
  const text = number.toFixed(1)
  if (!signed) return text
  return number > 0 ? `+${text}` : text
}

function formatEdge(value, percent = false) {
  const number = finite(value)
  if (number == null) return '—'
  const text = `${number > 0 ? '+' : ''}${number.toFixed(1)}`
  return percent ? `${text}%` : text
}

function edgeTone(value) {
  const number = finite(value)
  if (number == null || number === 0) return ''
  return number > 0 ? 'over' : 'under'
}

function kickoffLabel(game) {
  const [hourText, minute] = String(game.gametime || '').split(':')
  const hour = Number(hourText)
  if (!Number.isFinite(hour)) return game.weekday || 'Kickoff TBD'
  const meridiem = hour >= 12 ? 'PM' : 'AM'
  const day = game.weekday ? game.weekday.slice(0, 3).toUpperCase() : ''
  return `${day} ${hour % 12 || 12}:${minute || '00'} ${meridiem} ET`.trim()
}

function TeamLogo({ team }) {
  const url = teamLogoUrl(team)
  return url ? <img src={url} alt="" /> : <i aria-hidden="true" />
}

function scoreText(value) {
  const number = finite(value)
  if (number == null) return '—'
  return String(Math.round(number))
}

function oppositeLine(line) {
  const number = finite(line)
  if (number == null) return null
  return -number
}

function scoreResult(awayScore, homeScore, side) {
  const away = finite(awayScore)
  const home = finite(homeScore)
  if (away == null || home == null || away === home) return null
  const higher = side === 'away' ? away > home : home > away
  return higher ? 'Winner' : 'Loser'
}

function TeamSide({ team, name, score, result }) {
  return (
    <div className="nfl-game-side">
      <div className="nfl-game-team">
        <TeamLogo team={team} />
        <span className="nfl-game-team-copy">
          <span className="nfl-game-team-name">{name || team}</span>
          <b className="nfl-game-score">{scoreText(score)}</b>
        </span>
      </div>
      <span className={`nfl-game-result${result === 'Winner' ? ' over' : ''}${result === 'Loser' ? ' under' : ''}`}>{result || ''}</span>
    </div>
  )
}

function SpreadSide({ line, projection }) {
  return (
    <div className="nfl-game-side-lines">
      <div><small>Line</small><strong>{formatPoints(line, true)}</strong></div>
      <div><small>Proj</small><strong>{formatPoints(projection, true)}</strong></div>
    </div>
  )
}

function GameCard({ game }) {
  const awayScore = scoreText(game.awayScore)
  const homeScore = scoreText(game.homeScore)
  const sum = awayScore !== '—' && homeScore !== '—' ? `${awayScore}+${homeScore}` : null
  const awayLine = game.spread?.line
  const awayProj = finite(game.awayScore) != null && finite(game.homeScore) != null ? game.homeScore - game.awayScore : game.spread?.projection
  const homeProj = finite(awayProj) == null ? null : -awayProj
  return (
    <article className="nfl-game-card">
      <p>{kickoffLabel(game)}</p>
      <div className="nfl-game-sides">
        <TeamSide team={game.awayTeam} name={game.awayName} score={game.awayScore} result={scoreResult(game.awayScore, game.homeScore, 'away')} />
        <TeamSide team={game.homeTeam} name={game.homeName} score={game.homeScore} result={scoreResult(game.awayScore, game.homeScore, 'home')} />
        <b>Spread</b>
        <b className="nfl-game-spread-spacer" />
        <SpreadSide line={awayLine} projection={awayProj} />
        <SpreadSide line={oppositeLine(awayLine)} projection={homeProj} />
      </div>
      <div className="nfl-game-spread-edge">
        <small>edge</small>
        <strong className={edgeTone(game.spread?.edge)}>{formatEdge(game.spread?.edge)}</strong>
      </div>
      <div className="nfl-game-market">
        <b>Total</b>
        <div><small>Line</small><strong>{formatPoints(game.total?.line)}</strong></div>
        <div>
          <small>Proj</small>
          <strong>
            {formatPoints(game.total?.projection)}
            {sum ? <i>{sum}</i> : null}
          </strong>
        </div>
        <div><small>edge</small><strong className={edgeTone(game.total?.edge)}>{formatEdge(game.total?.edge)}</strong></div>
      </div>
    </article>
  )
}

function FilterIcon() {
  return (
    <svg className="nfl-filters-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="7" x2="20" y2="7" /><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="17" x2="20" y2="17" /><circle cx="11" cy="17" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function FilterRow({ id, label, value, expandedRow, onToggle, children }) {
  const expanded = expandedRow === id
  return (
    <div className="nfl-filter-row">
      <button type="button" className="nfl-filter-row-head" onClick={() => onToggle(id)}>
        <span>{label}</span>
        <span className="nfl-filter-row-value">{value}</span>
        <i className={`nfl-filter-chevron${expanded ? ' open' : ''}`} />
      </button>
      {expanded && <div className="nfl-filter-row-body">{children}</div>}
    </div>
  )
}

function relevantEdge(game, filters) {
  if (filters.side === 'Spread +' || filters.sortBy === 'Spread edge') return finite(game.spread?.edge)
  if (filters.side === 'Total +' || filters.sortBy === 'Total edge') return finite(game.total?.edge)
  const edges = [game.spread?.edge, game.total?.edge].map(finite).filter((value) => value != null)
  return edges.length ? Math.max(...edges) : null
}

function FiltersPanel({ open, onClose, filters, updateFilter, resetFilters, days, resultCount }) {
  const [expandedRow, setExpandedRow] = useState(null)
  const toggleRow = (id) => setExpandedRow((current) => (current === id ? null : id))
  if (!open) return null
  const edgeLabel = filters.edgeMin || filters.edgeMax ? `${filters.edgeMin || '—'} to ${filters.edgeMax || '—'}` : 'All'
  return (
    <div className="nfl-filters-overlay" onClick={onClose}>
      <div className="nfl-filters-panel" onClick={(event) => event.stopPropagation()}>
        <div className="nfl-filters-head">
          <h2>Filters</h2>
          <button className="nfl-filters-close" onClick={onClose}>Close <span>&times;</span></button>
        </div>
        <div className="nfl-filters-side">
          {SIDE_OPTIONS.map((option) => (
            <button key={option} className={filters.side === option ? 'active' : ''} onClick={() => updateFilter('side', option)}>{option}</button>
          ))}
        </div>
        <FilterRow id="sort" label="Sort By" value={filters.sortBy} expandedRow={expandedRow} onToggle={toggleRow}>
          <select value={filters.sortBy} onChange={(event) => updateFilter('sortBy', event.target.value)}>
            {SORT_OPTIONS.map((option) => <option key={option}>{option}</option>)}
          </select>
        </FilterRow>
        <FilterRow id="day" label="Day" value={filters.day} expandedRow={expandedRow} onToggle={toggleRow}>
          <div className="nfl-filter-chip-row">
            {days.map((option) => (
              <button key={option} className={filters.day === option ? 'active' : ''} onClick={() => updateFilter('day', option)}>{option}</button>
            ))}
          </div>
        </FilterRow>
        <FilterRow id="team" label="Team" value={filters.team || 'All'} expandedRow={expandedRow} onToggle={toggleRow}>
          <input value={filters.team} placeholder="Team name or abbreviation" onChange={(event) => updateFilter('team', event.target.value)} />
        </FilterRow>
        <FilterRow id="edge" label="Edge" value={edgeLabel} expandedRow={expandedRow} onToggle={toggleRow}>
          <div className="nfl-filter-range-row">
            <input type="number" placeholder="Min" value={filters.edgeMin} onChange={(event) => updateFilter('edgeMin', event.target.value)} />
            <span>to</span>
            <input type="number" placeholder="Max" value={filters.edgeMax} onChange={(event) => updateFilter('edgeMax', event.target.value)} />
          </div>
        </FilterRow>
        <div className="nfl-filters-footer">
          <button className="nfl-filters-reset" onClick={resetFilters}>Reset</button>
          <button className="nfl-filters-apply" onClick={onClose}>Show {resultCount} games</button>
        </div>
      </div>
    </div>
  )
}

export default function NflGameMarkets() {
  const [payload, setPayload] = useState(null)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)

  useEffect(() => {
    let active = true
    fetchNflGameMarkets()
      .then(({ payload: next }) => {
        if (!active) return
        setPayload(next)
        setLoaded(true)
      })
      .catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  const games = useMemo(() => (Array.isArray(payload?.games) ? payload.games : []), [payload])
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }))
  const resetFilters = () => setFilters(DEFAULT_FILTERS)
  const days = useMemo(() => ['All', ...Array.from(new Set(games.map((game) => game.weekday).filter(Boolean)))], [games])

  const rows = useMemo(() => {
    const query = filters.team.trim().toLowerCase()
    const edgeMin = filters.edgeMin === '' ? -Infinity : Number(filters.edgeMin)
    const edgeMax = filters.edgeMax === '' ? Infinity : Number(filters.edgeMax)
    const filtered = games.filter((game) => {
      if (filters.day !== 'All' && game.weekday !== filters.day) return false
      if (query) {
        const haystack = `${game.awayTeam} ${game.homeTeam} ${game.awayName} ${game.homeName}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      if (filters.side === 'Spread +' && !(finite(game.spread?.edge) > 0)) return false
      if (filters.side === 'Total +' && !(finite(game.total?.edge) > 0)) return false
      const edge = relevantEdge(game, filters)
      if (filters.edgeMin !== '' || filters.edgeMax !== '') {
        if (edge == null || edge < edgeMin || edge > edgeMax) return false
      }
      return true
    })
    const rank = {
      'Spread edge': (game) => finite(game.spread?.edge) ?? -Infinity,
      'Total edge': (game) => finite(game.total?.edge) ?? -Infinity,
    }[filters.sortBy]
    if (!rank) return filtered
    return [...filtered].sort((a, b) => rank(b) - rank(a))
  }, [games, filters])

  const week = payload?.week
  const modelLabel = payload?.model?.label

  return (
    <section className="nfl-game-page">
      <div className="nfl-board-header">
        <div>
          <p>NFL / GAME MARKETS</p>
          <h1>Spread, Total</h1>
        </div>
        <div className="nfl-lines-header-actions">
          <span>{loaded ? `${rows.length} game${rows.length === 1 ? '' : 's'}` : 'Loading'}{week ? ` · Week ${week}` : ''}</span>
          <button className={`nfl-filters-btn${filtersOpen ? ' active' : ''}`} onClick={() => setFiltersOpen(true)}><FilterIcon /> Filters</button>
        </div>
      </div>
      {modelLabel && <p className="nfl-game-note">{modelLabel}. Posted lines are Unabated only. The number by each team is that team's projected score. The total projection is those two scores added together. Each team shows its own spread. The higher score is the winner.</p>}
      {error && <div className="nfl-notice">Unable to load game markets: {error}</div>}
      {!error && !loaded && <div className="nfl-notice">Loading NFL game markets.</div>}
      {!error && loaded && !games.length && <div className="nfl-notice">{payload?.message || 'No NFL games are posted right now.'}</div>}
      {!error && loaded && !!games.length && !rows.length && <div className="nfl-notice">No games match these filters.</div>}
      {!!rows.length && (
        <div className="nfl-game-board">
          {rows.map((game) => <GameCard key={game.id || `${game.awayTeam}-${game.homeTeam}`} game={game} />)}
        </div>
      )}
      <FiltersPanel
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        updateFilter={updateFilter}
        resetFilters={resetFilters}
        days={days}
        resultCount={rows.length}
      />
    </section>
  )
}
