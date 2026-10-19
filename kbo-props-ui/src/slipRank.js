// Slip ranking and payouts. CG Score itself is unchanged: this only reads
// cgScore() and the published Power/Flex table.

import { boundCg, cgScore } from './cgScore.js'
import { breakevenFor } from './prizepicksBreakeven.js'

// Over uses the score as published. Under mirrors it around 50 so a
// projection well under the line ranks with a projection well over it.
// NBA and KBO are bounded 0-100 like their boards, so a leg (and the card
// average) stays inside 0-100 on either side.
export function legCg(row, side) {
  const raw = cgScore(row?.projection, row?.line, row?.prop ?? row?.stat)
  const sport = String(row?.sport || '').toLowerCase()
  const score = sport === 'nba' || sport === 'kbo' ? boundCg(raw) : raw
  if (score == null || !Number.isFinite(score)) return null
  return side === 'UNDER' || side === 'LESS' ? (100 - score) : score
}

export function averageCg(rows) {
  const scores = (Array.isArray(rows) ? rows : [])
    .map((row) => legCg(row, row?.side))
    .filter((score) => score != null)
  if (!scores.length) return null
  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

export function playerKey(row) {
  const id = row?.playerId || row?.player_id || row?.id
  if (id != null && String(id).trim() !== '') return `id:${id}`
  const name = String(row?.name || row?.player || '').trim().toLowerCase()
  return name ? `name:${name}` : ''
}

export function playersRepeat(rows) {
  const seen = new Set()
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = playerKey(row)
    if (!key) continue
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

export function payoutFor(mode, picks, { altered = false } = {}) {
  const row = breakevenFor(mode === 'flex' ? 'flex' : 'power', picks)
  if (!row) return null
  return {
    mode: row.mode,
    picks: row.picks,
    payout: row.payout,
    breakeven: row.rate,
    altered: altered === true,
  }
}

const ENTRY = 10

export function payoutDollars(payout, entry = ENTRY) {
  if (!payout) return ''
  return String(payout).split('/').map((part) => {
    const multiplier = Number(String(part).trim().replace(/x$/i, ''))
    if (!Number.isFinite(multiplier)) return String(part).trim()
    const dollars = multiplier * entry
    return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`
  }).join(' / ')
}

export { ENTRY as PAYOUT_ENTRY }
