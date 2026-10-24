import { useEffect, useState } from 'react'
import { fetchNbaSharpOdds } from './nbaData'
import { ShowAllLinesToggle, useShowAllLines } from '../ShowAllLinesToggle'
import { lineWord } from '../lineCount'
import { fitImage } from '../fitImage.js'
import { computeCgOdds, lineAdjustDetail, NBA_MAX_LINE_GAP } from '../nfl/cgOdds'

const CG_OPTIONS = { maxLineGap: NBA_MAX_LINE_GAP }
import { BookLineLabel, BookLinePct, LineAdjTag } from '../nfl/LineAdjust.jsx'
import { displayedBookCount, policyBestQuote } from '../nfl/bookPolicy'
import { BASELINES, BookLogo, BookStrip, noBookNote } from '../nfl/BookOddsStrip'
import { hitRateColor, priceColor, priceTone } from '../nfl/ppBoardColors'
import {
  gradeClass,
  nbaActiveEdge,
  nbaDisplayedGrade,
  nbaMatchupGrade,
  nbaScoredSide,
  nbaSideEdge,
  projectionVsLineColor,
} from './nbaSharpDisplay'
import '../nfl/nfl.css'
import '../nfl/bookOddsStrip.css'

const COLUMN_COUNT = 11

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

function initials(name) {
  return String(name || '').split(' ').map((part) => part[0]).join('').slice(0, 2)
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
  const side = nbaScoredSide(item)
  if (!side) return null
  const sharp = side === 'under' ? item.sharp_under : item.sharp_over
  const best = side === 'under' ? item.best_under : item.best_over
  return sharp || best || null
}

function rowId(item) {
  return item.id || `${item.player}-${item.prop}-${item.pp_line}`
}

function stripDomId(item) {
  return `nba-sharp-strip-${String(rowId(item)).replace(/[^a-zA-Z0-9_-]+/g, '-')}`
}

