import { useMemo, useState, useEffect, useRef } from 'react'
import { fetchWnbaData, fetchWnbaSnapshot } from './wnbaData'
import BoardStatus from '../BoardStatus'
import { wnbaRecordsAsSharp } from '../boardOdds'
import { BoardOddsPanel, OddsChevron, boardOddsFor, useBoardOdds } from '../nfl/BoardOddsPanel'
import HitRateStrip from '../HitRateStrip'
import { pillById, wnbaHitPills } from '../hitRateStrip'
import { HOT_L10_GAMES, HOT_L10_RATE, buildSlate, hotStreakRows, propsOnBoardCount, sortWnbaRows } from '../wnbaBoard'
import { wnbaCgScore } from './wnbaScore'
import { buildCgScoreExplainer } from '../cgScoreExplainer'
import { CgScoreCell, CgScoreNote } from '../CgScoreExplainer'
import { BoardSkeleton } from '../BootScreen.jsx'
import { fitImage } from '../fitImage.js'
import { BoardLine, BoardSurface, LockedPlaceholder } from '../PropLineCard'
import { rememberBoardSort, withDefaultSort } from '../boardSort'
import { usePhoneBoard } from '../usePhoneBoard'
import { countedLines, lineWord } from '../lineCount'
import { MemberPreviewNotice } from '../MemberPreviewNotice'
import { QuietMemberPreview } from '../QuietMemberPreview'
import { MemberBoardStatus } from '../MemberBoardStatus'
import { useMemberBoardPhase } from '../useMemberBoardPhase'
import { previewLockedCount, useFullBoardRefresh } from '../useFullBoardRefresh'
import { BoardLoadError } from '../BoardLoadError'
import { opponentLabel } from '../cardMark'
import { CardTeamLogo } from '../CardTeamLogo'
import { wnbaLogoUrl } from '../slipBoardModel.js'
import { pickSide, sideClass, sideLetter } from '../pickSide.js'

const EXCLUDED_PROP_LABELS = new Set(['Points - 1st 3 Minutes'])
const FREE_ROW_LIMIT = 3

const PROP_PROJECTION = {
  Points: p => p.projPts,
  Rebounds: p => p.projReb,
  Assists: p => p.projAst,
  '3-PT Made': p => p.projFg3m,
  Steals: p => p.projStl,
  Blocks: p => p.projBlk,
  Turnovers: p => p.projTov,
  'Offensive Rebounds': p => p.projOreb,
  'Defensive Rebounds': p => p.projDreb,
  'Fantasy Score': p => p.projFantasy,
  'Reb+Asts': p => (p.projReb ?? 0) + (p.projAst ?? 0),
  'Rebs+Asts': p => (p.projReb ?? 0) + (p.projAst ?? 0),
  'Pts+Rebs': p => (p.projPts ?? 0) + (p.projReb ?? 0),
  'Pts+Asts': p => (p.projPts ?? 0) + (p.projAst ?? 0),
  'Pts+Rebs+Asts': p => (p.projPts ?? 0) + (p.projReb ?? 0) + (p.projAst ?? 0),
  'Double-Double': p => p.projDoubleDouble,
  'Triple-Double': p => p.projTripleDouble,
}

// Compute a game's actual value for a prop so we can derive hit rates client-side.
const GAME_STAT_VALUE = {
  Points: g => g.pts ?? 0,
  Rebounds: g => g.reb ?? 0,
  Assists: g => g.ast ?? 0,
  '3-PT Made': g => g.fg3m ?? 0,
  Steals: g => g.stl ?? 0,
  Blocks: g => g.blk ?? 0,
  Turnovers: g => g.tov ?? 0,
  'Offensive Rebounds': g => g.oreb ?? 0,
  'Defensive Rebounds': g => g.dreb ?? 0,
  'Fantasy Score': g => g.fantasy ?? 0,
  'Reb+Asts': g => (g.reb ?? 0) + (g.ast ?? 0),
  'Rebs+Asts': g => (g.reb ?? 0) + (g.ast ?? 0),
  'Pts+Rebs': g => (g.pts ?? 0) + (g.reb ?? 0),
  'Pts+Asts': g => (g.pts ?? 0) + (g.ast ?? 0),
  'Pts+Rebs+Asts': g => (g.pts ?? 0) + (g.reb ?? 0) + (g.ast ?? 0),
}

