import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchNbaData, fetchNbaSnapshot } from './nbaData'
import {
  DEFAULT_FILTERS,
  GAMES_OPTIONS,
  GRADE_OPTIONS,
  HIT_RATE_OPTIONS,
  POSITIONS,
  PROP_TABS,
  SEASON_LABEL,
  SORT_OPTIONS,
  buildPropRows,
  dvpColor,
  dvpGrade,
  filterAndSortRows,
  nbaLogoUrl,
} from './nbaPropLines'

const FREE_ROW_LIMIT = 3

function dedupePlayers(list, limit) {
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

function formatValue(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1)
}

function initials(name) {
  return (name || '').split(' ').map((word) => word[0]).join('').slice(0, 2) || '?'
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

function hitColor(pct) {
  if (pct == null) return '#4b5563'
  const from = [239, 68, 68]
  const mid = [180, 180, 180]
  const to = [34, 197, 94]
  const lerp = (a, b, t) => Math.round(a + (b - a) * Math.max(0, Math.min(1, t)))
  const [start, end, t] = pct <= 50 ? [from, mid, pct / 50] : [mid, to, (pct - 50) / 50]
  return `rgb(${lerp(start[0], end[0], t)},${lerp(start[1], end[1], t)},${lerp(start[2], end[2], t)})`
}

function TeamLogo({ team, className }) {
  const url = nbaLogoUrl(team)
  if (!url) return null
  return <img className={className} src={url} alt={team} loading="lazy" onError={(event) => { event.target.style.display = 'none' }} />
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
        <span key={index} className={value >= line ? 'hit' : 'miss'} style={{ height: `${Math.max(14, (value / maxValue) * 100)}%` }} />
      ))}
    </div>
  )
}

