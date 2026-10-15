import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchDataSnapshot } from './dataUrl'
import BoardStatus from './BoardStatus'
import { useAuth } from './AuthContext'
import { sportAccess } from './entitlements'
import HitRateStrip from './HitRateStrip'
import { kboHitPills } from './hitRateStrip'
import { directionFor, scoreFor } from './kboBoardScore'
import { buildCgScoreExplainer } from './cgScoreExplainer'
import { CgScoreCell, CgScoreNote } from './CgScoreExplainer'
import { BoardSkeleton } from './BootScreen.jsx'
import './KboPropBoard.css'
import { fitImage } from './fitImage.js'
import GameSelect from './GameSelect.jsx'
import { useGameFilter } from './useGameFilter.js'

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

function KboBoardRow({ card, prop, score, direction, hitPills, photo, locked, rowRef, onSelectPlayer, onExpand }) {
  const [whyOpen, setWhyOpen] = useState(false)
  const sideMark = direction === 'over' ? 'O' : direction === 'under' ? 'U' : ''
  const scoreNote = buildCgScoreExplainer({
    player: card.name,
    projection: prop.projection,
    line: prop.line,
    stat: prop.stat,
    score,
    recentValues: prop.recent_values,
    newestFirst: true,
  })
  return (
    <>
      <tr className={locked ? 'locked' : undefined} ref={whyOpen ? undefined : rowRef}>
        <td onClick={() => !locked && onSelectPlayer?.(card.name)} style={{ cursor: locked ? 'default' : 'pointer' }}>
          <div className="kbo-player-cell">
            <div className="kbo-avatar">{photo ? <img src={fitImage(photo, 42)} alt="" loading="lazy" /> : initials(card.name)}</div>
            <div>
              <strong>{card.name}</strong>
              <small>{card.team}, {card.type}</small>
              <b className={direction}>{sideMark ? `${sideMark} ` : ''}{value(prop.line)} {prop.stat}</b>
            </div>
          </div>
        </td>
        <td className="hit-rate-chart"><MiniChart values={prop.recent_values} line={prop.line} /></td>
        <td className={`hit-rate-score ${direction}`}>
          <CgScoreCell
            scoreText={score == null ? '-' : value(score)}
            note={locked ? null : scoreNote}
            open={whyOpen}
            onToggle={() => {
              setWhyOpen((current) => !current)
              onExpand?.()
            }}
          />
        </td>
        <td className="hit-rate-col"><HitRateStrip pills={hitPills} /></td>
        <td><div className="kbo-matchup"><span>{card.team}</span><i>vs</i><span>{card.opponent}</span></div></td>
      </tr>
      {whyOpen && !locked && scoreNote && (
        <tr className="cg-score-note-row" ref={rowRef}>
          <td colSpan={5}>
            <CgScoreNote note={scoreNote} />
          </td>
        </tr>
      )}
    </>
  )
}

