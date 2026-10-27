// CG Score overs treatment (Code Green draft, Oct 26 2026).
//
// CG Score stays proj/line × 50. This module never rewrites that number and
// must not be used as a sort key. Free top 3, hub lists, and board CG sorts
// keep the raw score. Two env flags, both default off:
//
//   VITE_FLAG_SIDE_AWARE_UNPROVEN_BADGE / FLAG_SIDE_AWARE_UNPROVEN_BADGE
//     Badge on an over whose |CG−50| is at least 20 (CG ≥ 70). Same distance
//     from 50 as the under-qualify rule (CG ≤ 30), and only the over side.
//     The trailing gate uses the Sniper playable window (overs 48.7% on
//     n=1620, Oct 19–25), which is under Flex break-even 54.25%. It is not a
//     live ledger query. FLAG_OVER_TRAILING_HIT / FLAG_OVER_TRAILING_N can
//     stand in for a later window. Sample under 50, or a hit rate at or above
//     54.25, hides the badge.
//
//   VITE_FLAG_CG_OVER_DISPLAY_DAMPENER / FLAG_CG_OVER_DISPLAY_DAMPENER
//     Display only, overs only: 50 + (raw−50) × k, then cap at 80.
//     k is 0.7 unless VITE_FLAG_CG_OVER_DISPLAY_DAMPENER_K is 0.5 or 0.7.
//     The label is "Calibrated display (beta)". Ranking stays on the raw score
//     even when this flag is on. There is no sort flag.

import { displayScore, sideOfScore } from './sideRank.js'

export const OVER_UNPROVEN_EDGE = 20
export const FLEX_BREAKEVEN_PCT = 54.25
export const OVER_UNPROVEN_MIN_N = 50
export const PUBLISHED_OVER_HIT_PCT = 48.7
export const PUBLISHED_OVER_N = 1620
export const CG_OVER_DISPLAY_CAP = 80
export const CG_OVER_DAMPENER_K_DEFAULT = 0.7

export const UNPROVEN_OVER_LABEL = 'Unproven'
export const UNPROVEN_OVER_TITLE = 'High CG overs are model-ranked edges, not a proven cash rate.'
export const CALIBRATED_DISPLAY_LABEL = 'Calibrated display (beta)'

function truthy(value) {
  return String(value ?? '').toLowerCase() === 'true'
}

function viteEnv() {
  if (typeof import.meta === 'undefined' || !import.meta.env) return {}
  return {
    VITE_FLAG_SIDE_AWARE_UNPROVEN_BADGE: import.meta.env.VITE_FLAG_SIDE_AWARE_UNPROVEN_BADGE,
    VITE_FLAG_CG_OVER_DISPLAY_DAMPENER: import.meta.env.VITE_FLAG_CG_OVER_DISPLAY_DAMPENER,
    VITE_FLAG_CG_OVER_DISPLAY_DAMPENER_K: import.meta.env.VITE_FLAG_CG_OVER_DISPLAY_DAMPENER_K,
    VITE_FLAG_OVER_TRAILING_HIT: import.meta.env.VITE_FLAG_OVER_TRAILING_HIT,
    VITE_FLAG_OVER_TRAILING_N: import.meta.env.VITE_FLAG_OVER_TRAILING_N,
  }
}

// Browser builds read Vite's VITE_ keys. Node callers (the static free-top-3
// builder, tests) pass an env object so this file stays free of process.
export function cgOverEnv(env) {
  if (env) return env
  return viteEnv()
}

function pick(source, viteName, nodeName) {
  if (source?.[viteName] != null && source[viteName] !== '') return source[viteName]
  if (source?.[nodeName] != null && source[nodeName] !== '') return source[nodeName]
  return undefined
}

export function dampenerK(raw) {
  const k = Number(raw)
  return k === 0.5 || k === 0.7 ? k : CG_OVER_DAMPENER_K_DEFAULT
}

