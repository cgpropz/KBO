export function CardTeamLogo({ team, src }) {
  if (!team || !src) return null
  return (
    <img
      className="board-team-logo"
      src={src}
      alt={team}
      data-testid="player-team-logo"
      data-team={team}
      loading="lazy"
    />
  )
}