const SEASON_LABEL = String(new Date().getFullYear())
const PROP_TABS = ['All Props', 'Points', 'Rebounds', 'Assists', '3-PT Made', 'Steals', 'Blocks', 'Turnovers', 'Fantasy Score', 'Pts+Rebs+Asts']
const SORT_OPTIONS = ['L10 Hit Rate', 'CG Score', `${SEASON_LABEL} Hit Rate`, 'H2H Hit Rate', 'DVP Rank']
const HIT_RATE_OPTIONS = [0, 50, 70, 90, 100]
const GAMES_OPTIONS = [0, 3, 5, 8, 10]
const POSITIONS = ['All', 'Guard', 'Forward', 'Center']
const GRADE_OPTIONS = ['All Grades', 'A', 'B', 'C', 'D', 'F']
const DEFAULT_FILTERS = { side: 'All', sortBy: 'CG Score', minHitRate: 0, minGames: 0, position: 'All', grade: 'All Grades', edgeMin: '', edgeMax: '', lineMin: '', lineMax: '' }

function formatValue(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1)
}

function initials(name) {
  return (name || '').split(' ').map(w => w[0]).join('').slice(0, 2) || '?'
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

// Buckets the DVP rank (1 = toughest matchup, 15 = easiest) into a letter grade.
function dvpGrade(rank) {
  if (!rank) return null
  const pct = rank / 15
  if (pct >= .9) return 'A+'
  if (pct >= .78) return 'A'
  if (pct >= .66) return 'A-'
  if (pct >= .56) return 'B+'
  if (pct >= .46) return 'B'
  if (pct >= .36) return 'B-'
  if (pct >= .26) return 'C+'
  if (pct >= .16) return 'C'
  if (pct >= .1) return 'C-'
  if (pct >= .06) return 'D+'
  if (pct >= .03) return 'D'
  return 'F'
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

// 1 = toughest matchup (red) -> 15 = easiest matchup (green)
function dvpColor(rank) {
  if (!rank) return null
  const value = Math.max(1, Math.min(15, rank))
  const [r, g, b] = value <= 7.5
    ? mixColor(DVP_RED, DVP_NEUTRAL, (value - 1) / 6.5)
    : mixColor(DVP_NEUTRAL, DVP_GREEN, (value - 7.5) / 7.5)
  return `rgb(${r}, ${g}, ${b})`
}

function hitColor(pct) {
  if (pct == null) return '#4b5563'
  const from = [239, 68, 68], mid = [180, 180, 180], to = [34, 197, 94]
  const lerp = (a, b, t) => Math.round(a + (b - a) * Math.max(0, Math.min(1, t)))
  const [f, t_, p] = pct <= 50 ? [from, mid, pct / 50] : [mid, to, (pct - 50) / 50]
  return `rgb(${lerp(f[0], t_[0], p)},${lerp(f[1], t_[1], p)},${lerp(f[2], t_[2], p)})`
}

function FilterIcon() {
  return (
    <svg className="wnba-filters-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="7" x2="20" y2="7" /><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="17" x2="20" y2="17" /><circle cx="11" cy="17" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function MiniChart({ recent, line }) {
  const maxValue = Math.max(line, ...recent, 1)
  if (!recent.length) return <span style={{ fontSize: 11, color: '#4d635e' }}>No data</span>
  return (
    <div className="wnba-lines-chart" aria-hidden="true">
      {recent.map((value, index) => (
        <span key={index} className={value > line ? 'hit' : value === line ? 'push' : 'miss'} style={{ height: `${Math.max(14, (value / maxValue) * 100)}%` }} />
      ))}
    </div>
  )
}

function PropRow({ item, onSelectPlayer, locked, rowRef, open, onToggle, whyOpen, onWhy, odds, oddsState, seen, phone }) {
  const recent = Array.isArray(item.recent) ? item.recent : []
  const side = item.side
  const grade = dvpGrade(item.dvpRank)
  const scoreNote = buildCgScoreExplainer({
    player: item.player,
    projection: item.projection,
    line: item.line,
    stat: item.prop,
    score: item.score,
    recentValues: recent,
  })

  return (
    <BoardLine
      phone={phone}
      className={`wnba-lines-row${locked ? ' locked' : ''}${open ? ' is-open' : ''}`}
      rowRef={open || whyOpen ? undefined : rowRef}
      onClick={locked ? undefined : onToggle}
      cells={[
        { node: (
          <div className="wnba-lines-player">
            <div className="wnba-lines-avatar">
              {item.imageUrl
                ? <img src={fitImage(item.imageUrl, 42)} alt={item.player} width={42} height={42} loading="lazy" onError={e => { e.target.style.display = 'none' }} />
                : initials(item.player)}
            </div>
            <div className="wnba-lines-info">
              <button className="wnba-player-link" onClick={(event) => { event.stopPropagation(); if (!locked) onSelectPlayer?.(item.player) }}>{item.player}</button>
              <span className="wnba-lines-tag"><CardTeamLogo team={item.team} src={wnbaLogoUrl(item.team) ? fitImage(wnbaLogoUrl(item.team), 16) : ''} />{item.team}{item.position ? `, ${item.position}` : ''}</span>
              <div className={`wnba-lines-line ${sideClass(side)}`}>{side ? <b>{sideLetter(side)}</b> : null} {formatValue(item.line)} {item.prop}</div>
            </div>
            <OddsChevron open={open} player={item.player} onToggle={onToggle} disabled={locked} />
          </div>
        ) },
        { className: 'hit-rate-chart', node: <MiniChart recent={recent} line={item.line} /> },
        { className: `hit-rate-score ${sideClass(side)}`, node: (
          <CgScoreCell scoreText={item.score.toFixed(1)} note={locked ? null : scoreNote} open={whyOpen} onToggle={onWhy} />
        ) },
        { className: 'hit-rate-col', node: <HitRateStrip pills={item.hitPills} /> },
        { className: 'hit-rate-extra', style: item.dvpRank ? { color: dvpColor(item.dvpRank) } : undefined, node: item.dvpRank ? ordinal(Math.round(item.dvpRank)) : '—' },
        { node: (
          <div className="wnba-lines-matchup">
            {item.opponent ? <span className="board-vs">{opponentLabel(item.opponent)}</span> : null}
            <span className={`wnba-grade ${gradeClass(grade)}`}>{grade || '—'}</span>
          </div>
        ) },
      ]}
      after={(
        <>
          {whyOpen && !locked && scoreNote && (phone
            ? <CgScoreNote note={scoreNote} />
            : (
              <tr className="cg-score-note-row" ref={open ? undefined : rowRef}>
                <td colSpan={6}><CgScoreNote note={scoreNote} /></td>
              </tr>
            ))}
          {open && !locked && (phone
            ? <BoardOddsPanel item={item} odds={odds} oddsState={oddsState} seen={seen} />
            : (
              <tr className="nfl-sharp-strip-row" ref={rowRef}>
                <td colSpan={6}><BoardOddsPanel item={item} odds={odds} oddsState={oddsState} seen={seen} /></td>
              </tr>
            ))}
        </>
      )}
    />
  )
}

function FilterRow({ id, label, value, expandedRow, onToggle, children }) {
  const expanded = expandedRow === id
  return (
    <div className="wnba-filter-row">
      <button type="button" className="wnba-filter-row-head" onClick={() => onToggle(id)}>
        <span>{label}</span>
        <span className="wnba-filter-row-value">{value}</span>
        <i className={`wnba-filter-chevron${expanded ? ' open' : ''}`} />
      </button>
      {expanded && <div className="wnba-filter-row-body">{children}</div>}
    </div>
  )
}

function FiltersPanel({ open, onClose, filters, updateFilter, resetFilters, propTab, setPropTab, lineBounds, resultCount }) {
  const [expandedRow, setExpandedRow] = useState(null)
  const toggleRow = id => setExpandedRow(current => (current === id ? null : id))

  if (!open) return null
  return (
    <div className="wnba-filters-overlay" onClick={onClose}>
      <div className="wnba-filters-panel" onClick={event => event.stopPropagation()}>
        <div className="wnba-filters-head">
          <h2>Filters</h2>
          <button className="wnba-filters-close" onClick={onClose}>Close <span>&times;</span></button>
        </div>
        <div className="wnba-filters-side">
          {['All', 'Overs', 'Unders'].map(option => (
            <button key={option} className={filters.side === option ? 'active' : ''} onClick={() => updateFilter('side', option)}>{option}</button>
          ))}
        </div>

        <FilterRow id="sort" label="Sort By" value={filters.sortBy} expandedRow={expandedRow} onToggle={toggleRow}>
          <select value={filters.sortBy} onChange={event => updateFilter('sortBy', event.target.value)}>
            {SORT_OPTIONS.map(option => <option key={option}>{option}</option>)}
          </select>
        </FilterRow>

        <FilterRow id="hitrate" label="Hit Rates" value={`Hit Rate > ${filters.minHitRate}%`} expandedRow={expandedRow} onToggle={toggleRow}>
          <div className="wnba-filter-chip-row">
            {HIT_RATE_OPTIONS.map(option => (
              <button key={option} className={filters.minHitRate === option ? 'active' : ''} onClick={() => updateFilter('minHitRate', option)}>{option === 0 ? 'All' : `>${option}%`}</button>
            ))}
          </div>
        </FilterRow>

        <FilterRow id="prop" label="Prop Type" value={propTab} expandedRow={expandedRow} onToggle={toggleRow}>
          <select value={propTab} onChange={event => setPropTab(event.target.value)}>
            {PROP_TABS.map(option => <option key={option}>{option}</option>)}
          </select>
        </FilterRow>

        <FilterRow id="games" label="Games" value={filters.minGames === 0 ? 'All' : `${filters.minGames}+`} expandedRow={expandedRow} onToggle={toggleRow}>
          <div className="wnba-filter-chip-row">
            {GAMES_OPTIONS.map(option => (
              <button key={option} className={filters.minGames === option ? 'active' : ''} onClick={() => updateFilter('minGames', option)}>{option === 0 ? 'All' : `${option}+`}</button>
            ))}
          </div>
        </FilterRow>

        <FilterRow id="position" label="Positions" value={filters.position} expandedRow={expandedRow} onToggle={toggleRow}>
          <div className="wnba-filter-chip-row">
            {POSITIONS.map(option => (
              <button key={option} className={filters.position === option ? 'active' : ''} onClick={() => updateFilter('position', option)}>{option}</button>
            ))}
          </div>
        </FilterRow>

        <FilterRow id="edge" label="CG Score" value={filters.edgeMin || filters.edgeMax ? `${filters.edgeMin || '—'} to ${filters.edgeMax || '—'}` : 'All'} expandedRow={expandedRow} onToggle={toggleRow}>
          <div className="wnba-filter-range-row">
            <input type="number" placeholder="Min" value={filters.edgeMin} onChange={event => updateFilter('edgeMin', event.target.value)} />
            <span>to</span>
            <input type="number" placeholder="Max" value={filters.edgeMax} onChange={event => updateFilter('edgeMax', event.target.value)} />
          </div>
        </FilterRow>

        <FilterRow id="lines" label="Lines" value={filters.lineMin || filters.lineMax ? `${filters.lineMin || lineBounds.min} to ${filters.lineMax || lineBounds.max}` : `${lineBounds.min} to ${lineBounds.max}`} expandedRow={expandedRow} onToggle={toggleRow}>
          <div className="wnba-filter-range-row">
            <input type="number" placeholder={String(lineBounds.min)} value={filters.lineMin} onChange={event => updateFilter('lineMin', event.target.value)} />
            <span>to</span>
            <input type="number" placeholder={String(lineBounds.max)} value={filters.lineMax} onChange={event => updateFilter('lineMax', event.target.value)} />
          </div>
        </FilterRow>

        <FilterRow id="grade" label="Matchup Grade" value={filters.grade} expandedRow={expandedRow} onToggle={toggleRow}>
          <select value={filters.grade} onChange={event => updateFilter('grade', event.target.value)}>
            {GRADE_OPTIONS.map(option => <option key={option}>{option}</option>)}
          </select>
        </FilterRow>

        <div className="wnba-filters-footer">
          <button className="wnba-filters-reset" onClick={resetFilters}>Reset</button>
          <button className="wnba-filters-apply" onClick={onClose}>Show {resultCount} {lineWord(resultCount)}</button>
        </div>
      </div>
    </div>
  )
}

// ── Small presentational pieces (bonus insight panels below the board) ───────
function KpiCard({ label, value, sub, color }) {
  return (
    <div className="card" style={{ padding: '16px 18px' }}>
      <p className="stat-label" style={{ margin: 0 }}>{label}</p>
      <p style={{ fontSize: 28, fontWeight: 800, color, margin: '6px 0 2px', lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>{sub}</p>}
    </div>
  )
}

function InsightPanel({ title, kicker, accent, children }) {
  return (
    <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: accent, boxShadow: `0 0 10px ${accent}` }} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'white', letterSpacing: 0.2 }}>{title}</h3>
        {kicker && <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>{kicker}</span>}
      </div>
      {children}
    </div>
  )
}

