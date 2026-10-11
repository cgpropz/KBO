import { useEffect, useMemo, useState } from 'react'
import { fetchNflGameMarkets } from './nflData'
import { teamColor, teamLogoUrl } from './nflTeams'
import { downloadGameCardPng } from './gameCardShare'
import {
  GAME_CARD_PROBS_ENABLED,
  cardView,
  edgeRank,
  finite,
  scoreText,
} from './gameCardModel'

const SORT_OPTIONS = ['Kickoff', 'Edge', 'Spread edge', 'Total edge']
const SIDE_OPTIONS = ['All', 'Spread +', 'Total +']
const DEFAULT_FILTERS = { sortBy: 'Kickoff', side: 'All', edgeMin: '', edgeMax: '', team: '', day: 'All' }

function TeamMark({ team }) {
  const url = teamLogoUrl(team)
  const [failed, setFailed] = useState(false)
  if (url && !failed) {
    return <img src={url} alt="" width={40} height={40} onError={() => setFailed(true)} />
  }
  return (
    <span className="nfl-market-fallback" style={{ background: teamColor(team) }} aria-hidden="true">
      {team || '—'}
    </span>
  )
}

function NumberTile({ label, value, tone, book }) {
  return (
    <div className={`nfl-market-tile${tone ? ` is-${tone}` : ''}`}>
      <small>{label}</small>
      <strong className={book ? 'is-book' : 'is-ours'}>{value}</strong>
    </div>
  )
}

function GameCard({ game }) {
  const view = cardView(game, GAME_CARD_PROBS_ENABLED)
  const [sharing, setSharing] = useState(false)
  const [shareError, setShareError] = useState('')
  const share = async () => {
    setShareError('')
    setSharing(true)
    try {
      await downloadGameCardPng(game, GAME_CARD_PROBS_ENABLED)
    } catch (error) {
      setShareError(error?.message || 'Could not export this card')
    } finally {
      setSharing(false)
    }
  }
  const leadAway = view.wins ? view.wins.awayPct >= view.wins.homePct : false
  return (
    <article className="nfl-market-card">
      <div className="nfl-market-top">
        <span className="nfl-market-pill">{view.status}</span>
      </div>
      <div className="nfl-market-matchup">
        <div className="nfl-market-club">
          <TeamMark team={view.away} />
          <span>
            <b>{view.away}</b>
            <small>away</small>
          </span>
        </div>
        <div className="nfl-market-ours">
          <small>OUR NUMBER</small>
          {view.scores && (
            <div>
              <b>{scoreText(view.scores.away)}</b>
              <b>{scoreText(view.scores.home)}</b>
            </div>
          )}
        </div>
        <div className="nfl-market-club is-home">
          <span>
            <b>{view.home}</b>
            <small>home</small>
          </span>
          <TeamMark team={view.home} />
        </div>
      </div>
      {view.wins && (
        <div className="nfl-market-prob">
          <div className="nfl-market-prob-bar" aria-hidden="true">
            <span className={leadAway ? 'is-lead' : 'is-trail'} style={{ width: `${view.wins.awayPct}%` }} />
            <span className={leadAway ? 'is-trail' : 'is-lead'} style={{ width: `${view.wins.homePct}%` }} />
          </div>
          <div className="nfl-market-prob-labels">
            <span>{view.wins.awayPct}% win</span>
            <span>{view.wins.homePct}% win</span>
          </div>
        </div>
      )}
      <div className="nfl-market-grid">
        <NumberTile label="BOOK SPREAD" value={view.spreadBook} book />
        <NumberTile label="OUR SPREAD" value={view.spreadOurs} tone={view.spreadTone} />
        <NumberTile label="BOOK TOTAL" value={view.totalBook} book />
        <NumberTile label="OUR TOTAL" value={view.totalOurs} tone={view.totalTone} />
      </div>
      <p className="nfl-market-foot">{view.footer}</p>
      <button type="button" className="nfl-market-share" onClick={share} disabled={sharing}>
        {sharing ? 'Sharing…' : 'Share'}
      </button>
      {shareError && <p className="nfl-market-share-error">{shareError}</p>}
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
  if (filters.sortBy === 'Edge') return edgeRank(game)
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
          <button type="button" className="nfl-filters-close" onClick={onClose}>Close <span>&times;</span></button>
        </div>
        <div className="nfl-filters-side">
          {SIDE_OPTIONS.map((option) => (
            <button type="button" key={option} className={filters.side === option ? 'active' : ''} onClick={() => updateFilter('side', option)}>{option}</button>
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
              <button type="button" key={option} className={filters.day === option ? 'active' : ''} onClick={() => updateFilter('day', option)}>{option}</button>
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
          <button type="button" className="nfl-filters-reset" onClick={resetFilters}>Reset</button>
          <button type="button" className="nfl-filters-apply" onClick={onClose}>Show {resultCount} games</button>
        </div>
      </div>
    </div>
  )
}

export default function NflGameMarkets() {
  const [payload, setPayload] = useState(null)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [lockedCount, setLockedCount] = useState(0)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)

  useEffect(() => {
    let active = true
    fetchNflGameMarkets()
      .then(({ payload: next, preview, lockedCount: locked }) => {
        if (!active) return
        setPayload(next)
        setLockedCount(preview ? locked : 0)
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
      Edge: (game) => edgeRank(game) ?? -Infinity,
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
          <button type="button" className={`nfl-filters-btn${filtersOpen ? ' active' : ''}`} onClick={() => setFiltersOpen(true)}><FilterIcon /> Filters</button>
        </div>
      </div>
      {modelLabel && <p className="nfl-game-note">{modelLabel}. Posted lines are Unabated only. OUR NUMBER is each team's projected score. The total is those two scores added together.</p>}
      {error && <div className="nfl-notice">Unable to load game markets: {error}</div>}
      {!error && !loaded && <div className="nfl-notice">Loading NFL game markets.</div>}
      {!error && loaded && !games.length && lockedCount > 0 && <div className="nfl-notice">Game markets are locked. {lockedCount} games are locked. Upgrade to see the full board.</div>}
      {!error && loaded && !games.length && lockedCount <= 0 && <div className="nfl-notice">{payload?.message || 'No NFL games are posted right now.'}</div>}
      {!error && loaded && !!games.length && !rows.length && <div className="nfl-notice">No games match these filters.</div>}
      {!!rows.length && (
        <div className="nfl-game-board">
          {rows.map((game) => <GameCard key={game.id || `${game.awayTeam}-${game.homeTeam}`} game={game} />)}
        </div>
      )}
      <p className="nfl-market-disclaimer">21+ · Play responsibly · Entertainment only</p>
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
