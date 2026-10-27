import { useEffect, useMemo, useState } from 'react'
import NhlAvatar from './NhlAvatar.jsx'
import { fetchNhlProjections } from './nhlData'
import { ShowAllLinesToggle, useShowAllLines } from '../ShowAllLinesToggle'
import { MemberPreviewNotice } from '../MemberPreviewNotice'
import { QuietMemberPreview } from '../QuietMemberPreview'
import { MemberBoardStatus } from '../MemberBoardStatus'
import { useMemberBoardPhase } from '../useMemberBoardPhase'
import { useFullBoardRefresh } from '../useFullBoardRefresh'
import BoardStatus from '../BoardStatus'
import { sortBoard } from './NhlPropLines'
import { initialBoardSort, rememberBoardSort } from '../boardSort'
import { NhlFiltersButton, NhlFiltersPanel } from './NhlBoardFilters.jsx'
import {
  DEFAULT_NHL_FILTERS,
  NHL_PROP_TABS,
  NHL_SORT_OPTIONS,
  filterNhlRows,
  nhlFiltersNarrowed,
  nhlLineBounds,
  nhlMatchupOptions,
  nhlTeamOptions,
} from './nhlBoardFilters.js'
import { fitImage } from '../fitImage.js'
import { teamLogoUrl } from './nhlTeams'
import { opponentLabel } from '../cardMark'
import { CardTeamLogo } from '../CardTeamLogo'
import { cgScore, lineMatchesStat } from '../cgScore'
import { prepareBoardRows } from './pointsGate.js'
import { BoardLoadError } from '../BoardLoadError'
import { pickSide, sideClass } from '../pickSide.js'
import { ChartDateRow } from '../MiniHitBars'
import { tailChartBars } from '../chartLabels'

function chipLabel(name) {
  if (name === 'All Props') return 'ALL'
  return name.split(' ')[0]
}

