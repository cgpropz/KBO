import { useState, useEffect } from 'react'
import { fetchWnbaData } from './wnbaData'
import { fmt1, dvpLabel } from './utils/formatters'

const TEAM_FULL = {
  LVA: 'Las Vegas Aces', MIN: 'Minnesota Lynx', IND: 'Indiana Fever',
  PHX: 'Phoenix Mercury', NYL: 'New York Liberty', SEA: 'Seattle Storm',
  GSV: 'Golden State Valkyries', CON: 'Connecticut Sun', DAL: 'Dallas Wings',
  LAS: 'Los Angeles Sparks', ATL: 'Atlanta Dream', CHI: 'Chicago Sky',
}

const TEAM_COLORS = {
  LVA: '#C9A84C', MIN: '#236192', IND: '#C8102E', PHX: '#E56020',
  NYL: '#6ECEB2', SEA: '#2C5234', GSV: '#FFC72C', CON: '#F47321',
  DAL: '#C4D600', LAS: '#702F8A', ATL: '#418FDE', CHI: '#5D76A9',
}

function DVPRow({ rank, team, oppPts, dvpFactor, leagueAvg }) {
  const dvp = dvpLabel(dvpFactor)
  const tc = TEAM_COLORS[team] || '#FF6900'
  const pct = Math.min(100, Math.max(0, ((oppPts / (leagueAvg * 1.3)) * 100)))

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '9px 0',
      borderBottom: '1px solid #1a1a1a',
    }}>
      <span style={{ width: 20, fontSize: 11, fontWeight: 700, color: '#4b5563', textAlign: 'right' }}>{rank}</span>
      <span style={{
        fontSize: 11, fontWeight: 800, color: tc,
        background: tc + '15', padding: '2px 8px', borderRadius: 20,
        minWidth: 44, textAlign: 'center',
      }}>{team}</span>
      <div style={{ flex: 1, height: 5, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: dvp.color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
      <span style={{ width: 42, textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'white' }}>{fmt1(oppPts)}</span>
      <span style={{
        color: dvp.color, fontWeight: 700, fontSize: 11,
        background: dvp.color + '18', padding: '2px 8px', borderRadius: 20,
        minWidth: 64, textAlign: 'center',
      }}>{dvp.label} {dvpFactor.toFixed(2)}x</span>
    </div>
  )
}

