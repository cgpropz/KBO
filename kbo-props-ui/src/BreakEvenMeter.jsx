import { useState } from 'react'
import { formatHitRate } from './hitRateStrip'
import { BREAKEVEN_AS_OF, PICK_COUNTS, breakevenFor, formatBreakEvenRate } from './prizepicksBreakeven'
import './BreakEvenMeter.css'

function clampRate(rate) {
  const value = Number(rate)
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

function markShift(windows, window) {
  if (!Array.isArray(windows) || windows.length < 2) return 0
  const other = windows.find((item) => item.id !== window.id)
  if (!other || Math.abs(other.rate - window.rate) > 6) return 0
  return window.id === 'l10' ? -8 : 8
}

export default function BreakEvenMeter({ windows, side = 'over', lineText = '', chartCountsOvers = false }) {
  const [picks, setPicks] = useState(2)
  const shown = Array.isArray(windows) ? windows.filter((window) => window && window.games >= 5) : []
  if (!shown.length) return null

  const power = breakevenFor('power', picks)
  const flex = breakevenFor('flex', picks)
  const sideWord = side === 'under' ? 'Under' : 'Over'
  const linePhrase = lineText ? `at ${lineText}` : 'at this line'
  const powerNudge = power && flex && Math.abs(power.rate - flex.rate) < 1.2 ? -4 : 0
  const flexNudge = powerNudge ? 4 : 0
  const summary = [
    ...shown.map((window) => `${window.label} ${sideWord.toLowerCase()} hit rate ${formatHitRate(window.rate)}, ${window.hits} of ${window.games} games`),
    `${picks}-pick Power break-even ${formatBreakEvenRate(power?.rate)}`,
    `${picks}-pick Flex break-even ${formatBreakEvenRate(flex?.rate)}`,
  ].join('. ')

  return (
    <section className="be-meter" data-testid="break-even-meter" aria-label="Break-even meter">
      <h3 className="be-meter-title">Break-even meter</h3>
      <p className="be-meter-side">{sideWord} hit rate {linePhrase}</p>
      <div className="be-meter-picks" role="group" aria-label="Number of picks">
        <span>Picks</span>
        {PICK_COUNTS.map((count) => (
          <button
            key={count}
            type="button"
            aria-pressed={picks === count}
            onClick={(event) => {
              event.stopPropagation()
              setPicks(count)
            }}
          >
            {count}
          </button>
        ))}
      </div>
      <ul className="be-meter-rates">
        {shown.map((window) => (
          <li key={window.id}>
            <b>{window.label}</b>
            <strong>{formatHitRate(window.rate)}</strong>
            <span>{window.hits} of {window.games} games</span>
          </li>
        ))}
      </ul>
      <div className="be-meter-scale">
        <div className="be-meter-rail" aria-hidden="true">
          {shown.map((window) => (
            <span
              key={window.id}
              className={`be-meter-mark be-meter-mark-${window.id}`}
              style={{ left: `${clampRate(window.rate)}%`, marginTop: markShift(shown, window) }}
            />
          ))}
          {power && (
            <span className="be-meter-tick be-meter-tick-power" style={{ left: `calc(${clampRate(power.rate)}% + ${powerNudge}px)` }} />
          )}
          {flex && (
            <span className="be-meter-tick be-meter-tick-flex" style={{ left: `calc(${clampRate(flex.rate)}% + ${flexNudge}px)` }} />
          )}
        </div>
        <div className="be-meter-axis" aria-hidden="true"><span>0</span><span>50</span><span>100</span></div>
      </div>
      <ul className="be-meter-legend">
        {shown.map((window) => (
          <li key={window.id}>
            <i className={`be-meter-swatch be-meter-swatch-${window.id}`} aria-hidden="true" />
            {window.label} {formatHitRate(window.rate)}
          </li>
        ))}
        {power && (
          <li>
            <i className="be-meter-swatch be-meter-swatch-power" aria-hidden="true" />
            <span>
              <b>Power {formatBreakEvenRate(power.rate)}</b>
              <small>standard {power.payout}</small>
            </span>
          </li>
        )}
        {flex && (
          <li>
            <i className="be-meter-swatch be-meter-swatch-flex" aria-hidden="true" />
            <span>
              <b>Flex {formatBreakEvenRate(flex.rate)}</b>
              <small>standard {flex.payout}</small>
            </span>
          </li>
        )}
      </ul>
      <p className="be-meter-explainer">
        Power Play: every pick has to be right, and the payout is higher. Flex Play can still pay if you miss one or two picks, depending on lineup size, with a lower top payout. The marks are PrizePicks&apos; break-even rate for a standard lineup of this size. The dots are the real {sideWord.toLowerCase()} hit rate {linePhrase}, with the number of games. Counted from graded games only.
      </p>
      {chartCountsOvers && (
        <p className="be-meter-note">This prop is an under, so the meter counts games under the line. The chart marks a game green when the stat went over.</p>
      )}
      <p className="be-meter-note">
        Standard PrizePicks payouts as of {BREAKEVEN_AS_OF}. Demons, goblins, and promos use other payouts. The lineup screen shows the payout that applies.
      </p>
      <p className="be-meter-sr">{summary}</p>
    </section>
  )
}