function formatValue(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

function initials(name) {
  return String(name || '').split(' ').map((part) => part[0]).join('').slice(0, 2)
}

function Card({ item, onSelectPlayer }) {
  const bars = tailChartBars(item)
  const recent = bars.map((bar) => bar.value)
  const fullRecent = Array.isArray(item.recent) ? item.recent : []
  const allSeasons = Array.isArray(item.chartSeasons) ? item.chartSeasons : []
  const seasons = allSeasons.length === fullRecent.length ? allSeasons.slice(-recent.length) : []
  const score = cgScore(item.projection, item.line, item.prop)
  const side = pickSide(item.projection, item.line, score)
  const maxValue = Math.max(item.line, ...recent, 1)
  return (
    <article className="nfl-edge-card">
      <div className="nfl-card-topline">
        <span>{item.goalieStatus === 'probable' ? <b className="nhl-probable">PROBABLE</b> : (typeof item.oddsType === 'string' && item.oddsType && item.oddsType !== 'standard' ? item.oddsType.toUpperCase() : 'FULL GAME')}</span>
        <b className={sideClass(side)}>{side ? `${side} ` : ''}{score == null ? '—' : score.toFixed(1)}</b>
      </div>
      <div className="nfl-card-player">
        <div className="nfl-card-avatar"><NhlAvatar item={item} initials={initials(item.player)} /></div>
        <div>
          <h2 className="nfl-player-link" onClick={() => onSelectPlayer(item)}>{item.player}</h2>
          <p><b>{item.position}</b><CardTeamLogo team={item.team} src={teamLogoUrl(item.team) ? fitImage(teamLogoUrl(item.team), 16) : ''} /><span>{item.team}</span>{item.opponent ? <em>{opponentLabel(item.opponent)}</em> : null}</p>
        </div>
      </div>
      <div className="nfl-card-prop">{item.prop}</div>
      <div className="nfl-card-metrics">
        <div><small>LINE</small><strong>{formatValue(item.line)}</strong></div>
        <div><small>MODEL</small><strong>{formatValue(item.projection)}</strong></div>
        <div><small>SCORE</small><strong className={sideClass(side)}>{score == null ? '—' : score.toFixed(1)}</strong></div>
        <div><small>DVP</small><strong>{item.dvpRank || '—'}<i> /32</i></strong></div>
      </div>
      <div className="nfl-card-meta">
        <div><small>2026-27</small><strong>{item.seasonHitRate == null ? '—' : `${item.seasonHitRate}%`}</strong></div>
        <div><small>2025-26</small><strong>{item.priorSeasonHitRate == null ? '—' : `${item.priorSeasonHitRate}%`}</strong></div>
        <div><small>L10</small><strong>{item.hitRate == null ? '—' : `${item.hitRate}%`}</strong></div>
        <div><small>H2H</small><strong>{item.h2hHitRate == null ? '—' : `${item.h2hHitRate}%`}</strong></div>
      </div>
      <div className="nfl-history-label">
        <span>LAST {recent.length}{item.chartIncludesPriorSeason ? ' · INCLUDES 2025-26' : ''}</span>
        <span>{item.hitRate == null ? '' : `${item.hitRate}% OVER`}</span>
      </div>
      <div className="nfl-history-bars">
        {recent.map((value, index) => (
          <span className={value > item.line ? 'hit' : value === item.line ? 'push' : 'miss'} style={{ height: `${Math.max(12, (value / maxValue) * 52)}px` }} key={`${item.id}-${index}`}>
            <i>{formatValue(value)} · {bars[index]?.date || ''} {seasons[index] === '2025-26' ? 'last season' : ''}</i>
          </span>
        ))}
      </div>
      <ChartDateRow bars={bars} logoFor={teamLogoUrl} />
    </article>
  )
}

export default function NhlProjections({ onSelectPlayer }) {
  const [projections, setProjections] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [showingPreview, setShowingPreview] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState('All Props')
  const [query, setQuery] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState(() => ({
    ...DEFAULT_NHL_FILTERS,
    sortBy: initialBoardSort('nhl', NHL_SORT_OPTIONS),
  }))
  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }))
    if (key === 'sortBy') rememberBoardSort('nhl', value)
  }
  const resetFilters = () => {
    setFilters(DEFAULT_NHL_FILTERS)
    rememberBoardSort('nhl', DEFAULT_NHL_FILTERS.sortBy)
  }

  useEffect(() => {
    let active = true
    fetchNhlProjections()
      .then(({ projections: next, updatedAt: publishedAt, preview, refreshing: pendingRefresh }) => {
        if (active) { setProjections(next); setUpdatedAt(publishedAt || null); setShowingPreview(preview === true); setRefreshing(pendingRefresh === true); setError(''); setLoaded(true) }
      })
      .catch((loadError) => active && setError(loadError))
    return () => { active = false }
  }, [loadAttempt])

  const [refreshExhausted, clearRefreshExhausted] = useFullBoardRefresh('nhl_projections', (snapshot) => {
    setProjections(Array.isArray(snapshot.data) ? snapshot.data : [])
    setUpdatedAt(snapshot.updatedAt || null)
    setShowingPreview(false)
    setRefreshing(false)
    setError('')
    setLoaded(true)
  })
  const phase = useMemberBoardPhase('nhl', { refreshing: refreshing && !refreshExhausted, exhausted: refreshExhausted })
  const hold = phase === 'loading' || phase === 'exhausted'
  const showPaywall = phase === 'free'

  const retryLoad = () => {
    clearRefreshExhausted()
    setError('')
    setLoaded(false)
    setLoadAttempt((current) => current + 1)
  }

  const { showAllLines, setShowAllLines, allPayload } = useShowAllLines(
    `${loadAttempt}:${updatedAt || ''}`,
    () => fetchNhlProjections({ showAllLines: true }),
  )
  const boardProjections = showAllLines && allPayload ? allPayload.projections : projections
  const sortKey = NHL_SORT_OPTIONS.includes(filters.sortBy) ? filters.sortBy : 'CG Score'
  const prepared = useMemo(
    () => prepareBoardRows(boardProjections).filter((item) => lineMatchesStat(item.prop, item.line)),
    [boardProjections],
  )
  const rows = useMemo(
    () => sortBoard(filterNhlRows(prepared, { propTab: tab, filters, query }), sortKey),
    [prepared, tab, filters, query, sortKey],
  )
  const bounds = useMemo(() => nhlLineBounds(prepared), [prepared])
  const teams = useMemo(() => nhlTeamOptions(prepared), [prepared])
  const matchups = useMemo(() => nhlMatchupOptions(prepared), [prepared])

  return (
    <section>
      <div className="nfl-board-header">
        <div><p>NHL / PRIZEPICKS</p><h1>Board</h1><BoardStatus sport="nhl" updatedAt={updatedAt} /></div>
        <ShowAllLinesToggle pressed={showAllLines} onChange={setShowAllLines} />
      </div>
      <p className="nhl-note">One card per player and prop. Demon and goblin unders stay hidden until Show all lines. Probable goalies are tagged and sorted to the bottom. When a starter is confirmed, other goalie lines on that team come off the board.</p>
      <div className="nfl-edge-controls">
        <label><span>PLAYER</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search player" /></label>
        <label>
          <span>SORT</span>
          <select aria-label="Sort" value={sortKey} onChange={(event) => updateFilter('sortBy', event.target.value)}>
            {NHL_SORT_OPTIONS.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
        <label>
          <span>MATCHUP</span>
          <select aria-label="Matchup" value={filters.matchup} onChange={(event) => updateFilter('matchup', event.target.value)}>
            {matchups.map((option) => <option key={option} value={option}>{option === 'All' ? 'All matchups' : option}</option>)}
          </select>
        </label>
        <NhlFiltersButton open={filtersOpen} narrowed={nhlFiltersNarrowed(filters)} onOpen={() => setFiltersOpen(true)} />
        <div className="nfl-position-tabs">
          {NHL_PROP_TABS.map((name) => <button key={name} className={name === tab ? 'active' : ''} onClick={() => setTab(name)}>{chipLabel(name)}</button>)}
        </div>
      </div>
      {hold && <MemberBoardStatus phase={phase} onRetry={retryLoad} />}
      <QuietMemberPreview phase={phase} preview={showingPreview} refreshing={refreshing} onRetry={retryLoad} />
      {!hold && error && <BoardLoadError error={error} prefix="Unable to load the board:" onRetry={retryLoad} />}
      {showPaywall && <MemberPreviewNotice preview={showingPreview} exhausted={refreshExhausted} onRetry={retryLoad} />}
      {!hold && !error && !loaded && <div className="nfl-notice">Loading the PrizePicks board.</div>}
      {!hold && !error && loaded && !rows.length && <div className="nfl-notice">No cards match.</div>}
      {!hold && (
        <div className="nfl-edge-grid">
          {rows.map((item) => <Card key={item.id || `${item.player}-${item.prop}`} item={item} onSelectPlayer={onSelectPlayer} />)}
        </div>
      )}
      <NhlFiltersPanel
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        updateFilter={updateFilter}
        resetFilters={resetFilters}
        propTab={tab}
        setPropTab={setTab}
        lineBounds={bounds}
        teams={teams}
        matchups={matchups}
        resultCount={rows.length}
      />
    </section>
  )
}
