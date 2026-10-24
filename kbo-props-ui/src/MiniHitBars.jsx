import GameDateLogo from './GameDateLogo'
import { dateRowBars } from './chartLabels'
import './MiniHitBars.css'

// The board's mini hit-rate chart: one bar per game, oldest on the left, with
// the game date and the opponent's logo under each bar (the same label as the
// player-page charts, #370). chartClass keeps each sport's bar colors. A bar
// with no date leaves a blank slot. The row hides only when none of the bars
// have a date.
export default function MiniHitBars({ bars, line, chartClass, logoFor, ariaLabel }) {
  const rows = Array.isArray(bars) ? bars.filter((bar) => Number.isFinite(Number(bar?.value))) : []
  const lineValue = Number(line) || 0
  const maxValue = Math.max(lineValue, ...rows.map((bar) => Number(bar.value)), 1)
  const labelled = dateRowBars(rows)
  const chart = (
    <div className={chartClass} aria-hidden={ariaLabel ? undefined : 'true'} aria-label={ariaLabel}>
      {rows.map((bar, index) => {
        const value = Number(bar.value)
        return <span key={index} className={value > lineValue ? 'hit' : value === lineValue ? 'push' : 'miss'} style={{ height: `${Math.max(14, (value / maxValue) * 100)}%` }} />
      })}
    </div>
  )
  if (!labelled) return chart
  return (
    <div className="mini-hit-bars" data-testid="mini-hit-bars">
      {chart}
      <ChartDateRow bars={labelled} logoFor={logoFor} />
    </div>
  )
}

// The label row on its own, for cards that draw their own bars. One dated bar
// is enough to show the row. `seasonLabel` (NBA landing, mixed window) sits
// under that bar's logo.
export function ChartDateRow({ bars, logoFor }) {
  const rows = dateRowBars(bars)
  if (!rows) return null
  return (
    <div className="mini-hit-dates" aria-hidden="true">
      {rows.map((bar, index) => (
        <span key={index}>
          {bar?.date ? (
            <GameDateLogo
              date={bar.date}
              team={bar.team}
              logo={bar.team && logoFor ? logoFor(bar.team) : ''}
              extra={bar.seasonLabel ? <span className="hr-game-season" data-testid="hr-game-season" title={bar.seasonTitle || bar.seasonLabel}>{bar.seasonLabel}</span> : null}
            />
          ) : (
            <span className="hr-game hr-game-blank" />
          )}
        </span>
      ))}
    </div>
  )
}
