import { formatHitRate, hitRatePillColor } from './hitRateStrip'
import './hitRateStrip.css'

function pillLabel(pill) {
  const rate = formatHitRate(pill.rate)
  const sample = pill.count != null ? `, ${pill.count} games` : ''
  const note = pill.note ? `, ${pill.note}` : ''
  return `${pill.label} ${rate} over${sample}${note}`
}

export default function HitRateStrip({ pills }) {
  const shown = Array.isArray(pills) ? pills.filter((pill) => pill && hitRatePillColor(pill.rate)) : []
  if (!shown.length) return null
  return (
    <div className="hit-rate-strip" aria-label="Over hit rate">
      {shown.map((pill) => (
        <span
          key={pill.id}
          className="hit-rate-pill"
          style={{ background: hitRatePillColor(pill.rate) }}
          title={pillLabel(pill)}
        >
          <span className="hit-rate-pill-k">{pill.label}</span>
          <span className="hit-rate-pill-v">{formatHitRate(pill.rate)}</span>
          {pill.count != null ? <span className="hit-rate-pill-n">{pill.count}</span> : null}
        </span>
      ))}
    </div>
  )
}
