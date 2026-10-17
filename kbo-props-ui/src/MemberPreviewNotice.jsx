import './BoardLoadError.css'

// Shown when a paid member is still on the 3-row preview. Retry appears
// only after the background refresh has used its retries.
export function MemberPreviewNotice({ preview = false, exhausted, onRetry, className = 'nfl-notice' }) {
  if (!preview && !exhausted) return null
  return (
    <div className={className}>
      Free preview
      {exhausted && typeof onRetry === 'function' && (
        <button type="button" className="board-retry" onClick={onRetry}>Retry</button>
      )}
    </div>
  )
}
