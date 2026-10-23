import GameDateLogo from '../GameDateLogo'
import { nbaLogoUrl, opponentFromMatchup } from './nbaPropLines'
import {
  TREND_ARROWS, TREND_COLORS, TREND_METRICS, formatTrendValue, metricSummary, trendBars,
} from './nbaMinutesUsage.js'

// Minutes & Usage under the hit-rate chart. Display only. windowGames is the
// hit-rate chart's window (L5 / L10 / L20 / Season) over every logged game,
// newest first; keptGames is the set the minutes / usage sliders keep (null
// when the sliders are open), and the rest are dimmed.

function gameOpponent(game) {
  return opponentFromMatchup(game?.matchup || game?.opponent)
}

const TREND_WORDS = { up: 'trending up', down: 'trending down', flat: 'steady' }

function TrendChart({ metric, logs, windowGames, keptGames }) {
  const summary = metricSummary(logs, metric.field)
  const bars = trendBars(windowGames, keptGames, metric.field)
  const scaleMax = Math.max(1, ...bars.map((bar) => bar.value || 0))
  const trend = summary.trend
  const hasValues = bars.some((bar) => bar.value != null)
  return (
    <div className={`nba-mu-metric nba-mu-${metric.id}`} data-testid={`nba-mu-${metric.id}`}>
      <div className="nba-mu-head">
        <span className="nba-mu-label">{metric.label}</span>
        {trend && (
          <b
            className={`nba-mu-trend ${trend}`}
            style={{ color: TREND_COLORS[trend] }}
            aria-label={`L5 vs season: ${TREND_WORDS[trend]}`}
            title="L5 vs season"
          >
            {TREND_ARROWS[trend]}
          </b>
        )}
        <span className="nba-mu-avgs">
          <span><em>L5</em>{formatTrendValue(summary.l5, metric.unit)}</span>
          <span><em>L10</em>{formatTrendValue(summary.l10, metric.unit)}</span>
          <span><em>Season</em>{formatTrendValue(summary.season, metric.unit)}</span>
        </span>
      </div>
      {hasValues ? (
        <>
          <div className="nba-mu-bars">
            {bars.map((bar, index) => (
              <div
                className={`nba-mu-col${bar.dimmed ? ' is-dimmed' : ''}`}
                key={`${bar.game?.date || index}-${index}`}
                data-dimmed={bar.dimmed ? 'true' : undefined}
              >
                {bar.value == null ? (
                  <span className="nba-mu-none">—</span>
                ) : (
                  <div className="nba-mu-bar" style={{ height: `${Math.max(4, (bar.value / scaleMax) * 100)}%` }}>
                    <i>{Math.round(bar.value)}</i>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="nba-player-dates nba-mu-dates">
            {bars.map((bar, index) => (
              <span key={`d-${bar.game?.date || index}-${index}`} className={bar.dimmed ? 'is-dimmed' : undefined}>
                <GameDateLogo date={bar.game?.date || bar.game?.gameDate} team={gameOpponent(bar.game)} logo={nbaLogoUrl(gameOpponent(bar.game))} />
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="nba-mu-empty">No {metric.label.toLowerCase()} logged for these games.</p>
      )}
    </div>
  )
}

export default function NbaMinutesUsage({ logs, windowGames, keptGames }) {
  if (!Array.isArray(logs) || !logs.length) return null
  return (
    <section className="nba-mu card" aria-label="Minutes and usage" data-testid="nba-minutes-usage">
      <p className="stat-label">Minutes &amp; Usage</p>
      {TREND_METRICS.map((metric) => (
        <TrendChart key={metric.id} metric={metric} logs={logs} windowGames={windowGames} keptGames={keptGames} />
      ))}
      {keptGames && <p className="nba-mu-note">Dimmed games are outside the filters.</p>}
    </section>
  )
}
