import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchNflSharpOdds } from './nflData'
import { ShowAllLinesToggle } from '../ShowAllLinesToggle'
import { isNflPassClusterRow, NFL_PASS_QUARANTINE_NOTE } from '../nflPassQuarantine'
import { passAllFromLocation, useNflReveal } from './useNflReveal'
import { MemberBoardStatus } from '../MemberBoardStatus'
import { QuietMemberPreview } from '../QuietMemberPreview'
import { useMemberBoardPhase } from '../useMemberBoardPhase'
import { useFullBoardRefresh } from '../useFullBoardRefresh'
import { computeCgOdds, lineAdjustDetail } from './cgOdds'
import { BookLineLabel, BookLinePct, LineAdjTag } from './LineAdjust.jsx'
import { displayedBookCount, policyBestQuote } from './bookPolicy'
import { sharpOddsEmptyNotice } from '../sharpOddsEmpty'
import { fitImage } from '../fitImage.js'
import { ALL_MATCHUPS, listMatchups, rowMatchesMatchup } from './matchupFilters'
import { dvpGrade } from './matchupGrade'
import { AdjMatchupChip } from './MatchupDefense'
import { useNflMatchupDefense } from './useNflMatchupDefense'
import { BASELINES, BookLogo, BookStrip, noBookNote } from './BookOddsStrip'
import {
  finiteNumber,
  hitRateColor,
  priceColor,
  priceTone,
} from './ppBoardColors'
import { lineClause } from '../lineCount'

const PROP_ORDER = ['Pass Yards', 'Pass Attempts', 'Pass Completions', 'Pass TDs', 'Pass+Rush Yds', 'Rush Yards', 'Rush Attempts', 'Rush+Rec Yds', 'Receiving Yards', 'Receptions', 'Rec Targets']
const GRADE_RANK = { 'A+': 5, A: 4, B: 3, C: 2, D: 1 }
const GRADE_BANDS = [[4, 'A+'], [2, 'A'], [0.5, 'B'], [0, 'C']]
const GRADE_LADDER = ['A+', 'A', 'B', 'C', 'D']
const COLUMN_COUNT = 10

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

function formatSnapshotTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
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

function rowId(item) {
  return item.id || `${item.player}-${item.prop}-${item.pp_line}`
}

function stripDomId(item) {
  return `nfl-sharp-strip-${String(rowId(item)).replace(/[^a-zA-Z0-9_-]+/g, '-')}`
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

// CG odds column (public). Display only: it reads fields the Sharp Odds
// snapshot already sends to this viewer, so it exposes no extra data.
function cgFor(item, mode) {
  const side = scoredSide(item)
  return side ? computeCgOdds(item, side, (BASELINES[mode] || BASELINES.flex).breakeven) : null
}

function CgOddsCell({ item, mode }) {
  const side = scoredSide(item)
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
  const adjust = cg.lineAdjusted ? lineAdjustDetail(item) : null
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
          {cg.lineAdjusted && <LineAdjTag item={item} detail={adjust} extra="CG shifted the book price to the PrizePicks line, so this number is less certain." />}
        </div>
      </div>
    </td>
  )
}

function SharpRow({ item, mode, baselineAmerican, onSelectPlayer, open, onToggle, showCg, matchupDefense }) {
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
  const bookCount = displayedBookCount(item)
  const gap = noBookNote(item)

  return (
    <>
      <tr
        className={`nfl-lines-row nfl-sharp-row${open ? ' is-open' : ''}${showCg ? ' has-cg' : ''}`}
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
            <button className="nfl-player-link" onClick={(event) => { event.stopPropagation(); onSelectPlayer?.(item.player, item.prop) }}>{item.player}</button>
            <span className="nfl-lines-tag">{[item.team, item.position].filter(Boolean).join(', ') || 'NFL'}</span>
          </div>
        </td>
        <td>
          <div className={`nfl-lines-line ${side}`}><b>{label}</b> {formatValue(item.pp_line)} {item.prop}{isNflPassClusterRow(item) ? <span className="nfl-unproven-tag">Unproven</span> : null}</div>
          {item.line_match === 'nearest' && <div className="nfl-sharp-book">nearest {formatValue(item.matched_line)}</div>}
          {gap && <div className="nfl-sharp-book">{gap}</div>}
          {item.line_plus && (
            <span className="nfl-sharp-badge line" title="LINE+ marks an easier half-point line. That half point is already priced into the edge, with no extra letter.">LINE+</span>
          )}
        </td>
        {showCg && <CgOddsCell item={item} mode={mode} />}
        <td><BookLineLabel item={item} side="over" /><Quote quote={policyBestQuote(item.best_over, item.book_prices, 'over')} baselineAmerican={baselineAmerican} /></td>
        <td><BookLineLabel item={item} side="under" /><Quote quote={policyBestQuote(item.best_under, item.book_prices, 'under')} baselineAmerican={baselineAmerican} /></td>
        <td>{formatValue(item.projection)}</td>
        <td>
          <div className="nfl-sharp-matchup-cell">
            <span className={`nfl-grade ${gradeClass(matchup)}`}>{matchup || '—'}</span>
            <AdjMatchupChip payload={matchupDefense} prop={item.prop} position={item.position} opponent={item.opponent} />
          </div>
        </td>
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
          <td colSpan={COLUMN_COUNT + (showCg ? 1 : 0)}>
            <BookStrip item={item} mode={mode} baselineAmerican={baselineAmerican} />
          </td>
        </tr>
      )}
    </>
  )
}

