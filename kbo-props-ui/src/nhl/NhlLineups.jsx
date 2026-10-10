import { useEffect, useState } from 'react'
import { fetchNhlLineups } from './nhlData'
import { TEAM_NAMES, teamLogoUrl } from './nhlTeams'

const UNIT_LABEL = {
  F1: 'Line 1', F2: 'Line 2', F3: 'Line 3', F4: 'Line 4',
  D1: 'Pair 1', D2: 'Pair 2', D3: 'Pair 3',
  PP1: 'Power play 1', PP2: 'Power play 2',
  PK1: 'Penalty kill 1', PK2: 'Penalty kill 2',
  F: 'Forwards', D: 'Defense',
  G: 'Goalies',
}

function lineTagClass(label) {
  if (label === 'PROJECTED') return 'nhl-projected'
  if (String(label || '').startsWith('LAST GAME')) return 'nhl-last-game'
  if (label === 'NOT POSTED') return 'nhl-unposted'
  return ''
}

function TeamColumn({ team, players, label }) {
  const logo = teamLogoUrl(team)
  const tagClass = lineTagClass(label)
  let last = ''
  return (
    <div className="nfl-lineup-team">
      <header>
        {logo && <img src={logo} alt="" width="28" height="28" />}
        <b>{team}</b>
        <span>{TEAM_NAMES[team] || team}</span>
        {tagClass && <b className={tagClass}>{label}</b>}
      </header>
      {players.map((player, index) => {
        const unit = player.position === 'G' ? 'Goalie' : (UNIT_LABEL[player.position] || player.position)
        const show = unit !== last
        last = unit
        const status = player.status === 'CONFIRMED' ? 'confirmed' : player.status === 'PROBABLE' ? 'probable' : ''
        return (
          <div key={`${team}-${player.name}-${player.position}-${index}`}>
            {show && <div className="nhl-unit">{unit}</div>}
            <div className="nfl-lineup-player">
              <em>{player.position}</em>
              <span>{player.name}</span>
              {status === 'confirmed' && <b className="nhl-confirmed">CONFIRMED</b>}
              {status === 'probable' && <b className="nhl-probable">PROBABLE</b>}
              {player.status && !status && <b className="nfl-status status-gtd">{player.status}</b>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Matchup({ matchup }) {
  return (
    <article className="nfl-matchup-card">
      <p>{matchup.weekday ? matchup.weekday.slice(0, 3).toUpperCase() : ''} {matchup.gametime || 'TIME TBD'}</p>
      <div className="nfl-matchup-teams">
        <TeamColumn team={matchup.awayTeam} players={matchup.lineups?.[matchup.awayTeam] || []} label={matchup.lineLabels?.[matchup.awayTeam]} />
        <span className="nfl-at">@</span>
        <TeamColumn team={matchup.homeTeam} players={matchup.lineups?.[matchup.homeTeam] || []} label={matchup.lineLabels?.[matchup.homeTeam]} />
      </div>
    </article>
  )
}

export default function NhlLineups() {
  const [matchups, setMatchups] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [lockedCount, setLockedCount] = useState(0)

  useEffect(() => {
    let active = true
    fetchNhlLineups()
      .then(({ matchups: next, preview, lockedCount: locked }) => {
        if (!active) return
        setMatchups(next)
        setLockedCount(preview ? locked : 0)
        setLoaded(true)
      })
      .catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  return (
    <section className="nfl-lineups">
      <header className="nfl-lineups-header">
        <p>NHL / GAME DAY</p>
        <h1>Lines and Goalies</h1>
        <span>Goalie tags come from Daily Faceoff. Skater lines are projected. If that page has no skaters, the list is the last game they actually played. A team with nothing posted stays empty.</span>
      </header>
      {error && <div className="nfl-notice">Unable to load lineups: {error}</div>}
      {!error && !loaded && <div className="nfl-notice">Loading lines and starting goalies.</div>}
      {!error && loaded && !matchups.length && <div className="nfl-notice">No lineups are posted for tonight.</div>}
      {!!matchups.length && <div className="nfl-lineups-grid">{matchups.map((matchup) => <Matchup key={`${matchup.date}-${matchup.awayTeam}-${matchup.homeTeam}`} matchup={matchup} />)}</div>}
      {lockedCount > 0 && <div className="nfl-notice">{lockedCount} more games are locked.</div>}
    </section>
  )
}
