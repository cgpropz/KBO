import './startingLineups.css'

function statusClass(status) {
  return status === 'OUT' ? 'status-out' : status === 'GTD' ? 'status-gtd' : 'status-season'
}

function kickoffLabel(matchup) {
  if (matchup.kickoffLabel) return matchup.kickoffLabel
  if (!matchup.gametime) return 'TBD'
  const [hourText, minuteText] = String(matchup.gametime).split(':')
  const hour = Number(hourText || 0)
  const minute = (minuteText || '00').slice(0, 2)
  const meridiem = hour >= 12 ? 'PM' : 'AM'
  const weekday = String(matchup.weekday || '').slice(0, 3).toUpperCase()
  const clock = `${hour % 12 || 12}:${minute} ${meridiem} ET`
  return weekday ? `${weekday} ${clock}` : clock
}

function weatherLabel(matchup) {
  if (matchup.conditions) return matchup.conditions
  if (matchup.roof === 'dome' || matchup.roof === 'closed') return 'DOME'
  if (matchup.temp === null || matchup.temp === undefined) return 'WEATHER TBD'
  return `${Math.round(matchup.temp)}°F · ${Math.round(matchup.wind || 0)} MPH WIND`
}

function TeamColumn({ team, record, lineup, teamNames }) {
  return (
    <div className="nfl-lineup-team">
      <header>
        <b>{team}</b>
        <span>
          {teamNames[team] || team}
          <small>{record}</small>
        </span>
      </header>
      {lineup.map((player, index) => (
        <div className="nfl-lineup-player" key={`${team}-${player.position}-${player.name}-${index}`}>
          <em>{player.position}</em>
          <i>{player.imageUrl && <img src={player.imageUrl} alt="" loading="lazy" />}</i>
          <span>{player.name}</span>
          {player.status && <b className={`nfl-status ${statusClass(player.status)}`}>{player.status}</b>}
        </div>
      ))}
    </div>
  )
}

function InjuryColumn({ team, entries }) {
  return (
    <div className="nfl-injury-column">
      <b>{team}</b>
      {entries.length ? entries.map((entry) => (
        <div className="nfl-injury" key={`${team}-${entry.name}`}>
          <i className={`nfl-status ${statusClass(entry.status)}`}>{entry.status}</i>
          <span>
            {entry.name}
            <small>{entry.position}{entry.detail ? ` · ${entry.detail}` : ''}</small>
          </span>
        </div>
      )) : <small>No injury designations.</small>}
    </div>
  )
}

function MatchupCard({ matchup, teamNames }) {
  const spread = matchup.spreadLine
  return (
    <article className="nfl-matchup-card">
      <p>{kickoffLabel(matchup)}</p>
      <div className="nfl-matchup-teams">
        <TeamColumn team={matchup.awayTeam} record={matchup.awayRecord} lineup={matchup.lineups?.[matchup.awayTeam] || []} teamNames={teamNames} />
        <span className="nfl-at">@</span>
        <TeamColumn team={matchup.homeTeam} record={matchup.homeRecord} lineup={matchup.lineups?.[matchup.homeTeam] || []} teamNames={teamNames} />
      </div>
      <footer>
        <span>{weatherLabel(matchup)}</span>
        <span>SPREAD (HOME) {spread > 0 ? '+' : ''}{spread ?? '—'}</span>
        <span>O/U {matchup.totalLine ?? '—'}</span>
      </footer>
      <section className="nfl-injuries">
        <p>INJURY REPORT</p>
        <div>
          <InjuryColumn team={matchup.awayTeam} entries={matchup.injuries?.[matchup.awayTeam] || []} />
          <InjuryColumn team={matchup.homeTeam} entries={matchup.injuries?.[matchup.homeTeam] || []} />
        </div>
      </section>
    </article>
  )
}

export default function StartingLineups({
  kicker,
  heading,
  matchups,
  teamNames,
  error,
  loaded,
  lockedCount,
  emptyMessage,
}) {
  return (
    <section className="nfl-lineups">
      <header className="nfl-lineups-header">
        <p>{kicker}</p>
        <h1>{heading}</h1>
        <span>
          <b className="nfl-status status-out">OUT</b> Ruled out
          <b className="nfl-status status-gtd">GTD</b> Questionable / doubtful
          <b className="nfl-status status-season">OUT (SEASON)</b> Injured reserve
        </span>
      </header>
      {error ? <div className="nfl-notice">Unable to load starting lineups: {error}</div>
        : !loaded ? <div className="nfl-notice">Loading the current starting lineups.</div>
          : !matchups.length ? <div className="nfl-notice">{emptyMessage}</div>
            : (
              <>
                <div className="nfl-lineups-grid">
                  {matchups.map((matchup) => (
                    <MatchupCard key={`${matchup.awayTeam}-${matchup.homeTeam}-${matchup.gameday || ''}`} matchup={matchup} teamNames={teamNames} />
                  ))}
                </div>
                {lockedCount > 0 && (
                  <div className="nfl-notice">
                    Free preview: showing {matchups.length} game{matchups.length === 1 ? '' : 's'}. {lockedCount} more are locked. Upgrade to see every lineup.
                  </div>
                )}
              </>
            )}
    </section>
  )
}
