import './BoardLoadError.css'
import { useAuth } from './AuthContext'

export function MemberBoardStatus({ phase, onRetry, className = 'nfl-notice' }) {
  const { retryPlanCheck } = useAuth()
  const retry = () => {
    if (typeof retryPlanCheck === 'function') retryPlanCheck()
    if (typeof onRetry === 'function') onRetry()
  }
  if (phase === 'loading') {
    return (
      <div className={`${className} board-member-status`} role="status">
        <span className="board-spinner" aria-hidden="true" />
        Loading your member board…
      </div>
    )
  }
  if (phase === 'exhausted') {
    return (
      <div className={className} role="alert">
        Couldn't load your member board
        <button type="button" className="board-retry" onClick={retry}>Retry</button>
      </div>
    )
  }
  return null
}
