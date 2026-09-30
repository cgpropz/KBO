import { useEffect, useMemo, useState } from 'react'
import { fetchNflSharpOdds } from './nflData'

const PROP_ORDER = ['Pass Yards', 'Pass Attempts', 'Pass Completions', 'Pass+Rush Yds', 'Rush Yards', 'Rush Attempts', 'Rush+Rec Yds', 'Receiving Yards', 'Receptions', 'Rec Targets']
const GRADE_RANK = { 'A+': 4, A: 3, B: 2, C: 1 }

function formatValue(value) {
  if (value == null || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

function formatAmerican(price) {
  if (price == null || !Number.isFinite(Number(price))) return '—'
  const number = Number(price)
  return number > 0 ? `+${number}` : String(number)
}

function formatHit(rate) {
  if (rate == null || rate === '') return '—'
  const number = Number(rate)
  return Number.isFinite(number) ? `${Math.round(number)}%` : '—'
}

function formatEv(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const number = Number(value)
  const text = `${number > 0 ? '+' : ''}${number.toFixed(1)}%`
  return text
}

function initials(name) {
  return String(name || '').split(' ').map((part) => part[0]).join('').slice(0, 2)
}

function gradeClass(grade) {
  if (!grade) return 'grade-na'
  return `grade-${grade[0].toLowerCase()}`
}

function Quote({ quote, side }) {
  if (!quote) return <span className="nfl-sharp-book">—</span>
  return (
    <>
      <div className={`nfl-sharp-price ${side}`}>{formatAmerican(quote.price)}</div>
      <div className="nfl-sharp-book">{quote.book}{quote.implied_pct != null ? ` · ${Number(quote.implied_pct).toFixed(1)}%` : ''}</div>
    </>
  )
}

function SharpRow({ item, onSelectPlayer }) {
  const side = item.recommendation === 'UNDER' ? 'under' : 'over'
  const label = item.recommendation === 'UNDER' ? 'UNDER' : item.recommendation === 'OVER' ? 'OVER' : 'LINE'
  const evClass = item.ev_pct == null ? '' : item.ev_pct >= 0 ? 'over' : 'under'

  return (
    <tr className="nfl-lines-row">
      <td className="nfl-lines-player">
        <div className="nfl-lines-avatar">{item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : initials(item.player)}</div>
        <div className="nfl-lines-info">
          <button className="nfl-player-link" onClick={() => onSelectPlayer?.(item.player, item.prop)}>{item.player}</button>
          <span className="nfl-lines-tag">{[item.team, item.position].filter(Boolean).join(', ') || 'NFL'}</span>
        </div>
      </td>
      <td>
        <div className={`nfl-lines-line ${side}`}><b>{label}</b> {formatValue(item.pp_line)} {item.prop}</div>
        {item.line_match === 'nearest' && <div className="nfl-sharp-book">nearest {formatValue(item.matched_line)}</div>}
      </td>
      <td><Quote quote={item.best_over} side="over" /></td>
      <td><Quote quote={item.best_under} side="under" /></td>
      <td>{formatValue(item.projection)}</td>
      <td>{formatHit(item.hitRateL5)} / {formatHit(item.hitRate)}</td>
      <td className={`nfl-sharp-ev ${evClass}`}>{formatEv(item.ev_pct)}</td>
      <td><span className={`nfl-grade ${gradeClass(item.grade)}`}>{item.grade || '—'}</span></td>
    </tr>
  )
}

export default function NflSharpOdds({ onSelectPlayer }) {
  const [payload, setPayload] = useState(null)
  const [records, setRecords] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [lockedCount, setLockedCount] = useState(0)
  const [query, setQuery] = useState('')
  const [prop, setProp] = useState('All')
  const [side, setSide] = useState('All')
  const [sort, setSort] = useState('Grade')

  useEffect(() => {
    let active = true
    fetchNflSharpOdds()
      .then(({ payload: nextPayload, records: nextRecords, preview, lockedCount: locked }) => {
        if (!active) return
        setPayload(nextPayload)
        setRecords(nextRecords)
        setLockedCount(preview ? locked : 0)
        setLoaded(true)
      })
      .catch((loadError) => {
        if (active) setError(loadError.message)
      })
    return () => { active = false }
  }, [])

  const props = useMemo(() => {
    const present = new Set(records.map((item) => item.prop).filter(Boolean))
    const ordered = PROP_ORDER.filter((item) => present.has(item))
    const extras = [...present].filter((item) => !PROP_ORDER.includes(item)).sort()
    return ['All', ...ordered, ...extras]
  }, [records])

  const rows = useMemo(() => {
    const filtered = records.filter((item) => {
      if (prop !== 'All' && item.prop !== prop) return false
      if (side === 'Overs' && item.recommendation !== 'OVER') return false
      if (side === 'Unders' && item.recommendation !== 'UNDER') return false
      if (query && !String(item.player || '').toLowerCase().includes(query.toLowerCase())) return false
      return true
    })
    const rank = (item) => GRADE_RANK[item.grade] || 0
    const ev = (item) => (Number.isFinite(Number(item.ev_pct)) ? Number(item.ev_pct) : -999)
    return filtered.sort((a, b) => {
      if (sort === 'EV') return ev(b) - ev(a)
      if (sort === 'L10') return (b.hitRate ?? -1) - (a.hitRate ?? -1)
      if (sort === 'L5') return (b.hitRateL5 ?? -1) - (a.hitRateL5 ?? -1)
      return (rank(b) - rank(a)) || (ev(b) - ev(a)) || String(a.player).localeCompare(String(b.player))
    })
  }, [records, prop, side, query, sort])

  const status = payload?.status || 'ok'
  const matched = payload?.matched_count
  const showStatus = loaded && !error && payload && status !== 'ok'

  return (
    <section className="nfl-lines-page nfl-sharp-page">
      <div className="nfl-board-header">
        <div>
          <p>NFL / SHARP ODDS</p>
          <h1>Sharp Odds</h1>
        </div>
        <span>{loaded ? `${rows.length} props` : ''}</span>
      </div>
      <div className="nfl-board-meta">
        <span><i /> {payload?.provider === 'unabated' || !payload ? 'UNABATED PUBLIC ODDS' : String(payload.provider).toUpperCase()}</span>
        <span>{matched != null ? `${matched} matched to a book` : 'Best price vs no-vig fair'}</span>
        <span>A+ / A / B / C from EV</span>
      </div>
      <div className="nfl-lines-tabs" role="tablist" aria-label="Prop type">
        {props.map((item) => (
          <button key={item} className={prop === item ? 'active' : ''} onClick={() => setProp(item)}>{item === 'All' ? 'All Props' : item}</button>
        ))}
      </div>
      <section className="nfl-edge-controls" aria-label="Sharp odds filters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player..." />
        <label><span>SORT</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option>Grade</option>
            <option>EV</option>
            <option>L10</option>
            <option>L5</option>
          </select>
        </label>
        <label><span>SIDE</span>
          <select value={side} onChange={(event) => setSide(event.target.value)}>
            <option>All</option>
            <option>Overs</option>
            <option>Unders</option>
          </select>
        </label>
      </section>
      {error && <div className="nfl-notice">Unable to load NFL sharp odds: {error}</div>}
      {!error && !loaded && <div className="nfl-notice">Loading sharp odds.</div>}
      {showStatus && <div className="nfl-notice">{payload.message || 'Sportsbook odds are unavailable right now.'}</div>}
      {!error && loaded && !records.length && <div className="nfl-notice">{payload?.message || 'No NFL props are on the PrizePicks board right now. Check back closer to kickoff.'}</div>}
      {!error && loaded && !!records.length && !rows.length && <div className="nfl-notice">No props match these filters.</div>}
      {!error && loaded && lockedCount > 0 && <div className="nfl-notice">Free preview: showing the top {records.length} by EV. {lockedCount} more are locked.</div>}
      {!!rows.length && (
        <div className="nfl-lines-table-wrap">
          <table className="nfl-lines-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Prop</th>
                <th>Best Over</th>
                <th>Best Under</th>
                <th>Our Proj</th>
                <th>L5 / L10</th>
                <th>EV</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <SharpRow key={item.id || `${item.player}-${item.prop}-${item.pp_line}`} item={item} onSelectPlayer={onSelectPlayer} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
