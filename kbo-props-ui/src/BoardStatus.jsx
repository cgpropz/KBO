import { boardStatusLine, isBoardStale } from './boardFreshness'
import './boardStatus.css'

export default function BoardStatus({ sport, updatedAt, injuriesCheckedAt = null }) {
  const line = boardStatusLine({ sport, updatedAt, injuriesCheckedAt })
  if (!line) return null
  const stale = isBoardStale(updatedAt, sport)
  return (
    <p className={`board-status${stale ? ' is-stale' : ''}`} data-testid={`board-status-${sport}`}>
      {line}
    </p>
  )
}
