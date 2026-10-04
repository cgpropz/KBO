// Sportsbook rows for the player-page odds table.
// NFL rows come from the Unabated sharp-odds snapshot (book_prices).
// WNBA rows come from the Unabated line-matched record already attached
// to each prop as bookPrices. Pick'em books are not sportsbook prices.

const EXCLUDED_PREFIXES = [
  'prizepicks',
  'underdog',
  'sleeper',
  'splashsports',
  'unabated',
  'sharpbook',
  'draftkingspick6',
  '4castersinternal',
]

export function bookKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isExcludedBook(key) {
  if (!key) return true
  return EXCLUDED_PREFIXES.some((prefix) => key === prefix || key.startsWith(prefix))
}

function nameKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function finitePrice(value) {
  if (typeof value === 'boolean' || value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : null
}

export function formatOddsLine(value) {
  if (value == null || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

export function formatAmerican(price) {
  const number = finitePrice(price)
  if (number == null || number === 0) return '—'
  return number > 0 ? `+${number}` : String(number)
}

function sortRows(rows) {
  return [...rows].sort((a, b) => String(a.book).localeCompare(String(b.book)) || String(a.book_key).localeCompare(String(b.book_key)))
}

export function rowsFromBookPrices(bookPrices, line) {
  if (!Array.isArray(bookPrices)) return []
  const rows = []
  for (const book of bookPrices) {
    const key = book?.book_key || bookKey(book?.book || book?.bookmaker)
    if (isExcludedBook(key)) continue
    const over = finitePrice(book?.over)
    const under = finitePrice(book?.under)
    if (over == null && under == null) continue
    rows.push({
      book: book.book || book.bookmaker || key,
      book_key: key,
      line: book.line != null ? book.line : line,
      over,
      under,
    })
  }
  return sortRows(rows)
}

export function rowsFromWnbaMatched(record) {
  if (!record) return []
  const line = record.sharp_reference_line ?? record.pp_line ?? null
  const map = new Map()
  for (const side of ['over', 'under']) {
    const books = record[side]?.books
    if (!Array.isArray(books)) continue
    for (const item of books) {
      const name = item?.bookmaker || item?.book
      const key = bookKey(name)
      if (isExcludedBook(key)) continue
      const price = finitePrice(item?.price)
      if (price == null) continue
      const slot = map.get(key) || { book: name, book_key: key, line, over: null, under: null }
      if (slot[side] == null || price > slot[side]) {
        slot[side] = price
        slot.book = name
      }
      map.set(key, slot)
    }
  }
  return sortRows([...map.values()])
}

export function nflOddsRows(records, player, prop, line) {
  const key = nameKey(player)
  const propName = String(prop || '')
  const matches = (Array.isArray(records) ? records : []).filter((row) => nameKey(row?.player) === key && row?.prop === propName)
  if (!matches.length) return []
  let record = matches[0]
  if (line != null && line !== '') {
    const exact = matches.find((row) => Number(row.pp_line) === Number(line))
    if (exact) record = exact
  }
  if (record.line_match === 'none') return []
  const bookLine = record.matched_line ?? record.pp_line
  return rowsFromBookPrices(record.book_prices, bookLine)
}

export function wnbaOddsRows(records, player, stat, line) {
  const key = nameKey(player)
  const statName = String(stat || '').trim().toLowerCase()
  const matches = (Array.isArray(records) ? records : []).filter((row) => (
    nameKey(row?.player) === key && String(row?.stat_label || '').trim().toLowerCase() === statName
  ))
  if (!matches.length) return []
  if (line == null || line === '') return rowsFromWnbaMatched(matches[0])
  const target = Number(line)
  const exact = matches.find((row) => Number(row.pp_line) === target)
  return rowsFromWnbaMatched(exact || null)
}
