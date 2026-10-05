import { useEffect, useMemo, useState } from 'react'
import { fetchNflSharpOdds } from './nflData'
import { ALL_MATCHUPS, listMatchups, rowMatchesMatchup } from './matchupFilters'
import { dvpGrade } from './matchupGrade'
import { bookLogoSrc } from './bookLogos'
import {
  bestAmerican,
  finiteNumber,
  hitRateColor,
  priceColor,
  priceEvLabel,
  priceTone,
  sameAmericanPrice,
} from './ppBoardColors'

const PROP_ORDER = ['Pass Yards', 'Pass Attempts', 'Pass Completions', 'Pass TDs', 'Pass+Rush Yds', 'Rush Yards', 'Rush Attempts', 'Rush+Rec Yds', 'Receiving Yards', 'Receptions', 'Rec Targets']
const GRADE_RANK = { 'A+': 5, A: 4, B: 3, C: 2, D: 1 }
const GRADE_BANDS = [[4, 'A+'], [2, 'A'], [0.5, 'B'], [0, 'C']]
const GRADE_LADDER = ['A+', 'A', 'B', 'C', 'D']
const COLUMN_COUNT = 10

// Display order for the expand strip. Unknown books follow, alphabetically.
const BOOK_ORDER = ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'Pinnacle', 'Bookmaker', 'Circa', 'Novig', 'Kalshi', 'BetOnline', 'Parx', 'Fanatics', 'Polymarket', 'TheScore']

// American implied break-evens. Flex is the default screen; Power is ~2-pick Power.
const BASELINES = {
  flex: { id: 'flex', label: 'Flex', american: -119, breakeven: 119 / 219 },
  power: { id: 'power', label: 'Power', american: -137, breakeven: 137 / 237 },
}

