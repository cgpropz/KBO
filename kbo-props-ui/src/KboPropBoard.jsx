import MiniHitBars from './MiniHitBars'
import { headChartBars } from './chartLabels'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchDataSnapshot } from './dataUrl'
import { ShowAllLinesToggle, useShowAllLines } from './ShowAllLinesToggle'
import BoardStatus from './BoardStatus'
import HitRateStrip from './HitRateStrip'
import { KBO_VALUE, kboHitPills } from './hitRateStrip'
import { directionFor, scoreFor } from './kboBoardScore'
import { buildCgScoreExplainer } from './cgScoreExplainer'
import { CgScoreCell, CgScoreNote } from './CgScoreExplainer'
import BreakEvenMeter from './BreakEvenMeter'
import { kboBreakEvenWindows } from './prizepicksBreakeven'
import { BoardSkeleton } from './BootScreen.jsx'
import './KboPropBoard.css'
import { fitImage } from './fitImage.js'
import { BoardLine, BoardSurface, LockedPlaceholder } from './PropLineCard'
import { rememberBoardSort, withDefaultSort } from './boardSort'
import { usePhoneBoard } from './usePhoneBoard'
import { LaneMark, TipLaneNote } from './TipLane'
import { peekApiDataset } from './apiData'
import { rankWithTipLanes } from './stableBoard'
import { tipRowClass } from './tipFirst'
import { countedLines, lineWord } from './lineCount'
import { MemberPreviewNotice } from './MemberPreviewNotice'
import { QuietMemberPreview } from './QuietMemberPreview'
import { MemberBoardStatus } from './MemberBoardStatus'
import { useMemberBoardPhase } from './useMemberBoardPhase'
import { previewLockedCount, useFullBoardRefresh } from './useFullBoardRefresh'
import { BoardLoadError } from './BoardLoadError'
import { opponentLabel } from './cardMark'
import { CardTeamLogo } from './CardTeamLogo'
import { kboLogoUrl } from './slipBoardModel.js'

const FREE_ROW_LIMIT = 3
const SORT_OPTIONS = ['CG Score', 'L10 Hit Rate', 'Full Hit Rate', 'Player Name']

const DEFAULT_FILTERS = {
  direction: 'All',
  minL10: 0,
  minScore: '',
  playerType: 'All',
  sortBy: 'CG Score',
}

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function value(value, digits = 1) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '-'
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(digits)
}

function formatNextGameEt(nextGame) {
  const iso = nextGame?.start_time_utc || nextGame?.start_time_et
  const date = new Date(iso || '')
  if (Number.isNaN(date.getTime())) return nextGame?.label_et || ''
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h12',
    }).formatToParts(date).map((part) => [part.type, part.value]),
  )
  return `${parts.weekday}, ${parts.month} ${parts.day}, ${parts.hour}:${parts.minute} ${parts.dayPeriod} ET`
}

function EmptyBoard({ nextGame, hold }) {
  const when = formatNextGameEt(nextGame)
  const matchup = nextGame?.away && nextGame?.home ? `${nextGame.away} @ ${nextGame.home}` : ''
  if (hold?.active) {
    return (
      <section className="kbo-board-empty" data-testid="kbo-board-hold">
        <h2>{hold.message || 'Lines not posted yet'}</h2>
        <p>PrizePicks has not posted KBO lines. The board fills in when they do.</p>
      </section>
    )
  }
  return (
    <section className="kbo-board-empty" data-testid="kbo-board-empty">
      <h2>No upcoming props</h2>
      {when ? (
        <>
          <p>Next game{matchup ? ` · ${matchup}` : ''}</p>
          <time dateTime={nextGame.start_time_utc || nextGame.start_time_et}>{when}</time>
        </>
      ) : (
        <p>The next KBO game is not posted yet.</p>
      )}
    </section>
  )
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="4" y1="7" x2="20" y2="7" /><circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="12" x2="20" y2="12" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
      <line x1="4" y1="17" x2="20" y2="17" /><circle cx="11" cy="17" r="2" fill="currentColor" stroke="none" />
    </svg>
  )
}


