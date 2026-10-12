// Shared by the inline loader and the React fallback so the 1.5s handoff
// uses one clock (navigation start) and one set of lines.

export const BOOT_SLOW_MS = 1500

export const BOOT_LINES = [
  'Pulling today’s lines…',
  'Crunching CG Scores…',
  'Checking hit rates…',
]

export function bootIsSlow(elapsed, limit = BOOT_SLOW_MS) {
  return Number(elapsed) >= limit
}

// The compact loader is only the full-page wait. An inset fallback sits under
// a shell that is already on screen, so it stays on skeleton rows.
export function bootShowsLoader(elapsed, { inset = false } = {}) {
  return !inset && bootIsSlow(elapsed)
}

export function bootElapsed() {
  if (typeof performance === 'undefined') return 0
  const origin = typeof window !== 'undefined' && typeof window.__cgBoot === 'number'
    ? window.__cgBoot
    : 0
  return Math.max(0, performance.now() - origin)
}
