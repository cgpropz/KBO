import { useState } from 'react'
import { fitImage } from './fitImage'
import { avatarSize, inkOn, landingHeadshotUrl, landingTeamFill, playerInitials } from './playerMark'

// Initials, or a lazy PrizePicks headshot at the on-screen size. `photo` stays
// false in the hero so a headshot cannot become the LCP element.
export default function PlayerMark({ name, team, sport, image, size = 32, photo = true }) {
  const px = avatarSize(size)
  const [failed, setFailed] = useState(false)
  const src = photo && !failed ? landingHeadshotUrl({ ppImageUrl: image }) : ''
  const fill = landingTeamFill(sport, team)
  if (!src) {
    return (
      <span
        className="pl-avatar"
        style={{ '--pl-avatar': `${px}px`, background: fill, color: inkOn(fill) }}
        aria-hidden="true"
      >
        {playerInitials(name)}
      </span>
    )
  }
  return (
    <img
      className="pl-avatar"
      style={{ '--pl-avatar': `${px}px`, background: fill }}
      src={fitImage(src, px)}
      alt=""
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}
