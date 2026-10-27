// Display quarantine for the NFL pass cluster. The Oct 26 playable ledger
// did not clear break-even on these stats. This file only decides which
// rows the default board and the free top 3 keep. It does not read or
// change CG Score, projections, or pricing.

const CLUSTER = new Set([
  'pass yards',
  'passing yards',
  'pass yds',
  'passing yds',
  'pass attempts',
  'passing attempts',
  'pass att',
  'passing att',
  'pass completions',
  'passing completions',
  'pass completion',
  'completions',
  'pass + rush',
  'pass + rush yds',
  'pass + rush yards',
  'pass + rush yd',
  'pass rush yards',
  'pass rush yds',
  'passing + rushing yards',
  'passing + rushing yds',
  'passing and rushing yards',
  'passing and rushing yds',
  'pass and rush yards',
  'pass and rush yds',
])

export const NFL_PASS_QUARANTINE_NOTE = 'Pass yards, pass attempts, completions, and pass+rush are off the default board and the free top 3. Show all reveals them here, marked Unproven.'

export function normalizeNflStat(stat) {
  return String(stat ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[_/]+/g, ' ')
    .replace(/\+/g, ' + ')
    .replace(/[^a-z0-9+ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isNflPassClusterStat(stat) {
  const key = normalizeNflStat(stat)
  return key !== '' && CLUSTER.has(key)
}

export function rowStatLabel(row) {
  return row?.prop ?? row?.stat ?? ''
}

export function isNflPassClusterRow(row) {
  return isNflPassClusterStat(rowStatLabel(row))
}

function dropRows(rows) {
  if (!Array.isArray(rows)) return rows
  let changed = false
  const kept = []
  for (const row of rows) {
    if (isNflPassClusterRow(row)) {
      changed = true
      continue
    }
    kept.push(row)
  }
  return changed ? kept : rows
}

// nfl_projections is a row list. nfl_sharp_odds is { records }. Every other
// dataset, including the other sports, is returned as-is.
export function withoutNflPassCluster(ds, payload) {
  if (ds === 'nfl_projections') return dropRows(payload)
  if (ds === 'nfl_sharp_odds') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
    if (!Array.isArray(payload.records)) return payload
    const records = dropRows(payload.records)
    return records === payload.records ? payload : { ...payload, records }
  }
  return payload
}
