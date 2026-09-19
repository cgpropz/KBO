import { useEffect, useMemo, useState } from 'react'
import { fetchNflProjections } from './nflData'

function formatValue(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1)
}

export default function NflDashboard({ onOpenBoard }) {
  const [projections, setProjections] = useState([])
  const [updatedAt, setUpdatedAt] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    fetchNflProjections()
      .then(({ projections: next, updatedAt: timestamp }) => {
        if (!active) return
        setProjections(next)
        setUpdatedAt(timestamp)
      })
      .catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  const topThree = useMemo(() => [...projections]
    .map((item) => ({ ...item, score: item.line ? (item.projection / item.line) * 50 : 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3), [projections])

  const updatedLabel = updatedAt ? new Date(updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Awaiting snapshot'

  return (
    <section className="nfl-dashboard">
      <div className="nfl-hero">
        <div><p>NFL / PRIZEPICKS</p><h1>Top 3 Props</h1></div>
        <div className="nfl-live"><i /> LIVE SNAPSHOT <span>{updatedLabel}</span></div>
      </div>
      {error && <div className="nfl-notice">NFL data is not published yet: {error}</div>}
      {!error && !topThree.length && <div className="nfl-notice">Loading the current PrizePicks board.</div>}
      <div className="nfl-top-grid">
        {topThree.map((item, index) => (
          <article className="nfl-top-card" key={item.id}>
            <div className="nfl-rank">0{index + 1}</div>
            <div className="nfl-player">
              <div className="nfl-avatar">{item.imageUrl && <img src={item.imageUrl} alt="" />}</div>
              <div><h2>{item.player}</h2><span>{item.position} · {item.team} vs {item.opponent}</span></div>
            </div>
            <p className="nfl-prop">{item.prop}</p>
            <div className="nfl-metrics"><span>LINE <b>{formatValue(item.line)}</b></span><span>MODEL <b>{formatValue(item.projection)}</b></span><span>EDGE <b>{item.score.toFixed(1)}</b></span></div>
            <div className="nfl-hit"><span>{item.hitRate}% hit rate</span><span>{item.gamesPlayed} games</span></div>
          </article>
        ))}
      </div>
      <button className="nfl-board-link" onClick={onOpenBoard}>Open full PrizePicks board <span>→</span></button>
    </section>
  )
}