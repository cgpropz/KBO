import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchNflProjections, fetchNflSharpOdds } from './nflData'
import { MemberPreviewNotice } from '../MemberPreviewNotice'
import { QuietMemberPreview } from '../QuietMemberPreview'
import { MemberBoardStatus } from '../MemberBoardStatus'
import { useMemberBoardPhase } from '../useMemberBoardPhase'
import { previewLockedCount, useFullBoardRefresh } from '../useFullBoardRefresh'
import BoardStatus from '../BoardStatus'
import { dvpGrade } from './matchupGrade'
import { AdjMatchupChip } from './MatchupDefense'
import { useNflMatchupDefense } from './useNflMatchupDefense'
import { teamLogoUrl } from './nflTeams'
import { fitImage } from '../fitImage.js'
import { BoardOddsPanel, OddsChevron, boardOddsFor, useBoardOdds } from './BoardOddsPanel'
import HitRateStrip from '../HitRateStrip'
import { nflHitPills } from '../hitRateStrip'
import { cgSide, lineMatchesStat } from '../cgScore'
import { compareNflScores, nflCgScore, nflRawScore } from './nflLineFloors'
import { compareSymmetric, symmetricRankOn } from '../sideRank'
import { buildCgScoreExplainer } from '../cgScoreExplainer'
import { CgScoreCell, CgScoreNote } from '../CgScoreExplainer'
import { BoardSkeleton } from '../BootScreen.jsx'
import { BoardLine, BoardSurface, LockedPlaceholder } from '../PropLineCard'
import { rememberBoardSort, withDefaultSort } from '../boardSort'
import { usePhoneBoard, usePhonePaintCount } from '../usePhoneBoard'
import { BoardLoadError } from '../BoardLoadError'
import { countedLines, lineClause, lineWord } from '../lineCount'
import { opponentLabel } from '../cardMark'
import { CardTeamLogo } from '../CardTeamLogo'

const FREE_ROW_LIMIT = 3

const PROP_TABS = ['All Props', 'Pass Yards', 'Pass Attempts', 'Pass Completions', 'Pass TDs', 'Rush Yards', 'Rush Attempts', 'Receiving Yards', 'Receptions', 'Rec Targets', 'Pass+Rush Yds', 'Rush+Rec Yds']
const SEASON_LABEL = String(new Date().getFullYear())
const SORT_OPTIONS = ['Hit Rate', 'CG Score', `${SEASON_LABEL} Hit Rate`, 'H2H Hit Rate', 'DVP Rank']
const HIT_RATE_OPTIONS = [0, 50, 70, 90, 100]
const GAMES_OPTIONS = [0, 3, 5, 8, 10]
const POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE']
const GRADE_OPTIONS = ['All Grades', 'A', 'B', 'C', 'D', 'F']
const DEFAULT_FILTERS = { side: 'All', sortBy: 'CG Score', minHitRate: 0, minGames: 0, position: 'All', grade: 'All Grades', edgeMin: '', edgeMax: '', lineMin: '', lineMax: '' }

function formatValue(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1)
}

function initials(name) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2)
}

function ordinal(rank) {
  const remainder = rank % 100
  if (remainder >= 11 && remainder <= 13) return `${rank}th`
  switch (rank % 10) {
    case 1: return `${rank}st`
    case 2: return `${rank}nd`
    case 3: return `${rank}rd`
    default: return `${rank}th`
  }
}

function gradeClass(grade) {
  if (!grade) return 'grade-na'
  return `grade-${grade[0].toLowerCase()}`
}

const DVP_RED = [255, 123, 121]
const DVP_NEUTRAL = [120, 145, 138]
const DVP_GREEN = [127, 255, 104]

function mixColor(a, b, t) {
  return a.map((channel, index) => Math.round(channel + (b[index] - channel) * t))
}