export default function KboPropBoard({ onNavigatePricing, onSelectPlayer }) {
  const [snapshot, setSnapshot] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [photos, setPhotos] = useState({})
  const [error, setError] = useState('')
  const [propTab, setPropTab] = useState('All Props')
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [lockedCount, setLockedCount] = useState(0)
  const [whyRevision, setWhyRevision] = useState(0)

  const { tier } = useAuth()
  // The server decides what is sent (full board vs. top-3 preview); lockedCount
  // is how many rows it withheld. The client tier only drives UI chrome.
  const isPaid = sportAccess(tier).kbo && lockedCount === 0

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
        setUpdatedAt(props.updatedAt || null)
        setLockedCount(props.preview ? props.lockedCount : 0)
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
  const allRows = useMemo(() => (snapshot?.cards || []).flatMap((card) => (card.props || []).map((prop) => ({
    card,
    prop,
    score: scoreFor(prop),
    direction: directionFor(prop),
    hitPills: kboHitPills({ games: card.games, stat: prop.stat, line: prop.line, opponent: card.opponent }),
  }))), [snapshot])
  const { games, selected: gameId, setSelected: setGameId, filtered: boardRows } = useGameFilter(allRows)
  const propTabs = useMemo(() => ['All Props', ...[...new Set(allRows.map(({ prop }) => prop.stat))].sort()], [allRows])
  const rows = useMemo(() => {
    const minimumScore = filters.minScore === '' ? -Infinity : Number(filters.minScore)
    const visible = boardRows
      .filter(({ prop }) => propTab === 'All Props' || prop.stat === propTab)
      .filter(({ card }) => filters.playerType === 'All' || card.type === (filters.playerType === 'Pitchers' ? 'pitcher' : 'batter'))
      .filter(({ direction }) => filters.direction === 'All' || direction === (filters.direction === 'Overs' ? 'over' : 'under'))
      .filter(({ prop }) => Number(prop.hit_rate_l10 ?? 0) >= filters.minL10)
      .filter(({ score }) => filters.minScore === '' || (score != null && score >= minimumScore))
    const rank = (row) => (row.score == null || !Number.isFinite(row.score) ? -Infinity : row.score)
    return visible.sort((left, right) => {
      if (filters.sortBy === 'L10 Hit Rate') return Number(right.prop.hit_rate_l10 ?? 0) - Number(left.prop.hit_rate_l10 ?? 0)
      if (filters.sortBy === 'Full Hit Rate') return Number(right.prop.hit_rate_all ?? 0) - Number(left.prop.hit_rate_all ?? 0)
      if (filters.sortBy === 'Player Name') return left.card.name.localeCompare(right.card.name)
      return rank(right) - rank(left)
    })
  }, [boardRows, filters, propTab])

  const hasLockedRows = !isPaid && (rows.length > FREE_ROW_LIMIT || lockedCount > 0)
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
  }, [hasLockedRows, rows, whyRevision])

  return (
    <main className="kbo-lines-page">
      <nav className="kbo-prop-tabs" aria-label="KBO prop types">
        {propTabs.map((tab) => <button key={tab} className={tab === propTab ? 'active' : ''} onClick={() => setPropTab(tab)}>{tab}</button>)}
      </nav>
      <section className="kbo-board-header">
        <div><p>KBO / PRIZEPICKS</p><h1>Prop Lines</h1><BoardStatus sport="kbo" updatedAt={updatedAt} /></div>
        <div className="kbo-header-actions"><span>{rows.length}{lockedCount > 0 && !isPaid ? ` + ${lockedCount} locked` : ''} lines · sorted by {filters.sortBy}</span><GameSelect games={games} value={gameId} onChange={setGameId} /><button onClick={() => setFiltersOpen(true)}><FilterIcon /> Filters</button></div>
      </section>
      {error && <p className="kbo-notice">{error}</p>}
      {!error && !snapshot && (
        <div role="status" aria-label="Loading KBO prop lines">
          <BoardSkeleton />
        </div>
      )}
      {!!rows.length && <div className="kbo-lines-table-wrap" ref={tableWrapRef}><table className="kbo-lines-table hit-rate-board"><thead><tr><th>Lines</th><th>L10 Chart</th><th>CG Score</th><th>Over hit rate</th><th>Matchup</th></tr></thead><tbody>
        {rows.map(({ card, prop, score, direction, hitPills }, index) => (
          <KboBoardRow
            key={`${card.name}-${prop.stat}-${prop.line}-${prop.odds_type}-${index}`}
            card={card}
            prop={prop}
            score={score}
            direction={direction}
            hitPills={hitPills}
            photo={photoLookup[String(card.name || '').toLowerCase()]}
            locked={!isPaid && index >= FREE_ROW_LIMIT}
            rowRef={index === lastFreeIndex ? lastFreeRowRef : undefined}
            onSelectPlayer={onSelectPlayer}
            onExpand={() => setWhyRevision((current) => current + 1)}
          />
        ))}
        {Array.from({ length: placeholderCount }, (_, index) => <tr key={`locked-${index}`} className="locked kbo-placeholder-row" aria-hidden="true"><td colSpan={5}><span className="kbo-placeholder-bar" /></td></tr>)}
      </tbody></table>
        {hasLockedRows && lockTop != null && (
          <div className="kbo-lines-lock-overlay" style={{ top: lockTop }}>
            <div className="kbo-lines-lock-card">
              <div className="kbo-lines-lock-icon">🔒</div>
              <h3>Unlock the Full Board</h3>
              <p>Free members see the top {FREE_ROW_LIMIT} lines.{lockedCount > 0 ? ` ${lockedCount} more are locked.` : ''} Upgrade to see every prop line.</p>
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