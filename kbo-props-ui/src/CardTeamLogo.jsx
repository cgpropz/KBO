import { useState } from 'react'

export function CardTeamLogo({ team, src }) {
  const [failedSrc, setFailedSrc] = useState('')
  if (!team || !src || src === failedSrc) return null
  return (
    <img
      className="board-team-logo"
      src={src}
      alt={team}
      data-testid="player-team-logo"
      data-team={team}
      loading="lazy"
      onError={() => setFailedSrc(src)}
    />
  )
}
