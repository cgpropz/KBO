// Pair labels for the slip builder. Agreement is a rate from 0 to 1.
// Above 60% hits together. Below 40% works against. A sample within a few
// games of the sport floor is a small sample.

export const HIT_TOGETHER = 0.6
export const WORKS_AGAINST = 0.4
export const SMALL_SAMPLE_PAD = 4

export function normName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function propKey(name, stat) {
  return `${normName(name)}|${stat || ''}`
}

export function isSmallSample(n, minShared) {
  const floor = Number(minShared)
  const sample = Number(n)
  if (!Number.isFinite(floor) || !Number.isFinite(sample)) return false
  return sample < floor + SMALL_SAMPLE_PAD
}

export function correlationSuggestions(legs, board, doc) {
  const pairs = Array.isArray(doc?.pairs) ? doc.pairs : []
  const minShared = Number(doc?.minShared) || Number(doc?.smallSampleUnder) - SMALL_SAMPLE_PAD || 0
  const selected = new Set((legs || []).map((leg) => propKey(leg.name, leg.prop)))
  const byKey = new Map()
  for (const row of board || []) {
    byKey.set(propKey(row.name, row.prop), row)
  }
  const well = []
  const against = []
  const seen = new Set()
  for (const leg of legs || []) {
    const legKey = propKey(leg.name, leg.prop)
    for (const pair of pairs) {
      const left = propKey(pair.player, pair.stat)
      const right = propKey(pair.partner, pair.partnerStat)
      let partnerKey = null
      if (left === legKey) partnerKey = right
      else if (right === legKey) partnerKey = left
      else continue
      if (selected.has(partnerKey) || seen.has(partnerKey)) continue
      const boardRow = byKey.get(partnerKey)
      if (!boardRow) continue
      const agreement = Number(pair.agreement)
      if (!Number.isFinite(agreement)) continue
      seen.add(partnerKey)
      const item = {
        idx: boardRow.idx,
        name: boardRow.name,
        prop: boardRow.prop,
        propShort: boardRow.propShort,
        team: boardRow.team,
        agreement,
        n: pair.n,
        smallSample: isSmallSample(pair.n, minShared),
        withName: leg.name,
        withStat: leg.propShort || leg.prop,
      }
      if (agreement > HIT_TOGETHER) well.push(item)
      else if (agreement < WORKS_AGAINST) against.push(item)
    }
  }
  well.sort((a, b) => b.agreement - a.agreement || b.n - a.n)
  against.sort((a, b) => a.agreement - b.agreement || b.n - a.n)
  return { pairsWell: well, worksAgainst: against }
}

// A failed or unpublished snapshot is hidden. A real file with no pairs that
// clear the floor still opens, so the empty copy is a result, not an error.
export function correlationSectionOpen(doc) {
  return !!doc && doc.unavailable !== true && Array.isArray(doc.pairs)
}

export function presentCorrelationDoc(data, minShared) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.unavailable === true || !Array.isArray(data.pairs)) {
    return { pairs: [], minShared, unavailable: true }
  }
  return data
}

export function formatAgreement(rate) {
  const value = Number(rate)
  if (!Number.isFinite(value)) return '—'
  return `${Math.round(value * 100)}%`
}
