// Match a Dashboard prop row to the sportsbook snapshot for that same
// player, stat, and PrizePicks line. The side stays whatever the board shows.

import { rowsFromWnbaMatched } from './playerOdds.js'

export const NO_BOOK_ODDS_MESSAGE = 'No sportsbook odds for this line yet'

export function boardSide(projection, line) {
  if (projection == null || projection === '' || line == null || line === '') return null
  const projected = Number(projection)
  const posted = Number(line)
  if (!Number.isFinite(projected) || !Number.isFinite(posted)) return null
  return projected >= posted ? 'over' : 'under'
}

function nameKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function propKey(prop) {
  return String(prop || '').trim().toLowerCase()
}

function lineKey(value) {
  const number = Number(value)
  return Number.isFinite(number) ? String(number) : ''
}

export function sharpOddsKey(player, prop, line) {
  return `${nameKey(player)}|${propKey(prop)}|${lineKey(line)}`
}

function hasBookPrice(record) {
  const books = Array.isArray(record?.book_prices) ? record.book_prices : []
  return books.some((book) => book && (book.over != null || book.under != null))
}

// A nearest book line is still this PrizePicks prop: PP Odds says so in the strip.
// A row with no posted price is not a match.
export function usableSharpOdds(record) {
  if (!record || record.line_match === 'none') return null
  if (!hasBookPrice(record)) return null
  return record
}

export function indexSharpOdds(records) {
  const map = new Map()
  for (const record of Array.isArray(records) ? records : []) {
    if (!record) continue
    const key = sharpOddsKey(record.player, record.prop, record.pp_line)
    if (!nameKey(record.player) || !propKey(record.prop) || !lineKey(record.pp_line)) continue
    map.set(key, record)
  }
  return map
}

export function findSharpOdds(index, item) {
  if (!index || !item) return null
  return index.get(sharpOddsKey(item.player, item.prop, item.line)) || null
}

export function lookupSharpOdds(index, item) {
  return usableSharpOdds(findSharpOdds(index, item))
}

// WNBA stores each book's price under over.books / under.books.
// The comparison strip reads the NFL book_prices shape.
export function wnbaRecordsAsSharp(records) {
  return (Array.isArray(records) ? records : []).map((record) => {
    const bookPrices = rowsFromWnbaMatched(record)
    return {
      player: record?.player,
      prop: record?.stat_label,
      pp_line: record?.pp_line,
      line_match: bookPrices.length ? 'exact' : 'none',
      matched_line: record?.pp_line,
      book_prices: bookPrices,
    }
  })
}

export function oddsPanelMessage(odds, oddsState, seen = false) {
  if (odds) return null
  if (oddsState === 'loading') return 'Loading sportsbook odds.'
  if (oddsState === 'error') return 'Sportsbook odds are unavailable right now.'
  if (seen || oddsState === 'ready') return NO_BOOK_ODDS_MESSAGE
  if (oddsState === 'preview') return 'Sportsbook odds for this line are not in the free preview.'
  return NO_BOOK_ODDS_MESSAGE
}