function Filters({ open, close, filters, setFilters, propTabs, propTab, setPropTab, count }) {
  if (!open) return null
  const update = (key, next) => {
    setFilters((current) => ({ ...current, [key]: next }))
    if (key === 'sortBy') rememberBoardSort('kbo', next)
  }
  return (
    <div className="kbo-filter-overlay" onClick={close}>
      <aside className="kbo-filter-panel" onClick={(event) => event.stopPropagation()} aria-label="KBO prop filters">
        <header><h2>Filters</h2><button onClick={close} aria-label="Close filters">Close x</button></header>
        <label>Sort by
          <select value={filters.sortBy} onChange={(event) => update('sortBy', event.target.value)}>
            {SORT_OPTIONS.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
        <label>Prop type
          <select value={propTab} onChange={(event) => setPropTab(event.target.value)}>
            {propTabs.map((tab) => <option key={tab}>{tab}</option>)}
          </select>
        </label>
        <fieldset><legend>Direction</legend>
          {['All', 'Overs', 'Unders'].map((option) => <button key={option} className={filters.direction === option ? 'active' : ''} onClick={() => update('direction', option)}>{option}</button>)}
        </fieldset>
        <fieldset><legend>Player type</legend>
          {['All', 'Pitchers', 'Batters'].map((option) => <button key={option} className={filters.playerType === option ? 'active' : ''} onClick={() => update('playerType', option)}>{option}</button>)}
        </fieldset>
        <fieldset><legend>Minimum L10 hit rate</legend>
          {[0, 50, 60, 70, 80].map((option) => <button key={option} className={filters.minL10 === option ? 'active' : ''} onClick={() => update('minL10', option)}>{option ? `${option}%+` : 'All'}</button>)}
        </fieldset>
        <label>Minimum CG score
          <input type="number" inputMode="decimal" placeholder="Any score" value={filters.minScore} onChange={(event) => update('minScore', event.target.value)} />
        </label>
        <footer><button className="kbo-reset" onClick={() => { setFilters(DEFAULT_FILTERS); rememberBoardSort('kbo', DEFAULT_FILTERS.sortBy) }}>Reset</button><button className="kbo-apply" onClick={close}>Show {count} {lineWord(count)}</button></footer>
      </aside>
    </div>
  )
}

const KboBoardRow = memo(function KboBoardRow({ card, prop, score, direction, hitPills, breakEvenWindows, showBreakEven, photo, locked, rowRef, onSelectPlayer, onExpand, phone, tipLane }) {
  const [whyOpen, setWhyOpen] = useState(false)
  const sideMark = direction === 'over' ? 'O' : direction === 'under' ? 'U' : ''
  const scoreNote = buildCgScoreExplainer({
    player: card.name,
    projection: prop.projection,
    line: prop.line,
    stat: prop.stat,
    score,
    recentValues: prop.recent_values,
    newestFirst: true,
  })
  const meter = showBreakEven && breakEvenWindows.length > 0
    ? (
      <BreakEvenMeter
        windows={breakEvenWindows}
        side={direction === 'under' ? 'under' : 'over'}
        chartCountsOvers={direction === 'under'}
      />
    )
    : null
  return (
    <BoardLine
      phone={phone}
      className={tipRowClass(tipLane, locked ? 'locked' : '')}
      rowRef={whyOpen ? undefined : rowRef}
      cells={[
        {
          onClick: () => !locked && onSelectPlayer?.(card.name),
          style: { cursor: locked ? 'default' : 'pointer' },
          node: (
            <div className="kbo-player-cell">
              <div className="kbo-avatar">{photo ? <img src={fitImage(photo, 42)} alt="" loading="lazy" /> : initials(card.name)}</div>
              <div>
                <strong>{card.name}<LaneMark lane={tipLane} /></strong>
                <small><CardTeamLogo team={card.team} src={kboLogoUrl(card.team)} />{card.team}, {card.type}</small>
                <b className={direction}>{sideMark ? `${sideMark} ` : ''}{value(prop.line)} {prop.stat}</b>
              </div>
            </div>
          ),
        },
        { className: 'hit-rate-chart', node: <MiniHitBars bars={headChartBars(prop, card?.games, KBO_VALUE[prop.stat])} line={prop.line} chartClass="kbo-lines-chart" logoFor={kboLogoUrl} ariaLabel="Last ten game values" /> },
        { className: `hit-rate-score ${direction}`, node: (
          <CgScoreCell
            scoreText={score == null ? '-' : value(score)}
            score={score}
            side={direction}
            note={locked ? null : scoreNote}
            open={whyOpen}
            onToggle={() => {
              setWhyOpen((current) => !current)
              onExpand?.()
            }}
          />
        ) },
        { className: 'hit-rate-col', node: <HitRateStrip pills={hitPills} /> },
        { node: <div className="kbo-matchup">{card.opponent ? <span className="board-vs">{opponentLabel(card.opponent)}</span> : null}</div> },
      ]}
      after={(
        <>
          {meter && (phone ? meter : <tr className="be-meter-row"><td colSpan={5}>{meter}</td></tr>)}
          {whyOpen && !locked && scoreNote && (phone
            ? <CgScoreNote note={scoreNote} />
            : <tr className="cg-score-note-row" ref={rowRef}><td colSpan={5}><CgScoreNote note={scoreNote} /></td></tr>)}
        </>
      )}
    />
  )
})

function readKboCache() {
  return peekApiDataset('prizepicks_props')
}

export default function KboPropBoard({ onNavigatePricing, onSelectPlayer }) {
  const [snapshot, setSnapshot] = useState(() => readKboCache()?.data ?? null)
  const [updatedAt, setUpdatedAt] = useState(() => readKboCache()?.updatedAt || null)
  const [photos, setPhotos] = useState({})
  const [error, setError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [propTab, setPropTab] = useState('All Props')
  const [filters, setFilters] = useState(() => withDefaultSort(DEFAULT_FILTERS, 'kbo', SORT_OPTIONS))
  const phone = usePhoneBoard()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [lockedCount, setLockedCount] = useState(() => {
    const snap = readKboCache()
    return snap ? previewLockedCount(snap.preview === true, snap.lockedCount) : 0
  })
  const [refreshing, setRefreshing] = useState(() => readKboCache()?.refreshing === true)
  const [memberPreview, setMemberPreview] = useState(() => readKboCache()?.preview === true)
  const [whyRevision, setWhyRevision] = useState(0)

  const tableWrapRef = useRef(null)
  const lastFreeRowRef = useRef(null)
  const [lockTop, setLockTop] = useState(null)

  useEffect(() => {
    let active = true
    const load = async ({ fresh = false } = {}) => {
      try {
        const [props, playerPhotos] = await Promise.all([
          fetchDataSnapshot('prizepicks_props.json', { fresh: fresh || loadAttempt > 0 }),
          fetchDataSnapshot('player_photos.json').catch(() => ({ data: {} })),
        ])
        if (!active) return
        setSnapshot((current) => current === props.data ? current : props.data)
        setUpdatedAt(props.updatedAt || null)
        setLockedCount(previewLockedCount(props.preview === true, props.lockedCount))
        setRefreshing(props.refreshing === true)
        setMemberPreview(props.preview === true)
        setPhotos(playerPhotos.data || {})
        setError('')
      } catch (loadError) {
        if (active) {
          if (loadError && !loadError.message) loadError.message = 'Unable to load KBO prop lines.'
          setError(loadError?.message ? loadError : new Error('Unable to load KBO prop lines.'))
        }
      }
    }
    load()
    const refresh = window.setInterval(() => load({ fresh: true }), 30 * 60 * 1000)
    return () => { active = false; window.clearInterval(refresh) }
  }, [loadAttempt])

  const [refreshExhausted, clearRefreshExhausted] = useFullBoardRefresh('prizepicks_props', (next) => {
    setSnapshot(next.data)
    setUpdatedAt(next.updatedAt || null)
    setLockedCount(0)
    setRefreshing(false)
    setMemberPreview(false)
    setError('')
  })
  const phase = useMemberBoardPhase('kbo', { refreshing: refreshing && !refreshExhausted, exhausted: refreshExhausted })
  const hold = phase === 'loading' || phase === 'exhausted'
  const showPaywall = phase === 'free'
  const isPaid = phase === 'member'

  const retryLoad = () => {
    clearRefreshExhausted()
    setError('')
    setLoadAttempt((current) => current + 1)
  }

  const { showAllLines, setShowAllLines, allPayload } = useShowAllLines(
    `${loadAttempt}:${updatedAt || ''}`,
    () => fetchDataSnapshot('prizepicks_props.json', { showAllLines: true }),
  )
  const activeSnapshot = showAllLines && allPayload ? allPayload.data : snapshot
  const photoLookup = useMemo(() => Object.fromEntries(Object.entries(photos).map(([name, url]) => [name.toLowerCase(), url])), [photos])
  const allRows = useMemo(() => (activeSnapshot?.cards || []).flatMap((card) => (card.props || []).map((prop) => ({
    card,
    prop,
    score: scoreFor(prop),
    direction: directionFor(prop),
    hitPills: kboHitPills({ games: card.games, stat: prop.stat, line: prop.line, opponent: card.opponent }),
    breakEvenWindows: kboBreakEvenWindows({
      games: card.games,
      stat: prop.stat,
      line: prop.line,
      side: directionFor(prop) === 'under' ? 'under' : 'over',
    }),
  }))), [activeSnapshot])
  const propTabs = useMemo(() => ['All Props', ...[...new Set(allRows.map(({ prop }) => prop.stat))].sort()], [allRows])
  const laneRows = useMemo(() => {
    const rank = (row) => (row.score == null || !Number.isFinite(row.score) ? -Infinity : row.score)
    const kboKey = (row) => `${row.card?.name}|${row.prop?.stat}|${row.prop?.line}|${row.prop?.odds_type || ''}`
    return rankWithTipLanes(allRows, (left, right) => rank(right) - rank(left), kboKey)
  }, [allRows])
  const rows = useMemo(() => {
    const minimumScore = filters.minScore === '' ? -Infinity : Number(filters.minScore)
    const visible = laneRows
      .filter(({ prop }) => propTab === 'All Props' || prop.stat === propTab)
      .filter(({ card }) => filters.playerType === 'All' || card.type === (filters.playerType === 'Pitchers' ? 'pitcher' : 'batter'))
      .filter(({ direction }) => filters.direction === 'All' || direction === (filters.direction === 'Overs' ? 'over' : 'under'))
      .filter(({ prop }) => Number(prop.hit_rate_l10 ?? 0) >= filters.minL10)
      .filter(({ score }) => filters.minScore === '' || (score != null && score >= minimumScore))
    if (filters.sortBy === 'L10 Hit Rate') {
      return visible.sort((left, right) => Number(right.prop.hit_rate_l10 ?? 0) - Number(left.prop.hit_rate_l10 ?? 0))
    }
    if (filters.sortBy === 'Full Hit Rate') {
      return visible.sort((left, right) => Number(right.prop.hit_rate_all ?? 0) - Number(left.prop.hit_rate_all ?? 0))
    }
    if (filters.sortBy === 'Player Name') {
      return visible.sort((left, right) => left.card.name.localeCompare(right.card.name))
    }
    return visible
  }, [laneRows, filters, propTab])

  const showTipLane = filters.sortBy === 'CG Score'
  const bumpWhy = useCallback(() => setWhyRevision((current) => current + 1), [])
  const boardEmpty = !!snapshot && !allRows.length
  const hasLockedRows = showPaywall && (rows.length > FREE_ROW_LIMIT || lockedCount > 0)
  const lastFreeIndex = Math.min(rows.length, FREE_ROW_LIMIT) - 1
  const placeholderCount = isPaid || lockedCount <= 0 ? 0 : Math.max(4, Math.min(lockedCount, 6))

  useEffect(() => {
    if (!hasLockedRows) return
    const measure = () => {
      if (tableWrapRef.current && lastFreeRowRef.current) {
        const wrapTop = tableWrapRef.current.getBoundingClientRect().top
        const rowBottom = lastFreeRowRef.current.getBoundingClientRect().bottom
        setLockTop(rowBottom - wrapTop)
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [hasLockedRows, rows, whyRevision])

  return (
    <main className="kbo-lines-page">
      {!boardEmpty && <nav className="kbo-prop-tabs" aria-label="KBO prop types">
        {propTabs.map((tab) => <button key={tab} className={tab === propTab ? 'active' : ''} onClick={() => setPropTab(tab)}>{tab}</button>)}
      </nav>}
      <section className="kbo-board-header">
        <div><p>KBO / PRIZEPICKS</p><h1>Prop Lines</h1><BoardStatus sport="kbo" updatedAt={updatedAt} /></div>
        {!hold && !!snapshot && <div className="kbo-header-actions">{!boardEmpty && <span>{countedLines(rows.length, { locked: showPaywall ? lockedCount : 0 })} · sorted by {filters.sortBy}</span>}<ShowAllLinesToggle pressed={showAllLines} onChange={setShowAllLines} />{!boardEmpty && <button onClick={() => setFiltersOpen(true)}><FilterIcon /> Filters</button>}</div>}
      </section>
      <TipLaneNote show={filters.sortBy === 'CG Score' && rows.some((row) => row.tipLane)} />
      {hold && <MemberBoardStatus phase={phase} onRetry={retryLoad} className="kbo-notice" />}
      <QuietMemberPreview phase={phase} preview={memberPreview} refreshing={refreshing} onRetry={retryLoad} className="kbo-notice" />
      {!hold && error && <BoardLoadError className="kbo-notice" error={error} onRetry={retryLoad} />}
      {showPaywall && <MemberPreviewNotice exhausted={refreshExhausted} onRetry={retryLoad} className="kbo-notice" />}
      {!hold && !error && boardEmpty && <EmptyBoard nextGame={snapshot.next_game} hold={snapshot.kbo_hold} />}
      {!hold && !error && !snapshot && (
        <div role="status" aria-label="Loading KBO prop lines">
          <BoardSkeleton />
        </div>
      )}
      {!hold && !!rows.length && (
        <BoardSurface
          phone={phone}
          wrapClass="kbo-lines-table-wrap"
          wrapRef={tableWrapRef}
          tableClass="kbo-lines-table hit-rate-board"
          head={<><th>Lines</th><th>L10 Chart</th><th>CG Score</th><th>Over hit rate</th><th>Matchup</th></>}
          overlay={hasLockedRows && lockTop != null && (
            <div className="kbo-lines-lock-overlay" style={{ top: lockTop }}>
              <div className="kbo-lines-lock-card">
                <div className="kbo-lines-lock-icon">🔒</div>
                <h3>Unlock the Full Board</h3>
                <p>Free members see the top {FREE_ROW_LIMIT} lines.{lockedCount > 0 ? ` ${lockedCount} more are locked.` : ''} Upgrade to see every prop line.</p>
                <button onClick={() => onNavigatePricing?.()}>View Plans</button>
              </div>
            </div>
          )}
        >
          {rows.map(({ card, prop, score, direction, hitPills, breakEvenWindows, tipLane }, index) => (
            <KboBoardRow
              key={`${card.name}-${prop.stat}-${prop.line}-${prop.odds_type || ''}`}
              card={card}
              prop={prop}
              score={score}
              direction={direction}
              hitPills={hitPills}
              breakEvenWindows={breakEvenWindows}
              showBreakEven={isPaid}
              photo={photoLookup[String(card.name || '').toLowerCase()]}
              locked={!isPaid && index >= FREE_ROW_LIMIT}
              rowRef={index === lastFreeIndex ? lastFreeRowRef : undefined}
              onSelectPlayer={onSelectPlayer}
              onExpand={bumpWhy}
              phone={phone}
              tipLane={showTipLane ? tipLane : null}
            />
          ))}
          {Array.from({ length: placeholderCount }, (_, index) => (
            <LockedPlaceholder key={`locked-${index}`} phone={phone} className="locked kbo-placeholder-row" />
          ))}
        </BoardSurface>
      )}
      {!error && snapshot && !boardEmpty && !rows.length && <p className="kbo-notice">No KBO prop lines match these filters.</p>}
      <Filters open={filtersOpen} close={() => setFiltersOpen(false)} filters={filters} setFilters={setFilters} propTabs={propTabs} propTab={propTab} setPropTab={setPropTab} count={rows.length} />
    </main>
  )
}