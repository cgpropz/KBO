import { useMemo } from 'react'
import { buildPitcherMatchup, resolveLeague } from './pitcherMatchup'

const TEAM_LOGOS = {
  Doosan: '/team-logos/doosan.svg', Hanwha: '/team-logos/hanwha.svg', Kia: '/team-logos/kia.png',
  Kiwoom: '/team-logos/kiwoom.png', KT: '/team-logos/kt.svg', LG: '/team-logos/lg.svg',
  Lotte: '/team-logos/lotte.svg', NC: '/team-logos/nc.svg', Samsung: '/team-logos/samsung.svg',
  SSG: '/team-logos/ssg.png',
}

function identityLine(model) {
  return [model.team, model.handLabel, model.starts != null ? `${model.starts} starts` : null]
    .filter(Boolean)
    .join(' · ')
}

export default function PitcherMatchup({
  batterTeam,
  matchups,
  rankings,
  matchupLeague,
  leagueFile,
  seasonRates,
  status,
}) {
  const league = useMemo(
    () => resolveLeague(matchupLeague, leagueFile, rankings),
    [matchupLeague, leagueFile, rankings],
  )
  const model = useMemo(
    () => buildPitcherMatchup({ batterTeam, matchups, rankings, league, seasonRates }),
    [batterTeam, matchups, rankings, league, seasonRates],
  )
  const logo = TEAM_LOGOS[model.team]
  const meta = identityLine(model)

  return (
    <section className="kbo-pitcher-matchup" aria-label="Pitcher Matchup">
      <div className="kbo-pitcher-matchup-head">
        <h2>Pitcher Matchup</h2>
        <p>Green = easier matchup for the hitter. Red = tougher. Close to the league average stays neutral.</p>
      </div>

      {status === 'loading' && <div className="kbo-notice">Loading today's starter.</div>}
      {status === 'error' && <div className="kbo-notice">Starter info is unavailable right now.</div>}

      {status === 'ready' && !model.starterName && (
        <div className="kbo-pitcher-matchup-empty">
          <strong>Starter not announced</strong>
          {model.emptyDetail && <span>{model.emptyDetail}</span>}
        </div>
      )}

      {status === 'ready' && model.starterName && (
        <>
          <div className="kbo-pitcher-matchup-identity">
            {logo && <img src={logo} alt="" />}
            <div>
              <strong>{model.starterName}</strong>
              {meta && <span>{meta}</span>}
            </div>
          </div>
          {model.statsNote && <p className="kbo-pitcher-matchup-note">{model.statsNote}</p>}
          <div className="kbo-pitcher-matchup-grid">
            {model.stats.map((stat) => (
              <div className={`kbo-pitcher-matchup-card ${stat.tone}`} key={stat.key}>
                <small>{stat.label}</small>
                <strong>{stat.display}</strong>
                {stat.leagueDisplay && stat.leagueDisplay !== '—' && <span>Lg {stat.leagueDisplay}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
