import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchNflProjections } from './nflData'
import { teamLogoUrl } from './nflTeams'
import { useAuth } from '../AuthContext'
import { sportAccess } from '../entitlements'

const FREE_ROW_LIMIT = 3

const PROP_TABS = ['All Props', 'Pass Yards', 'Pass Attempts', 'Pass Completions', 'Rush Yards', 'Rush Attempts', 'Receiving Yards', 'Receptions', 'Rec Targets', 'Pass+Rush Yds', 'Rush+Rec Yds']
const SEASON_LABEL = String(new Date().getFullYear())
const SORT_OPTIONS = ['Hit Rate', 'CG Score', `${SEASON_LABEL} Hit Rate`, 'H2H Hit Rate', 'DVP Rank']
const HIT_RATE_OPTIONS = [0, 50, 70, 90, 100]
const GAMES_OPTIONS = [0, 3, 5, 8, 10]
const POSITIONS = ['All', 'QB', 'RB', 'WR', 'TE']
const GRADE_OPTIONS = ['All Grades', 'A', 'B', 'C', 'D', 'F']
const DEFAULT_FILTERS = { side: 'All', sortBy: 'Hit Rate', minHitRate: 0, minGames: 0, position: 'All', grade: 'All Grades', edgeMin: '', edgeMax: '', lineMin: '', lineMax: '' }

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

// Buckets the DVP rank (1 = toughest matchup, 32 = easiest) into a letter grade, same idea as fantasy matchup grades.
function dvpGrade(rank) {
  if (!rank) return null
  const pct = rank / 32
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

// 1 = toughest matchup (red) -> 15 = neutral -> 32 = easiest matchup (green)
function dvpColor(rank) {
  if (!rank) return null
  const value = Math.max(1, Math.min(32, rank))
  const [r, g, b] = value <= 15
    ? mixColor(DVP_RED, DVP_NEUTRAL, (value - 1) / 14)
    : mixColor(DVP_NEUTRAL, DVP_GREEN, (value - 15) / 17)
  return `rgb(${r}, ${g}, ${b})`
}

function TeamLogo({ team, className }) {
  const url = teamLogoUrl(team)
  return url ? <img className={className} src={url} alt={team} loading="lazy" /> : null
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
        <span key={index} className={value >= line ? 'hit' : 'miss'} style={{ height: `${Math.max(14, (value / maxValue) * 100)}%` }} />
      ))}
    </div>
  )
}

function PropRow({ item, onSelectPlayer, locked, rowRef }) {
  const recent = Array.isArray(item.recent) ? item.recent : []
  const isOver = item.projection >= item.line
  const grade = dvpGrade(item.dvpRank)

  return (
    <tr className={`nfl-lines-row${locked ? ' locked' : ''}`} ref={rowRef}>
      <td className="nfl-lines-player">
        <div className="nfl-lines-avatar">{item.imageUrl ? <img src={item.imageUrl} alt={item.player} loading="lazy" /> : initials(item.player)}</div>
        <div className="nfl-lines-info">
          <button className="nfl-player-link" onClick={() => !locked && onSelectPlayer(item.player, item.prop)}>{item.player}</button>
          <span className="nfl-lines-tag">{item.team}, {item.position}</span>
          <div className={`nfl-lines-line ${isOver ? 'over' : 'under'}`}><b>{isOver ? 'O' : 'U'}</b> {formatValue(item.line)} {item.prop}</div>
        </div>
      </td>
      <td><MiniChart recent={recent} line={item.line} /></td>
      <td className={isOver ? 'over' : 'under'}>{item.score.toFixed(1)}</td>
      <td className={item.seasonHitRate == null ? '' : item.seasonHitRate >= 50 ? 'over' : 'under'}>{item.seasonHitRate == null ? '—' : `${item.seasonHitRate}%`}</td>
      <td className={item.h2hHitRate == null ? '' : item.h2hHitRate >= 50 ? 'over' : 'under'}>{item.h2hHitRate == null ? '—' : `${item.h2hHitRate}%`}</td>
      <td style={item.dvpRank ? { color: dvpColor(item.dvpRank) } : undefined}>{item.dvpRank ? ordinal(item.dvpRank) : '—'}</td>
      <td className="nfl-lines-matchup">
        <TeamLogo team={item.opponent} className="nfl-lines-matchup-logo" />
        <span className={`nfl-grade ${gradeClass(grade)}`}>{grade || '—'}</span>
      </td>
    </tr>
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
          <button className="nfl-filters-apply" onClick={onClose}>Show {resultCount} lines</button>
        </div>
      </div>
    </div>
  )
}

