import { useEffect, useState } from 'react'
import { dvpGrade } from '../nfl/matchupGrade'
import { fetchNhlSharpOdds } from './nhlData'

function formatValue(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

function formatAmerican(price) {
  const number = Number(price)
  if (!Number.isFinite(number)) return '—'
  return number > 0 ? `+${number}` : String(number)
}

function formatEdge(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return `${number > 0 ? '+' : ''}${number.toFixed(1)}%`
}

function priceOf(quote) {
  if (!quote || typeof quote !== 'object') return null
  return quote.price ?? quote.american ?? null
}

function bookOf(quote) {
  if (!quote || typeof quote !== 'object') return ''
  return quote.book || ''
}

export default function NhlSharpOdds({ onSelectPlayer }) {
  const [records, setRecords] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let active = true
    fetchNhlSharpOdds()
      .then(({ records: next, payload }) => {
        if (!active) return
        setRecords(next)
        setNote(payload?.message || '')
        setLoaded(true)
      })
      .catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  return (
    <section className="nfl-lines-page">
      <div className="nfl-board-header">
        <div><p>NHL / UNABATED</p><h1>PP Odds</h1></div>
        <span>{records.length} lines</span>
      </div>
      <p className="nhl-note">NHL prices come from the same public Unabated file as the NFL board. Hockey is league 6. Full game only. PP Edge compares the no-vig book price with PrizePicks Flex.</p>
      {error && <div className="nfl-notice">Unable to load odds: {error}</div>}
      {!error && !loaded && <div className="nfl-notice">Loading sportsbook prices.</div>}
      {!error && loaded && !records.length && <div className="nfl-notice">{note || 'No matched NHL odds right now. The prop board is unchanged.'}</div>}
      {!!records.length && (
        <div className="nfl-lines-table-wrap">
          <table className="nfl-lines-table">
            <thead>
              <tr>
                <th>Player</th><th>Prop</th><th>Best Over</th><th>Best Under</th><th>Our Proj</th><th>Matchup</th><th>L5</th><th>L10</th><th>PP Edge</th><th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {records.map((item) => {
                const grade = item.grade || dvpGrade(item.dvpRank)
                return (
                  <tr key={`${item.player}-${item.prop}-${item.pp_line}`} className="nfl-lines-row">
                    <td className="nfl-lines-player">
                      <div className="nfl-lines-info">
                        <button className="nfl-player-link" onClick={() => onSelectPlayer(item)}>{item.player}</button>
                        <span className="nfl-lines-tag">{[item.team, item.position].filter(Boolean).join(', ')}</span>
                      </div>
                    </td>
                    <td>{formatValue(item.pp_line)} {item.prop}</td>
                    <td>{formatAmerican(priceOf(item.best_over))}<div className="nfl-sharp-book">{bookOf(item.best_over)}</div></td>
                    <td>{formatAmerican(priceOf(item.best_under))}<div className="nfl-sharp-book">{bookOf(item.best_under)}</div></td>
                    <td>{formatValue(item.projection)}</td>
                    <td>{grade || '—'}</td>
                    <td>{item.hitRateL5 == null ? '—' : `${Math.round(item.hitRateL5)}%`}</td>
                    <td>{item.hitRate == null ? '—' : `${Math.round(item.hitRate)}%`}</td>
                    <td className={Number(item.pp_edge_flex) > 0 ? 'over' : ''}>{formatEdge(item.pp_edge_flex)}</td>
                    <td>{item.grade || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
