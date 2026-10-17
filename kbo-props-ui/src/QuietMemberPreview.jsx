import { MemberPreviewNotice } from './MemberPreviewNotice'
import { memberSeesQuietPreview } from './memberBoardPhase.js'

// A confirmed member on a quiet preview sees the free-preview label and Retry.
export function QuietMemberPreview({ phase, preview, refreshing, onRetry, className = 'nfl-notice' }) {
  if (!memberSeesQuietPreview(phase, preview, refreshing)) return null
  return <MemberPreviewNotice preview retry onRetry={onRetry} className={className} />
}
