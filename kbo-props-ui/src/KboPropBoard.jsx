import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchDataSnapshot } from './dataUrl'
import { useAuth } from './AuthContext'
import { sportAccess } from './entitlements'
import './KboPropBoard.css'

const FREE_ROW_LIMIT = 3

const DEFAULT_FILTERS = {
  direction: 'All',
  minL10: 0,
  minScore: '',
  playerType: 'All',
  sortBy: 'CG Score',
}

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function value(value, digits = 1) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '-'
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(digits)
}

function directionFor(prop) {
  const projection = Number(prop.cg_projection ?? prop.avg ?? prop.projection)
  const line = Number(prop.line)
  if (!Number.isFinite(projection) || !Number.isFinite(line)) return 'neutral'
  return projection >= line ? 'over' : 'under'
}

function scoreFor(prop) {
  const score = Number(prop.cg_projection ?? prop.rating)
  if (Number.isFinite(score)) return score
  const projection = Number(prop.avg ?? prop.projection)
  const line = Number(prop.line)
  return Number.isFinite(projection) && line > 0 ? (projection / line) * 50 : 0
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="4" y1="7" x2="20" y2="7" /><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="17" x2="20" y2="17" /><circle cx="11" cy="17" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}

function MiniChart({ values, line }) {
  const recent = Array.isArray(values) ? values.slice(0, 10).reverse() : []
  const max = Math.max(Number(line) || 0, ...recent.map(Number).filter(Number.isFinite), 1)
  return (
    <div className="kbo-lines-chart" aria-label="Last ten game values">
      {recent.map((recentValue, index) => (
        <span
          key={`${recentValue}-${index}`}
          className={Number(recentValue) > Number(line) ? 'hit' : Number(recentValue) === Number(line) ? 'push' : 'miss'}
          style={{ height: `${Math.max(14, (Number(recentValue) / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

function Filters({ open, close, filters, setFilters, propTabs, propTab, setPropTab, count }) {
  if (!open) return null
  const update = (key, next) => setFilters((current) => ({ ...current, [key]: next }))
  return (
    <div className="kbo-filter-overlay" onClick={close}>
      <aside className="kbo-filter-panel" onClick={(event) => event.stopPropagation()} aria-label="KBO prop filters">
        <header><h2>Filters</h2><button onClick={close} aria-label="Close filters">Close x</button></header>
        <label>Sort by
          <select value={filters.sortBy} onChange={(event) => update('sortBy', event.target.value)}>
            <option>CG Score</option><option>L10 Hit Rate</option><option>Full Hit Rate</option><option>Player Name</option>
          </select>
        </label>
        <label>Prop type
          <select value={propTab} onChange={(event) => setPropTab(event.target.value)}>
            {propTabs.map((tab) => <option key={tab}>{tab}</option>)}
          </select>
        </label>
        <fieldset><legend>Direction</legend>
          {['All', 'Overs', 'Unders'].map((option) => <button key={option} className={filters.direction === option ? 'active' : ''} onClick={() => update('direction', option)}>{option}</button>)}
        </fieldset>
        <fieldset><legend>Player type</legend>
          {['All', 'Pitchers', 'Batters'].map((option) => <button key={option} className={filters.playerType === option ? 'active' : ''} onClick={() => update('playerType', option)}>{option}</button>)}
        </fieldset>
        <fieldset><legend>Minimum L10 hit rate</legend>
          {[0, 50, 60, 70, 80].map((option) => <button key={option} className={filters.minL10 === option ? 'active' : ''} onClick={() => update('minL10', option)}>{option ? `${option}%+` : 'All'}</button>)}
        </fieldset>
        <label>Minimum CG score
          <input type="number" inputMode="decimal" placeholder="Any score" value={filters.minScore} onChange={(event) => update('minScore', event.target.value)} />
        </label>
        <footer><button className="kbo-reset" onClick={() => setFilters(DEFAULT_FILTERS)}>Reset</button><button className="kbo-apply" onClick={close}>Show {count} lines</button></footer>
      </aside>
    </div>
  )
}

export default function KboPropBoard({ onNavigatePricing }) {
  const [snapshot, setSnapshot] = useState(null)
  const [photos, setPhotos] = useState({})
  const [error, setError] = useState('')
  const [propTab, setPropTab] = useState('All Props')
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const { tier, user } = useAuth()
  const isPaid = sportAccess(tier, user?.email).kbo

  const tableWrapRef = useRef(null)
  const lastFreeRowRef = useRef(null)
  const [lockTop, setLockTop] = useState(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const [props, playerPhotos] = await Promise.all([
          fetchDataSnapshot('prizepicks_props.json'),
          fetchDataSnapshot('player_photos.json').catch(() => ({ data: {} })),
        ])
        if (!active) return
        setSnapshot(props.data)
        setPhotos(playerPhotos.data || {})
        setError('')
      } catch (loadError) {
        if (active) setError(loadError.message || 'Unable to load KBO prop lines.')
      }
    }
    load()
    const refresh = window.setInterval(load, 30 * 60 * 1000)
    return () => { active = false; window.clearInterval(refresh) }
  }, [])

  const photoLookup = useMemo(() => Object.fromEntries(Object.entries(photos).map(([name, url]) => [name.toLowerCase(), url])), [photos])
  const allRows = useMemo(() => (snapshot?.cards || []).flatMap((card) => (card.props || []).map((prop) => ({ card, prop, score: scoreFor(prop), direction: directionFor(prop) }))), [snapshot])
  const propTabs = useMemo(() => ['All Props', ...[...new Set(allRows.map(({ prop }) => prop.stat))].sort()], [allRows])
  const rows = useMemo(() => {
    const minimumScore = filters.minScore === '' ? -Infinity : Number(filters.minScore)
    const visible = allRows
      .filter(({ prop }) => propTab === 'All Props' || prop.stat === propTab)
      .filter(({ card }) => filters.playerType === 'All' || card.type === (filters.playerType === 'Pitchers' ? 'pitcher' : 'batter'))
      .filter(({ direction }) => filters.direction === 'All' || direction === (filters.direction === 'Overs' ? 'over' : 'under'))
      .filter(({ prop }) => Number(prop.hit_rate_l10 ?? 0) >= filters.minL10)
      .filter(({ score }) => score >= minimumScore)
    return visible.sort((left, right) => {
      if (filters.sortBy === 'L10 Hit Rate') return Number(right.prop.hit_rate_l10 ?? 0) - Number(left.prop.hit_rate_l10 ?? 0)
      if (filters.sortBy === 'Full Hit Rate') return Number(right.prop.hit_rate_all ?? 0) - Number(left.prop.hit_rate_all ?? 0)
      if (filters.sortBy === 'Player Name') return left.card.name.localeCompare(right.card.name)
      return right.score - left.score
    })
  }, [allRows, filters, propTab])

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
    <main className="kbo-lines-page">
      <nav className="kbo-prop-tabs" aria-label="KBO prop types">
        {propTabs.map((tab) => <button key={tab} className={tab === propTab ? 'active' : ''} onClick={() => setPropTab(tab)}>{tab}</button>)}
      </nav>
      <section className="kbo-board-header">
        <div><p>KBO / PRIZEPICKS</p><h1>Prop Lines</h1></div>
        <div className="kbo-header-actions"><span>{rows.length} lines · sorted by {filters.sortBy}</span><button onClick={() => setFiltersOpen(true)}><FilterIcon /> Filters</button></div>
      </section>
      {error && <p className="kbo-notice">{error}</p>}
      {!error && !snapshot && <p className="kbo-notice">Loading KBO prop lines...</p>}
      {!!rows.length && <div className="kbo-lines-table-wrap" ref={tableWrapRef}><table className="kbo-lines-table"><thead><tr><th>Lines</th><th>L10 Chart</th><th>CG Score</th><th>L5</th><th>L10</th><th>Full</th><th>Matchup</th></tr></thead><tbody>
        {rows.map(({ card, prop, score, direction }, index) => {
          const photo = photoLookup[String(card.name || '').toLowerCase()]
          const locked = !isPaid && index >= FREE_ROW_LIMIT
          return <tr key={`${card.name}-${prop.stat}-${prop.line}-${prop.odds_type}-${index}`} className={locked ? 'locked' : undefined} ref={index === FREE_ROW_LIMIT - 1 ? lastFreeRowRef : undefined}><td className="kbo-player-cell"><div className="kbo-avatar">{photo ? <img src={photo} alt="" loading="lazy" /> : initials(card.name)}</div><div><strong>{card.name}</strong><small>{card.team}, {card.type}</small><b className={direction}>{direction === 'over' ? 'O' : 'U'} {value(prop.line)} {prop.stat}</b></div></td><td><MiniChart values={prop.recent_values} line={prop.line} /></td><td className={direction}>{value(score)}</td><td>{value(prop.hit_rate_l5, 0)}%</td><td className={Number(prop.hit_rate_l10) >= 50 ? 'over' : 'under'}>{value(prop.hit_rate_l10, 0)}%</td><td className={Number(prop.hit_rate_all) >= 50 ? 'over' : 'under'}>{value(prop.hit_rate_all, 0)}%</td><td className="kbo-matchup"><span>{card.team}</span><i>vs</i><span>{card.opponent}</span></td></tr>
        })}
      </tbody></table>
        {hasLockedRows && lockTop != null && (
          <div className="kbo-lines-lock-overlay" style={{ top: lockTop }}>
            <div className="kbo-lines-lock-card">
              <div className="kbo-lines-lock-icon">🔒</div>
              <h3>Unlock the Full Board</h3>
              <p>Free members see the top {FREE_ROW_LIMIT} lines. Upgrade to see every prop line.</p>
              <button onClick={() => onNavigatePricing?.()}>View Plans</button>
            </div>
          </div>
        )}
      </div>}
      {!error && snapshot && !rows.length && <p className="kbo-notice">No KBO prop lines match these filters.</p>}
      <Filters open={filtersOpen} close={() => setFiltersOpen(false)} filters={filters} setFilters={setFilters} propTabs={propTabs} propTab={propTab} setPropTab={setPropTab} count={rows.length} />
    </main>
  )
}