import { useState } from 'react'

// Mount a board the first time it is opened, then keep it mounted. Switching
// back shows the same tree instead of remounting and refetching it.
export default function VisitedPane({ active, children }) {
  const [seen, setSeen] = useState(active)
  if (active && !seen) setSeen(true)
  if (!seen) return null
  return (
    <div hidden={!active} inert={!active ? true : undefined}>
      {children}
    </div>
  )
}
