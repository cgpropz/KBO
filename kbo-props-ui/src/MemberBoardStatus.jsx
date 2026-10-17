import './BoardLoadError.css'

export function MemberBoardStatus({ phase, onRetry, className = 'nfl-notice' }) {
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
        {typeof onRetry === 'function' && (
          <button type="button" className="board-retry" onClick={onRetry}>Retry</button>
        )}
      </div>
    )
  }
  return null
}
