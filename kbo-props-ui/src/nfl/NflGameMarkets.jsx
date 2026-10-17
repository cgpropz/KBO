import { useEffect, useMemo, useState } from 'react'
import { fetchNflGameMarkets } from './nflData'
import { MemberBoardStatus } from '../MemberBoardStatus'
import { useMemberBoardPhase } from '../useMemberBoardPhase'
import { useFullBoardRefresh } from '../useFullBoardRefresh'
import { teamColor, teamLogoUrl } from './nflTeams'
import { fitImage } from '../fitImage.js'
import { downloadGameCardPng } from './gameCardShare'
import {
  GAME_CARD_PROBS_ENABLED,
  cardView,
  edgeRank,
  finite,
} from './gameCardModel'

const SORT_OPTIONS = ['Kickoff', 'Edge', 'Spread edge', 'Total edge']
const SIDE_OPTIONS = ['All', 'Spread +', 'Total +']
const DEFAULT_FILTERS = { sortBy: 'Kickoff', side: 'All', edgeMin: '', edgeMax: '', team: '', day: 'All' }

function TeamMark({ team }) {
  const url = teamLogoUrl(team)
  const [failed, setFailed] = useState(false)
  if (url && !failed) {
    return <img src={fitImage(url, 40)} alt="" width={40} height={40} loading="lazy" onError={() => setFailed(true)} />
  }
  return (
    <span className="nfl-market-fallback" style={{ background: teamColor(team) }} aria-hidden="true">
      {team || '—'}
    </span>
  )
}

function NumberTile({ label, value, tone, book, missing }) {
  return (
    <div className={`nfl-market-tile${tone ? ` is-${tone}` : ''}`}>
      <small>{label}</small>
      {missing ? <em>No line posted</em> : <strong className={book ? 'is-book' : 'is-ours'}>{value}</strong>}
    </div>
  )
}

