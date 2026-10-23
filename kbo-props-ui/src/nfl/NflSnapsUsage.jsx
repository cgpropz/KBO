import GameDateLogo from '../GameDateLogo'
import { EARLY_SEASON_GAMES, TREND_ARROWS, TREND_COLORS } from '../nba/nbaMinutesUsage.js'
import { teamLogoUrl } from './nflTeams'
import { formatTrend, nflTrendSummary } from './nflPlayerGames.js'

// Snaps & Usage under the hit-rate chart, the NFL counterpart of the NBA
// Minutes & Usage section. Display only. `games` is the player's game log
// (oldest first), `windowIndices` the hit-rate chart's window before filters,
// and `kept` the set of games the filters keep (null when no filter is
// narrowed); the rest are dimmed.

const TREND_WORDS = { up: 'trending up', down: 'trending down', flat: 'steady' }

function TrendChart({ metric, newestFirst, windowGames, kept, currentSeason }) {
  const summary = nflTrendSummary(newestFirst, metric, currentSeason)
  const values = windowGames.map((game) => game[metric.field])
  const scaleMax = Math.max(1, ...values.map((value) => value || 0))
  const trend = summary.trend
  const hasValues = values.some((value) => value != null)
  return (
    <div className={`nfl-su-metric nfl-su-${metric.id}`} data-testid={`nfl-su-${metric.id}`}>
      <div className="nfl-su-head">
        <span className="nfl-su-label">{metric.label}</span>
        {trend && (
          <b
            className={`nfl-su-trend ${trend}`}
            style={{ color: TREND_COLORS[trend] }}
            aria-label={`L5 vs season: ${TREND_WORDS[trend]}`}
            title="L5 vs season"
            data-testid="nfl-su-trend"
          >
            {TREND_ARROWS[trend]}
          </b>
        )}
        <span className="nfl-su-avgs">
          <span><em>L5</em>{formatTrend(summary.l5, metric.unit)}</span>
          <span><em>L10</em>{formatTrend(summary.l10, metric.unit)}</span>
          <span><em>Season</em>{formatTrend(summary.season, metric.unit)}</span>
        </span>
      </div>
      {hasValues ? (
        <>
          <div className="nfl-su-bars">
            {windowGames.map((game, index) => {
              const value = values[index]
              const dimmed = kept != null && !kept.has(game.index)
              return (
                <div className={`nfl-su-col${dimmed ? ' is-dimmed' : ''}`} key={`${game.index}`} data-dimmed={dimmed ? 'true' : undefined}>
                  {value == null ? (
                    <span className="nfl-su-none">—</span>
                  ) : (
                    <div className="nfl-su-bar" style={{ height: `${Math.max(4, (value / scaleMax) * 100)}%` }}>
                      <i>{Math.round(value)}</i>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="nfl-su-dates">
            {windowGames.map((game) => (
              <span key={`d-${game.index}`} className={kept != null && !kept.has(game.index) ? 'is-dimmed' : undefined}>
                <GameDateLogo date={game.date} team={game.opp} logo={teamLogoUrl(game.opp)} />
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="nfl-su-empty">No {metric.label.toLowerCase()} logged for these games.</p>
      )}
    </div>
  )
}

export default function NflSnapsUsage({ games, windowIndices, kept, metrics, currentSeason }) {
  if (!Array.isArray(games) || !games.length || !metrics?.length) return null
  const newestFirst = [...games].reverse()
  const windowGames = (windowIndices || []).map((index) => games[index]).filter(Boolean)
  // Same rule as the arrow: only this season's games that have a value for
  // that stat count toward the 5.
  const seasonCounts = metrics.map((metric) => nflTrendSummary(newestFirst, metric, currentSeason).seasonGames)
  const ready = seasonCounts.filter((count) => count >= EARLY_SEASON_GAMES).length
  const arrowNote = ready === 0
    ? `Trend arrows start after ${EARLY_SEASON_GAMES} games this season. `
    : ready < metrics.length
      ? `Arrow: last 5 games vs this season, once a stat has ${EARLY_SEASON_GAMES} games logged this season. `
      : 'Arrow: last 5 games vs this season. '
  return (
    <section className="nfl-su" aria-label="Snaps and usage" data-testid="nfl-snaps-usage">
      <p className="nfl-su-title">Snaps &amp; Usage</p>
      {metrics.map((metric) => (
        <TrendChart key={metric.id} metric={metric} newestFirst={newestFirst} windowGames={windowGames} kept={kept} currentSeason={currentSeason} />
      ))}
      <p className="nfl-su-note">
        {arrowNote}
        {kept ? 'Dimmed games are outside the filters.' : ''}
      </p>
    </section>
  )
}
