import GameDateLogo from '../GameDateLogo'
import NbaRangeSlider from '../nba/NbaRangeSlider'
import { formatMetric } from '../nba/nbaGameFilters'
import { TREND_ARROWS, TREND_COLORS } from '../nba/nbaMinutesUsage.js'
import { teamLogoUrl } from './nhlTeams'
import {
  PENDING, cgText, formatTrend, nhlTodayPick, nhlTrendSummary, pickNumber, trendBarLabel, trendsFor,
} from './nhlPlayerParity.js'
import './nhlParity.css'

// Player-page sections that match the NBA page. Display only.

// Today's PrizePicks line with the board's projection and CG Score. Board
// values only, so this is not behind the NHL API flag.
export function NhlPickCard({ item }) {
  const pick = nhlTodayPick(item)
  const projection = pickNumber(pick.projection)
  const cg = cgText(pick.cg)
  const sideClass = pick.side === 'OVER' ? 'is-over' : pick.side === 'UNDER' ? 'is-under' : ''
  return (
    <div className="nhl-pick" data-testid="nhl-pick">
      <span className="nhl-pick-line">
        <small>PrizePicks line</small>
        <b data-testid="nhl-pick-line" className={pick.line == null ? 'is-pending' : ''}>
          {pick.line == null ? 'No line today' : `${pickNumber(pick.line)} ${item.prop}`}
        </b>
      </span>
      <span>
        <small>Projection</small>
        <b data-testid="nhl-pick-projection" className={projection ? '' : 'is-pending'}>{projection || PENDING}</b>
      </span>
      <span>
        <small>CG Score</small>
        <b data-testid="nhl-pick-cg" className={cg ? sideClass : 'is-pending'}>{cg || PENDING}</b>
      </span>
    </div>
  )
}

// Switch between the player's props on today's board.
export function NhlPropChips({ rows, current, onSelect }) {
  if (!Array.isArray(rows) || rows.length < 2) return null
  return (
    <div className="nhl-props" role="tablist" aria-label="Stat" data-testid="nhl-prop-chips">
      {rows.map((row) => (
        <button
          key={row.prop}
          type="button"
          role="tab"
          aria-selected={row.prop === current}
          className={row.prop === current ? 'active' : ''}
          onClick={() => onSelect(row)}
        >
          {row.prop}
        </button>
      ))}
    </div>
  )
}

function rangeText(range, filter) {
  if (!range) return '—'
  return `${formatMetric(range.low, filter.step)}–${formatMetric(range.high, filter.step)} ${filter.unit}`
}

// TOI / PP TOI sliders. Narrowing one picks which games the chart, the range
// chips and the hit rate use.
export function NhlFilters({ filters, bounds, ranges, kept, total, onChange, onReset }) {
  const usable = filters.filter((filter) => bounds[filter.id])
  if (!usable.length) return null
  const narrowed = usable.some((filter) => ranges[filter.id] && !ranges[filter.id].full)
  return (
    <div className={`nhl-filters${narrowed ? ' is-narrowed' : ''}`} data-testid="nhl-filters">
      <div className="nhl-filters-head">
        <span>Filters</span>
        <b data-testid="nhl-filters-count">{narrowed ? `${kept} of ${total} games` : `All ${total} games`}</b>
        <button type="button" onClick={onReset} disabled={!narrowed}>Reset</button>
      </div>
      {usable.map((filter) => {
        const bound = bounds[filter.id]
        const range = ranges[filter.id]
        return (
          <div className="nhl-filter" key={filter.id} data-testid={`nhl-filter-${filter.id}`}>
            <div className="nhl-filter-label">
              <span>{filter.label}</span>
              <b>{rangeText(range, filter)}</b>
            </div>
            <NbaRangeSlider
              label={filter.label}
              unit={filter.unit}
              min={bound.min}
              max={bound.max}
              low={range?.low ?? bound.min}
              high={range?.high ?? bound.max}
              step={filter.step}
              onChange={(low, high) => onChange(filter.id, { low, high })}
            />
          </div>
        )
      })}
    </div>
  )
}

