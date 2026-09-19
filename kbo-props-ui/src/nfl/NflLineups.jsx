import { useEffect, useMemo, useState } from 'react'
import { fetchNflLineups } from './nflData'

const TEAM_NAMES = { ARI: 'Cardinals', ATL: 'Falcons', BAL: 'Ravens', BUF: 'Bills', CAR: 'Panthers', CHI: 'Bears', CIN: 'Bengals', CLE: 'Browns', DAL: 'Cowboys', DEN: 'Broncos', DET: 'Lions', GB: 'Packers', HOU: 'Texans', IND: 'Colts', JAC: 'Jaguars', KC: 'Chiefs', LA: 'Rams', LAC: 'Chargers', LV: 'Raiders', MIA: 'Dolphins', MIN: 'Vikings', NE: 'Patriots', NO: 'Saints', NYG: 'Giants', NYJ: 'Jets', PHI: 'Eagles', PIT: 'Steelers', SEA: 'Seahawks', SF: '49ers', TB: 'Buccaneers', TEN: 'Titans', WAS: 'Commanders' }

function statusClass(status) {
  return status === 'OUT' ? 'status-out' : status === 'GTD' ? 'status-gtd' : 'status-season'
}

function TeamColumn({ team, record, lineup }) {
  return <div className="nfl-lineup-team"><header><b>{team}</b><span>{TEAM_NAMES[team] || team}<small>{record}</small></span></header>{lineup.map((player) => <div className="nfl-lineup-player" key={`${team}-${player.position}-${player.name}`}><em>{player.position}</em><i>{player.imageUrl && <img src={player.imageUrl} alt="" loading="lazy" />}</i><span>{player.name}</span>{player.status && <b className={`nfl-status ${statusClass(player.status)}`}>{player.status}</b>}</div>)}</div>
}

function InjuryColumn({ team, entries }) {
  return <div className="nfl-injury-column"><b>{team}</b>{entries.length ? entries.map((entry) => <div className="nfl-injury" key={`${team}-${entry.name}`}><i className={`nfl-status ${statusClass(entry.status)}`}>{entry.status}</i><span>{entry.name}<small>{entry.position}{entry.detail ? ` · ${entry.detail}` : ''}</small></span></div>) : <small>No injury designations.</small>}</div>
}

function MatchupCard({ matchup }) {
  const hour = Number(matchup.gametime?.split(':')[0] || 0)
  const minute = matchup.gametime?.split(':')[1] || '00'
  const meridiem = hour >= 12 ? 'PM' : 'AM'
  const kickoff = `${matchup.weekday?.slice(0, 3).toUpperCase()} ${hour % 12 || 12}:${minute} ${meridiem} ET`
  const weather = matchup.roof === 'dome' || matchup.roof === 'closed' ? 'DOME' : matchup.temp === null ? 'WEATHER TBD' : `${Math.round(matchup.temp)}°F · ${Math.round(matchup.wind || 0)} MPH WIND`
  return <article className="nfl-matchup-card"><p>{kickoff}</p><div className="nfl-matchup-teams"><TeamColumn team={matchup.awayTeam} record={matchup.awayRecord} lineup={matchup.lineups[matchup.awayTeam] || []} /><span className="nfl-at">@</span><TeamColumn team={matchup.homeTeam} record={matchup.homeRecord} lineup={matchup.lineups[matchup.homeTeam] || []} /></div><footer><span>{weather}</span><span>SPREAD (HOME) {matchup.spreadLine > 0 ? '+' : ''}{matchup.spreadLine ?? '—'}</span><span>O/U {matchup.totalLine ?? '—'}</span></footer><section className="nfl-injuries"><p>INJURY REPORT</p><div><InjuryColumn team={matchup.awayTeam} entries={matchup.injuries[matchup.awayTeam] || []} /><InjuryColumn team={matchup.homeTeam} entries={matchup.injuries[matchup.homeTeam] || []} /></div></section></article>
}

export default function NflLineups() {
  const [matchups, setMatchups] = useState([])
  const [error, setError] = useState('')
  useEffect(() => { fetchNflLineups().then(({ matchups: next }) => setMatchups(next)).catch((loadError) => setError(loadError.message)) }, [])
  const week = useMemo(() => matchups[0]?.week, [matchups])
  return <section className="nfl-lineups"><header className="nfl-lineups-header"><p>NFL / GAME DAY</p><h1>Week {week || '—'} Starting Lineups</h1><span><b className="nfl-status status-out">OUT</b> Ruled out <b className="nfl-status status-gtd">GTD</b> Questionable / doubtful <b className="nfl-status status-season">OUT (SEASON)</b> Injured reserve</span></header>{error ? <div className="nfl-notice">Unable to load starting lineups: {error}</div> : !matchups.length ? <div className="nfl-notice">Loading the current starting lineups.</div> : <div className="nfl-lineups-grid">{matchups.map((matchup) => <MatchupCard key={`${matchup.awayTeam}-${matchup.homeTeam}`} matchup={matchup} />)}</div>}</section>
}