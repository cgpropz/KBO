import { useEffect, useState } from 'react'
import { NBA_DVP_POSITIONS } from './positions'
import { fetchNbaData } from './nbaData'

function fmt1(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(1) : '—'
}

function mix(from, to, progress) {
  const amount = Math.min(1, Math.max(0, progress))
  return `rgb(${Math.round(from[0] + (to[0] - from[0]) * amount)}, ${Math.round(from[1] + (to[1] - from[1]) * amount)}, ${Math.round(from[2] + (to[2] - from[2]) * amount)})`
}

// 1 is the toughest matchup and `max` is the easiest, matching the WNBA rank.
function dvpLabel(rankValue, maxTeams) {
  const max = Math.max(1, maxTeams || 30)
  const rank = Math.min(max, Math.max(1, Math.round(Number(rankValue) || 1)))
  const mid = Math.round(max / 2)
  const label = rank < mid ? 'Tough' : rank > mid ? 'Easy' : 'Neutral'
  const color = rank <= mid
    ? mix([239, 68, 68], [250, 204, 21], mid === 1 ? 1 : (rank - 1) / (mid - 1))
    : mix([250, 204, 21], [34, 197, 94], (rank - mid) / Math.max(1, max - mid))
  return { label, color, rank }
}

function DvpRow({ order, team, oppPts, dvpFactor, leagueAvg, color }) {
  const dvp = dvpLabel(dvpFactor, 30)
  const pct = Math.min(100, Math.max(0, (oppPts / (leagueAvg * 1.3)) * 100))
  return (
    <div className="nba-dvp-row">
      <span className="nba-dvp-order">{order}</span>
      <span className="nba-dvp-team" style={{ color, background: `${color}15` }}>{team}</span>
      <div className="nba-dvp-bar">
        <div style={{ width: `${pct}%`, background: dvp.color }} />
      </div>
      <span className="nba-dvp-pts">{fmt1(oppPts)}</span>
      <span className="nba-dvp-badge" style={{ color: dvp.color, background: `${dvp.color}18` }}>
        {dvp.label} {dvp.rank}
      </span>
    </div>
  )
}

function DvpCard({ position, data, colors }) {
  const sorted = [...(data?.teams ?? [])].sort((a, b) => b.oppPts - a.oppPts)
  const leagueAvg = data?.leagueAvgOppPts ?? 1
  const easiest = sorted[0]
  const toughest = sorted[sorted.length - 1]
  return (
    <div className="card nba-dvp-card">
      <div className="nba-dvp-card-head">
        <h3>
          <span style={{ color: position.color }}>{position.id}</span> DVP Rankings
        </h3>
        <p>League Avg: <span style={{ color: position.color }}>{fmt1(leagueAvg)} OPP PTS</span></p>
      </div>
      <div className="nba-dvp-extremes">
        {[
          { label: 'Easiest', tone: '#22c55e', team: easiest?.team, val: easiest ? `${fmt1(easiest.oppPts)} opp pts` : '—' },
          { label: 'Toughest', tone: '#ef4444', team: toughest?.team, val: toughest ? `${fmt1(toughest.oppPts)} opp pts` : '—' },
        ].map(({ label, tone, team, val }) => (
          <div key={label} style={{ background: `${tone}18`, border: `1px solid ${tone}30` }}>
            <p className="stat-label" style={{ color: tone }}>{label} Matchup</p>
            <p className="nba-dvp-extreme-team">{team || '—'}</p>
            <p className="nba-dvp-extreme-val">{val}</p>
          </div>
        ))}
      </div>
      {sorted.length === 0 ? (
        <p className="nba-dvp-empty">No 2025-26 rankings yet.</p>
      ) : (
        <>
          <div className="nba-dvp-columns">
            <span className="stat-label">Team</span>
            <span className="stat-label">OPP PTS</span>
            <span className="stat-label">DVP</span>
          </div>
          {sorted.map((row, index) => (
            <DvpRow
              key={row.team}
              order={index + 1}
              team={row.team}
              oppPts={row.oppPts}
              dvpFactor={row.dvpFactor}
              leagueAvg={leagueAvg}
              color={colors[row.team] || '#94a3b8'}
            />
          ))}
        </>
      )}
    </div>
  )
}

export default function NbaTeams() {
  const [teams, setTeams] = useState([])
  const [boards, setBoards] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeId, setActiveId] = useState('PG')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [teamRows, ...dvps] = await Promise.all([
          fetchNbaData('nba/teams.json').catch(() => []),
          ...NBA_DVP_POSITIONS.map((position) => fetchNbaData(`nba/dvp_${position.id.toLowerCase()}.json`)),
        ])
        if (cancelled) return
        setTeams(Array.isArray(teamRows) ? teamRows : [])
        const next = {}
        NBA_DVP_POSITIONS.forEach((position, index) => {
          next[position.id] = dvps[index]
        })
        setBoards(next)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const colors = Object.fromEntries(teams.map((team) => [team.abbr, team.color]))
  const active = NBA_DVP_POSITIONS.find((position) => position.id === activeId) || NBA_DVP_POSITIONS[0]
  const sourceThrough = boards?.[active.id]?.sourceThrough

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 28, fontWeight: 800, color: 'white' }}>Teams & DVP</h1>
        <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>
          Defense vs position — higher OPP PTS is an easier matchup for that spot.
          {sourceThrough ? ` 2025-26 regular season through ${sourceThrough}.` : ''}
        </p>
      </div>
      {teams.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
          {teams.map((team) => (
            <span
              key={team.abbr}
              title={team.fullName}
              style={{
                color: team.color || '#e5e5e5',
                background: `${team.color || '#94a3b8'}18`,
                border: `1px solid ${team.color || '#94a3b8'}55`,
                borderRadius: 999,
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {team.abbr}
            </span>
          ))}
        </div>
      )}
      {loading && <p style={{ color: '#6b7280' }}>Loading 2025-26 rankings...</p>}
      {error && <p style={{ color: '#ef4444' }}>Failed to load DVP: {error}.</p>}
      {boards && (
        <>
          <div className="wnba-dvp-head">
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'white' }}>Defense vs Position</h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {NBA_DVP_POSITIONS.map((position) => (
                <button
                  key={position.id}
                  className={`btn-ghost${activeId === position.id ? ' active' : ''}`}
                  onClick={() => setActiveId(position.id)}
                >
                  {position.id}
                </button>
              ))}
            </div>
          </div>
          <DvpCard position={active} data={boards[active.id]} colors={colors} />
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'white', margin: '32px 0 16px' }}>All Position DVP Comparison</h2>
          <div className="nba-dvp-grid">
            {NBA_DVP_POSITIONS.map((position) => (
              <DvpCard key={position.id} position={position} data={boards[position.id]} colors={colors} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
