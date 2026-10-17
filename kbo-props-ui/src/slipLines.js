// Line identity for the slip builder. KBO, WNBA, and NBA rows use odds_type.
// NHL rows use oddsType. NFL rows use line_type. A row with no odds-type
// field stays. A present goblin or demon (or any other non-standard token)
// is left out. That is the same rule the board API uses.

import { isStandardBoardLine } from './standardBoard.js'

const KNOWN_ODDS_TYPES = new Set(['standard', 'demon', 'goblin'])

export function oddsTypeOf(row) {
  if (!row || typeof row !== 'object') return ''
  for (const raw of [row.odds_type, row.oddsType, row.line_type, row.lineType]) {
    if (raw == null) continue
    const text = String(raw).trim().toLowerCase()
    if (!text) continue
    return KNOWN_ODDS_TYPES.has(text) ? text : ''
  }
  return ''
}

export function isPromoLine(row) {
  const type = oddsTypeOf(row)
  return type === 'demon' || type === 'goblin'
}

export function isStandardLine(row) {
  return isStandardBoardLine(row)
}

// Loaders pass every board row through this. A row with no odds-type field
// stays. Demon, goblin, blank, and unknown types never become slip props.
export function standardSlipRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => isStandardLine(row))
}

function sameNumber(left, right) {
  const a = Number(left)
  const b = Number(right)
  return Number.isFinite(a) && Number.isFinite(b) && a === b
}

// Import matching includes the line. Demon and goblin rows are not selectable,
// so a standard row is the only match.
export function matchImportedPick(props, pick) {
  const rows = Array.isArray(props) ? props : []
  const wantedType = pick?.odds_type ?? pick?.oddsType ?? pick?.line_type ?? pick?.lineType
  const hits = []
  rows.forEach((row, index) => {
    if (!isStandardLine(row)) return
    if (!row || row.name !== pick?.name || row.prop !== pick?.prop) return
    if (pick?.team != null && pick.team !== '' && row.team !== pick.team) return
    if (pick?.opponent != null && pick.opponent !== '' && row.opponent !== pick.opponent) return
    if (pick?.line != null && pick.line !== '' && !sameNumber(row.line, pick.line)) return
    if (wantedType != null && wantedType !== '' && oddsTypeOf(row) !== oddsTypeOf({ odds_type: wantedType })) return
    hits.push(index)
  })
  return hits.length ? hits[0] : -1
}
