import { useEffect, useMemo, useState } from 'react'
import { fetchNflProjections } from './nflData'

function formatValue(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1)
}

export default function NflProjections() {
  const [projections, setProjections] = useState([])
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState('ALL')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    fetchNflProjections()
      .then(({ projections: next }) => active && setProjections(next))
      .catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  const rows = useMemo(() => projections
    .map((item) => ({ ...item, score: item.line ? (item.projection / item.line) * 50 : 0 }))
    .filter((item) => position === 'ALL' || item.position === position)
    .filter((item) => item.player.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.score - a.score), [position, projections, query])

  return (
    <section className="nfl-board">
      <div className="nfl-board-header"><div><p>NFL / PRIZEPICKS</p><h1>Edge Board</h1></div><span>{rows.length} props</span></div>
      <div className="nfl-filters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a player" />
        <div>{['ALL', 'QB', 'RB', 'WR', 'TE'].map((item) => <button key={item} className={position === item ? 'active' : ''} onClick={() => setPosition(item)}>{item}</button>)}</div>
      </div>
      {error && <div className="nfl-notice">NFL data is not published yet: {error}</div>}
      <div className="nfl-table-wrap"><table className="nfl-table"><thead><tr><th>Player</th><th>Matchup</th><th>Prop</th><th>Line</th><th>Model</th><th>Hit Rate</th><th>Edge</th></tr></thead><tbody>
        {rows.map((item) => <tr key={item.id}><td><strong>{item.player}</strong><small>{item.position} · {item.team}</small></td><td>vs {item.opponent}</td><td>{item.prop}</td><td>{formatValue(item.line)}</td><td>{formatValue(item.projection)}</td><td>{item.hitRate}%</td><td className="nfl-edge">{item.score.toFixed(1)}</td></tr>)}
      </tbody></table></div>
    </section>
  )
}