function PropRow({ item, onSelectPlayer, locked, rowRef }) {
  const recent = Array.isArray(item.recent) ? item.recent : []
  const grade = dvpGrade(item.dvpRank)

  return (
    <tr className={`wnba-lines-row${locked ? ' locked' : ''}`} ref={rowRef}>
      <td className="wnba-lines-player">
        <div className="wnba-lines-avatar">
          {item.imageUrl
            ? <img src={item.imageUrl} alt={item.player} loading="lazy" onError={(event) => { event.target.style.display = 'none' }} />
            : initials(item.player)}
        </div>
        <div className="wnba-lines-info">
          <button className="wnba-player-link" onClick={() => !locked && onSelectPlayer?.(item.player)}>{item.player}</button>
          <span className="wnba-lines-tag">{item.team}{item.position ? `, ${item.position}` : ''}</span>
          <div className={`wnba-lines-line ${item.isOver ? 'over' : 'under'}`}><b>{item.isOver ? 'O' : 'U'}</b> {formatValue(item.line)} {item.prop}</div>
        </div>
      </td>
      <td><MiniChart recent={recent} line={item.line} /></td>
      <td className={item.isOver ? 'over' : 'under'}>{item.score.toFixed(1)}</td>
      <td className={item.seasonHitRate == null ? '' : item.seasonHitRate >= 50 ? 'over' : 'under'}>{item.seasonHitRate == null ? '—' : `${item.seasonHitRate}%`}</td>
      <td className={item.h2hHitRate == null ? '' : item.h2hHitRate >= 50 ? 'over' : 'under'}>{item.h2hHitRate == null ? '—' : `${item.h2hHitRate}%`}</td>
      <td style={item.dvpRank ? { color: dvpColor(item.dvpRank) } : undefined}>{item.dvpRank ? ordinal(Math.round(item.dvpRank)) : '—'}</td>
      <td className="wnba-lines-matchup">
        <TeamLogo team={item.opponent} className="wnba-lines-matchup-logo" />
        <span className={`wnba-grade ${gradeClass(grade)}`}>{grade || '—'}</span>
      </td>
    </tr>
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
  const toggleRow = (id) => setExpandedRow((current) => (current === id ? null : id))

  if (!open) return null
  return (
    <div className="wnba-filters-overlay" onClick={onClose}>
      <div className="wnba-filters-panel" onClick={(event) => event.stopPropagation()}>
        <div className="wnba-filters-head">
          <h2>Filters</h2>
          <button className="wnba-filters-close" onClick={onClose}>Close <span>&times;</span></button>
        </div>
        <div className="wnba-filters-side">
          {['All', 'Overs', 'Unders'].map((option) => (
            <button key={option} className={filters.side === option ? 'active' : ''} onClick={() => updateFilter('side', option)}>{option}</button>
          ))}
        </div>

        <FilterRow id="sort" label="Sort By" value={filters.sortBy} expandedRow={expandedRow} onToggle={toggleRow}>
          <select value={filters.sortBy} onChange={(event) => updateFilter('sortBy', event.target.value)}>
            {SORT_OPTIONS.map((option) => <option key={option}>{option}</option>)}
          </select>
        </FilterRow>

        <FilterRow id="hitrate" label="Hit Rates" value={`Hit Rate > ${filters.minHitRate}%`} expandedRow={expandedRow} onToggle={toggleRow}>
          <div className="wnba-filter-chip-row">
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
          <div className="wnba-filter-chip-row">
            {GAMES_OPTIONS.map((option) => (
              <button key={option} className={filters.minGames === option ? 'active' : ''} onClick={() => updateFilter('minGames', option)}>{option === 0 ? 'All' : `${option}+`}</button>
            ))}
          </div>
        </FilterRow>

        <FilterRow id="position" label="Positions" value={filters.position} expandedRow={expandedRow} onToggle={toggleRow}>
          <div className="wnba-filter-chip-row">
            {POSITIONS.map((option) => (
              <button key={option} className={filters.position === option ? 'active' : ''} onClick={() => updateFilter('position', option)}>{option}</button>
            ))}
          </div>
        </FilterRow>

        <FilterRow id="edge" label="CG Score" value={filters.edgeMin || filters.edgeMax ? `${filters.edgeMin || '—'} to ${filters.edgeMax || '—'}` : 'All'} expandedRow={expandedRow} onToggle={toggleRow}>
          <div className="wnba-filter-range-row">
            <input type="number" placeholder="Min" value={filters.edgeMin} onChange={(event) => updateFilter('edgeMin', event.target.value)} />
            <span>to</span>
            <input type="number" placeholder="Max" value={filters.edgeMax} onChange={(event) => updateFilter('edgeMax', event.target.value)} />
          </div>
        </FilterRow>

        <FilterRow id="lines" label="Lines" value={filters.lineMin || filters.lineMax ? `${filters.lineMin || lineBounds.min} to ${filters.lineMax || lineBounds.max}` : `${lineBounds.min} to ${lineBounds.max}`} expandedRow={expandedRow} onToggle={toggleRow}>
          <div className="wnba-filter-range-row">
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

        <div className="wnba-filters-footer">
          <button className="wnba-filters-reset" onClick={resetFilters}>Reset</button>
          <button className="wnba-filters-apply" onClick={onClose}>Show {resultCount} lines</button>
        </div>
      </div>
    </div>
  )
}

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
          ? <img src={player.image} alt={player.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(event) => { event.target.style.display = 'none' }} />
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

export default function NbaDashboard({ onSelectPlayer, onNavigate, onNavigatePricing }) {
  const [projections, setProjections] = useState(null)
  const [players, setPlayers] = useState(null)
  const [projLoading, setProjLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [propTab, setPropTab] = useState('All Props')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [lockedCount, setLockedCount] = useState(0)
  const [isPaid, setIsPaid] = useState(false)

  const tableWrapRef = useRef(null)
  const lastFreeRowRef = useRef(null)
  const [lockTop, setLockTop] = useState(null)

  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }))
  const resetFilters = () => setFilters(DEFAULT_FILTERS)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setProjLoading(true)
      setLoadError('')
      try {
        const [board, roster] = await Promise.all([
          fetchNbaSnapshot('nba/projections_standard.json'),
          fetchNbaData('nba/players.json').catch(() => []),
        ])
        if (cancelled) return
        setLockedCount(board?.preview ? board.lockedCount : 0)
        setIsPaid(board?.preview !== true)
        setProjections(Array.isArray(board?.data) ? board.data : [])
        setPlayers(Array.isArray(roster) ? roster : [])
      } catch (err) {
        if (!cancelled) {
          setProjections([])
          setPlayers([])
          setIsPaid(false)
          setLoadError(err?.message || 'Request failed')
        }
      } finally {
        if (!cancelled) setProjLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const totalPlayers = players?.length ?? 0
  const totalGames = projections ? projections.reduce((sum, player) => sum + (player.gp ?? 0), 0) : 0

  const allRows = useMemo(() => buildPropRows(projections, players), [projections, players])

  const lineBounds = useMemo(() => {
    const lines = allRows.map((item) => item.line).filter((value) => typeof value === 'number')
    if (!lines.length) return { min: 0, max: 0 }
    return { min: Math.floor(Math.min(...lines) * 10) / 10, max: Math.ceil(Math.max(...lines) * 10) / 10 }
  }, [allRows])

  const rows = useMemo(
    () => filterAndSortRows(allRows, propTab, filters),
    [allRows, propTab, filters],
  )

  const insightLimit = isPaid ? 5 : FREE_ROW_LIMIT

  const hotStreaks = useMemo(() => {
    const filtered = allRows
      .filter((row) => row._hit && row._hit.total >= 5)
      .sort((a, b) => (b._hit.pct - a._hit.pct) || (b.score - a.score))
    return dedupePlayers(filtered, insightLimit)
  }, [allRows, insightLimit])

  const bestValue = useMemo(() => {
    const filtered = allRows
      .filter((row) => row.isOver)
      .sort((a, b) => b._edgePct - a._edgePct)
    return dedupePlayers(filtered, insightLimit)
  }, [allRows, insightLimit])

  const slate = useMemo(() => {
    const seen = new Map()
    allRows.forEach((row) => {
      const home = (row.team || '').toUpperCase()
      const away = (row.opponent || '').toUpperCase()
      if (!home || !away) return
      const [t1, t2] = [home, away].sort()
      const key = `${t1}_${t2}`
      const entry = seen.get(key) || { key, label: `${t1} vs ${t2}`, count: 0 }
      entry.count += 1
      seen.set(key, entry)
    })
    return [...seen.values()].sort((a, b) => b.count - a.count).slice(0, 8)
  }, [allRows])

  const avgTopScore = useMemo(() => {
    if (!allRows.length) return null
    const top = [...allRows].sort((a, b) => b.score - a.score).slice(0, 10)
    return top.reduce((sum, row) => sum + row.score, 0) / top.length
  }, [allRows])

  const hasLockedRows = !isPaid && (rows.length > FREE_ROW_LIMIT || lockedCount > 0)
  const lastFreeIndex = Math.min(rows.length, FREE_ROW_LIMIT) - 1
  const placeholderCount = isPaid || lockedCount <= 0 ? 0 : Math.max(4, Math.min(lockedCount, 6))

  useEffect(() => {
    if (!hasLockedRows) return undefined
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
    <div className="fade-in">
      <div className="wnba-propboard">
        <section className="wnba-lines-page">
          <div className="wnba-lines-tabs">
            {PROP_TABS.map((tab) => (
              <button key={tab} className={tab === propTab ? 'active' : ''} onClick={() => setPropTab(tab)}>{tab}</button>
            ))}
          </div>
          <div className="wnba-board-header">
            <div><p>NBA / PrizePicks</p><h1>Prop Lines</h1></div>
            <div className="wnba-lines-header-actions">
              <span>{rows.length}{lockedCount > 0 && !isPaid ? ` + ${lockedCount} locked` : ''} lines · sorted by {filters.sortBy}</span>
              <button className={`wnba-filters-btn${filtersOpen ? ' active' : ''}`} onClick={() => setFiltersOpen(true)}><FilterIcon /> Filters</button>
            </div>
          </div>

          {projLoading && <div className="wnba-notice">Loading NBA prop lines…</div>}
          {!projLoading && loadError && <div className="wnba-notice">Unable to load NBA prop lines: {loadError}. Please refresh to try again.</div>}
          {!projLoading && !loadError && !allRows.length && <div className="wnba-notice">No NBA props are on the board right now. Check back closer to tip-off.</div>}
          {!projLoading && !loadError && !!allRows.length && !rows.length && <div className="wnba-notice">No props match these filters.</div>}
          {!projLoading && !!rows.length && (
            <div className="wnba-lines-table-wrap" ref={tableWrapRef}>
              <table className="wnba-lines-table">
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
                      rowRef={index === lastFreeIndex ? lastFreeRowRef : undefined}
                    />
                  ))}
                  {Array.from({ length: placeholderCount }, (_, index) => (
                    <tr key={`locked-${index}`} className="wnba-lines-row locked wnba-placeholder-row" aria-hidden="true">
                      <td colSpan={7}><span className="wnba-placeholder-bar" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hasLockedRows && lockTop != null && (
                <div className="wnba-lines-lock-overlay" style={{ top: lockTop }}>
                  <div className="wnba-lines-lock-card">
                    <div className="wnba-lines-lock-icon">🔒</div>
                    <h3>Unlock the Full Board</h3>
                    <p>Free members see the top {FREE_ROW_LIMIT} lines.{lockedCount > 0 ? ` ${lockedCount} more are locked.` : ''} Upgrade to see every prop line.</p>
                    <button onClick={() => onNavigatePricing?.()}>View Plans</button>
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
      </div>

      <div className="wnba-kpi-grid">
        <KpiCard label="Active Players" value={totalPlayers} sub="2025–26 roster" color="#FF6900" />
        <KpiCard label="Games Logged" value={projLoading ? '…' : totalGames.toLocaleString()} sub="players with a projection" color="#3b82f6" />
        <KpiCard label="Props on Board" value={projLoading ? '…' : allRows.length.toLocaleString()} sub="scored & rated" color="#a855f7" />
        <KpiCard label="Avg Top Score" value={avgTopScore != null ? avgTopScore.toFixed(1) : '…'} sub="top 10 plays" color="#22c55e" />
      </div>

      <div className="wnba-insight-grid">
        <InsightPanel title="Hottest Streaks" kicker="L10 hit rate" accent="#22c55e">
          {projLoading
            ? Array(insightLimit).fill(0).map((_, index) => <div key={index} style={{ height: 44, background: '#0e1623', borderRadius: 8, marginBottom: 6 }} />)
            : hotStreaks.length
              ? (
                <>
                  {hotStreaks.map((row, index) => (
                    <MiniRow
                      key={row.id}
                      rank={index + 1}
                      player={row._player}
                      stat={row.prop}
                      side="OVER"
                      primary={`${row._hit.pct.toFixed(0)}%`}
                      primaryColor={hitColor(row._hit.pct)}
                      sub={`${row._hit.hits}/${row._hit.total} · line ${row.line}`}
                      onClick={() => onSelectPlayer?.(row.player)}
                      last={index === hotStreaks.length - 1 && (isPaid || hotStreaks.length < FREE_ROW_LIMIT)}
                    />
                  ))}
                  {!isPaid && hotStreaks.length >= FREE_ROW_LIMIT && (
                    <p style={{ color: '#6b7280', fontSize: 11, margin: '10px 0 0', fontWeight: 600 }}>
                      Free members see the top {FREE_ROW_LIMIT}.{' '}
                      <button type="button" onClick={() => onNavigatePricing?.()} style={{ background: 'none', border: 'none', padding: 0, color: '#FF6900', fontWeight: 800, cursor: 'pointer', fontSize: 11 }}>Upgrade</button>
                      {' '}for the full list.
                    </p>
                  )}
                </>
              )
              : <p style={{ color: '#6b7280', fontSize: 12, margin: '4px 0' }}>Not enough game history yet.</p>}
        </InsightPanel>

        <InsightPanel title="Best Value Edges" kicker="proj vs line" accent="#FF6900">
          {projLoading
            ? Array(insightLimit).fill(0).map((_, index) => <div key={index} style={{ height: 44, background: '#0e1623', borderRadius: 8, marginBottom: 6 }} />)
            : bestValue.length
              ? (
                <>
                  {bestValue.map((row, index) => (
                    <MiniRow
                      key={row.id}
                      rank={index + 1}
                      player={row._player}
                      stat={row.prop}
                      side="OVER"
                      primary={`+${row._edgePct.toFixed(0)}%`}
                      primaryColor="#FF6900"
                      sub={`proj ${row.projection.toFixed(1)} · line ${row.line}`}
                      onClick={() => onSelectPlayer?.(row.player)}
                      last={index === bestValue.length - 1 && (isPaid || bestValue.length < FREE_ROW_LIMIT)}
                    />
                  ))}
                  {!isPaid && bestValue.length >= FREE_ROW_LIMIT && (
                    <p style={{ color: '#6b7280', fontSize: 11, margin: '10px 0 0', fontWeight: 600 }}>
                      Free members see the top {FREE_ROW_LIMIT}.{' '}
                      <button type="button" onClick={() => onNavigatePricing?.()} style={{ background: 'none', border: 'none', padding: 0, color: '#FF6900', fontWeight: 800, cursor: 'pointer', fontSize: 11 }}>Upgrade</button>
                      {' '}for the full list.
                    </p>
                  )}
                </>
              )
              : <p style={{ color: '#6b7280', fontSize: 12, margin: '4px 0' }}>No value edges available.</p>}
        </InsightPanel>

        <InsightPanel title="Today's Slate" kicker={`${slate.length} matchups`} accent="#3b82f6">
          {projLoading
            ? Array(5).fill(0).map((_, index) => <div key={index} style={{ height: 36, background: '#0e1623', borderRadius: 8, marginBottom: 6 }} />)
            : slate.length
              ? slate.map((matchup, index) => (
                <div
                  key={matchup.key}
                  onClick={() => onNavigate?.('projections')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                    padding: '9px 0', borderBottom: index === slate.length - 1 ? 'none' : '1px solid #161616',
                  }}
                >
                  <span style={{ width: 16, fontSize: 11, fontWeight: 800, color: '#4b5563', textAlign: 'center' }}>{index + 1}</span>
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'white', letterSpacing: 0.3 }}>{matchup.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#3b82f6', background: '#3b82f618', padding: '2px 9px', borderRadius: 999 }}>{matchup.count} props</span>
                </div>
              ))
              : <p style={{ color: '#6b7280', fontSize: 12, margin: '4px 0' }}>No matchups posted yet.</p>}
        </InsightPanel>
      </div>
    </div>
  )
}
