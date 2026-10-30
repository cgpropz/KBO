import playableRecordFile from '../api/_playableRecord.json' with { type: 'json' }
import { playableRecordDetail, playableRecordText, playableSlate } from './playableRecord'
import { RESULTS_PAGE_PUBLIC } from './resultsPublic.js'

// Static snapshot. This component does not query qa_pick_ledger.
export default function PlayableRecord({ record = playableRecordFile, sport, slateDate, detailed = false }) {
  const slate = playableSlate(record, { sport, slateDate })
  if (detailed) {
    const detail = playableRecordDetail(slate)
    if (!detail) return null
    return (
      <div className="pl-record-block">
        <p className="pl-record">{detail.line}</p>
        <p className="pl-record-note">{detail.note} 54.2% is the reference break-even. Beating it does not mean every slip makes money.{RESULTS_PAGE_PUBLIC ? <> <a href="/results">Full record</a></> : null}</p>
      </div>
    )
  }
  const text = playableRecordText(slate)
  if (!text) return null
  return <p className="pl-record">{text}</p>
}
