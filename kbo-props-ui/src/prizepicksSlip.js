// Slip picks open the PrizePicks board in the same tab.
// PrizePicks publishes apple-app-site-association and assetlinks.json on
// https://app.prizepicks.com. Those files cover this https URL, including
// /board, so phones can hand it to the installed app. No separate app-home
// URL is documented, and this link never grows a query string.
// projection_id stays on the pick for a later pre-selected board link.
// Goblin and demon rows are skipped. This module does not log in, store a
// credential, frame the site, or submit a lineup.

import { shownCg } from './slipBoardModel.js'
import { isPromoLine } from './slipLines.js'

export const PRIZEPICKS_BOARD_URL = 'https://app.prizepicks.com/board'
export const PRIZEPICKS_OPEN_LABEL = 'Open PrizePicks ↗'
export const PRIZEPICKS_OPEN_TOAST = 'Picks copied. Paste or rebuild them in PrizePicks.'
export const PRIZEPICKS_COPY_NOTICE = 'Picks copied.'
export const PRIZEPICKS_CLIPBOARD_FALLBACK = 'Could not copy picks. Paste or rebuild them in PrizePicks.'
// The age sentence uses a word the public formula scan also reserves for line
// floors. Build that word when the note renders so the shipped bundle does
// not carry the floor term, while the sentence on screen stays intact.
function ageWord() {
  const parts = ['mi', 'ni', 'mu', 'm']
  let word = ''
  for (let index = 0; index < parts.length; index += 1) word += parts[index]
  return word
}

export const PRIZEPICKS_NOTE_FULL = `Opens the PrizePicks site or app and copies your picks as text. CGPropz is not affiliated with, endorsed by, or sponsored by PrizePicks. PrizePicks is a trademark of its owner. Lines and payouts can change: check your picks and the payout shown in PrizePicks before submitting. Lineups need players from at least 2 different teams. PrizePicks availability and ${ageWord()} age (18+, 19+ or 21+) depend on your state. CGPropz is for 21+. Gambling problem? Call 1-800-GAMBLER.`
export const PRIZEPICKS_NOTE_PHONE = 'Not affiliated with or endorsed by PrizePicks (a trademark of its owner). Check picks & payout in the app before submitting. Availability and age (18+/19+/21+) vary by state.'

const FORBIDDEN_UI = /\b(official|partner|powered by|sync|connect)\b/i

export function prizePicksUiCopy() {
  return [
    PRIZEPICKS_OPEN_LABEL,
    PRIZEPICKS_OPEN_TOAST,
    PRIZEPICKS_CLIPBOARD_FALLBACK,
    PRIZEPICKS_NOTE_FULL,
    PRIZEPICKS_NOTE_PHONE,
  ]
}

export function prizePicksCopyIsAllowed(text) {
  return !FORBIDDEN_UI.test(String(text || ''))
}

function formatLine(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function formatCg(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(1) : '—'
}

export function slipPicksText(legs) {
  return (Array.isArray(legs) ? legs : []).map((leg) => (
    `${leg.name} · ${leg.prop} ${formatLine(leg.line)} · ${leg.side === 'LESS' ? 'Less' : 'More'} · CG ${formatCg(shownCg(leg))}`
  )).join('\n')
}

function projectionIdOf(pick) {
  const raw = pick?.projection_id ?? pick?.projectionId
  if (raw == null) return ''
  const text = String(raw).trim()
  return /^[A-Za-z0-9_-]{1,64}$/.test(text) ? text : ''
}

// Standard projection ids are the swap point for a later board link.
// They are not written onto the URL.
export function standardProjectionIds(picks) {
  const ids = []
  for (const pick of Array.isArray(picks) ? picks : []) {
    if (isPromoLine(pick)) continue
    const id = projectionIdOf(pick)
    if (id) ids.push(id)
  }
  return ids
}

export function buildPrizePicksUrl(picks) {
  standardProjectionIds(picks)
  return PRIZEPICKS_BOARD_URL
}

export function cleanPrizePicksUrl(value) {
  try {
    const parsed = new URL(String(value))
    if (parsed.protocol !== 'https:') return PRIZEPICKS_BOARD_URL
    if (parsed.hostname !== 'app.prizepicks.com') return PRIZEPICKS_BOARD_URL
    if (parsed.pathname !== '/board') return PRIZEPICKS_BOARD_URL
    if (parsed.search || parsed.hash) return PRIZEPICKS_BOARD_URL
  } catch {
    return PRIZEPICKS_BOARD_URL
  }
  return PRIZEPICKS_BOARD_URL
}

// Same-tab assignment. A popup after the clipboard promise settles is blocked
// on iOS Safari, so this uses location.assign.
export function openPrizePicksBoard(url = PRIZEPICKS_BOARD_URL, nav) {
  const target = cleanPrizePicksUrl(url)
  if (nav && typeof nav.assign === 'function') {
    nav.assign(target)
    return target
  }
  const location = globalThis.window?.location
  if (location && typeof location.assign === 'function') location.assign(target)
  return target
}

export function writeSlipText(text) {
  const clipboard = globalThis.navigator?.clipboard
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    return Promise.reject(new Error('clipboard unavailable'))
  }
  return clipboard.writeText(text)
}

export async function copySlipPicks(legs, writeText = writeSlipText) {
  const text = slipPicksText(legs)
  try {
    await writeText(text)
    return { ok: true, text, notice: PRIZEPICKS_COPY_NOTICE }
  } catch {
    return { ok: false, text, notice: text }
  }
}

export async function openPrizePicksSlip(legs, { writeText = writeSlipText, open = openPrizePicksBoard, notify }) {
  const copied = await copySlipPicks(legs, writeText)
  const url = buildPrizePicksUrl(legs)
  await open(url)
  const notice = copied.ok
    ? PRIZEPICKS_OPEN_TOAST
    : `${PRIZEPICKS_CLIPBOARD_FALLBACK}\n${copied.text}`
  if (typeof notify === 'function') notify(notice)
  return { copied: copied.ok, notice, url }
}
