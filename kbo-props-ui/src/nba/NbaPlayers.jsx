import { useEffect, useMemo, useRef, useState } from 'react'
import { NBA_DVP_POSITIONS } from './positions'
import { fetchNbaData, fetchNbaSnapshot } from './nbaData'
import NbaPlayerChart from './NbaPlayerChart'
import { nbaLogoUrl } from './nbaPropLines'
import { CardTeamLogo } from '../CardTeamLogo'
import { fitImage } from '../fitImage.js'

const FILTERS = ['All', ...NBA_DVP_POSITIONS.map((position) => position.id), 'Unset']

function statText(value) {
  return value == null || value === '' ? '—' : Number(value).toFixed(1)
}

function positionColor(position) {
  return NBA_DVP_POSITIONS.find((slot) => slot.id === position)?.color || '#9ca3af'
}

function initials(name) {
  return String(name || '').split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase() || '?'
}

// ESPN headshot from the roster, as on the dashboard and Edge cards. Initials
// stand in when there is no image or it fails to load.
function PlayerHeadshot({ player }) {
  const src = player?.image ? fitImage(player.image, 128) : ''
  const [failedSrc, setFailedSrc] = useState('')
  const color = player?.teamColor || '#1f3f3d'
  return (
    <div className="nba-profile-headshot" style={{ borderColor: color }}>
      {src && src !== failedSrc
        ? <img src={src} alt={player.name} onError={() => setFailedSrc(src)} />
        : <span>{initials(player?.name)}</span>}
    </div>
  )
}

function projectionFor(board, player) {
  if (!player || !Array.isArray(board)) return null
  const id = player.athleteId == null ? '' : String(player.athleteId)
  const name = String(player.name || '').trim().toLowerCase()
  return board.find((row) => id && String(row.athleteId ?? row.playerId ?? '') === id)
    || board.find((row) => String(row.name || row.player || '').trim().toLowerCase() === name)
    || null
}

export default function NbaPlayers({ initialName = '' }) {
  const [players, setPlayers] = useState(null)
  const [board, setBoard] = useState([])
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
        const [rows, lines] = await Promise.all([
          fetchNbaData('nba/players.json'),
          fetchNbaData('nba/projections_standard.json').catch(() => []),
        ])
        if (!cancelled) {
          setPlayers(Array.isArray(rows) ? rows : [])
          setBoard(Array.isArray(lines) ? lines : [])
        }
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

  useEffect(() => {
    const name = selected?.name
    const id = selected?.athleteId
    if (!name) return undefined
    let cancelled = false
    fetchNbaSnapshot('nba/players.json', { player: name })
      .then((snapshot) => {
        if (cancelled) return
        const rows = Array.isArray(snapshot.data) ? snapshot.data : []
        const match = rows.find((row) => row.athleteId === id) || rows.find((row) => row.name === name)
        if (!match || !Array.isArray(match.gameLogs)) return
        setPlayers((current) => (current || []).map((player) => (
          player.athleteId === id ? { ...player, gameLogs: match.gameLogs } : player
        )))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selected?.athleteId, selected?.name])

  if (selected) {
    const logs = Array.isArray(selected.gameLogs) ? selected.gameLogs : []
    const color = selected.teamColor || '#94a3b8'
    return (
      <div className="fade-in">
        <button className="btn-ghost" onClick={() => setSelectedId(null)}>← Players</button>
        <div className="nba-profile-head">
          <PlayerHeadshot player={selected} />
          <div className="nba-profile-id">
            <h1>{selected.name}</h1>
            <p style={{ color }}>
              <CardTeamLogo team={selected.team} src={nbaLogoUrl(selected.team) ? fitImage(nbaLogoUrl(selected.team), 40) : ''} />
              <span>
                {selected.teamFull || selected.team}
                {selected.position ? ` · ${selected.position}` : ' · Position unset'}
              </span>
            </p>
          </div>
        </div>
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <p className="stat-label">2025-26 regular season</p>
          <p style={{ margin: '8px 0 0', color: 'white' }}>
            {selected.gp ? `${selected.gp} GP · ${statText(selected.pts)} PTS · ${statText(selected.reb)} REB · ${statText(selected.ast)} AST` : 'No 2025-26 games yet.'}
          </p>
        </div>
        <NbaPlayerChart player={selected} projection={projectionFor(board, selected)} />
        {logs.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No game log yet.</p>
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
