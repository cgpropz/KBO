// Display helpers for today's board projection and CG Score on the NBA
// player profile and Players list. Nothing here models or ranks anything:
// the projection is the board row's own value, and the CG Score comes from
// the same shared cgScore/boundCg call the prop board makes for that row.

import { boundCg, cgScore, cgSide } from '../cgScore.js'

export const PENDING = 'Pending'

function finite(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

// { projection, cg, side } for one stat at today's posted line. A blank
// projection (null, '', not a number, or not above 0, as for players held
// blank early in the season) or a missing line gives nulls, so the caller
// shows Pending or a dash and never 0 or NaN.
export function todayPick(prop, line, stat) {
  const posted = finite(line)
  const projection = finite(prop?.projection)
  if (posted == null || posted <= 0 || projection == null || projection <= 0) {
    return { projection: null, cg: null, side: null }
  }
  const cg = finite(boundCg(cgScore(projection, posted, stat)))
  return { projection, cg, side: cg == null ? null : cgSide(cg) }
}

export function pickText(value) {
  const number = finite(value)
  return number == null ? null : number.toFixed(1)
}

// "'26-27" for the season code on the game logs ("2027", "2026-27" or
// "2026-2027"). Anything else keeps the plain label.
export function seasonShortLabel(season, fallback = 'Season') {
  const text = String(season ?? '').trim()
  const span = text.match(/^(\d{4})\s*[-/]\s*(\d{2}|\d{4})$/)
  if (span) return `'${span[1].slice(2)}-${span[2].slice(-2)}`
  if (/^\d{4}$/.test(text)) {
    const end = Number(text)
    return `'${String(end - 1).slice(2)}-${text.slice(2)}`
  }
  return fallback
}
