// Board counts use "1 line" and "2 lines". A locked remainder means more than
// the shown count is on the board, so that phrase stays plural.

export function lineWord(count) {
  return Number(count) === 1 ? 'line' : 'lines'
}

export function lineClause(count) {
  return Number(count) === 1 ? 'line is' : 'lines are'
}

export function countedLines(count, { locked = 0 } = {}) {
  const shown = Number(count) || 0
  const extra = Number(locked) > 0 ? Number(locked) : 0
  const noun = shown === 1 && extra === 0 ? 'line' : 'lines'
  return extra > 0 ? `${shown} + ${extra} locked ${noun}` : `${shown} ${noun}`
}
