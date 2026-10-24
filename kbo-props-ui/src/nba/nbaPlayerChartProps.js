// Stat groups for the NBA player chart. A logged stat with a line stays
// here even when the projection is blank. The chart then shows that line
// and Pending (todayPick), never 0 or NaN. Ranking is elsewhere: the Edge
// board and the hub skip a prop with no posted projection.

import { logsSupport } from './nbaPropLines.js'

const PROP_ORDER = ['Points', 'Rebounds', 'Assists', '3-PT Made', 'Steals', 'Blocks', 'Turnovers', 'Fantasy Score', 'Pts+Rebs+Asts']

function finiteLine(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

export function postedLineFor(rows) {
  const standard = rows.find((prop) => finiteLine(prop.standardLine) != null && Number(prop.line) === Number(prop.standardLine))
    || rows.find((prop) => finiteLine(prop.standardLine) != null)
    || rows[0]
  return finiteLine(standard?.standardLine ?? standard?.line)
}

export function groupProps(player, projection) {
  const logs = Array.isArray(player?.gameLogs) ? player.gameLogs : []
  const grouped = new Map()
  ;(Array.isArray(projection?.ppAllProps) ? projection.ppAllProps : []).forEach((prop) => {
    if (!prop?.stat || !logsSupport(logs, prop.stat)) return
    if (postedLineFor([prop]) == null) return
    if (!grouped.has(prop.stat)) grouped.set(prop.stat, [])
    grouped.get(prop.stat).push(prop)
  })
  return [...grouped.entries()]
    .map(([stat, rows]) => ({ stat, rows, posted: postedLineFor(rows) }))
    .filter((group) => group.posted != null)
    .sort((a, b) => {
      const ai = PROP_ORDER.indexOf(a.stat)
      const bi = PROP_ORDER.indexOf(b.stat)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.stat.localeCompare(b.stat)
    })
}
