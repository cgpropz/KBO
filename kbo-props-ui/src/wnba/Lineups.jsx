import { useEffect, useMemo, useState } from 'react'
import StartingLineups from '../lineups/StartingLineups'
import { wnbaSlateHeading } from '../lineups/normalizeWnbaLineups'
import { fetchWnbaLineups } from './wnbaData'

const TEAM_NAMES = {
  ATL: 'Dream', CHI: 'Sky', CON: 'Sun', DAL: 'Wings', GSV: 'Valkyries',
  IND: 'Fever', LVA: 'Aces', LAS: 'Sparks', MIN: 'Lynx', NYL: 'Liberty',
  PHX: 'Mercury', PDX: 'Fire', SEA: 'Storm', TOR: 'Tempo', WAS: 'Mystics',
}

export default function Lineups() {
  const [matchups, setMatchups] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [lockedCount, setLockedCount] = useState(0)
  useEffect(() => {
    let active = true
    fetchWnbaLineups()
      .then(({ matchups: next, preview, lockedCount: locked }) => {
        if (!active) return
        setMatchups(next)
        setLockedCount(preview ? locked : 0)
        setLoaded(true)
      })
      .catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])
  const heading = useMemo(() => wnbaSlateHeading(matchups), [matchups])
  return (
    <StartingLineups
      kicker="WNBA / GAME DAY"
      heading={heading}
      matchups={matchups}
      teamNames={TEAM_NAMES}
      error={error}
      loaded={loaded}
      lockedCount={lockedCount}
      emptyMessage="No starting lineups are posted yet. Check back closer to tip-off."
    />
  )
}
