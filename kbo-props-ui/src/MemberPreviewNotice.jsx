import './BoardLoadError.css'
import { useAuth } from './AuthContext'

// Shown when the board is still the free preview. Retry reloads the board
// and runs the plan check again.
export function MemberPreviewNotice({ preview = false, exhausted, retry = false, onRetry, className = 'nfl-notice' }) {
  const { retryPlanCheck } = useAuth()
  if (!preview && !exhausted) return null
  const showRetry = Boolean(exhausted || retry)
  const run = () => {
    if (typeof retryPlanCheck === 'function') retryPlanCheck()
    if (typeof onRetry === 'function') onRetry()
  }
  return (
    <div className={className}>
      Free preview
      {showRetry && (
        <button type="button" className="board-retry" onClick={run}>Retry</button>
      )}
    </div>
  )
}
