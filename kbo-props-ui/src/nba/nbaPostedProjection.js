// A posted NBA projection is a finite number. Null, blank, and non-numeric
// values are pending. Number(null) and Number('') are 0, so a display path
// has to reject them before it treats the row as a pick. Zero stays: it is
// a number, same as the slip builder (slipSports basketRows).

export function hasPostedProjection(value) {
  if (value == null) return false
  if (typeof value === 'string' && value.trim() === '') return false
  return Number.isFinite(Number(value))
}

export function postedNbaProps(props) {
  return (Array.isArray(props) ? props : []).filter((prop) => hasPostedProjection(prop?.projection))
}