function MiniRow({ rank, player, stat, side, primary, primaryColor, sub, onClick, last }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 0', cursor: 'pointer',
        borderBottom: last ? 'none' : '1px solid #161616',
      }}
    >
      <span style={{ width: 16, fontSize: 11, fontWeight: 800, color: rank === 1 ? primaryColor : '#4b5563', textAlign: 'center' }}>{rank}</span>
      <div style={{
        width: 30, height: 30, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
        background: '#12231f', border: '1px solid #1f3f3d',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 800, color: '#7efc6a',
      }}>
        {player.image
          ? <img src={fitImage(player.image, 30)} alt={player.name} width={30} height={30} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none' }} />
          : initials(player.name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.name}</p>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#8b94a9' }}>{player.team}</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#a78bfa' }}>{stat}</span>
          {side && (
            <span style={{ fontSize: 9, fontWeight: 800, color: side === 'OVER' ? '#22c55e' : '#ef4444' }}>{side}</span>
          )}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 900, color: primaryColor }}>{primary}</p>
        {sub && <p style={{ margin: 0, fontSize: 10, color: '#6b7280', fontWeight: 600 }}>{sub}</p>}
      </div>
    </div>
  )
}

export default function Dashboard({ onSelectPlayer, onNavigate, onNavigatePricing }) {
  const [projections, setProjections] = useState(null)
  const [players, setPlayers] = useState(null)
  const [projLoading, setProjLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)

  const [propTab, setPropTab] = useState('All Props')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState(() => withDefaultSort(DEFAULT_FILTERS, 'wnba', SORT_OPTIONS))
  const phone = usePhoneBoard()
  const [openId, setOpenId] = useState(null)
  const [whyId, setWhyId] = useState(null)

  const [lockedCount, setLockedCount] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [memberPreview, setMemberPreview] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const { index: oddsIndex, oddsState, reload: reloadOdds } = useBoardOdds(({ fresh = false } = {}) => fetchWnbaSnapshot('wnba/pp_line_matched_odds.json', { fresh }).then((snapshot) => {
    const payload = snapshot?.data
    const records = Array.isArray(payload?.records) ? payload.records : []
    return { records: wnbaRecordsAsSharp(records), preview: !!snapshot?.preview }
  }))

  const tableWrapRef = useRef(null)
  const lastFreeRowRef = useRef(null)
  const [lockTop, setLockTop] = useState(null)

  const updateFilter = (key, value) => {
    setFilters(current => ({ ...current, [key]: value }))
    if (key === 'sortBy') rememberBoardSort('wnba', value)
  }
  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS)
    rememberBoardSort('wnba', DEFAULT_FILTERS.sortBy)
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setProjLoading(true)
      setLoadError('')
      try {
        const [pr, pl] = await Promise.all([
          fetchWnbaSnapshot('wnba/projections_standard.json'),
          fetchWnbaData('wnba/players.json'),
        ])
        if (cancelled) return
        setLockedCount(previewLockedCount(pr?.preview === true, pr?.lockedCount))
        setRefreshing(pr?.refreshing === true)
        setMemberPreview(pr?.preview === true)
        setUpdatedAt(pr?.updatedAt || null)
        setProjections(Array.isArray(pr?.data) ? pr.data : [])
        setPlayers(Array.isArray(pl) ? pl : [])
      } catch (err) {
        if (!cancelled) {
          setProjections([])
          setPlayers([])
          setLoadError(err?.message ? err : Object.assign(new Error('Request failed'), { code: err?.code }))
        }
      } finally {
        if (!cancelled) setProjLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [loadAttempt])

  const [refreshExhausted, clearRefreshExhausted] = useFullBoardRefresh('wnba_projections_standard', (snapshot) => {
    setLockedCount(0)
    setRefreshing(false)
    setMemberPreview(false)
    setUpdatedAt(snapshot.updatedAt || null)
    setProjections(Array.isArray(snapshot.data) ? snapshot.data : [])
    setLoadError('')
    setProjLoading(false)
    reloadOdds()
  })
  const phase = useMemberBoardPhase('wnba', { refreshing: refreshing && !refreshExhausted, exhausted: refreshExhausted })
  const hold = phase === 'loading' || phase === 'exhausted'
  const showPaywall = phase === 'free'
  const isPaid = phase === 'member'

  const retryLoad = () => {
    clearRefreshExhausted()
    setLoadError('')
    setProjLoading(true)
    setLoadAttempt((current) => current + 1)
  }

  const totalPlayers = players?.length ?? 0
  const totalGames = projections ? projections.reduce((s, p) => s + (p.gp ?? 0), 0) : 0

  // Flatten every prop into a scored row.
  // The line on the row is the PrizePicks line. See wnbaCgScore.
  const allRows = useMemo(() => {
    if (!projections) return []
    const rows = []
    projections.forEach(player => {
      const props = (player.ppAllProps || []).filter(prop => !EXCLUDED_PROP_LABELS.has(prop?.stat))
      props.forEach(prop => {
        const line = Number(prop.line)
        const projectionFn = PROP_PROJECTION[prop.stat]
        const projection = prop.projection ?? (projectionFn ? projectionFn(player) : null)
        const score = wnbaCgScore(projection, prop)
        if (projection == null || !Number.isFinite(line) || line <= 0 || score == null) return

        const recentGames = player.recentGames || []
        const getter = GAME_STAT_VALUE[prop.stat]
        const recent = getter
          ? recentGames.slice(0, 10).map(g => getter(g)).filter(v => v != null).reverse()
          : []
        const hitPills = wnbaHitPills({ games: recentGames, stat: prop.stat, line, opponent: prop.opponent ?? null })
        const l10 = pillById(hitPills, 'l10')

        rows.push({
          id: `${player.name}-${prop.stat}`,
          player: player.name,
          team: player.team,
          position: player.position,
          imageUrl: player.image || null,
          opponent: prop.opponent ?? null,
          gameDate: prop.gameDate || null,
          prop: prop.stat,
          line,
          projection,
          score,
          side: pickSide(projection, line, score),
          isOver: pickSide(projection, line, score) === 'OVER',
          recent,
          hitRate: l10 ? l10.rate : 0,
          gamesPlayed: l10 ? l10.games : 0,
          hitPills,
          dvpRank: prop.effectiveDvpFactor ?? player.dvpFactor ?? 1,
          // Preserved for the insight panels below.
          _player: player,
          _edgePct: ((projection - line) / line) * 100,
        })
      })
    })
    return rows
  }, [projections])

  const lineBounds = useMemo(() => {
    const lines = allRows.map(item => item.line).filter(value => typeof value === 'number')
    if (!lines.length) return { min: 0, max: 0 }
    return { min: Math.floor(Math.min(...lines) * 10) / 10, max: Math.ceil(Math.max(...lines) * 10) / 10 }
  }, [allRows])

  const rows = useMemo(() => {
    const edgeMin = filters.edgeMin === '' ? -Infinity : Number(filters.edgeMin)
    const edgeMax = filters.edgeMax === '' ? Infinity : Number(filters.edgeMax)
    const lineMin = filters.lineMin === '' ? -Infinity : Number(filters.lineMin)
    const lineMax = filters.lineMax === '' ? Infinity : Number(filters.lineMax)

    const filtered = allRows
      .filter(item => propTab === 'All Props' || item.prop === propTab)
      .filter(item => filters.side === 'All' || (filters.side === 'Overs' ? item.side === 'OVER' : item.side === 'UNDER'))
      .filter(item => item.hitRate >= filters.minHitRate)
      .filter(item => item.gamesPlayed >= filters.minGames)
      .filter(item => filters.position === 'All' || item.position === filters.position)
      .filter(item => item.score >= edgeMin && item.score <= edgeMax)
      .filter(item => item.line >= lineMin && item.line <= lineMax)
      .filter(item => {
        if (filters.grade === 'All Grades') return true
        const grade = dvpGrade(item.dvpRank)
        return grade && grade[0] === filters.grade
      })

    return sortWnbaRows(filtered, filters.sortBy, SEASON_LABEL)
  }, [allRows, propTab, filters])

  // ── Bonus insight panels (kept from the previous board) ──────────────────
  // Free tier matches Prop Lines: top FREE_ROW_LIMIT; paid keeps full insight lists.
  const insightLimit = isPaid ? 5 : FREE_ROW_LIMIT

  const dedupePlayers = (list, limit) => {
    const seen = new Set()
    const out = []
    for (const row of list) {
      if (seen.has(row.player)) continue
      seen.add(row.player)
      out.push(row)
      if (out.length === limit) break
    }
    return out
  }

  const hotStreaks = useMemo(() => {
    return dedupePlayers(hotStreakRows(allRows), insightLimit)
  }, [allRows, insightLimit])

  const bestValue = useMemo(() => {
    const filtered = allRows
      .filter(r => r.isOver)
      .sort((a, b) => b._edgePct - a._edgePct)
    return dedupePlayers(filtered, insightLimit)
  }, [allRows, insightLimit])

  const slate = useMemo(() => buildSlate(allRows), [allRows])

  const avgTopScore = useMemo(() => {
    if (!allRows.length) return null
    const top = [...allRows].sort((a, b) => b.score - a.score).slice(0, 10)
    return top.reduce((s, r) => s + r.score, 0) / top.length
  }, [allRows])

  const goPlayer = name => onSelectPlayer?.(name)
  const goProjections = () => onNavigate?.('projections')

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
    <div className="fade-in">
      <div className="wnba-propboard">
        <section className="wnba-lines-page">
          <div className="wnba-lines-tabs">
            {PROP_TABS.map(tab => (
              <button key={tab} className={tab === propTab ? 'active' : ''} onClick={() => setPropTab(tab)}>{tab}</button>
            ))}
          </div>
          <div className="wnba-board-header">
            <div><p>WNBA / PrizePicks</p><h1>Prop Lines</h1><BoardStatus sport="wnba" updatedAt={updatedAt} /></div>
            <div className="wnba-lines-header-actions">
              <span>{countedLines(rows.length, { locked: showPaywall ? lockedCount : 0 })} · sorted by {filters.sortBy}</span>
              <button className={`wnba-filters-btn${filtersOpen ? ' active' : ''}`} onClick={() => setFiltersOpen(true)}><FilterIcon /> Filters</button>
            </div>
          </div>

          {hold && <MemberBoardStatus phase={phase} onRetry={retryLoad} className="wnba-notice" />}
          <QuietMemberPreview phase={phase} preview={memberPreview} refreshing={refreshing} onRetry={retryLoad} className="wnba-notice" />
          {!hold && projLoading && (
            <div role="status" aria-label="Loading WNBA prop lines">
              <BoardSkeleton />
            </div>
          )}
          {!hold && !projLoading && loadError && <BoardLoadError className="wnba-notice" error={loadError} prefix="Unable to load WNBA prop lines:" suffix=". Please refresh to try again." onRetry={retryLoad} />}
          {showPaywall && <MemberPreviewNotice exhausted={refreshExhausted} onRetry={retryLoad} className="wnba-notice" />}
          {!hold && !projLoading && !loadError && !allRows.length && <div className="wnba-notice">No WNBA props are on the board right now. Check back closer to tip-off.</div>}
          {!hold && !projLoading && !loadError && !!allRows.length && !rows.length && <div className="wnba-notice">No props match these filters.</div>}
          {!hold && !projLoading && !!rows.length && (
            <BoardSurface
              phone={phone}
              wrapClass="wnba-lines-table-wrap"
              wrapRef={tableWrapRef}
              tableClass="wnba-lines-table hit-rate-board"
              head={<><th>Lines</th><th>L10 Chart</th><th>CG Score</th><th>Over hit rate</th><th>DVP</th><th>Matchup</th></>}
              overlay={hasLockedRows && lockTop != null && (
                <div className="wnba-lines-lock-overlay" style={{ top: lockTop }}>
                  <div className="wnba-lines-lock-card">
                    <div className="wnba-lines-lock-icon">🔒</div>
                    <h3>Unlock the Full Board</h3>
                    <p>Free members see the top {FREE_ROW_LIMIT} lines.{lockedCount > 0 ? ` ${lockedCount} more are locked.` : ''} Upgrade to see every prop line.</p>
                    <button onClick={() => onNavigatePricing?.()}>View Plans</button>
                  </div>
                </div>
              )}
            >
              {rows.map((item, index) => {
                const matched = boardOddsFor(oddsIndex, item)
                return (
                  <PropRow
                    key={item.id}
                    item={item}
                    phone={phone}
                    onSelectPlayer={goPlayer}
                    locked={!isPaid && index >= FREE_ROW_LIMIT}
                    rowRef={index === lastFreeIndex ? lastFreeRowRef : undefined}
                    open={openId === item.id}
                    onToggle={() => setOpenId((current) => current === item.id ? null : item.id)}
                    whyOpen={whyId === item.id}
                    onWhy={() => setWhyId((current) => current === item.id ? null : item.id)}
                    odds={matched.odds}
                    seen={matched.seen}
                    oddsState={oddsState}
                  />
                )
              })}
              {Array.from({ length: placeholderCount }, (_, index) => (
                <LockedPlaceholder key={`locked-${index}`} phone={phone} className="wnba-lines-row locked wnba-placeholder-row" />
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
      </div>

      {/* ── KPI strip ────────────────────────────────────────── */}
      {!hold && (<>
      <div className="wnba-kpi-grid">
        <KpiCard label="Active Players" value={totalPlayers} sub="2025–2026 roster" color="#FF6900" />
        <KpiCard label="Games Logged" value={projLoading ? '…' : totalGames.toLocaleString()} sub="combined 2025+2026" color="#3b82f6" />
        <KpiCard
          label="Props on Board"
          value={projLoading ? '…' : propsOnBoardCount(allRows.length, isPaid ? 0 : lockedCount).toLocaleString()}
          sub={!projLoading && showPaywall && lockedCount > 0 ? `${allRows.length} shown, ${lockedCount} locked` : 'scored & rated'}
          color="#a855f7"
        />
        <KpiCard label="Avg Top Score" value={avgTopScore != null ? avgTopScore.toFixed(1) : '…'} sub="top 10 plays" color="#22c55e" />
      </div>

      {/* ── Insight panels ───────────────────────────────────── */}
      <div className="wnba-insight-grid">
        <InsightPanel title="Hottest Streaks" kicker="L10 hit rate" accent="#22c55e">
          {projLoading
            ? Array(insightLimit).fill(0).map((_, i) => <div key={i} style={{ height: 44, background: '#0e1623', borderRadius: 8, marginBottom: 6 }} />)
            : hotStreaks.length
              ? <>
                  {hotStreaks.map((r, i) => {
                    const l10 = pillById(r.hitPills, 'l10')
                    return (
                      <MiniRow
                        key={r.id} rank={i + 1} player={r._player} stat={r.prop} side="OVER"
                        primary={`${Math.round(l10.rate)}%`} primaryColor={hitColor(l10.rate)}
                        sub={`${l10.games} gm · line ${r.line}`}
                        onClick={() => goPlayer(r.player)}
                        last={i === hotStreaks.length - 1 && (isPaid || hotStreaks.length < FREE_ROW_LIMIT)}
                      />
                    )
                  })}
                  {showPaywall && hotStreaks.length >= FREE_ROW_LIMIT && (
                    <p style={{ color: '#6b7280', fontSize: 11, margin: '10px 0 0', fontWeight: 600 }}>
                      Free members see the top {FREE_ROW_LIMIT}.{' '}
                      <button type="button" onClick={() => onNavigatePricing?.()} style={{ background: 'none', border: 'none', padding: 0, color: '#FF6900', fontWeight: 800, cursor: 'pointer', fontSize: 11 }}>Upgrade</button>
                      {' '}for the full list.
                    </p>
                  )}
                </>
              : <p style={{ color: '#6b7280', fontSize: 12, margin: '4px 0' }}>No L10 streak at {HOT_L10_RATE}%+ over at least {HOT_L10_GAMES} games.</p>}
        </InsightPanel>

        <InsightPanel title="Best Value Edges" kicker="proj vs line" accent="#FF6900">
          {projLoading
            ? Array(insightLimit).fill(0).map((_, i) => <div key={i} style={{ height: 44, background: '#0e1623', borderRadius: 8, marginBottom: 6 }} />)
            : bestValue.length
              ? <>
                  {bestValue.map((r, i) => (
                    <MiniRow
                      key={r.id} rank={i + 1} player={r._player} stat={r.prop} side="OVER"
                      primary={`+${r._edgePct.toFixed(0)}%`} primaryColor="#FF6900"
                      sub={`proj ${r.projection.toFixed(1)} · line ${r.line}`}
                      onClick={() => goPlayer(r.player)}
                      last={i === bestValue.length - 1 && (isPaid || bestValue.length < FREE_ROW_LIMIT)}
                    />
                  ))}
                  {showPaywall && bestValue.length >= FREE_ROW_LIMIT && (
                    <p style={{ color: '#6b7280', fontSize: 11, margin: '10px 0 0', fontWeight: 600 }}>
                      Free members see the top {FREE_ROW_LIMIT}.{' '}
                      <button type="button" onClick={() => onNavigatePricing?.()} style={{ background: 'none', border: 'none', padding: 0, color: '#FF6900', fontWeight: 800, cursor: 'pointer', fontSize: 11 }}>Upgrade</button>
                      {' '}for the full list.
                    </p>
                  )}
                </>
              : <p style={{ color: '#6b7280', fontSize: 12, margin: '4px 0' }}>No value edges available.</p>}
        </InsightPanel>

        <InsightPanel title={slate.title} kicker={slate.kicker} accent="#3b82f6">
          {projLoading
            ? Array(5).fill(0).map((_, i) => <div key={i} style={{ height: 36, background: '#0e1623', borderRadius: 8, marginBottom: 6 }} />)
            : slate.matchups.length
              ? slate.matchups.map((m, i) => (
                  <div
                    key={m.key}
                    onClick={goProjections}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                      padding: '9px 0', borderBottom: i === slate.matchups.length - 1 ? 'none' : '1px solid #161616',
                    }}
                  >
                    <span style={{ width: 16, fontSize: 11, fontWeight: 800, color: '#4b5563', textAlign: 'center' }}>{i + 1}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'white', letterSpacing: 0.3 }}>{m.label}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6', background: '#3b82f618', padding: '2px 9px', borderRadius: 999 }}>{m.count} props</span>
                  </div>
                ))
              : <p style={{ color: '#6b7280', fontSize: 12, margin: '4px 0' }}>No matchups posted yet.</p>}
        </InsightPanel>
      </div>
      </>)}
    </div>
  )
}