// 1 = toughest matchup (red) -> 15 = neutral -> 32 = easiest matchup (green)
function dvpColor(rank) {
  if (!rank) return null
  const value = Math.max(1, Math.min(32, rank))
  const [r, g, b] = value <= 15
    ? mixColor(DVP_RED, DVP_NEUTRAL, (value - 1) / 14)
    : mixColor(DVP_NEUTRAL, DVP_GREEN, (value - 15) / 17)
  return `rgb(${r}, ${g}, ${b})`
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

function MiniChart({ recent, line }) {
  const maxValue = Math.max(line, ...recent, 1)
  return (
    <div className="nfl-lines-chart" aria-hidden="true">
      {recent.map((value, index) => (
        <span key={index} className={value > line ? 'hit' : value === line ? 'push' : 'miss'} style={{ height: `${Math.max(14, (value / maxValue) * 100)}%` }} />
      ))}
    </div>
  )
}

function PropRow({ item, onSelectPlayer, locked, rowRef, open, onToggle, whyOpen, onWhy, odds, oddsState, seen, phone, matchupDefense }) {
  const recent = Array.isArray(item.recent) ? item.recent : []
  // Side from the CG Score. Exactly 50 is no pick: no O/U letter, no color.
  const side = cgSide(item.score)
  const sideClass = side === 'OVER' ? 'over' : side === 'UNDER' ? 'under' : 'neutral'
  const grade = dvpGrade(item.dvpRank)
  const stripId = `nfl-board-odds-${String(item.id).replace(/[^a-zA-Z0-9_-]+/g, '-')}`
  const scoreNote = buildCgScoreExplainer({
    player: item.player,
    projection: item.projection,
    line: item.line,
    stat: item.prop,
    score: item.score,
    recentValues: recent,
    symmetric: symmetricRankOn('nfl'),
  })

  const note = whyOpen && !locked && scoreNote
    ? (phone ? <CgScoreNote note={scoreNote} /> : (
      <tr className="cg-score-note-row" ref={open ? undefined : rowRef}>
        <td colSpan={6}><CgScoreNote note={scoreNote} /></td>
      </tr>
    ))
    : null
  const oddsRow = open && !locked
    ? (phone ? <BoardOddsPanel item={item} odds={odds} oddsState={oddsState} seen={seen} /> : (
      <tr className="nfl-sharp-strip-row" id={stripId} ref={rowRef}>
        <td colSpan={6}><BoardOddsPanel item={item} odds={odds} oddsState={oddsState} seen={seen} /></td>
      </tr>
    ))
    : null
  return (
    <BoardLine
      phone={phone}
      className={`nfl-lines-row${locked ? ' locked' : ''}${open ? ' is-open' : ''}`}
      rowRef={open || whyOpen ? undefined : rowRef}
      onClick={locked ? undefined : onToggle}
      cells={[
        { node: (
          <div className="nfl-lines-player">
            <div className="nfl-lines-avatar">{item.imageUrl ? <img src={fitImage(item.imageUrl, 42)} alt={item.player} width={42} height={42} loading="lazy" /> : initials(item.player)}</div>
            <div className="nfl-lines-info">
              <button className="nfl-player-link" onClick={(event) => { event.stopPropagation(); if (!locked) onSelectPlayer(item.player, item.prop) }}>{item.player}</button>
              <span className="nfl-lines-tag"><CardTeamLogo team={item.team} src={teamLogoUrl(item.team) ? fitImage(teamLogoUrl(item.team), 16) : ''} />{item.team}, {item.position}</span>
              <div className={`nfl-lines-line ${sideClass}`}>{side ? <b>{side === 'OVER' ? 'O' : 'U'}</b> : null} {formatValue(item.line)} {item.prop}</div>
            </div>
            <OddsChevron open={open} player={item.player} onToggle={onToggle} disabled={locked} />
          </div>
        ) },
        { className: 'hit-rate-chart', node: <MiniChart recent={recent} line={item.line} /> },
        { className: `hit-rate-score ${sideClass}`, node: (
          <CgScoreCell scoreText={item.score.toFixed(1)} score={item.score} side={item.side} symmetric={symmetricRankOn('nfl')} note={locked ? null : scoreNote} open={whyOpen} onToggle={onWhy} />
        ) },
        { className: 'hit-rate-col', node: <HitRateStrip pills={item.hitPills} /> },
        { className: 'hit-rate-extra', style: item.dvpRank ? { color: dvpColor(item.dvpRank) } : undefined, node: <><span className="nfl-dvp-label">DvP</span> {item.dvpRank ? ordinal(item.dvpRank) : '—'}</> },
        { node: (
          <div className="nfl-lines-matchup">
            {item.opponent ? <span className="board-vs">{opponentLabel(item.opponent)}</span> : null}
            <span className={`nfl-grade ${gradeClass(grade)}`}>{grade || '—'}</span>
            {!locked && <AdjMatchupChip payload={matchupDefense} prop={item.prop} position={item.position} opponent={item.opponent} />}
          </div>
        ) },
      ]}
      after={(
        <>
          {note}
          {oddsRow}
        </>
      )}
    />
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

function FiltersPanel({ open, onClose, filters, updateFilter, resetFilters, propTab, setPropTab, lineBounds, resultCount }) {
  const [expandedRow, setExpandedRow] = useState(null)
  const toggleRow = (id) => setExpandedRow((current) => (current === id ? null : id))

  if (!open) return null
  return (
    <div className="nfl-filters-overlay" onClick={onClose}>
      <div className="nfl-filters-panel" onClick={(event) => event.stopPropagation()}>
        <div className="nfl-filters-head">
          <h2>Filters</h2>
          <button className="nfl-filters-close" onClick={onClose}>Close <span>&times;</span></button>
        </div>
        <div className="nfl-filters-side">
          {['All', 'Overs', 'Unders'].map((option) => (
            <button key={option} className={filters.side === option ? 'active' : ''} onClick={() => updateFilter('side', option)}>{option}</button>
          ))}
        </div>

        <FilterRow id="sort" label="Sort By" value={filters.sortBy} expandedRow={expandedRow} onToggle={toggleRow}>
          <select value={filters.sortBy} onChange={(event) => updateFilter('sortBy', event.target.value)}>
            {SORT_OPTIONS.map((option) => <option key={option}>{option}</option>)}
          </select>
        </FilterRow>

        <FilterRow id="hitrate" label="Hit Rates" value={`L10 > ${filters.minHitRate}%`} expandedRow={expandedRow} onToggle={toggleRow}>
          <div className="nfl-filter-chip-row">
            {HIT_RATE_OPTIONS.map((option) => (
              <button key={option} className={filters.minHitRate === option ? 'active' : ''} onClick={() => updateFilter('minHitRate', option)}>{option === 0 ? 'All' : `>${option}%`}</button>
            ))}
          </div>
        </FilterRow>

        <FilterRow id="prop" label="Prop Type" value={propTab} expandedRow={expandedRow} onToggle={toggleRow}>
          <select value={propTab} onChange={(event) => setPropTab(event.target.value)}>
            {PROP_TABS.map((option) => <option key={option}>{option}</option>)}
          </select>
        </FilterRow>

        <FilterRow id="games" label="Games" value={filters.minGames === 0 ? 'All' : `${filters.minGames}+`} expandedRow={expandedRow} onToggle={toggleRow}>
          <div className="nfl-filter-chip-row">
            {GAMES_OPTIONS.map((option) => (
              <button key={option} className={filters.minGames === option ? 'active' : ''} onClick={() => updateFilter('minGames', option)}>{option === 0 ? 'All' : `${option}+`}</button>
            ))}
          </div>
        </FilterRow>

        <FilterRow id="position" label="Positions" value={filters.position} expandedRow={expandedRow} onToggle={toggleRow}>
          <div className="nfl-filter-chip-row">
            {POSITIONS.map((option) => (
              <button key={option} className={filters.position === option ? 'active' : ''} onClick={() => updateFilter('position', option)}>{option}</button>
            ))}
          </div>
        </FilterRow>

        <FilterRow id="edge" label="CG Score" value={filters.edgeMin || filters.edgeMax ? `${filters.edgeMin || '—'} to ${filters.edgeMax || '—'}` : 'All'} expandedRow={expandedRow} onToggle={toggleRow}>
          <div className="nfl-filter-range-row">
            <input type="number" placeholder="Min" value={filters.edgeMin} onChange={(event) => updateFilter('edgeMin', event.target.value)} />
            <span>to</span>
            <input type="number" placeholder="Max" value={filters.edgeMax} onChange={(event) => updateFilter('edgeMax', event.target.value)} />
          </div>
        </FilterRow>

        <FilterRow id="lines" label="Lines" value={filters.lineMin || filters.lineMax ? `${filters.lineMin || lineBounds.min} to ${filters.lineMax || lineBounds.max}` : `${lineBounds.min} to ${lineBounds.max}`} expandedRow={expandedRow} onToggle={toggleRow}>
          <div className="nfl-filter-range-row">
            <input type="number" placeholder={String(lineBounds.min)} value={filters.lineMin} onChange={(event) => updateFilter('lineMin', event.target.value)} />
            <span>to</span>
            <input type="number" placeholder={String(lineBounds.max)} value={filters.lineMax} onChange={(event) => updateFilter('lineMax', event.target.value)} />
          </div>
        </FilterRow>

        <FilterRow id="grade" label="Matchup Grade" value={filters.grade} expandedRow={expandedRow} onToggle={toggleRow}>
          <select value={filters.grade} onChange={(event) => updateFilter('grade', event.target.value)}>
            {GRADE_OPTIONS.map((option) => <option key={option}>{option}</option>)}
          </select>
        </FilterRow>

        <div className="nfl-filters-footer">
          <button className="nfl-filters-reset" onClick={resetFilters}>Reset</button>
          <button className="nfl-filters-apply" onClick={onClose}>Show {resultCount} {lineWord(resultCount)}</button>
        </div>
      </div>
    </div>
  )
}

export default function NflPropLines({ onSelectPlayer, onNavigatePricing }) {
  const matchupDefense = useNflMatchupDefense()
  const [projections, setProjections] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [propTab, setPropTab] = useState('All Props')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState(() => withDefaultSort(DEFAULT_FILTERS, 'nfl', SORT_OPTIONS))
  const phone = usePhoneBoard()
  const [openId, setOpenId] = useState(null)
  const [whyId, setWhyId] = useState(null)

  const [lockedCount, setLockedCount] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [memberPreview, setMemberPreview] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const { index: oddsIndex, oddsState, reload: reloadOdds } = useBoardOdds(
    ({ fresh = false } = {}) => fetchNflSharpOdds({ fresh }).then(({ records, preview }) => ({ records, preview })),
    { enabled: loaded },
  )

  const tableWrapRef = useRef(null)
  const lastFreeRowRef = useRef(null)
  const [lockTop, setLockTop] = useState(null)

  useEffect(() => {
    let active = true
    fetchNflProjections().then(({ projections: next, updatedAt: publishedAt, preview, lockedCount: locked, refreshing: pendingRefresh }) => { if (!active) return; setProjections(next); setUpdatedAt(publishedAt || null); setLockedCount(previewLockedCount(preview, locked)); setMemberPreview(preview === true); setRefreshing(pendingRefresh === true); setError(''); setLoaded(true) }).catch((loadError) => active && setError(loadError))
    return () => { active = false }
  }, [loadAttempt])

  const [refreshExhausted, clearRefreshExhausted] = useFullBoardRefresh('nfl_projections', (snapshot) => {
    setProjections(Array.isArray(snapshot.data) ? snapshot.data : [])
    setUpdatedAt(snapshot.updatedAt || null)
    setLockedCount(0)
    setRefreshing(false)
    setMemberPreview(false)
    setError('')
    setLoaded(true)
    reloadOdds()
  })
  const phase = useMemberBoardPhase('nfl', { refreshing: refreshing && !refreshExhausted, exhausted: refreshExhausted })
  const hold = phase === 'loading' || phase === 'exhausted'
  const showPaywall = phase === 'free'
  const isPaid = phase === 'member'

  const retryLoad = () => {
    clearRefreshExhausted()
    setError('')
    setLoaded(false)
    setLoadAttempt((current) => current + 1)
  }

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }))
    if (key === 'sortBy') rememberBoardSort('nfl', value)
  }
  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS)
    rememberBoardSort('nfl', DEFAULT_FILTERS.sortBy)
  }

  const lineBounds = useMemo(() => {
    const lines = projections.map((item) => item.line).filter((value) => typeof value === 'number')
    if (!lines.length) return { min: 0, max: 0 }
    return { min: Math.floor(Math.min(...lines) * 10) / 10, max: Math.ceil(Math.max(...lines) * 10) / 10 }
  }, [projections])

  const rows = useMemo(() => {
    const withScore = projections.filter((item) => lineMatchesStat(item.prop, item.line)).map((item) => {
      const pills = nflHitPills(item)
      const byId = Object.fromEntries(pills.map((pill) => [pill.id, pill]))
      return {
        ...item,
        hitPills: pills,
        hitRate: byId.l10?.rate ?? 0,
        gamesPlayed: byId.l10?.games ?? 0,
        seasonHitRate: byId.season?.rate ?? null,
        h2hHitRate: byId.h2h?.rate ?? null,
        score: nflCgScore(item.projection, item.line, item.prop) ?? 0,
        rawScore: nflRawScore(item.projection, item.line, item.prop),
        side: cgSide(nflCgScore(item.projection, item.line, item.prop)),
      }
    })
    const edgeMin = filters.edgeMin === '' ? -Infinity : Number(filters.edgeMin)
    const edgeMax = filters.edgeMax === '' ? Infinity : Number(filters.edgeMax)
    const lineMin = filters.lineMin === '' ? -Infinity : Number(filters.lineMin)
    const lineMax = filters.lineMax === '' ? Infinity : Number(filters.lineMax)

    const filtered = withScore
      .filter((item) => propTab === 'All Props' || item.prop === propTab)
      .filter((item) => filters.side === 'All' || (filters.side === 'Overs' ? item.side === 'OVER' : item.side === 'UNDER'))
      .filter((item) => item.hitRate >= filters.minHitRate)
      .filter((item) => item.gamesPlayed >= filters.minGames)
      .filter((item) => filters.position === 'All' || item.position === filters.position)
      .filter((item) => item.score >= edgeMin && item.score <= edgeMax)
      .filter((item) => item.line >= lineMin && item.line <= lineMax)
      .filter((item) => {
        if (filters.grade === 'All Grades') return true
        const grade = dvpGrade(item.dvpRank)
        return grade && grade[0] === filters.grade
      })

    const symmetric = symmetricRankOn('nfl')
    return filtered.sort((a, b) => {
      if (filters.sortBy === 'CG Score') return symmetric ? compareSymmetric(a, b) : compareNflScores(a.score, a.rawScore, b.score, b.rawScore)
      if (filters.sortBy === `${SEASON_LABEL} Hit Rate`) return (b.seasonHitRate ?? -1) - (a.seasonHitRate ?? -1)
      if (filters.sortBy === 'H2H Hit Rate') return (b.h2hHitRate ?? -1) - (a.h2hHitRate ?? -1)
      if (filters.sortBy === 'DVP Rank') return (b.dvpRank ?? 0) - (a.dvpRank ?? 0)
      return b.hitRate - a.hitRate
    })
  }, [projections, propTab, filters])

  const paintCount = usePhonePaintCount(phone, rows.length)
  const visibleRows = rows.slice(0, paintCount)
  const hasLockedRows = showPaywall && (rows.length > FREE_ROW_LIMIT || lockedCount > 0)
  const lastFreeIndex = Math.min(rows.length, FREE_ROW_LIMIT) - 1
  const placeholderCount = isPaid || lockedCount <= 0 ? 0 : Math.max(4, Math.min(lockedCount, 6))

  useEffect(() => {
    if (!hasLockedRows) return
    const measure = () => {
      if (tableWrapRef.current && lastFreeRowRef.current) {
        const wrapTop = tableWrapRef.current.getBoundingClientRect().top
        const rowBottom = lastFreeRowRef.current.getBoundingClientRect().bottom
        setLockTop(rowBottom - wrapTop)
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [hasLockedRows, rows, openId, whyId])

  return (
    <section className="nfl-lines-page">
      <div className="nfl-lines-tabs">
        {PROP_TABS.map((tab) => (
          <button key={tab} className={tab === propTab ? 'active' : ''} onClick={() => setPropTab(tab)}>{tab}</button>
        ))}
      </div>
      <div className="nfl-board-header">
        <div><p>NFL / PRIZEPICKS</p><h1>Prop Lines</h1><BoardStatus sport="nfl" updatedAt={updatedAt} /></div>
        <div className="nfl-lines-header-actions">
          <span>{hold ? '' : `${countedLines(rows.length, { locked: showPaywall ? lockedCount : 0 })} · sorted by ${filters.sortBy}`}</span>
          <button className={`nfl-filters-btn${filtersOpen ? ' active' : ''}`} onClick={() => setFiltersOpen(true)}><FilterIcon /> Filters</button>
        </div>
      </div>
      {hold && <MemberBoardStatus phase={phase} onRetry={retryLoad} />}
      <QuietMemberPreview phase={phase} preview={memberPreview} refreshing={refreshing} onRetry={retryLoad} />
      {!hold && error && <BoardLoadError error={error} prefix="Unable to load the NFL snapshot:" onRetry={retryLoad} />}
      {showPaywall && <MemberPreviewNotice exhausted={refreshExhausted} onRetry={retryLoad} />}
      {!hold && !error && !loaded && (
        <div role="status" aria-label="Loading NFL prop lines">
          <BoardSkeleton />
        </div>
      )}
      {!hold && !error && loaded && !projections.length && showPaywall && lockedCount > 0 && (
        <div className="nfl-lines-lock-card">
          <div className="nfl-lines-lock-icon">🔒</div>
          <h3>Unlock the Full Board</h3>
          <p>{lockedCount} {lineClause(lockedCount)} locked. Upgrade to see every prop line.</p>
          <button onClick={onNavigatePricing}>View Plans</button>
        </div>
      )}
      {!hold && !error && loaded && !projections.length && !showPaywall && <div className="nfl-notice">No NFL prop lines are posted right now. Check back closer to kickoff.</div>}
      {!hold && !error && loaded && !!projections.length && !rows.length && <div className="nfl-notice">No NFL prop lines match these filters.</div>}
      {!hold && !!rows.length && (
        <BoardSurface
          phone={phone}
          wrapClass="nfl-lines-table-wrap"
          wrapRef={tableWrapRef}
          tableClass="nfl-lines-table hit-rate-board"
          head={<><th>Lines</th><th>L10 Chart</th><th>CG Score</th><th>Over hit rate</th><th>DVP</th><th>Matchup</th></>}
          overlay={hasLockedRows && lockTop != null && (
            <div className="nfl-lines-lock-overlay" style={{ top: lockTop }}>
              <div className="nfl-lines-lock-card">
                <div className="nfl-lines-lock-icon">🔒</div>
                <h3>Unlock the Full Board</h3>
                <p>Free members see the top {FREE_ROW_LIMIT} lines.{lockedCount > 0 ? ` ${lockedCount} more are locked.` : ''} Upgrade to see every prop line.</p>
                <button onClick={onNavigatePricing}>View Plans</button>
              </div>
            </div>
          )}
        >
          {visibleRows.map((item, index) => {
            const matched = boardOddsFor(oddsIndex, item)
            return (
              <PropRow
                key={item.id}
                item={item}
                phone={phone}
                onSelectPlayer={onSelectPlayer}
                locked={!isPaid && index >= FREE_ROW_LIMIT}
                rowRef={index === lastFreeIndex ? lastFreeRowRef : undefined}
                open={openId === item.id}
                onToggle={() => setOpenId((current) => current === item.id ? null : item.id)}
                whyOpen={whyId === item.id}
                onWhy={() => setWhyId((current) => current === item.id ? null : item.id)}
                odds={matched.odds}
                seen={matched.seen}
                oddsState={oddsState}
                matchupDefense={matchupDefense}
              />
            )
          })}
          {Array.from({ length: placeholderCount }, (_, index) => (
            <LockedPlaceholder key={`locked-${index}`} phone={phone} className="nfl-lines-row locked nfl-placeholder-row" />
          ))}
        </BoardSurface>
      )}
      <FiltersPanel
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        filters={filters}
        updateFilter={updateFilter}
        resetFilters={resetFilters}
        propTab={propTab}
        setPropTab={setPropTab}
        lineBounds={lineBounds}
        resultCount={rows.length}
      />
    </section>
  )
}
