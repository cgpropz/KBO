import { useState } from 'react'
import { nhlAvatarSources } from './nhlAvatar.js'

// A failed headshot tries the next source, then shows initials. A board card
// never shows the browser's broken-image icon.
export default function NhlAvatar({ item, initials, size = 42, width, height }) {
  const [failed, setFailed] = useState(() => new Set())
  const src = nhlAvatarSources(item, size).find((url) => !failed.has(url)) || ''
  if (!src) return initials
  return (
    <img
      key={src}
      src={src}
      alt=""
      width={width}
      height={height}
      loading="lazy"
      onError={() => setFailed((current) => new Set(current).add(src))}
    />
  )
}
