import { TIP_LABEL, UNPROVEN_LABEL } from './tipFirst'
import { UNPROVEN_RANK_NOTE } from './freePreviewCopy'
import './TipLane.css'

export function LaneMark({ lane }) {
  if (lane === 'tip') return <span className="tip-lane tip-lane-tip">{TIP_LABEL}</span>
  if (lane === 'unproven') return <span className="tip-lane tip-lane-unproven">{UNPROVEN_LABEL}</span>
  return null
}

export function TipLaneNote({ show = false }) {
  if (!show) return null
  return <p className="tip-lane-note" role="note">{UNPROVEN_RANK_NOTE}</p>
}
