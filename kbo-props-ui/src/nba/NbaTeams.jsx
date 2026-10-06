import { NBA_DVP_POSITIONS } from './positions'

function DvpSlot({ position, data }) {
  const teams = Array.isArray(data?.teams) ? data.teams : []
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'white' }}>
          <span style={{ color: position.color }}>{position.id}</span> DVP Rankings
        </h3>
      </div>
      <p className="stat-label" style={{ margin: '0 0 8px' }}>{position.label}</p>
      {teams.length === 0 ? (
        <p className="nba-dvp-empty">No 2025-26 rankings yet.</p>
      ) : (
        teams.map((row) => (
          <div key={row.team} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1a1a1a' }}>
            <span style={{ color: 'white', fontSize: 13 }}>{row.team}</span>
            <span style={{ color: '#9ca3af', fontSize: 12 }}>{row.oppPts}</span>
          </div>
        ))
      )}
    </div>
  )
}

export default function NbaTeams({ boards = {} }) {
  return (
    <div className="fade-in">
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 28, fontWeight: 800, color: 'white' }}>Teams & DVP</h1>
        <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>
          Defense vs position — point guard, shooting guard, small forward, power forward, and center.
        </p>
      </div>
      <div className="nba-dvp-grid">
        {NBA_DVP_POSITIONS.map((position) => (
          <DvpSlot key={position.id} position={position} data={boards[position.id]} />
        ))}
      </div>
    </div>
  )
}
