import { expectedMinutesPill } from './expectedMinutes.js'
import './expectedMinutes.css'

export default function ExpectedMinutesPill({ minutes }) {
  const pill = expectedMinutesPill(minutes)
  if (!pill) return null
  return (
    <span className={`nba-min-pill is-${pill.color}`} data-testid="nba-min-pill">
      {pill.label}
    </span>
  )
}
