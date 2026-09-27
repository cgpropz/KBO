import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchDataSnapshot } from './dataUrl'

// Powers nav-bar player lookup from today's active PrizePicks slate (the same
// set of players the KboPlayerPage can actually render).
export default function PlayerSearch({ onSelect }) {
  const [players, setPlayers] = useState([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimer = useRef(null)

  useEffect(() => {
    let active = true
    fetchDataSnapshot('prizepicks_props.json').then(snapshot => {
      if (!active) return
      const names = (snapshot.data?.cards || []).map(c => c.name).filter(Boolean)
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
    <div className="kbo-player-search">
      <span aria-hidden="true">⌕</span>
      <input
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
        <div className="kbo-player-search-menu">
          {matches.length
            ? matches.map(name => <button key={name} onMouseDown={() => pick(name)}>{name}</button>)
            : <span className="kbo-player-search-empty">No players found</span>}
        </div>
      )}
    </div>
  )
}
