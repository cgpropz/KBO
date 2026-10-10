import { bookLogoSrc } from './bookLogos'
import { bestAmerican, priceEvLabel, priceTone, sameAmericanPrice } from './ppBoardColors'

// Display order for the expand strip. Unknown books follow, alphabetically.
const BOOK_ORDER = ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'Pinnacle', 'Bookmaker', 'Circa', 'Novig', 'Kalshi', 'BetOnline', 'Parx', 'Fanatics', 'Polymarket', 'TheScore']

// American implied break-evens. Flex is the default screen; Power is ~2-pick Power.
export const BASELINES = {
  flex: { id: 'flex', label: 'Flex', american: -119, breakeven: 119 / 219 },
  power: { id: 'power', label: 'Power', american: -137, breakeven: 137 / 237 },
}

export function formatOddsValue(value) {
  if (value == null || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

export function formatStripAmerican(price) {
  if (price == null || !Number.isFinite(Number(price))) return '—'
  const number = Number(price)
  return number > 0 ? `+${number}` : String(number)
}

export function noBookNote(item) {
  if (item?.line_match !== 'none') return null
  if (item.unmatched_reason === 'market_not_in_feed') return 'No book market'
  if (item.unmatched_reason === 'line_too_far') return 'Book line too far'
  return 'No book line'
}

function bookKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function bookRank(book) {
  const key = bookKey(book?.book_key || book?.book)
  const index = BOOK_ORDER.findIndex((name) => {
    const ordered = bookKey(name)
    return key === ordered || key.startsWith(ordered)
  })
  return index === -1 ? BOOK_ORDER.length : index
}

export function booksFor(item) {
  if (Array.isArray(item?.book_prices) && item.book_prices.length) {
    return [...item.book_prices].sort((a, b) => bookRank(a) - bookRank(b) || String(a.book).localeCompare(String(b.book)))
  }
  const map = new Map()
  const quotes = [
    ['over', item?.best_over],
    ['under', item?.best_under],
    ['over', item?.sharp_over],
    ['under', item?.sharp_under],
  ]
  for (const [side, quote] of quotes) {
    if (!quote?.book || quote.price == null) continue
    const key = quote.book_key || quote.book
    const slot = map.get(key) || { book: quote.book, book_key: quote.book_key || bookKey(quote.book), over: null, under: null }
    if (slot[side] == null) slot[side] = quote.price
    map.set(key, slot)
  }
  return [...map.values()].sort((a, b) => bookRank(a) - bookRank(b) || String(a.book).localeCompare(String(b.book)))
}

function scoredSide(item) {
  if (item?.recommendation === 'UNDER') return 'under'
  if (item?.recommendation === 'OVER') return 'over'
  return null
}

export function BookLogo({ book, className, decorative = false }) {
  const src = bookLogoSrc(book)
  if (!src) return null
  const name = book?.book || book?.book_key || ''
  return <img className={className} src={src} alt={decorative ? '' : name} title={name} />
}

function SidePrice({ price, baselineAmerican, label, prominent }) {
  if (price == null) return null
  const ev = priceEvLabel(price, baselineAmerican)
  const tone = priceTone(price, baselineAmerican)
  return (
    <div className={prominent ? 'nfl-sharp-side-main' : 'nfl-sharp-side-alt'} data-tone={tone || undefined}>
      {label && <span className="nfl-sharp-side-label">{label}</span>}
      <b>{formatStripAmerican(price)}</b>
      {ev && <small>{ev}</small>}
    </div>
  )
}

function BookCell({ book, side, baselineAmerican, bestPrice }) {
  const hasSide = side && book?.[side] != null
  const primarySide = hasSide ? side : (book?.over != null ? 'over' : book?.under != null ? 'under' : null)
  const primary = primarySide ? book[primarySide] : null
  const highlighted = hasSide && sameAmericanPrice(book[side], bestPrice)
  const sideLabel = !hasSide && primarySide === 'over' ? 'O' : !hasSide && primarySide === 'under' ? 'U' : null
  const logo = bookLogoSrc(book)
  return (
    <div className={`nfl-sharp-book-cell${highlighted ? ' is-best' : ''}`}>
      {logo
        ? <BookLogo book={book} className="nfl-sharp-book-logo" />
        : <div className="nfl-sharp-book-name">{book.book}</div>}
      <SidePrice price={primary} baselineAmerican={baselineAmerican} label={sideLabel} prominent />
    </div>
  )
}

export function BookStrip({ item, mode, baselineAmerican, emptyMessage }) {
  const side = scoredSide(item)
  const books = booksFor(item)
  const bestPrice = bestAmerican(books, side)
  const gap = noBookNote(item)
  const sideLabel = item?.recommendation === 'UNDER' ? 'UNDER' : item?.recommendation === 'OVER' ? 'OVER' : 'LINE'
  const baseline = BASELINES[mode] || BASELINES.flex
  const showLegend = books.length > 0 || !emptyMessage
  return (
    <div className="nfl-sharp-strip">
      <p className="nfl-sharp-strip-title">
        Compare to PrizePicks line {formatOddsValue(item?.pp_line)} {item?.prop} {sideLabel}
      </p>
      {item?.line_match === 'nearest' && (
        <p className="nfl-sharp-strip-note">Books below are on {formatOddsValue(item.matched_line)}, the nearest posted line.</p>
      )}
      {books.length ? (
        <div className="nfl-sharp-books">
          {books.map((book) => (
            <BookCell
              key={book.book_key || book.book}
              book={book}
              side={side}
              baselineAmerican={baselineAmerican}
              bestPrice={bestPrice}
            />
          ))}
        </div>
      ) : (
        <p className="nfl-sharp-strip-note">{emptyMessage || gap || 'No book line'}</p>
      )}
      {showLegend && (
        <p className="nfl-sharp-strip-note">
          Green +EV means that price is a worse deal for the bettor than {baseline.label} ({formatStripAmerican(baseline.american)}). Red -EV means the book is an easier price for the bettor. Plus-money is red against Flex or Power. PP Edge is still the no-vig fair edge.
        </p>
      )}
    </div>
  )
}
