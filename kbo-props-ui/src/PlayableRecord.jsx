import playableRecordFile from '../api/_playableRecord.json' with { type: 'json' }
import { playableRecordDetail, playableRecordText, playableSlate } from './playableRecord'

// Static snapshot. This component does not query qa_pick_ledger.
export default function PlayableRecord({ record = playableRecordFile, sport, slateDate, detailed = false }) {
  const slate = playableSlate(record, { sport, slateDate })
  if (detailed) {
    const detail = playableRecordDetail(slate)
    if (!detail) return null
    return (
      <div className="pl-record-block">
        <p className="pl-record">{detail.line}</p>
        <p className="pl-record-note">{detail.note}</p>
      </div>
    )
  }
  const text = playableRecordText(slate)
  if (!text) return null
  return <p className="pl-record">{text}</p>
}
