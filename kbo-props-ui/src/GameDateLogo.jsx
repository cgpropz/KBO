import { useState } from 'react'
import { fitImage } from './fitImage'
import { formatGameDate, opponentAbbr } from './gameDateLabel'
import './GameDateLogo.css'

// The label under one hit-rate bar: the game date, then the opponent's logo.
// logo is the same team-logo URL the page's matchup header uses. With no URL,
// or when the file fails to load, the opponent's abbreviation shows instead.
export default function GameDateLogo({ date, team, logo, color, extra = null }) {
  const src = logo ? fitImage(logo, 16) : ''
  const [failedSrc, setFailedSrc] = useState('')
  const showLogo = Boolean(src) && src !== failedSrc
  return (
    <span className="hr-game" data-testid="hr-game-label">
      <span className="hr-game-date">{formatGameDate(date) || '—'}</span>
      {showLogo ? (
        <img className="hr-game-logo" src={src} alt={team || ''} title={team || undefined} loading="lazy" onError={() => setFailedSrc(src)} />
      ) : (
        <span className="hr-game-abbr" data-testid="hr-game-abbr" style={color ? { color } : undefined}>{opponentAbbr(team)}</span>
      )}
      {extra}
    </span>
  )
}
