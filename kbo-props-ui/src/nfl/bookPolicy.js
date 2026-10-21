// Same list as nfl/book_policy.py (kbo-props-ui/src/nfl/bookPolicy.json).
//
// Excluded books stay out of books count, the consensus, CG odds, and
// Best Over/Under. The shared BetOnline / SportsBetting / Bovada feed
// counts as one book. Consensus keeps one skin's own prices: BetOnline
// when that skin posted both sides, else SportsBetting, else Bovada.
// A missing side is not filled from another skin. Best Over/Under may
// still show the best price among the three.

import policy from './bookPolicy.json' with { type: 'json' }

export const BOOK_POLICY = policy

export function bookKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function sourceId(quote) {
  if (quote == null || typeof quote !== 'object') return null
  const raw = quote.source_id ?? quote.marketSourceId ?? quote.sourceId
  if (raw == null || raw === '') return null
  const id = Number(raw)
  return Number.isInteger(id) ? id : null
}

const EXCLUDED_KEYS = new Set()
const EXCLUDED_IDS = new Set()
for (const source of policy.excluded || []) {
  const key = bookKey(source.name)
  if (key) EXCLUDED_KEYS.add(key)
  for (const alias of source.aliases || []) {
    const aliasKey = bookKey(alias)
    if (aliasKey) EXCLUDED_KEYS.add(aliasKey)
  }
  if (source.id != null) EXCLUDED_IDS.add(Number(source.id))
}

const SHARED_BY_KEY = new Map()
const SHARED_BY_ID = new Map()
for (const group of policy.sharedFeed || []) {
  for (const source of group.sources || []) {
    const key = bookKey(source.name)
    if (!key) continue
    const info = {
      rank: Number(group.rank),
      canonical: source.canonical === true,
      name: source.name,
      key,
    }
    SHARED_BY_KEY.set(key, info)
    if (source.id != null) SHARED_BY_ID.set(Number(source.id), info)
  }
}

export const SHARED_COUNT_KEY = 'betonline-sportsbetting-bovada'

function rowKey(quote) {
  if (quote == null) return ''
  if (typeof quote === 'string') return bookKey(quote)
  return bookKey(quote.book_key || quote.book)
}

export function isExcludedBook(quote) {
  const id = sourceId(quote)
  if (id != null && EXCLUDED_IDS.has(id)) return true
  const key = rowKey(quote)
  return Boolean(key) && EXCLUDED_KEYS.has(key)
}

export function sharedFeedInfo(quote) {
  const id = sourceId(quote)
  const key = rowKey(quote)
  if (id != null && SHARED_BY_ID.has(id)) {
    const info = { ...SHARED_BY_ID.get(id) }
    if (key && SHARED_BY_KEY.has(key)) {
      const named = SHARED_BY_KEY.get(key)
      info.canonical = named.canonical
      info.name = named.name
      info.key = named.key
    }
    return info
  }
  if (key && SHARED_BY_KEY.has(key)) return { ...SHARED_BY_KEY.get(key) }
  return null
}

function before(left, right) {
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] < right[i]) return true
    if (left[i] > right[i]) return false
  }
  return false
}

export function booksCount(rows) {
  const keys = new Set()
  for (const row of rows || []) {
    if (isExcludedBook(row)) continue
    if (sharedFeedInfo(row)) {
      keys.add(SHARED_COUNT_KEY)
      continue
    }
    const key = rowKey(row)
    if (key) keys.add(key)
  }
  return keys.size
}

function sidePrice(quote, side) {
  if (!quote || typeof quote !== 'object') return null
  const price = quote[side]
  if (typeof price === 'boolean' || price == null || price === '' || !Number.isFinite(Number(price))) return null
  return Number(price)
}

// One quote for CG odds and the fair-price book list. Other books pass through.
export function consensusBookPrices(quotes) {
  const rest = []
  const shared = []
  for (const quote of Array.isArray(quotes) ? quotes : []) {
    if (!quote || isExcludedBook(quote)) continue
    if (sharedFeedInfo(quote)) shared.push(quote)
    else rest.push(quote)
  }
  const collapsed = collapseSharedQuote(shared)
  return collapsed ? [...rest, collapsed] : rest
}

function collapseSharedQuote(quotes) {
  if (!quotes.length) return null
  const byKey = new Map()
  for (const quote of quotes) {
    const key = quote.book_key || bookKey(quote.book)
    if (!key) continue
    const slot = byKey.get(key) || { key, over: null, under: null, sample: null }
    for (const side of ['over', 'under']) {
      const price = sidePrice(quote, side)
      if (price == null) continue
      if (slot[side] == null || price > slot[side]) {
        slot[side] = price
        slot.sample = quote
      }
    }
    if (!slot.sample) slot.sample = quote
    byKey.set(key, slot)
  }
  if (!byKey.size) return null
  const slots = [...byKey.values()]
  slots.sort((left, right) => {
    const leftInfo = sharedFeedInfo(left.sample) || { rank: 99, canonical: false }
    const rightInfo = sharedFeedInfo(right.sample) || { rank: 99, canonical: false }
    const leftComplete = left.over != null && left.under != null ? 0 : 1
    const rightComplete = right.over != null && right.under != null ? 0 : 1
    const leftKey = [leftComplete, leftInfo.rank, leftInfo.canonical ? 0 : 1, left.key]
    const rightKey = [rightComplete, rightInfo.rank, rightInfo.canonical ? 0 : 1, right.key]
    if (before(leftKey, rightKey)) return -1
    if (before(rightKey, leftKey)) return 1
    return 0
  })
  const winner = slots[0]
  const sample = winner.sample
  const info = sharedFeedInfo(sample) || {}
  return {
    book: sample.book || info.name,
    book_key: sample.book_key || info.key || bookKey(sample.book || info.name),
    source_id: sample.source_id ?? info.id,
    over: winner.over,
    under: winner.under,
  }
}

// Server best price when it is still a counted book. Otherwise the best
// remaining price on that side. The shared feed is not collapsed here.
export function policyBestQuote(stored, bookPrices, side) {
  if (stored && stored.price != null && !isExcludedBook(stored)) return stored
  let best = null
  let bestPrice = null
  for (const quote of Array.isArray(bookPrices) ? bookPrices : []) {
    if (!quote || isExcludedBook(quote)) continue
    const price = sidePrice(quote, side)
    if (price == null) continue
    if (bestPrice == null || price > bestPrice) {
      bestPrice = price
      best = quote
    }
  }
  if (!best) return null
  return {
    price: bestPrice,
    book: best.book,
    book_key: best.book_key || bookKey(best.book),
  }
}

// Visible "N books" next to the edge. fair_books is the consensus list.
export function displayedBookCount(item) {
  const names = Array.isArray(item?.fair_books) ? item.fair_books : []
  if (names.length) {
    return booksCount(names.map((book) => (typeof book === 'string' ? { book } : book)))
  }
  const stored = Number(item?.fair_book_count)
  return Number.isFinite(stored) ? stored : 0
}