function GameCard({ game, hideTotalEdge = false }) {
  const view = cardView(game, GAME_CARD_PROBS_ENABLED, new Date(), { hideTotalEdge })
  const [sharing, setSharing] = useState(false)
  const [shareError, setShareError] = useState('')
  const share = async () => {
    setShareError('')
    setSharing(true)
    try {
      await downloadGameCardPng(game, GAME_CARD_PROBS_ENABLED, { hideTotalEdge })
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
          <small>CG NUMBER</small>
          {view.scoreLine && (
            <div>
              <b>{view.scoreLine}</b>
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
        <NumberTile label="BOOK SPREAD" value={view.spreadBook} book missing={view.spreadBookMissing} />
        <NumberTile label="CG SPREAD" value={view.spreadOurs} tone={view.spreadTone} />
        <NumberTile label="BOOK TOTAL" value={view.totalBook} book missing={view.totalBookMissing} />
        <NumberTile label="CG TOTAL" value={view.totalOurs} tone={view.totalTone} />
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

function relevantEdge(game, filters, hideTotalEdge) {
  if (filters.side === 'Spread +' || filters.sortBy === 'Spread edge') return finite(game.spread?.edge)
  if (!hideTotalEdge && (filters.side === 'Total +' || filters.sortBy === 'Total edge')) return finite(game.total?.edge)
  if (filters.sortBy === 'Edge') return edgeRank(game, { includeTotal: !hideTotalEdge })
  const edges = [game.spread?.edge, hideTotalEdge ? null : game.total?.edge].map(finite).filter((value) => value != null)
  return edges.length ? Math.max(...edges) : null
}

function FiltersPanel({ open, onClose, filters, updateFilter, resetFilters, days, resultCount, hideTotalEdge = false }) {
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
          {(hideTotalEdge ? SIDE_OPTIONS.filter((option) => option !== 'Total +') : SIDE_OPTIONS).map((option) => (
            <button type="button" key={option} className={filters.side === option ? 'active' : ''} onClick={() => updateFilter('side', option)}>{option}</button>
          ))}
        </div>
        <FilterRow id="sort" label="Sort By" value={filters.sortBy} expandedRow={expandedRow} onToggle={toggleRow}>
          <select value={filters.sortBy} onChange={(event) => updateFilter('sortBy', event.target.value)}>
            {(hideTotalEdge ? SORT_OPTIONS.filter((option) => option !== 'Total edge') : SORT_OPTIONS).map((option) => <option key={option}>{option}</option>)}
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
  const [refreshing, setRefreshing] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [previewMode, setPreviewMode] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)

  useEffect(() => {
    let active = true
    fetchNflGameMarkets()
      .then(({ payload: next, preview, lockedCount: locked, refreshing: pendingRefresh }) => {
        if (!active) return
        setPayload(next)
        setPreviewMode(!!preview)
        setLockedCount(preview ? locked : 0)
        setRefreshing(pendingRefresh === true)
        setLoaded(true)
      })
      .catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [loadAttempt])
  const [refreshExhausted, clearRefreshExhausted] = useFullBoardRefresh('nfl_game_markets', (snapshot) => {
    const next = snapshot.data && typeof snapshot.data === 'object' && !Array.isArray(snapshot.data)
      ? snapshot.data
      : { games: Array.isArray(snapshot.data) ? snapshot.data : [], status: 'ok' }
    setPayload(next)
    setPreviewMode(false)
    setLockedCount(0)
    setRefreshing(false)
    setError('')
    setLoaded(true)
  })
  const phase = useMemberBoardPhase('nfl', { refreshing: refreshing && !refreshExhausted, exhausted: refreshExhausted })
  const hold = phase === 'loading' || phase === 'exhausted'
  const showPaywall = phase === 'free'
  const retryLoad = () => {
    clearRefreshExhausted()
    setError('')
    setLoaded(false)
    setLoadAttempt((current) => current + 1)
  }

  const games = useMemo(() => (Array.isArray(payload?.games) ? payload.games : []), [payload])
  const hideTotalEdges = previewMode && games.every((game) => finite(game.total?.edge) == null)
  const activeFilters = hideTotalEdges && (filters.side === 'Total +' || filters.sortBy === 'Total edge')
    ? { ...filters, side: filters.side === 'Total +' ? 'All' : filters.side, sortBy: filters.sortBy === 'Total edge' ? 'Kickoff' : filters.sortBy }
    : filters
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }))
  const resetFilters = () => setFilters(DEFAULT_FILTERS)
  const days = useMemo(() => ['All', ...Array.from(new Set(games.map((game) => game.weekday).filter(Boolean)))], [games])

  const rows = useMemo(() => {
    const query = activeFilters.team.trim().toLowerCase()
    const edgeMin = activeFilters.edgeMin === '' ? -Infinity : Number(activeFilters.edgeMin)
    const edgeMax = activeFilters.edgeMax === '' ? Infinity : Number(activeFilters.edgeMax)
    const filtered = games.filter((game) => {
      if (activeFilters.day !== 'All' && game.weekday !== activeFilters.day) return false
      if (query) {
        const haystack = `${game.awayTeam} ${game.homeTeam} ${game.awayName} ${game.homeName}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      if (activeFilters.side === 'Spread +' && !(finite(game.spread?.edge) > 0)) return false
      if (!hideTotalEdges && activeFilters.side === 'Total +' && !(finite(game.total?.edge) > 0)) return false
      const edge = relevantEdge(game, activeFilters, hideTotalEdges)
      if (activeFilters.edgeMin !== '' || activeFilters.edgeMax !== '') {
        if (edge == null || edge < edgeMin || edge > edgeMax) return false
      }
      return true
    })
    const rank = {
      Edge: (game) => edgeRank(game, { includeTotal: !hideTotalEdges }) ?? -Infinity,
      'Spread edge': (game) => finite(game.spread?.edge) ?? -Infinity,
      ...(hideTotalEdges ? {} : { 'Total edge': (game) => finite(game.total?.edge) ?? -Infinity }),
    }[activeFilters.sortBy]
    if (!rank) return filtered
    return [...filtered].sort((a, b) => rank(b) - rank(a))
  }, [games, activeFilters, hideTotalEdges])

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
      {modelLabel && <p className="nfl-game-note">{modelLabel}. Posted lines are Unabated only. CG NUMBER is each team's projected score. The total is those two scores added together.</p>}
      {hold && <MemberBoardStatus phase={phase} onRetry={retryLoad} />}
      {!hold && error && <div className="nfl-notice">Unable to load game markets: {error}</div>}
      {!hold && !error && !loaded && <div className="nfl-notice">Loading NFL game markets.</div>}
      {showPaywall && !error && loaded && !games.length && lockedCount > 0 && <div className="nfl-notice">Game markets are locked. {lockedCount} games are locked. Upgrade to see the full board.</div>}
      {!hold && !error && loaded && !games.length && lockedCount <= 0 && <div className="nfl-notice">{payload?.message || 'No NFL games are posted right now.'}</div>}
      {!hold && !error && loaded && !!games.length && !rows.length && <div className="nfl-notice">No games match these filters.</div>}
      {!hold && !!rows.length && (
        <div className="nfl-game-board">
          {rows.map((game) => <GameCard key={game.id || `${game.awayTeam}-${game.homeTeam}`} game={game} hideTotalEdge={hideTotalEdges} />)}
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
        hideTotalEdge={hideTotalEdges}
      />
    </section>
  )
}
