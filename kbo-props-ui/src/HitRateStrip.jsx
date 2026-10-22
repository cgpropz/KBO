import { formatGameCount, formatHitRate, hitRatePillStyle } from './hitRateStrip'
import './hitRateStrip.css'

function pillLabel(pill) {
  const rate = formatHitRate(pill.rate)
  const sample = formatGameCount(pill.games, pill.pushes)
  const note = pill.note ? `, ${pill.note}` : ''
  return `${pill.label} ${rate} over${sample ? `, ${sample}` : ''}${note}`
}

export default function HitRateStrip({ pills }) {
  const shown = (Array.isArray(pills) ? pills : [])
    .map((pill) => ({ pill, tone: hitRatePillStyle(pill) }))
    .filter((item) => item.tone)
  if (!shown.length) return null
  return (
    <div className="hit-rate-strip" aria-label="Over hit rate">
      {shown.map(({ pill, tone }) => {
        const games = formatGameCount(pill.games, pill.pushes)
        return (
          <span
            key={pill.id}
            className={tone.thin ? 'hit-rate-pill is-thin' : 'hit-rate-pill'}
            style={{ background: tone.background, borderColor: tone.borderColor, color: tone.color }}
            title={pillLabel(pill)}
          >
            <span className="hit-rate-pill-k">{pill.label}</span>
            <span className="hit-rate-pill-v">{formatHitRate(pill.rate)}</span>
            {games ? <span className="hit-rate-pill-n">{games}</span> : null}
          </span>
        )
      })}
    </div>
  )
}
