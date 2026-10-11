import { useEffect, useMemo, useState } from 'react'
import StartingLineups from '../lineups/StartingLineups'
import { fetchNflLineups } from './nflData'

const TEAM_NAMES = { ARI: 'Cardinals', ATL: 'Falcons', BAL: 'Ravens', BUF: 'Bills', CAR: 'Panthers', CHI: 'Bears', CIN: 'Bengals', CLE: 'Browns', DAL: 'Cowboys', DEN: 'Broncos', DET: 'Lions', GB: 'Packers', HOU: 'Texans', IND: 'Colts', JAC: 'Jaguars', JAX: 'Jaguars', KC: 'Chiefs', LA: 'Rams', LAC: 'Chargers', LV: 'Raiders', MIA: 'Dolphins', MIN: 'Vikings', NE: 'Patriots', NO: 'Saints', NYG: 'Giants', NYJ: 'Jets', PHI: 'Eagles', PIT: 'Steelers', SEA: 'Seahawks', SF: '49ers', TB: 'Buccaneers', TEN: 'Titans', WAS: 'Commanders' }

export default function NflLineups() {
  const [matchups, setMatchups] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [lockedCount, setLockedCount] = useState(0)
  useEffect(() => {
    let active = true
    fetchNflLineups()
      .then(({ matchups: next, preview, lockedCount: locked }) => {
        if (!active) return
        setMatchups(next)
        setLockedCount(preview ? locked : 0)
        setLoaded(true)
      })
      .catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])
  const week = useMemo(() => matchups[0]?.week, [matchups])
  return (
    <StartingLineups
      kicker="NFL / GAME DAY"
      heading={`Week ${week || '—'} Starting Lineups`}
      matchups={matchups}
      teamNames={TEAM_NAMES}
      error={error}
      loaded={loaded}
      lockedCount={lockedCount}
      emptyMessage="No starting lineups are posted yet. Check back closer to kickoff."
    />
  )
}