export function cgOverFlags(env) {
  const source = cgOverEnv(env)
  const hit = Number(pick(source, 'VITE_FLAG_OVER_TRAILING_HIT', 'FLAG_OVER_TRAILING_HIT'))
  const n = Number(pick(source, 'VITE_FLAG_OVER_TRAILING_N', 'FLAG_OVER_TRAILING_N'))
  return {
    unproven: truthy(pick(source, 'VITE_FLAG_SIDE_AWARE_UNPROVEN_BADGE', 'FLAG_SIDE_AWARE_UNPROVEN_BADGE')),
    dampener: truthy(pick(source, 'VITE_FLAG_CG_OVER_DISPLAY_DAMPENER', 'FLAG_CG_OVER_DISPLAY_DAMPENER')),
    k: dampenerK(pick(source, 'VITE_FLAG_CG_OVER_DISPLAY_DAMPENER_K', 'FLAG_CG_OVER_DISPLAY_DAMPENER_K')),
    trailingHitPct: Number.isFinite(hit) ? hit : PUBLISHED_OVER_HIT_PCT,
    trailingN: Number.isFinite(n) ? n : PUBLISHED_OVER_N,
  }
}

export function normalizeCgSide(side) {
  const value = String(side ?? '').trim().toUpperCase()
  if (value === 'OVER' || value === 'MORE') return 'OVER'
  if (value === 'UNDER' || value === 'LESS') return 'UNDER'
  return null
}

export function rawCgTitle(score) {
  const n = Number(score)
  const text = Number.isFinite(n) ? n.toFixed(1) : String(score ?? '')
  return `Raw CG Score ${text}. Display only. Board rank stays on the raw CG Score.`
}

// Side-aware. An under at CG 30 is the same distance from 50 and is not badged.
export function highCgOverUnproven(score, side, {
  trailingHitPct = PUBLISHED_OVER_HIT_PCT,
  trailingN = PUBLISHED_OVER_N,
} = {}) {
  const value = Number(score)
  if (!Number.isFinite(value)) return false
  const resolved = normalizeCgSide(side) || sideOfScore(value)
  if (resolved !== 'OVER') return false
  if (Math.abs(value - 50) < OVER_UNPROVEN_EDGE) return false
  if (!(Number(trailingN) >= OVER_UNPROVEN_MIN_N)) return false
  if (!(Number(trailingHitPct) < FLEX_BREAKEVEN_PCT)) return false
  return true
}

export function cgOverChrome(rawScore, side, env) {
  const flags = cgOverFlags(env)
  const raw = Number(rawScore)
  const finite = Number.isFinite(raw)
  const resolved = normalizeCgSide(side) || (finite ? sideOfScore(raw) : null)
  const unproven = flags.unproven && highCgOverUnproven(raw, resolved, {
    trailingHitPct: flags.trailingHitPct,
    trailingN: flags.trailingN,
  })
  let display = null
  if (flags.dampener && resolved === 'OVER' && finite && raw > 50) {
    display = Math.min(CG_OVER_DISPLAY_CAP, 50 + (raw - 50) * flags.k)
  }
  return {
    raw: finite ? raw : null,
    side: resolved,
    badge: unproven ? { label: UNPROVEN_OVER_LABEL, title: UNPROVEN_OVER_TITLE } : null,
    display,
    dampened: display != null,
    label: display != null ? CALIBRATED_DISPLAY_LABEL : null,
    rawTitle: display != null ? rawCgTitle(raw) : null,
  }
}

// Number to print. Overs shrink only when the dampener flag is on.
// Symmetric unders still flip to 100 − score. Missing scores stay null so
// callers can keep their own fallback.
export function printedCgScore(score, side, { symmetric = false, env } = {}) {
  const chrome = cgOverChrome(score, side, env)
  if (chrome.dampened) return chrome.display
  if (symmetric) return displayScore(score, side)
  const value = Number(score)
  return Number.isFinite(value) ? value : null
}
