import { useState } from 'react'
import { cleanLine, resolveChartLine, snapLine } from './lineSlider'

export function useChartLine({ postedLine, values, step, offeredLines, resetKey }) {
  const token = `${resetKey ?? ''}|${cleanLine(postedLine)}`
  const [seenToken, setSeenToken] = useState(token)
  const [override, setOverride] = useState(null)
  if (token !== seenToken) {
    setSeenToken(token)
    setOverride(null)
  }
  const resolved = resolveChartLine({ postedLine, override, values, step, offeredLines })
  return {
    ...resolved,
    setLine: (next) => {
      const line = cleanLine(next)
      if (line == null) return
      setOverride(Math.min(resolved.max, Math.max(resolved.min, line)))
    },
    nudge(direction) {
      const base = resolved.line ?? resolved.postedLine ?? 0
      const next = snapLine(base + direction * resolved.step, resolved.step, resolved.min, resolved.max)
      if (next != null) setOverride(next)
    },
    reset: () => setOverride(null),
  }
}