function formatValue(value) {
  if (value == null || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

function formatAmerican(price) {
  if (price == null || !Number.isFinite(Number(price))) return '—'
  const number = Number(price)
  return number > 0 ? `+${number}` : String(number)
}

function formatHit(rate) {
  if (rate == null || rate === '') return '—'
  const number = Number(rate)
  return Number.isFinite(number) ? `${Math.round(number)}%` : '—'
}

function formatEdge(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const number = Number(value)
  return `${number > 0 ? '+' : ''}${number.toFixed(1)}%`
}

function noBookNote(item) {
  if (item?.line_match !== 'none') return null
  if (item.unmatched_reason === 'market_not_in_feed') return 'No book market'
  if (item.unmatched_reason === 'line_too_far') return 'Book line too far'
  return 'No book line'
}

function initials(name) {
  return String(name || '').split(' ').map((part) => part[0]).join('').slice(0, 2)
}

function gradeClass(grade) {
  if (!grade) return 'grade-na'
  return `grade-${grade[0].toLowerCase()}`
}

function gradeFromEdge(edge, linePlus) {
  if (edge == null || !Number.isFinite(Number(edge))) return null
  let band = 'D'
  for (const [threshold, grade] of GRADE_BANDS) {
    if (Number(edge) >= threshold) {
      band = grade
      break
    }
  }
  if (linePlus && band !== 'D') band = GRADE_LADDER[Math.max(GRADE_LADDER.indexOf(band) - 1, 0)]
  return band
}

function scoredSide(item) {
  if (item.recommendation === 'UNDER') return 'under'
  if (item.recommendation === 'OVER') return 'over'
  return null
}

function sideEdge(item, side, mode) {
  const stored = finiteNumber(item?.[`pp_edge_${side}_${mode}`])
  if (stored != null) return stored
  const fair = finiteNumber(side === 'under' ? item?.fair_under_pct : item?.fair_over_pct)
  if (fair == null) return null
  return Math.round((fair / 100 - BASELINES[mode].breakeven) * 1000) / 10
}

function activeEdge(item, mode) {
  const side = scoredSide(item)
  if (side) return sideEdge(item, side, mode)
  const fallback = finiteNumber(mode === 'power' ? item?.pp_edge_power : (item?.pp_edge_flex ?? item?.pp_edge_pct))
  return fallback
}

function activeGrade(item, mode, edge) {
  const stored = mode === 'power' ? item?.grade_power : (item?.grade_flex || item?.grade)
  if (stored) return stored
  return gradeFromEdge(edge, !!item?.line_plus)
}

function matchupGrade(item) {
  const rank = Number(item?.dvpRank)
  if (!Number.isFinite(rank) || rank <= 0) return null
  return dvpGrade(rank)
}

function anchorQuote(item) {
  if (item?.quoted_price != null && item?.quoted_book) {
    return { price: item.quoted_price, book: item.quoted_book }
  }
  return priceShopQuote(item)
}

function priceShopQuote(item) {
  if (item?.price_american != null && item?.price_book) {
    return { price: item.price_american, book: item.price_book }
  }
  const side = scoredSide(item)
  if (!side) return null
  const sharp = side === 'under' ? item.sharp_under : item.sharp_over
  const best = side === 'under' ? item.best_under : item.best_over
  return sharp || best || null
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

function booksFor(item) {
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

function rowId(item) {
  return item.id || `${item.player}-${item.prop}-${item.pp_line}`
}

function stripDomId(item) {
  return `nfl-sharp-strip-${String(rowId(item)).replace(/[^a-zA-Z0-9_-]+/g, '-')}`
}

function BookLogo({ book, className, decorative = false }) {
  const src = bookLogoSrc(book)
  if (!src) return null
  const name = book?.book || book?.book_key || ''
  return <img className={className} src={src} alt={decorative ? '' : name} title={name} />
}

function Quote({ quote, baselineAmerican }) {
  if (!quote) return <span className="nfl-sharp-book">—</span>
  const color = priceColor(quote.price, baselineAmerican)
  return (
    <>
      <div className="nfl-sharp-price" style={color ? { color } : undefined}>{formatAmerican(quote.price)}</div>
      <div className="nfl-sharp-quote-book">
        <BookLogo book={quote} className="nfl-sharp-quote-logo" decorative />
        <span>{quote.book}{quote.implied_pct != null ? ` · ${Number(quote.implied_pct).toFixed(1)}%` : ''}</span>
      </div>
    </>
  )
}

function HitRate({ rate }) {
  const color = hitRateColor(rate)
  return <span className="nfl-sharp-hit" style={color ? { color } : undefined}>{formatHit(rate)}</span>
}

function SidePrice({ price, baselineAmerican, label, prominent }) {
  if (price == null) return null
  const ev = priceEvLabel(price, baselineAmerican)
  const tone = priceTone(price, baselineAmerican)
  return (
    <div className={prominent ? 'nfl-sharp-side-main' : 'nfl-sharp-side-alt'} data-tone={tone || undefined}>
      {label && <span className="nfl-sharp-side-label">{label}</span>}
      <b>{formatAmerican(price)}</b>
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

function BookStrip({ item, mode, baselineAmerican }) {
  const side = scoredSide(item)
  const books = booksFor(item)
  const bestPrice = bestAmerican(books, side)
  const gap = noBookNote(item)
  const sideLabel = item.recommendation === 'UNDER' ? 'UNDER' : item.recommendation === 'OVER' ? 'OVER' : 'LINE'
  const baseline = BASELINES[mode] || BASELINES.flex
  return (
    <div className="nfl-sharp-strip">
      <p className="nfl-sharp-strip-title">
        Compare to PrizePicks line {formatValue(item.pp_line)} {item.prop} {sideLabel}
      </p>
      {item.line_match === 'nearest' && (
        <p className="nfl-sharp-strip-note">Books below are on {formatValue(item.matched_line)}, the nearest posted line.</p>
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
        <p className="nfl-sharp-strip-note">{gap || 'No book line'}</p>
      )}
      <p className="nfl-sharp-strip-note">
        Green +EV means that price is a worse deal for the bettor than {baseline.label} ({formatAmerican(baseline.american)}). Red -EV means the book is an easier price for the bettor. Plus-money is red against Flex or Power. PP Edge is still the no-vig fair edge.
      </p>
    </div>
  )
}

function SharpRow({ item, mode, baselineAmerican, onSelectPlayer, open, onToggle }) {
  const side = item.recommendation === 'UNDER' ? 'under' : 'over'
  const label = item.recommendation === 'UNDER' ? 'UNDER' : item.recommendation === 'OVER' ? 'OVER' : 'LINE'
  const edge = activeEdge(item, mode)
  const grade = activeGrade(item, mode, edge)
  const matchup = matchupGrade(item)
  const edgeClass = edge == null ? '' : edge > 0 ? 'over' : edge < 0 ? 'under' : ''
  const overEdge = sideEdge(item, 'over', mode)
  const underEdge = sideEdge(item, 'under', mode)
  const quote = anchorQuote(item)
  const shop = priceShopQuote(item)
  const showPrice = priceTone(shop?.price, baselineAmerican) === 'worse'
  const bookCount = Number(item.fair_book_count) || (Array.isArray(item.fair_books) ? item.fair_books.length : 0)
  const gap = noBookNote(item)

  return (
    <>
      <tr
        className={`nfl-lines-row nfl-sharp-row${open ? ' is-open' : ''}`}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggle()
          }
        }}
        tabIndex={0}
        aria-expanded={open}
        aria-controls={stripDomId(item)}
      >
        <td className="nfl-lines-player">
          <div className="nfl-lines-avatar">{item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : initials(item.player)}</div>
          <div className="nfl-lines-info">
            <button className="nfl-player-link" onClick={(event) => { event.stopPropagation(); onSelectPlayer?.(item.player, item.prop) }}>{item.player}</button>
            <span className="nfl-lines-tag">{[item.team, item.position].filter(Boolean).join(', ') || 'NFL'}</span>
          </div>
        </td>
        <td>
          <div className={`nfl-lines-line ${side}`}><b>{label}</b> {formatValue(item.pp_line)} {item.prop}</div>
          {item.line_match === 'nearest' && <div className="nfl-sharp-book">nearest {formatValue(item.matched_line)}</div>}
          {gap && <div className="nfl-sharp-book">{gap}</div>}
          {item.line_plus && (
            <span className="nfl-sharp-badge line" title="Nearest book line is a half-point easier on this PrizePicks side. Grade is bumped one step. The edge number itself is not padded.">LINE+</span>
          )}
        </td>
        <td><Quote quote={item.best_over} baselineAmerican={baselineAmerican} /></td>
        <td><Quote quote={item.best_under} baselineAmerican={baselineAmerican} /></td>
        <td>{formatValue(item.projection)}</td>
        <td><span className={`nfl-grade ${gradeClass(matchup)}`}>{matchup || '—'}</span></td>
        <td><HitRate rate={item.hitRateL5} /></td>
        <td><HitRate rate={item.hitRate} /></td>
        <td className="nfl-sharp-edge">
          <div className={`nfl-sharp-ev ${edgeClass}`}>{formatEdge(edge)}</div>
          <div className="nfl-sharp-book">
            {quote ? `${quote.book} ${formatAmerican(quote.price)}` : (gap || 'No sharp price')}
            {bookCount > 1 ? ` · ${bookCount} books` : ''}
          </div>
          <div className="nfl-sharp-sides">O {formatEdge(overEdge)} · U {formatEdge(underEdge)}</div>
          {showPrice && (
            <span className="nfl-sharp-badge price" title={`Sharp price ${shop ? `${shop.book} ${formatAmerican(shop.price)}` : ''} is worse for a bettor than this PrizePicks juice. Badge only — the sort uses de-vigged fair edge.`}>PP PRICE</span>
          )}
        </td>
        <td><span className={`nfl-grade ${gradeClass(grade)}`}>{grade || '—'}</span></td>
      </tr>
      {open && (
        <tr className="nfl-sharp-strip-row" id={stripDomId(item)}>
          <td colSpan={COLUMN_COUNT}>
            <BookStrip item={item} mode={mode} baselineAmerican={baselineAmerican} />
          </td>
        </tr>
      )}
    </>
  )
}

export default function NflSharpOdds({ onSelectPlayer }) {
  const [payload, setPayload] = useState(null)
  const [records, setRecords] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [lockedCount, setLockedCount] = useState(0)
  const [query, setQuery] = useState('')
  const [matchup, setMatchup] = useState(ALL_MATCHUPS)
  const [prop, setProp] = useState('All')
  const [side, setSide] = useState('All')
  const [sort, setSort] = useState('PP Edge')
  const [mode, setMode] = useState('flex')
  const [plusOnly, setPlusOnly] = useState(false)
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    let active = true
    fetchNflSharpOdds()
      .then(({ payload: nextPayload, records: nextRecords, preview, lockedCount: locked }) => {
        if (!active) return
        setPayload(nextPayload)
        setRecords(nextRecords)
        setLockedCount(preview ? locked : 0)
        setLoaded(true)
      })
      .catch((loadError) => {
        if (active) setError(loadError.message)
      })
    return () => { active = false }
  }, [])

  const baseline = BASELINES[mode] || BASELINES.flex

  const props = useMemo(() => {
    const present = new Set(records.map((item) => item.prop).filter(Boolean))
    const ordered = PROP_ORDER.filter((item) => present.has(item))
    const extras = [...present].filter((item) => !PROP_ORDER.includes(item)).sort()
    return ['All', ...ordered, ...extras]
  }, [records])

  const matchups = useMemo(() => listMatchups(records), [records])

  const rows = useMemo(() => {
    const filtered = records.filter((item) => {
      if (prop !== 'All' && item.prop !== prop) return false
      if (!rowMatchesMatchup(item, matchup)) return false
      if (side === 'Overs' && item.recommendation !== 'OVER') return false
      if (side === 'Unders' && item.recommendation !== 'UNDER') return false
      if (plusOnly && !(activeEdge(item, mode) > 0)) return false
      if (query && !String(item.player || '').toLowerCase().includes(query.toLowerCase())) return false
      return true
    })
    const rank = (item) => GRADE_RANK[activeGrade(item, mode, activeEdge(item, mode))] || 0
    const edge = (item) => {
      const value = activeEdge(item, mode)
      return Number.isFinite(value) ? value : -999
    }
    return filtered.sort((a, b) => {
      if (sort === 'Grade') return (rank(b) - rank(a)) || (edge(b) - edge(a)) || String(a.player).localeCompare(String(b.player))
      if (sort === 'L10') return (b.hitRate ?? -1) - (a.hitRate ?? -1)
      if (sort === 'L5') return (b.hitRateL5 ?? -1) - (a.hitRateL5 ?? -1)
      return (edge(b) - edge(a)) || (rank(b) - rank(a)) || String(a.player).localeCompare(String(b.player))
    })
  }, [records, prop, matchup, side, query, sort, mode, plusOnly])

  const status = payload?.status || 'ok'
  const showStatus = loaded && !error && payload && status !== 'ok'

  return (
    <section className="nfl-lines-page nfl-sharp-page">
      <div className="nfl-board-header">
        <div>
          <p>NFL / PRIZEPICKS ODDS</p>
          <h1>PrizePicks Odds</h1>
        </div>
        <span>{loaded ? `${rows.length} props` : ''}</span>
      </div>
      <div className="nfl-lines-tabs" role="tablist" aria-label="Prop type">
        {props.map((item) => (
          <button key={item} className={prop === item ? 'active' : ''} onClick={() => setProp(item)}>{item === 'All' ? 'All Props' : item}</button>
        ))}
      </div>
      <section className="nfl-sharp-controls" aria-label="PrizePicks odds filters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player..." />
        <div className="nfl-sharp-baseline" role="group" aria-label="PrizePicks baseline">
          {Object.values(BASELINES).map((item) => (
            <button
              key={item.id}
              type="button"
              className={mode === item.id ? 'active' : ''}
              aria-pressed={mode === item.id}
              onClick={() => setMode(item.id)}
            >
              {item.label} ({formatAmerican(item.american)})
            </button>
          ))}
        </div>
        <label><span>SORT</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option>PP Edge</option>
            <option>Grade</option>
            <option>L10</option>
            <option>L5</option>
          </select>
        </label>
        <label><span>SIDE</span>
          <select value={side} onChange={(event) => setSide(event.target.value)}>
            <option>All</option>
            <option>Overs</option>
            <option>Unders</option>
          </select>
        </label>
        <label className="nfl-sharp-matchup"><span>MATCHUP</span>
          <select value={matchup} onChange={(event) => setMatchup(event.target.value)} aria-label="Matchup">
            <option value={ALL_MATCHUPS}>All matchups</option>
            {matchups.map((game) => (
              <option key={game.id} value={game.id}>{game.label}</option>
            ))}
          </select>
        </label>
        <label className="nfl-sharp-check">
          <input type="checkbox" checked={plusOnly} onChange={(event) => setPlusOnly(event.target.checked)} />
          Only +EV vs PP
        </label>
      </section>
      {error && <div className="nfl-notice">Unable to load NFL sharp odds: {error}</div>}
      {!error && !loaded && <div className="nfl-notice">Loading PrizePicks odds.</div>}
      {showStatus && <div className="nfl-notice">{payload.message || 'Sportsbook odds are unavailable right now.'}</div>}
      {!error && loaded && !records.length && <div className="nfl-notice">{payload?.message || 'No NFL props are on the PrizePicks board right now. Check back closer to kickoff.'}</div>}
      {!error && loaded && !!records.length && !rows.length && <div className="nfl-notice">No props match these filters.</div>}
      {!error && loaded && lockedCount > 0 && <div className="nfl-notice">Free preview: showing the top {records.length} by PP Edge. {lockedCount} more are locked.</div>}
      {!!rows.length && (
        <div className="nfl-lines-table-wrap">
          <table className="nfl-lines-table nfl-sharp-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Prop</th>
                <th>Best Over</th>
                <th>Best Under</th>
                <th>Our Proj</th>
                <th>Matchup</th>
                <th>L5</th>
                <th>L10</th>
                <th title="De-vigged fair win% minus the selected PrizePicks break-even">PP Edge</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const id = rowId(item)
                return (
                  <SharpRow
                    key={id}
                    item={item}
                    mode={mode}
                    baselineAmerican={baseline.american}
                    onSelectPlayer={onSelectPlayer}
                    open={openId === id}
                    onToggle={() => setOpenId((current) => current === id ? null : id)}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