export default function NflPropLines({ onSelectPlayer, onNavigatePricing }) {
  const [projections, setProjections] = useState([])
  const [error, setError] = useState('')
  const [propTab, setPropTab] = useState('All Props')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)

  const { tier, user } = useAuth()
  const isPaid = sportAccess(tier, user?.email).nfl

  const tableWrapRef = useRef(null)
  const lastFreeRowRef = useRef(null)
  const [lockTop, setLockTop] = useState(null)

  useEffect(() => {
    let active = true
    fetchNflProjections().then(({ projections: next }) => active && setProjections(next)).catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }))
  const resetFilters = () => setFilters(DEFAULT_FILTERS)

  const lineBounds = useMemo(() => {
    const lines = projections.map((item) => item.line).filter((value) => typeof value === 'number')
    if (!lines.length) return { min: 0, max: 0 }
    return { min: Math.floor(Math.min(...lines) * 10) / 10, max: Math.ceil(Math.max(...lines) * 10) / 10 }
  }, [projections])

  const rows = useMemo(() => {
    const withScore = projections.map((item) => ({ ...item, score: item.line ? (item.projection / item.line) * 50 : 0, isOver: item.projection >= item.line }))
    const edgeMin = filters.edgeMin === '' ? -Infinity : Number(filters.edgeMin)
    const edgeMax = filters.edgeMax === '' ? Infinity : Number(filters.edgeMax)
    const lineMin = filters.lineMin === '' ? -Infinity : Number(filters.lineMin)
    const lineMax = filters.lineMax === '' ? Infinity : Number(filters.lineMax)

    const filtered = withScore
      .filter((item) => propTab === 'All Props' || item.prop === propTab)
      .filter((item) => filters.side === 'All' || (filters.side === 'Overs' ? item.isOver : !item.isOver))
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

    return filtered.sort((a, b) => {
      if (filters.sortBy === 'CG Score') return b.score - a.score
      if (filters.sortBy === `${SEASON_LABEL} Hit Rate`) return (b.seasonHitRate ?? -1) - (a.seasonHitRate ?? -1)
      if (filters.sortBy === 'H2H Hit Rate') return (b.h2hHitRate ?? -1) - (a.h2hHitRate ?? -1)
      if (filters.sortBy === 'DVP Rank') return (b.dvpRank ?? 0) - (a.dvpRank ?? 0)
      return b.hitRate - a.hitRate
    })
  }, [projections, propTab, filters])

  const hasLockedRows = !isPaid && rows.length > FREE_ROW_LIMIT

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
  }, [hasLockedRows, rows])

  return (
    <section className="nfl-lines-page">
      <div className="nfl-lines-tabs">
        {PROP_TABS.map((tab) => (
          <button key={tab} className={tab === propTab ? 'active' : ''} onClick={() => setPropTab(tab)}>{tab}</button>
        ))}
      </div>
      <div className="nfl-board-header">
        <div><p>NFL / PRIZEPICKS</p><h1>Prop Lines</h1></div>
        <div className="nfl-lines-header-actions">
          <span>{rows.length} lines · sorted by {filters.sortBy}</span>
          <button className={`nfl-filters-btn${filtersOpen ? ' active' : ''}`} onClick={() => setFiltersOpen(true)}><FilterIcon /> Filters</button>
        </div>
      </div>
      {error && <div className="nfl-notice">Unable to load the NFL snapshot: {error}</div>}
      {!error && !rows.length && <div className="nfl-notice">Loading NFL prop lines.</div>}
      {!!rows.length && (
        <div className="nfl-lines-table-wrap" ref={tableWrapRef}>
          <table className="nfl-lines-table">
            <thead>
              <tr>
                <th>Lines</th><th>L10 Chart</th><th>CG Score</th><th>{SEASON_LABEL}</th><th>H2H</th><th>DVP</th><th>Matchup</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item, index) => (
                <PropRow
                  key={item.id}
                  item={item}
                  onSelectPlayer={onSelectPlayer}
                  locked={!isPaid && index >= FREE_ROW_LIMIT}
                  rowRef={index === FREE_ROW_LIMIT - 1 ? lastFreeRowRef : undefined}
                />
              ))}
            </tbody>
          </table>
          {hasLockedRows && lockTop != null && (
            <div className="nfl-lines-lock-overlay" style={{ top: lockTop }}>
              <div className="nfl-lines-lock-card">
                <div className="nfl-lines-lock-icon">🔒</div>
                <h3>Unlock the Full Board</h3>
                <p>Free members see the top {FREE_ROW_LIMIT} lines. Upgrade to see every prop line.</p>
                <button onClick={onNavigatePricing}>View Plans</button>
              </div>
            </div>
          )}
        </div>
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
