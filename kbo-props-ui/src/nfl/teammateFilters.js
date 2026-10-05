// Teammate on/off filters for the NFL player hit-rate chart.
// A game counts only when every active constraint matches. "On" means that
// teammate played offense in the game. "Off" means the snap file covers the
// week and they did not. A week with no snap file matches neither.

export function activeTeammateModes(modes) {
  if (!modes) return []
  return Object.entries(modes).filter(([, mode]) => mode === 'on' || mode === 'off')
}

export function gameMatchesTeammates(onIds, modes) {
  const active = activeTeammateModes(modes)
  if (!active.length) return true
  if (!Array.isArray(onIds)) return false
  const on = new Set(onIds)
  return active.every(([id, mode]) => (mode === 'on' ? on.has(id) : !on.has(id)))
}

export function hitRateForValues(values, line) {
  const games = Array.isArray(values) ? values.length : 0
  if (!games) return { hits: 0, games: 0, rate: null }
  const hits = values.filter((value) => value >= line).length
  return { hits, games, rate: Math.round((hits / games) * 100) }
}

export function teammateFilterLabel(teammates, modes) {
  const names = new Map((Array.isArray(teammates) ? teammates : []).map((teammate) => [teammate.id, teammate.name]))
  return activeTeammateModes(modes)
    .map(([id, mode]) => `${names.get(id) || 'Teammate'} ${mode}`)
    .join(', ')
}
