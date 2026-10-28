// Sort and filter for the admin game board and the matchup tables.
// These read numbers already on the sheet. They do not score props.

function numeric(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function cmpNum(a, b, dir) {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return dir * (a - b)
}

export function teamBlob(game) {
  return [game?.game?.away, game?.game?.home]
    .flatMap((team) => [team?.abbr, team?.city, team?.name])
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function gameEdge(game) {
  return Math.max(
    Math.abs(numeric(game?.cg?.total_edge) ?? 0),
    Math.abs(numeric(game?.cg?.side_edge) ?? 0),
  )
}

export function filterGames(games, { team = '', minEdge = 0 } = {}) {
  const query = String(team || '').trim().toLowerCase()
  const min = numeric(minEdge) ?? 0
  return (games || []).filter((game) => {
    if (query && !teamBlob(game).includes(query)) return false
    if (min > 0 && gameEdge(game) < min) return false
    return true
  })
}

export function toggleSort(current, key) {
  const numericKey = key === 'total' || key === 'edge' || key === 'off' || key === 'def'
  if (!current || current.key !== key) return { key, dir: numericKey ? 'desc' : 'asc' }
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
}

function compareGame(a, b, key) {
  if (key === 'game') {
    return String(a?.game?.away?.abbr || '').localeCompare(String(b?.game?.away?.abbr || ''))
  }
  if (key === 'total') return cmpNum(numeric(a?.market?.total), numeric(b?.market?.total), 1)
  if (key === 'edge') return cmpNum(numeric(a?.cg?.total_edge), numeric(b?.cg?.total_edge), 1)
  if (key === 'kick') return String(a?.kickSort || '').localeCompare(String(b?.kickSort || ''))
  return (a?.boardIndex ?? 0) - (b?.boardIndex ?? 0)
}

export function sortGames(games, sort, { projectionOnly = false } = {}) {
  const neutralized = projectionOnly && sort?.key === 'edge'
  const key = neutralized ? 'board' : (sort?.key || 'board')
  const dir = neutralized || sort?.dir !== 'desc' ? 1 : -1
  return [...(games || [])].sort((a, b) => {
    if (key === 'total' || key === 'edge') {
      if (projectionOnly && key === 'total') {
        return cmpNum(numeric(a?.cg?.total), numeric(b?.cg?.total), dir)
      }
      const field = key === 'total' ? 'market' : 'cg'
      const prop = key === 'total' ? 'total' : 'total_edge'
      return cmpNum(numeric(a?.[field]?.[prop]), numeric(b?.[field]?.[prop]), dir)
    }
    const delta = compareGame(a, b, key)
    return dir * delta
  })
}

export function visibleGames(games, filters, sort, { projectionOnly = false } = {}) {
  const nextFilters = projectionOnly ? { ...filters, minEdge: 0 } : filters
  return sortGames(filterGames(games, nextFilters), sort, { projectionOnly })
}

export function selectedGame(games, visible, gameId) {
  const picked = (games || []).find((game) => game.id === gameId) || (games || [])[0] || null
  if (!picked) return null
  if ((visible || []).some((game) => game.id === picked.id)) return picked
  return visible[0] || null
}

export function filterRows(rows, mode) {
  const list = rows || []
  if (mode === 'pos') return list.filter((row) => numeric(row.edge) != null && numeric(row.edge) > 0)
  if (mode === '10') return list.filter((row) => numeric(row.edge) != null && Math.abs(numeric(row.edge)) >= 10)
  return [...list]
}

export function sortRows(rows, sort) {
  if (!sort?.key) return [...(rows || [])]
  const dir = sort.dir === 'desc' ? -1 : 1
  return [...(rows || [])].sort((a, b) => {
    if (sort.key === 'stat') return dir * String(a.stat || '').localeCompare(String(b.stat || ''))
    return cmpNum(numeric(a[sort.key]), numeric(b[sort.key]), dir)
  })
}
