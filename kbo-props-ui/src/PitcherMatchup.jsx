import { useMemo } from 'react'
import { buildPitcherMatchup, resolveLeague } from './pitcherMatchup'
import { fitImage } from './fitImage.js'

const TEAM_LOGOS = {
  Doosan: '/team-logos/doosan.webp', Hanwha: '/team-logos/hanwha.webp', Kia: '/team-logos/kia.webp',
  Kiwoom: '/team-logos/kiwoom.webp', KT: '/team-logos/kt.webp', LG: '/team-logos/lg.webp',
  Lotte: '/team-logos/lotte.webp', NC: '/team-logos/nc.webp', Samsung: '/team-logos/samsung.webp',
  SSG: '/team-logos/ssg.webp',
}

function identityLine(model) {
  return [model.team, model.starts != null ? `${model.starts} starts` : null]
    .filter(Boolean)
    .join(' · ')
}

export default function PitcherMatchup({
  batterTeam,
  opponent,
  card,
  prop,
  matchups,
  slateDate,
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
    () => buildPitcherMatchup({
      batterTeam,
      opponent,
      sources: [prop, card],
      matchups,
      slateDate,
      rankings,
      league,
      seasonRates,
    }),
    [batterTeam, opponent, prop, card, matchups, slateDate, rankings, league, seasonRates],
  )
  const logo = TEAM_LOGOS[model.team]
  const meta = identityLine(model)

  return (
    <section className="kbo-pitcher-matchup" aria-label="Pitcher Matchup">
      <div className="kbo-pitcher-matchup-head">
        <h2>Pitcher Matchup</h2>
        <p className="kbo-pitcher-matchup-legend">Green = easier matchup for the hitter. Red = tougher. Close to the league average stays neutral.</p>
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
            {logo && <img src={fitImage(logo, 28)} alt="" loading="lazy" />}
            <div>
              <div className="kbo-pitcher-matchup-name">
                <strong>{model.starterName}</strong>
                {model.handLabel ? (
                  <span className="kbo-hand-badge" title={model.hand === 'L' ? 'Throws left' : 'Throws right'}>{model.handLabel}</span>
                ) : (
                  <span className="kbo-hand-badge kbo-hand-badge-unknown">Hand unknown</span>
                )}
              </div>
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
