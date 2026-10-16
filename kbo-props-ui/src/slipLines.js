// Line identity for the slip builder. NHL rows use oddsType, NFL rows use
// line_type, and KBO and WNBA use odds_type. A missing key is a standard line.

export function oddsTypeOf(row) {
  const raw = row?.odds_type ?? row?.oddsType ?? row?.line_type ?? row?.lineType
  const text = String(raw ?? 'standard').trim().toLowerCase()
  if (text === 'demon' || text === 'goblin') return text
  return 'standard'
}

export function isPromoLine(row) {
  const type = oddsTypeOf(row)
  return type === 'demon' || type === 'goblin'
}

export function isStandardLine(row) {
  return oddsTypeOf(row) === 'standard'
}

function sameNumber(left, right) {
  const a = Number(left)
  const b = Number(right)
  return Number.isFinite(a) && Number.isFinite(b) && a === b
}

// Import matching includes the line and the odds type. When several rows
// share a name, the standard row wins over a demon or goblin.
export function matchImportedPick(props, pick) {
  const rows = Array.isArray(props) ? props : []
  const wantedType = pick?.odds_type ?? pick?.oddsType ?? pick?.line_type ?? pick?.lineType
  const hits = []
  rows.forEach((row, index) => {
    if (!row || row.name !== pick?.name || row.prop !== pick?.prop) return
    if (pick?.team != null && pick.team !== '' && row.team !== pick.team) return
    if (pick?.opponent != null && pick.opponent !== '' && row.opponent !== pick.opponent) return
    if (pick?.line != null && pick.line !== '' && !sameNumber(row.line, pick.line)) return
    if (wantedType != null && wantedType !== '' && oddsTypeOf(row) !== oddsTypeOf({ odds_type: wantedType })) return
    hits.push(index)
  })
  const standard = hits.find((index) => isStandardLine(rows[index]))
  if (standard != null) return standard
  return hits.length ? hits[0] : -1
}