function DVPCard({ position, data }) {
  const sorted = [...(data?.teams ?? [])].sort((a, b) => b.oppPts - a.oppPts)
  const leagueAvg = data?.leagueAvgOppPts ?? 1

  const posColors = { Guard: '#60a5fa', Forward: '#4ade80', Center: '#c084fc' }
  const posColor = posColors[position] || '#FF6900'

  return (
    <div className="card" style={{ padding: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'white' }}>
          <span style={{ color: posColor }}>{position}</span> DVP Rankings
        </h3>
        <div style={{ textAlign: 'right' }}>
          <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>League Avg: <span style={{ color: posColor, fontWeight: 700 }}>{fmt1(leagueAvg)} OPP PTS</span></p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        {[
          { label: 'Easiest', bg: '#22c55e18', color: '#22c55e', team: sorted[0]?.team, val: sorted[0] ? `${fmt1(sorted[0].oppPts)} opp pts` : '—' },
          { label: 'Toughest', bg: '#ef444418', color: '#ef4444', team: sorted[sorted.length - 1]?.team, val: sorted.length ? `${fmt1(sorted[sorted.length - 1].oppPts)} opp pts` : '—' },
        ].map(({ label, bg, color, team, val }) => (
          <div key={label} style={{ flex: 1, background: bg, border: `1px solid ${color}30`, borderRadius: 8, padding: '10px 12px' }}>
            <p className="stat-label" style={{ color }}>{label} Matchup</p>
            <p style={{ margin: '4px 0 0', fontSize: 14, fontWeight: 700, color: 'white' }}>{team || '—'}</p>
            <p style={{ margin: 0, fontSize: 11, color: '#6b7280' }}>{val}</p>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="stat-label">Team</span>
        <div style={{ display: 'flex', gap: 12 }}>
          <span className="stat-label" style={{ width: 60, textAlign: 'right' }}>OPP PTS</span>
          <span className="stat-label" style={{ width: 64 }}>DVP</span>
        </div>
      </div>
      {sorted.map((row, i) => (
        <DVPRow key={row.team} rank={i + 1} team={row.team} oppPts={row.oppPts} dvpFactor={row.dvpFactor} leagueAvg={leagueAvg} />
      ))}
    </div>
  )
}

function TeamCard({ abbr, onSelectTeam, projections }) {
  const tc = TEAM_COLORS[abbr] || '#FF6900'
  const fullName = TEAM_FULL[abbr] || abbr
  const roster = projections?.filter(p => p.team === abbr) ?? []
  const topPlayer = roster[0]

  return (
    <div
      className="card"
      onClick={() => onSelectTeam?.(abbr)}
      style={{
        padding: '20px', cursor: 'pointer',
        background: `linear-gradient(135deg, ${tc}08 0%, #111 70%)`,
        borderColor: tc + '25',
        transition: 'all 0.2s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = tc + '55'; e.currentTarget.style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = tc + '25'; e.currentTarget.style.transform = 'translateY(0)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: tc + '20', border: `2px solid ${tc}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 900, color: tc,
        }}>{abbr}</div>
        <div>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: 'white' }}>{fullName}</p>
          <p style={{ margin: '3px 0 0', fontSize: 11, color: '#6b7280' }}>{roster.length} players tracked</p>
        </div>
      </div>
      {topPlayer && (
        <div style={{ background: '#0e0e0e', borderRadius: 8, padding: '10px 12px' }}>
          <p className="stat-label" style={{ marginBottom: 4 }}>Top Projected</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'white' }}>{topPlayer.name}</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: '#FF6900' }}>{fmt1(topPlayer.projPts)} PTS</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Teams({ onSelectTeam }) {
  const [guardDvp, setGuardDvp] = useState(null)
  const [forwardDvp, setForwardDvp] = useState(null)
  const [centerDvp, setCenterDvp] = useState(null)
  const [projections, setProjections] = useState(null)
  const [activePos, setActivePos] = useState('Guard')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [g, f, c, pr] = await Promise.all([
          fetchWnbaData('wnba/dvp_guard.json'),
          fetchWnbaData('wnba/dvp_forward.json'),
          fetchWnbaData('wnba/dvp_center.json'),
          fetchWnbaData('wnba/projections_standard.json'),
        ])
        if (cancelled) return
        setGuardDvp(g)
        setForwardDvp(f)
        setCenterDvp(c)
        setProjections(Array.isArray(pr) ? pr : [])
      } catch {
        /* leave nulls → cards render empty states */
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const dvpByPos = { Guard: guardDvp, Forward: forwardDvp, Center: centerDvp }
  const TEAMS = Object.keys(TEAM_COLORS)

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 28, fontWeight: 800, color: 'white' }}>Teams & DVP</h1>
        <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>
          Defense vs Position rankings — higher OPP PTS = easier matchup for that position
        </p>
      </div>

      {/* Team cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14, marginBottom: 36 }}>
        {TEAMS.map(abbr => (
          <TeamCard key={abbr} abbr={abbr} onSelectTeam={onSelectTeam} projections={projections ?? []} />
        ))}
      </div>

      {/* DVP tables */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'white' }}>Defense vs Position</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            {['Guard', 'Forward', 'Center'].map(pos => (
              <button key={pos} className={`btn-ghost${activePos === pos ? ' active' : ''}`}
                onClick={() => setActivePos(pos)}>{pos}</button>
            ))}
          </div>
        </div>
        <DVPCard position={activePos} data={dvpByPos[activePos]} />
      </div>

      {/* All 3 DVP tables */}
      <h2 style={{ fontSize: 16, fontWeight: 700, color: 'white', margin: '32px 0 16px' }}>All Position DVP Comparison</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {['Guard', 'Forward', 'Center'].map(pos => (
          <DVPCard key={pos} position={pos} data={dvpByPos[pos]} />
        ))}
      </div>
    </div>
  )
}