const TREND_WORDS = { up: 'trending up', down: 'trending down', flat: 'steady' }

function TrendChart({ metric, games, windowGames, keptGames }) {
  const summary = nhlTrendSummary(games, metric)
  const bars = windowGames.slice().reverse().map((game) => {
    const raw = Number(game?.[metric.field])
    const value = Number.isFinite(raw) && !(metric.field === 'toi' && raw <= 0) && game?.[metric.field] != null ? raw : null
    return { game, value, dimmed: keptGames ? !keptGames.has(game) : false }
  })
  const scaleMax = Math.max(1, ...bars.map((bar) => bar.value || 0))
  const hasValues = bars.some((bar) => bar.value != null)
  const trend = summary.trend
  return (
    <div className={`nhl-mu-metric nhl-mu-${metric.id}`} data-testid={`nhl-trend-${metric.id}`}>
      <div className="nhl-mu-head">
        <span className="nhl-mu-label">{metric.label}</span>
        {trend && (
          <b
            className={`nhl-mu-trend ${trend}`}
            style={{ color: TREND_COLORS[trend] }}
            aria-label={`L5 vs season: ${TREND_WORDS[trend]}`}
            title="L5 vs this season"
            data-testid="nhl-trend-arrow"
          >
            {TREND_ARROWS[trend]}
          </b>
        )}
        <span className="nhl-mu-avgs">
          <span><em>L5</em>{formatTrend(summary.l5, metric.unit)}</span>
          <span><em>L10</em>{formatTrend(summary.l10, metric.unit)}</span>
          <span><em>Season</em>{formatTrend(summary.season, metric.unit)}</span>
        </span>
      </div>
      {hasValues ? (
        <>
          <div className="nhl-mu-bars">
            {bars.map((bar, index) => (
              <div className={`nhl-mu-col${bar.dimmed ? ' is-dimmed' : ''}`} key={`${bar.game?.date}-${index}`} data-dimmed={bar.dimmed ? 'true' : undefined}>
                {bar.value == null ? (
                  <span className="nhl-mu-none">—</span>
                ) : (
                  <div className="nhl-mu-bar" style={{ height: `${Math.max(4, (bar.value / scaleMax) * 100)}%` }}>
                    <i>{trendBarLabel(bar.value, metric.unit)}</i>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="nhl-mu-dates">
            {bars.map((bar, index) => (
              <span key={`d-${bar.game?.date}-${index}`} className={bar.dimmed ? 'is-dimmed' : undefined}>
                <GameDateLogo date={bar.game?.date} team={bar.game?.opp} logo={teamLogoUrl(bar.game?.opp)} />
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="nhl-mu-empty">No {metric.label.toLowerCase()} logged for these games.</p>
      )}
    </div>
  )
}

// TOI, shots and power-play time (goalies: TOI, shots against, saves) for the
// chart's window. The arrow compares L5 with this season and appears from the
// fifth game this season. Bars are in minutes for TOI.
export function NhlUsageTrends({ kind, games, windowGames, keptGames, seasonGames }) {
  if (!Array.isArray(games) || !games.length) return null
  return (
    <section className="nhl-mu" aria-label="Ice time and usage" data-testid="nhl-usage-trends">
      <p className="nhl-mu-title">Ice Time &amp; Usage</p>
      {trendsFor(kind).map((metric) => (
        <TrendChart key={metric.id} metric={metric} games={games} windowGames={windowGames} keptGames={keptGames} />
      ))}
      {seasonGames < 5 && <p className="nhl-mu-note" data-testid="nhl-trend-early">Trend arrows start at 5 games this season ({seasonGames} so far).</p>}
      {keptGames && <p className="nhl-mu-note">Dimmed games are outside the filters.</p>}
      <p className="nhl-mu-note">TOI bars in minutes. Source: NHL API game logs.</p>
    </section>
  )
}
