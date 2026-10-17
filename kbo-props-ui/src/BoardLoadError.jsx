import './BoardLoadError.css'
import { boardErrorText, isTierPending } from './boardLoadError'

export function BoardLoadError({ error, prefix, suffix, className = 'nfl-notice', onRetry }) {
  if (!error) return null
  const pending = isTierPending(error)
  return (
    <div className={className}>
      {prefix ? `${prefix} ${boardErrorText(error)}` : boardErrorText(error)}
      {pending && typeof onRetry === 'function' && (
        <button type="button" className="board-retry" onClick={onRetry}>Retry</button>
      )}
      {!pending && suffix}
    </div>
  )
}
