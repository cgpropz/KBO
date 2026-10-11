import { useState } from 'react'
import { START_HERE_HREF } from './GuideLinks'
import './StartHereBanner.css'

const DISMISS_KEY = 'cg_dismissed_start_here'

function dismissedAlready() {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export default function StartHereBanner() {
  const [open, setOpen] = useState(() => !dismissedAlready())
  if (!open) return null

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
    setOpen(false)
  }

  return (
    <aside className="start-here-banner" role="note">
      <p>New here? <a href={START_HERE_HREF}>Start here</a></p>
      <button type="button" onClick={dismiss} aria-label="Dismiss start here">×</button>
    </aside>
  )
}
