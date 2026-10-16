// Board responses drop the long per-player logs. The player page asks for
// one player and gets those arrays back. The stored snapshot is unchanged.

export const HISTORY_KEYS = [
  'recent',
  'gameDates',
  'gameOpponents',
  'gameSeasons',
  'chartSeasons',
  'recentDvpRanks',
  'recentSnapPercents',
  'recentUsage',
  'teammateOn',
  'log',
  'logDates',
  'logSeasons',
  'logOpponents',
  'logTeams',
  'recentGames',
  'gameLogs',
  'recent_values',
]

const HISTORY = new Set(HISTORY_KEYS)

function isKboCard(node) {
  return Array.isArray(node.props) || node.type === 'batter' || node.type === 'pitcher'
}

// NHL rows carry a large profile. Matchup pitchers also have profile.era,
// and the free slate still shows that. Only board rows lose it.
function isBoardRow(node) {
  return Boolean(
    node.prop || node.stat || node.ppAllProps || Array.isArray(node.props)
    || node.log || node.recent || node.recentGames || node.gameLogs
  )
}

export function stripBoardHistory(data) {
  return stripNode(data)
}

function stripNode(node) {
  if (Array.isArray(node)) return node.map((item) => stripNode(item))
  if (!node || typeof node !== 'object') return node
  const out = {}
  for (const [key, value] of Object.entries(node)) {
    if (HISTORY.has(key)) continue
    if (key === 'profile' && isBoardRow(node)) continue
    if (key === 'games' && isKboCard(node)) continue
    out[key] = stripNode(value)
  }
  return out
}

function playerName(row) {
  return String(row?.player || row?.name || '').trim().toLowerCase()
}

function collectNames(data, into = new Set()) {
  if (Array.isArray(data)) {
    data.forEach((row) => collectNames(row, into))
    return into
  }
  if (!data || typeof data !== 'object') return into
  const name = playerName(data)
  if (name) into.add(name)
  for (const value of Object.values(data)) {
    if (value && typeof value === 'object') collectNames(value, into)
  }
  return into
}

function emptyLike(data) {
  if (Array.isArray(data)) return []
  if (data && typeof data === 'object') {
    if (Array.isArray(data.cards)) return { ...data, cards: [], total_props: 0 }
    if (Array.isArray(data.projections)) return { ...data, projections: [] }
  }
  return []
}

function filterToPlayer(data, wanted) {
  if (Array.isArray(data)) return data.filter((row) => playerName(row) === wanted)
  if (data && typeof data === 'object') {
    if (Array.isArray(data.cards)) {
      const cards = data.cards.filter((card) => playerName(card) === wanted)
      const total = cards.reduce((sum, card) => sum + (Array.isArray(card?.props) ? card.props.length : 0), 0)
      return { ...data, cards, total_props: total }
    }
    if (Array.isArray(data.projections)) {
      return { ...data, projections: data.projections.filter((row) => playerName(row) === wanted) }
    }
  }
  return emptyLike(data)
}

// visibleData is what this caller's tier is allowed to see. A free caller
// cannot pull another player's log by guessing the name.
export function historyForPlayer(fullData, visibleData, player) {
  const wanted = String(player || '').trim().toLowerCase()
  if (!wanted) return stripBoardHistory(visibleData)
  if (!collectNames(visibleData).has(wanted)) return emptyLike(visibleData)
  return filterToPlayer(fullData, wanted)
}

export function presentBoardPayload(player, shaped, fullData) {
  const name = String(player || '').trim()
  if (!name) return stripBoardHistory(shaped?.data)
  return historyForPlayer(fullData, shaped?.data, name)
}

export function payloadBytes(data) {
  return Buffer.byteLength(JSON.stringify(data))
}
