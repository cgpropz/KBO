import playableRecordFile from '../api/_playableRecord.json' with { type: 'json' }
import { playableRecordText, playableSlate } from './playableRecord'

// Static snapshot. This component does not query qa_pick_ledger.
export default function PlayableRecord({ record = playableRecordFile, sport, slateDate }) {
  const text = playableRecordText(playableSlate(record, { sport, slateDate }))
  if (!text) return null
  return <p className="pl-record">{text}</p>
}
