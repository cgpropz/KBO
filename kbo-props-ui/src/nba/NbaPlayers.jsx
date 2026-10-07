import { useEffect, useMemo, useRef, useState } from 'react'
import { NBA_DVP_POSITIONS } from './positions'
import { fetchNbaData } from './nbaData'

const FILTERS = ['All', ...NBA_DVP_POSITIONS.map((position) => position.id), 'Unset']

function statText(value) {
  return value == null || value === '' ? '—' : Number(value).toFixed(1)
}

function positionColor(position) {
  return NBA_DVP_POSITIONS.find((slot) => slot.id === position)?.color || '#9ca3af'
}

export default function NbaPlayers({ initialName = '' }) {
  const [players, setPlayers] = useState(null)
  const appliedName = useRef('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [posFilter, setPosFilter] = useState('All')
  const [teamFilter, setTeamFilter] = useState('All')
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await fetchNbaData('nba/players.json')
        if (!cancelled) setPlayers(Array.isArray(rows) ? rows : [])
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!initialName || !players || appliedName.current === initialName) return
    const match = players.find((player) => player.name === initialName)
    if (!match) return
    appliedName.current = initialName
    setSelectedId(match.athleteId)
  }, [initialName, players])

  const teams = useMemo(() => {
    const names = new Set((players || []).map((player) => player.team).filter(Boolean))
    return ['All', ...[...names].sort()]
  }, [players])

  const filtered = useMemo(() => {
    return (players || []).filter((player) => {
      const nameMatch = !search || player.name.toLowerCase().includes(search.toLowerCase())
      const position = player.position || ''
      const posMatch = posFilter === 'All'
        || (posFilter === 'Unset' ? !position : position === posFilter)
      const teamMatch = teamFilter === 'All' || player.team === teamFilter
      return nameMatch && posMatch && teamMatch
    })
  }, [players, search, posFilter, teamFilter])

  const selected = (players || []).find((player) => player.athleteId === selectedId) || null

  if (selected) {
    const logs = Array.isArray(selected.gameLogs) ? selected.gameLogs : []
    const color = selected.teamColor || '#94a3b8'
    return (
      <div className="fade-in">
        <button className="btn-ghost" onClick={() => setSelectedId(null)}>← Players</button>
        <div style={{ margin: '16px 0 20px' }}>
          <h1 style={{ margin: '0 0 6px', fontSize: 28, fontWeight: 800, color: 'white' }}>{selected.name}</h1>
          <p style={{ margin: 0, color, fontSize: 13, fontWeight: 700 }}>
            {selected.teamFull || selected.team}
            {selected.position ? ` · ${selected.position}` : ' · Position unset'}
          </p>
        </div>
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <p className="stat-label">2025-26 regular season</p>
          <p style={{ margin: '8px 0 0', color: 'white' }}>
            {selected.gp ? `${selected.gp} GP · ${statText(selected.pts)} PTS · ${statText(selected.reb)} REB · ${statText(selected.ast)} AST` : 'No 2025-26 games yet.'}
          </p>
        </div>
        {logs.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No 2025-26 game log.</p>
        ) : (
          <div className="card" style={{ padding: 16, overflowX: 'auto' }}>
            {logs.slice(0, 12).map((game) => (
              <div key={`${game.date}-${game.matchup}`} style={{ display: 'flex', gap: 12, justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1a1a1a', color: '#d4d4d8', fontSize: 13 }}>
                <span>{game.date}</span>
                <span>{game.team} {game.matchup}</span>
                <span>{game.result}</span>
                <span>{statText(game.pts)} PTS</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fade-in">
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 28, fontWeight: 800, color: 'white' }}>Players</h1>
        <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>
          {players ? `${players.length} current roster players — 2025-26 regular season` : 'Loading roster...'}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <input
          className="search-input"
          placeholder="Search players..."
          aria-label="Search players"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map((position) => (
            <button
              key={position}
              className={`btn-ghost${posFilter === position ? ' active' : ''}`}
              onClick={() => setPosFilter(position)}
            >
              {position}
            </button>
          ))}
        </div>
        <select
          value={teamFilter}
          onChange={(event) => setTeamFilter(event.target.value)}
          aria-label="Team"
          style={{
            background: '#111', border: '1px solid #222', borderRadius: 8,
            padding: '7px 12px', color: '#e5e5e5', fontSize: 13, fontFamily: 'inherit',
          }}
        >
          {teams.map((team) => <option key={team} value={team}>{team === 'All' ? 'All Teams' : team}</option>)}
        </select>
      </div>
      {error && (
        <div style={{ padding: 32, textAlign: 'center', color: '#ef4444' }}>
          Failed to load players: {error}.
        </div>
      )}
      {loading && <p style={{ color: '#6b7280' }}>Loading roster...</p>}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {filtered.map((player) => {
            const color = player.teamColor || '#94a3b8'
            const slot = player.position || 'Unset'
            return (
              <button
                key={player.athleteId || player.name}
                type="button"
                className="card"
                onClick={() => setSelectedId(player.athleteId)}
                style={{
                  textAlign: 'left', color: 'inherit', font: 'inherit', cursor: 'pointer',
                  padding: 20, position: 'relative', overflow: 'hidden',
                }}
              >
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color }} />
                <p style={{ margin: '0 0 6px', fontWeight: 700, color: 'white' }}>{player.name}</p>
                <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color }}>
                  {player.team} · <span style={{ color: positionColor(player.position) }}>{slot}</span>
                </p>
                <p style={{ margin: 0, fontSize: 13, color: '#d4d4d8' }}>
                  {player.gp ? `${statText(player.pts)} PTS · ${statText(player.reb)} REB · ${statText(player.ast)} AST` : 'No 2025-26 games yet'}
                </p>
              </button>
            )
          })}
        </div>
      )}
      {!loading && filtered.length === 0 && !error && (
        <p style={{ color: '#6b7280' }}>No players match your filters.</p>
      )}
    </div>
  )
}
