import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchWnbaData } from './wnbaData'

// Powers nav-bar player lookup from the standard-line projections board (the
// same set of players WnbaPlayerPage can actually render).
export default function WnbaPlayerSearch({ onSelect }) {
  const [players, setPlayers] = useState([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimer = useRef(null)

  useEffect(() => {
    let active = true
    fetchWnbaData('wnba/projections_standard.json').then(data => {
      if (!active) return
      const names = (Array.isArray(data) ? data : []).map(p => p.name).filter(Boolean)
      setPlayers([...new Set(names)].sort())
    }).catch(() => {})
    return () => { active = false; window.clearTimeout(blurTimer.current) }
  }, [])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return players.filter(name => name.toLowerCase().includes(q)).slice(0, 8)
  }, [players, query])

  const pick = name => {
    onSelect(name)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="wnba-player-search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
      </svg>
      <input
        className="search-input"
        type="search"
        value={query}
        onChange={event => { setQuery(event.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimer.current = window.setTimeout(() => setOpen(false), 120) }}
        onKeyDown={event => { if (event.key === 'Enter' && matches[0]) pick(matches[0]) }}
        placeholder="Search player..."
        aria-label="Search player"
      />
      {open && query.trim() && (
        <div className="wnba-player-search-menu">
          {matches.length
            ? matches.map(name => <button key={name} onMouseDown={() => pick(name)}>{name}</button>)
            : <span className="wnba-player-search-empty">No players found</span>}
        </div>
      )}
    </div>
  )
}
