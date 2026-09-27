import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchNflProjections } from './nflData'

// Powers nav-bar player lookup from the current projections board. NFL's
// player page routes on {player, prop}, so we keep one representative prop
// per player (whichever appears first) for the "jump to profile" click.
export default function NflPlayerSearch({ onSelect }) {
  const [players, setPlayers] = useState([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimer = useRef(null)

  useEffect(() => {
    let active = true
    fetchNflProjections().then(({ projections }) => {
      if (!active) return
      const seen = new Map()
      for (const item of projections || []) {
        if (item?.player && !seen.has(item.player)) seen.set(item.player, item.prop)
      }
      setPlayers([...seen.entries()].sort((a, b) => a[0].localeCompare(b[0])))
    }).catch(() => {})
    return () => { active = false; window.clearTimeout(blurTimer.current) }
  }, [])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return players.filter(([name]) => name.toLowerCase().includes(q)).slice(0, 8)
  }, [players, query])

  const pick = (name, prop) => {
    onSelect(name, prop)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="nfl-player-search">
      <input
        type="search"
        value={query}
        onChange={event => { setQuery(event.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { blurTimer.current = window.setTimeout(() => setOpen(false), 120) }}
        onKeyDown={event => { if (event.key === 'Enter' && matches[0]) pick(matches[0][0], matches[0][1]) }}
        placeholder="Search player..."
        aria-label="Search player"
      />
      {open && query.trim() && (
        <div className="nfl-player-search-menu">
          {matches.length
            ? matches.map(([name, prop]) => <button key={name} onMouseDown={() => pick(name, prop)}>{name}</button>)
            : <span className="nfl-player-search-empty">No players found</span>}
        </div>
      )}
    </div>
  )
}