export default function NflSharpOdds({ onSelectPlayer }) {
  const matchupDefense = useNflMatchupDefense()
  const [payload, setPayload] = useState(null)
  const [records, setRecords] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [lockedCount, setLockedCount] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [memberPreview, setMemberPreview] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [matchup, setMatchup] = useState(ALL_MATCHUPS)
  const [prop, setProp] = useState('All')
  const [side, setSide] = useState('All')
  const [sortChoice, setSort] = useState(null)
  const [mode, setMode] = useState('flex')
  const [plusOnly, setPlusOnly] = useState(false)
  const [openId, setOpenId] = useState(null)
  const loadedRef = useRef(false)
  // CG odds are public: every viewer sees the column and defaults to CG Edge.
  const showCg = true
  const sort = sortChoice ?? (showCg ? 'CG Edge' : 'PP Edge')

  useEffect(() => {
    let active = true
    const load = () => {
      fetchNflSharpOdds()
        .then(({ payload: nextPayload, records: nextRecords, preview, lockedCount: locked, refreshing: pendingRefresh }) => {
          if (!active) return
          loadedRef.current = true
          setPayload(nextPayload)
          setRecords(nextRecords)
          setLockedCount(preview ? locked : 0)
          setMemberPreview(preview === true)
          setRefreshing(pendingRefresh === true)
          setError('')
          setLoaded(true)
        })
        .catch((loadError) => {
          if (!active || loadedRef.current) return
          setError(loadError.message)
        })
    }
    load()
    // The snapshot is republished about every 30 minutes. Polling picks up a
    // new Unabated price, and the PP Edge computed from it, without a reload.
    const refresh = window.setInterval(load, 60 * 1000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      window.clearInterval(refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadAttempt])
  const [refreshExhausted, clearRefreshExhausted] = useFullBoardRefresh('nfl_sharp_odds', (snapshot) => {
    const nextPayload = snapshot.data && typeof snapshot.data === 'object' && !Array.isArray(snapshot.data)
      ? snapshot.data
      : { records: Array.isArray(snapshot.data) ? snapshot.data : [], status: 'ok' }
    loadedRef.current = true
    setPayload(nextPayload)
    setRecords(Array.isArray(nextPayload.records) ? nextPayload.records : [])
    setLockedCount(0)
    setRefreshing(false)
    setMemberPreview(false)
    setError('')
    setLoaded(true)
  })
  const phase = useMemberBoardPhase('nfl', { refreshing: refreshing && !refreshExhausted, exhausted: refreshExhausted })
  const hold = phase === 'loading' || phase === 'exhausted'
  const showPaywall = phase === 'free'
  const retryLoad = () => {
    clearRefreshExhausted()
    loadedRef.current = false
    setError('')
    setLoaded(false)
    setLoadAttempt((current) => current + 1)
  }

  const baseline = BASELINES[mode] || BASELINES.flex

  const [showAllLines, setShowAllLines] = useState(false)
  const [showPassCluster, setShowPassCluster] = useState(passAllFromLocation)
  const reveal = showAllLines || showPassCluster
  const altBoard = useNflReveal(
    `${loadAttempt}:${payload?.generated_at || ''}:${showAllLines ? 1 : 0}:${showPassCluster ? 1 : 0}`,
    reveal,
    () => fetchNflSharpOdds({ showAllLines, showPassCluster }),
  )
  const sourceRecords = reveal && altBoard ? altBoard.records : records
  const boardRecords = showPassCluster ? sourceRecords : sourceRecords.filter((item) => !isNflPassClusterRow(item))
  const props = useMemo(() => {
    const present = new Set(boardRecords.map((item) => item.prop).filter(Boolean))
    const ordered = PROP_ORDER.filter((item) => present.has(item))
    const extras = [...present].filter((item) => !PROP_ORDER.includes(item)).sort()
    return ['All', ...ordered, ...extras]
  }, [boardRecords])

  const matchups = useMemo(() => listMatchups(boardRecords), [boardRecords])

  const rows = useMemo(() => {
    const filtered = boardRecords.filter((item) => {
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
      if (sort === 'CG Edge' && showCg) {
        const cg = (item) => {
          const value = cgFor(item, mode)?.edgePct
          return Number.isFinite(value) ? value : -999
        }
        return (cg(b) - cg(a)) || (edge(b) - edge(a)) || String(a.player).localeCompare(String(b.player))
      }
      if (sort === 'Grade') return (rank(b) - rank(a)) || (edge(b) - edge(a)) || String(a.player).localeCompare(String(b.player))
      if (sort === 'L10') return (b.hitRate ?? -1) - (a.hitRate ?? -1)
      if (sort === 'L5') return (b.hitRateL5 ?? -1) - (a.hitRateL5 ?? -1)
      return (edge(b) - edge(a)) || (rank(b) - rank(a)) || String(a.player).localeCompare(String(b.player))
    })
  }, [boardRecords, prop, matchup, side, query, sort, mode, plusOnly, showCg])

  const activePayload = reveal && altBoard?.payload ? altBoard.payload : payload
  const status = activePayload?.status || 'ok'
  const showStatus = loaded && !error && activePayload && status !== 'ok'
  const startedEmpty = !boardRecords.length && activePayload?.empty_state === 'started'
  const emptyNotice = sharpOddsEmptyNotice(boardRecords, {
    emptyState: activePayload?.empty_state,
    fallback: activePayload?.message || 'No NFL props are on the PrizePicks board right now. Check back closer to kickoff.',
  })
  const snapshotLabel = formatSnapshotTime(activePayload?.generated_at) ? ` · odds ${formatSnapshotTime(activePayload.generated_at)}` : ''

  return (
    <section className="nfl-lines-page nfl-sharp-page">
      <div className="nfl-board-header">
        <div>
          <p>NFL / PRIZEPICKS ODDS</p>
          <h1>PrizePicks Odds</h1>
        </div>
        <div className="nfl-lines-header-actions">
          <ShowAllLinesToggle pressed={showAllLines} onChange={setShowAllLines} />
          <button type="button" className="show-all-lines" aria-pressed={showPassCluster} aria-label="Show quarantined pass props" onClick={() => setShowPassCluster((current) => !current)}>Show all</button>
          <span title={activePayload?.feed_snapshot_at ? `Unabated snapshot ${activePayload.feed_snapshot_at}` : undefined}>{loaded ? `${rows.length} props${snapshotLabel}` : ''}</span>
        </div>
      </div>
      <p className="nfl-pass-note" role="note">{NFL_PASS_QUARANTINE_NOTE}</p>
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
            {showCg && <option>CG Edge</option>}
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
      {hold && <MemberBoardStatus phase={phase} onRetry={retryLoad} />}
      <QuietMemberPreview phase={phase} preview={memberPreview} refreshing={refreshing} onRetry={retryLoad} />
      {!hold && error && <div className="nfl-notice">Unable to load NFL sharp odds: {error}</div>}
      {!hold && !error && !loaded && <div className="nfl-notice">Loading PrizePicks odds.</div>}
      {!hold && showStatus && <div className="nfl-notice">{payload.message || 'Sportsbook odds are unavailable right now.'}</div>}
      {!hold && !error && loaded && emptyNotice && (lockedCount <= 0 || startedEmpty) && <div className="nfl-notice">{emptyNotice}</div>}
      {!hold && !error && loaded && !!boardRecords.length && !rows.length && <div className="nfl-notice">No props match these filters.</div>}
      {showPaywall && !error && loaded && lockedCount > 0 && !startedEmpty && <div className="nfl-notice">{boardRecords.length ? `Free preview: showing the top ${boardRecords.length} by PP Edge. ${lockedCount} more are locked.` : `PrizePicks odds are locked. ${lockedCount} ${lineClause(lockedCount)} locked. Upgrade to see the full board.`}</div>}
      {!hold && !!rows.length && (
        <div className="nfl-lines-table-wrap">
          <table className={`nfl-lines-table nfl-sharp-table${showCg ? ' has-cg' : ''}`}>
            <thead>
              <tr>
                <th>Player</th>
                <th>Prop</th>
                {showCg && <th className="nfl-sharp-cg-th" title="CG fair odds, fair win% for the PrizePicks side, and edge vs the selected PrizePicks break-even. Sniper Bot spec method, unfitted priors, not backtested.">CG Odds</th>}
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
                    showCg={showCg}
                    matchupDefense={matchupDefense}
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
