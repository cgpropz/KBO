import { useState, useMemo, useEffect } from 'react'
import { fetchWnbaData } from './wnbaData'
import PlayerCard from './components/PlayerCard'

const POSITIONS = ['All', 'Guard', 'Forward', 'Center']

export default function PlayerMap({ onSelectPlayer, initialTeam = 'All' }) {
  const [players, setPlayers] = useState(null)
  const [projData, setProjData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [posFilter, setPosFilter] = useState('All')
  const [teamFilter, setTeamFilter] = useState(initialTeam)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const [pl, pr] = await Promise.all([
          fetchWnbaData('wnba/players.json'),
          fetchWnbaData('wnba/projections_standard.json'),
        ])
        if (cancelled) return
        setPlayers(Array.isArray(pl) ? pl : [])
        setProjData(Array.isArray(pr) ? pr : [])
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Build name -> { pts, reb, ast, fg3m } PP standard lines lookup
  const ppLinesMap = useMemo(() => {
    if (!projData) return {}
    const map = {}
    projData.forEach(p => {
      const lines = {}
      ;(p.ppAllProps || []).forEach(prop => {
        if (prop.standardLine != null) lines[prop.stat] = prop.standardLine
        else if (prop.line != null) lines[prop.stat] = prop.line
      })
      if (Object.keys(lines).length) map[p.name] = lines
    })
    return map
  }, [projData])

  const teams = useMemo(() => {
    if (!players) return ['All']
    const s = new Set(players.map(p => p.team).filter(Boolean))
    return ['All', ...[...s].sort()]
  }, [players])

  const filtered = useMemo(() => {
    if (!players) return []
    return players.filter(p => {
      const nameMatch = !search || p.name.toLowerCase().includes(search.toLowerCase())
      const posMatch = posFilter === 'All' || p.position === posFilter
      const teamMatch = teamFilter === 'All' || p.team === teamFilter
      return nameMatch && posMatch && teamMatch
    })
  }, [players, search, posFilter, teamFilter])

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 28, fontWeight: 800, color: 'white' }}>
          Player Map
        </h1>
        <p style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>
          {players ? `${players.length} active players — 2025/2026 season` : 'Loading roster...'}
        </p>
      </div>

      {/* Filters bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        marginBottom: 24, flexWrap: 'wrap',
      }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 320 }}>
          <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }}
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            className="search-input"
            style={{ paddingLeft: 32 }}
            placeholder="Search players..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Position filter */}
        <div style={{ display: 'flex', gap: 6 }}>
          {POSITIONS.map(pos => (
            <button
              key={pos}
              className={`btn-ghost${posFilter === pos ? ' active' : ''}`}
              onClick={() => setPosFilter(pos)}
            >
              {pos}
            </button>
          ))}
        </div>

        {/* Team filter */}
        <select
          value={teamFilter}
          onChange={e => setTeamFilter(e.target.value)}
          style={{
            background: '#111', border: '1px solid #222', borderRadius: 8,
            padding: '7px 12px', color: '#e5e5e5', fontSize: 13,
            fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
          }}
        >
          {teams.map(t => <option key={t} value={t}>{t === 'All' ? 'All Teams' : t}</option>)}
        </select>

        {/* Result count */}
        {!loading && (
          <span style={{ color: '#4b5563', fontSize: 12, marginLeft: 'auto' }}>
            {filtered.length} player{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '32px', textAlign: 'center', color: '#ef4444', background: '#1a0a0a', borderRadius: 12, border: '1px solid #3f1a1a' }}>
          Failed to load players: {error}.
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {Array(12).fill(0).map((_, i) => (
            <div key={i} style={{ height: 160, background: '#111', borderRadius: 12, border: '1px solid #1f1f1f', animation: 'wnbaFadeIn 0.3s ease', opacity: 0.7 }} />
          ))}
        </div>
      )}

      {/* Player grid */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {filtered.map(player => (
            <PlayerCard key={player.name} player={player} ppLines={ppLinesMap[player.name] ?? null} onSelect={onSelectPlayer} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && !error && (
        <div style={{ padding: '64px', textAlign: 'center', color: '#4b5563' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
          <p style={{ fontSize: 15, margin: 0 }}>No players match your filters.</p>
          <button className="btn-ghost" style={{ marginTop: 14 }} onClick={() => { setSearch(''); setPosFilter('All'); setTeamFilter('All') }}>
            Clear filters
          </button>
        </div>
      )}
    </div>
  )
}
