import GameDateLogo from './GameDateLogo'
import './MiniHitBars.css'

// The board's mini hit-rate chart: one bar per game, oldest on the left, with
// the game date and the opponent's logo under each bar (the same label as the
// player-page charts, #370). chartClass keeps each sport's bar colors. Bars
// with no date (a saved L10 series without a log) show without the label row.
export default function MiniHitBars({ bars, line, chartClass, logoFor, ariaLabel }) {
  const rows = Array.isArray(bars) ? bars.filter((bar) => Number.isFinite(Number(bar?.value))) : []
  const lineValue = Number(line) || 0
  const maxValue = Math.max(lineValue, ...rows.map((bar) => Number(bar.value)), 1)
  const labelled = rows.length > 0 && rows.every((bar) => bar.date)
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
      <ChartDateRow bars={rows} logoFor={logoFor} />
    </div>
  )
}

// The label row on its own, for cards that draw their own bars. Nothing shows
// unless every bar has a date.
export function ChartDateRow({ bars, logoFor }) {
  const rows = Array.isArray(bars) ? bars : []
  if (!rows.length || !rows.every((bar) => bar?.date)) return null
  return (
    <div className="mini-hit-dates" aria-hidden="true">
      {rows.map((bar, index) => (
        <span key={index}>
          <GameDateLogo date={bar.date} team={bar.team} logo={bar.team && logoFor ? logoFor(bar.team) : ''} />
        </span>
      ))}
    </div>
  )
}