function Quote({ quote, baselineAmerican }) {
  if (!quote || quote.price == null) return <span className="nfl-sharp-book">—</span>
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

function cgFor(item, mode) {
  const side = nbaScoredSide(item)
  return side ? computeCgOdds(item, side, (BASELINES[mode] || BASELINES.flex).breakeven, CG_OPTIONS) : null
}

function CgOddsCell({ item, mode }) {
  const side = nbaScoredSide(item)
  const cg = cgFor(item, mode)
  const baseline = BASELINES[mode] || BASELINES.flex
  if (!cg) {
    return (
      <td className="nfl-sharp-cg is-empty">
        <div className="cgo-hero">
          <div className="cgo-head"><span className="cgo-label">CG ODDS</span></div>
          <div className="cgo-none">No CG price for this line</div>
        </div>
      </td>
    )
  }
  const tone = cg.edgePct == null ? 'even' : cg.edgePct > 0 ? 'pos' : cg.edgePct < 0 ? 'neg' : 'even'
  const sideLabel = side === 'under' ? 'Under' : 'Over'
  const bookList = cg.books.join(', ')
  const adjust = cg.lineAdjusted ? lineAdjustDetail(item, CG_OPTIONS) : null
  return (
    <td className={`nfl-sharp-cg tone-${tone}`}>
      <div className="cgo-hero" title="CG odds. Sniper Bot spec method: power de-vig, weighted book blend, line shift. Weights are unfitted priors; not backtested.">
        <div className="cgo-head">
          <span className="cgo-label">CG ODDS</span>
          <span className={`cgo-edge ${tone}`} title={`CG fair win% minus the ${baseline.label} break-even (${(baseline.breakeven * 100).toFixed(2)}%)`}>
            {formatEdge(cg.edgePct)} <small>vs {baseline.label}</small>
          </span>
        </div>
        <div className="cgo-who">{item.player} · <span className={side}>{sideLabel} {formatValue(item.pp_line)} {item.prop}</span></div>
        <div className="cgo-main">
          <b className="cgo-price">{formatAmerican(cg.american)}</b>
          <span className="cgo-prob"><strong>{(cg.probability * 100).toFixed(1)}%</strong><small>{sideLabel} fair win</small></span>
          <BookLinePct detail={adjust} side={side} />
        </div>
        <div className="cgo-tags">
          <span className="cgo-tag" title={bookList ? `Books in the CG price: ${bookList}` : 'Books in the CG price'}>{cg.books.length} book{cg.books.length === 1 ? '' : 's'}</span>
          {cg.lineAdjusted && <LineAdjTag item={item} detail={adjust} />}
        </div>
      </div>
    </td>
  )
}

function ProjectionCell({ item }) {
  const color = projectionVsLineColor(item.projection, item.pp_line, nbaScoredSide(item))
  return <span className="nfl-sharp-hit" style={color ? { color } : undefined}>{formatValue(item.projection)}</span>
}

function SharpRow({ item, mode, baselineAmerican, onSelectPlayer, open, onToggle }) {
  const side = item.recommendation === 'UNDER' ? 'under' : item.recommendation === 'OVER' ? 'over' : ''
  const label = item.recommendation === 'UNDER' ? 'UNDER' : item.recommendation === 'OVER' ? 'OVER' : 'LINE'
  const edge = nbaActiveEdge(item, mode)
  const grade = nbaDisplayedGrade(item, mode, edge)
  const matchup = nbaMatchupGrade(item)
  const edgeClass = edge == null ? '' : edge > 0 ? 'over' : edge < 0 ? 'under' : ''
  const overEdge = nbaSideEdge(item, 'over', mode)
  const underEdge = nbaSideEdge(item, 'under', mode)
  const quote = anchorQuote(item)
  const shop = priceShopQuote(item)
  const showPrice = priceTone(shop?.price, baselineAmerican) === 'worse'
  const bookCount = displayedBookCount(item)
  const gap = noBookNote(item)

  return (
    <>
      <tr
        className={`nfl-lines-row nfl-sharp-row${open ? ' is-open' : ''} has-cg`}
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
          <div className="nfl-lines-avatar">{item.imageUrl ? <img src={fitImage(item.imageUrl, 42)} alt="" width={42} height={42} loading="lazy" /> : initials(item.player)}</div>
          <div className="nfl-lines-info">
            <button className="nfl-player-link" onClick={(event) => { event.stopPropagation(); onSelectPlayer?.(item.player) }}>{item.player}</button>
            <span className="nfl-lines-tag">{[item.team, item.position].filter(Boolean).join(', ') || 'NBA'}</span>
          </div>
        </td>
        <td>
          <div className={`nfl-lines-line ${side}`}><b>{label}</b> {formatValue(item.pp_line)} {item.prop}</div>
          {item.line_match === 'nearest' && <div className="nfl-sharp-book">nearest {formatValue(item.matched_line)}</div>}
          {gap && <div className="nfl-sharp-book">{gap}</div>}
          {item.line_plus && (
            <span className="nfl-sharp-badge line" title="LINE+ marks an easier half-point line. That half point is already priced into the edge, with no extra letter.">LINE+</span>
          )}
        </td>
        <CgOddsCell item={item} mode={mode} />
        <td><BookLineLabel item={item} side="over" /><Quote quote={policyBestQuote(item.best_over, item.book_prices, 'over')} baselineAmerican={baselineAmerican} /></td>
        <td><BookLineLabel item={item} side="under" /><Quote quote={policyBestQuote(item.best_under, item.book_prices, 'under')} baselineAmerican={baselineAmerican} /></td>
        <td><ProjectionCell item={item} /></td>
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

export default function NbaSharpOdds({ onSelectPlayer }) {
  const [records, setRecords] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [note, setNote] = useState('')
  const [mode, setMode] = useState('flex')
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    let active = true
    fetchNbaSharpOdds()
      .then(({ records: next, payload }) => {
        if (!active) return
        setRecords(next)
        setNote(payload?.message || '')
        setLoaded(true)
      })
      .catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  const { showAllLines, setShowAllLines, allPayload } = useShowAllLines(
    records.length,
    () => fetchNbaSharpOdds({ showAllLines: true }),
  )
  const boardRecords = showAllLines && allPayload ? allPayload.records : records
  const baseline = BASELINES[mode] || BASELINES.flex

  return (
    <section className="nfl-lines-page nfl-sharp-page">
      <div className="nfl-board-header">
        <div><p>NBA / UNABATED</p><h1>PP Odds</h1></div>
        <div className="nfl-lines-header-actions">
          <ShowAllLinesToggle pressed={showAllLines} onChange={setShowAllLines} />
          <span>{boardRecords.length} {lineWord(boardRecords.length)}</span>
        </div>
      </div>
      <p className="nhl-note">NBA prices come from the same public Unabated file as the NFL board. Basketball is league 3. Pregame full game only. PP Edge compares the no-vig book price with PrizePicks Flex or Power. CG odds needs two-sided book prices on the row.</p>
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
      {error && <div className="nfl-notice">Unable to load odds: {error}</div>}
      {!error && !loaded && <div className="nfl-notice">Loading sportsbook prices.</div>}
      {!error && loaded && !boardRecords.length && <div className="nfl-notice">{note || 'No matched NBA odds right now. The prop board is unchanged.'}</div>}
      {!!boardRecords.length && (
        <div className="nfl-lines-table-wrap">
          <table className="nfl-lines-table nba-sharp-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Prop</th>
                <th className="nfl-sharp-cg-th" title="CG fair odds, fair win% for the PrizePicks side, and edge vs the selected PrizePicks break-even. Sniper Bot spec method, unfitted priors, not backtested.">CG Odds</th>
                <th title="Best book price at the book line. When the book line differs from PrizePicks, the cell says Best Over @line.">Best Over</th>
                <th title="Best book price at the book line. When the book line differs from PrizePicks, the cell says Best Under @line.">Best Under</th>
                <th>Our Proj</th>
                <th>Matchup</th>
                <th>L5</th>
                <th>L10</th>
                <th title="De-vigged fair win% minus the selected PrizePicks break-even">PP Edge</th>
                <th>Grade</th>
              </tr>
            </thead>
            <tbody>
              {boardRecords.map((item) => {
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
