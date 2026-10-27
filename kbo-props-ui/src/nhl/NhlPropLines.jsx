import MiniHitBars from '../MiniHitBars'
import { tailChartBars } from '../chartLabels'
import { useEffect, useMemo, useState } from 'react'
import NhlAvatar from './NhlAvatar.jsx'
import { dvpGrade } from '../nfl/matchupGrade'
import { BoardOddsPanel, OddsChevron, boardOddsFor, useBoardOdds } from '../nfl/BoardOddsPanel'
import { fetchNhlProjections, fetchNhlSharpOdds } from './nhlData'
import { ShowAllLinesToggle, useShowAllLines } from '../ShowAllLinesToggle'
import { MemberPreviewNotice } from '../MemberPreviewNotice'
import { QuietMemberPreview } from '../QuietMemberPreview'
import { MemberBoardStatus } from '../MemberBoardStatus'
import { useMemberBoardPhase } from '../useMemberBoardPhase'
import { previewLockedCount, useFullBoardRefresh } from '../useFullBoardRefresh'
import { teamLogoUrl } from './nhlTeams'
import { fitImage } from '../fitImage.js'
import HitRateStrip from '../HitRateStrip'
import { nhlHitPills } from '../hitRateStrip'
import { cgScore, lineMatchesStat } from '../cgScore'
import { prepareBoardRows } from './pointsGate.js'
import { buildCgScoreExplainer } from '../cgScoreExplainer'
import { CgScoreCell, CgScoreNote } from '../CgScoreExplainer'
import BoardStatus from '../BoardStatus'
import { BoardSkeleton } from '../BootScreen.jsx'
import { BoardLoadError } from '../BoardLoadError'
import { opponentLabel } from '../cardMark'
import { CardTeamLogo } from '../CardTeamLogo'
import { LaneMark, TipLaneNote } from '../TipLane'
import { stampTipLanes, tipKeys, tipRowClass } from '../tipFirst'
import { BoardLine, BoardSurface } from '../PropLineCard'
import { initialBoardSort, rememberBoardSort } from '../boardSort'
import { usePhoneBoard } from '../usePhoneBoard'
import { countedLines, lineClause } from '../lineCount'
import { pickSide, sideClass, sideLetter } from '../pickSide.js'

const TABS = ['All Props', 'Shots On Goal', 'Goalie Saves', 'Points', 'Power Play Points']
const SORT_OPTIONS = ['CG Score', 'Hit Rate', 'Season', 'H2H', 'DVP']

function formatValue(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

function initials(name) {
  return String(name || '').split(' ').map((part) => part[0]).join('').slice(0, 2)
}

function ordinal(rank) {
  const remainder = rank % 100
  if (remainder >= 11 && remainder <= 13) return `${rank}th`
  switch (rank % 10) {
    case 1: return `${rank}st`
    case 2: return `${rank}nd`
    case 3: return `${rank}rd`
    default: return `${rank}th`
  }
}

function gradeClass(grade) {
  if (!grade) return 'grade-na'
  return `grade-${grade[0].toLowerCase()}`
}


function rowScore(item) {
  return cgScore(item.projection, item.line, item.prop ?? item.stat)
}

export function sortBoard(rows, sortBy) {
  return [...rows].sort((a, b) => {
    const ae = a.rankEligible === false ? 1 : 0
    const be = b.rankEligible === false ? 1 : 0
    if (ae !== be) return ae - be
    if (sortBy === 'CG Score') return (rowScore(b) ?? -Infinity) - (rowScore(a) ?? -Infinity)
    if (sortBy === 'Season') return (b.seasonHitRate ?? -1) - (a.seasonHitRate ?? -1)
    if (sortBy === 'H2H') return (b.h2hHitRate ?? -1) - (a.h2hHitRate ?? -1)
    if (sortBy === 'DVP') return (a.dvpRank ?? 99) - (b.dvpRank ?? 99)
    return (b.hitRate ?? -1) - (a.hitRate ?? -1)
  })
}

function PropRow({ item, onSelectPlayer, open, onToggle, odds, oddsState, seen, phone }) {
  const recent = Array.isArray(item.recent) ? item.recent : []
  const score = rowScore(item)
  const side = pickSide(item.projection, item.line, score)
  const [whyOpen, setWhyOpen] = useState(false)
  const scoreNote = buildCgScoreExplainer({
    player: item.player,
    projection: item.projection,
    line: item.line,
    stat: item.prop,
    score,
    recentValues: recent,
  })
  const grade = dvpGrade(item.dvpRank)
  const teamLogo = teamLogoUrl(item.team)
  return (
    <BoardLine
      phone={phone}
      className={tipRowClass(item.tipLane, `nfl-lines-row${open ? ' is-open' : ''}`)}
      onClick={onToggle}
      cells={[
        { node: (
          <div className="nfl-lines-player">
            <div className="nfl-lines-avatar"><NhlAvatar item={item} initials={initials(item.player)} /></div>
            <div className="nfl-lines-info">
              <button className="nfl-player-link" onClick={(event) => { event.stopPropagation(); onSelectPlayer(item) }}>{item.player}</button>
              <LaneMark lane={item.tipLane} />
              {item.goalieStatus === 'probable' && <span className="nhl-probable">PROBABLE</span>}
              {item.goalieStatus === 'confirmed' && <span className="nhl-confirmed">CONFIRMED</span>}
              <span className="nfl-lines-tag"><CardTeamLogo team={item.team} src={teamLogo ? fitImage(teamLogo, 16) : ''} />{item.team}, {item.position}</span>
              <div className={`nfl-lines-line ${sideClass(side)}`}>
                {side ? <b>{sideLetter(side)}</b> : null} {formatValue(item.line)} {item.prop}
              </div>
            </div>
            <OddsChevron open={open} player={item.player} onToggle={onToggle} />
          </div>
        ) },
        { className: 'hit-rate-chart', node: <MiniHitBars bars={tailChartBars(item)} line={Number(item.line)} chartClass="nfl-lines-chart" logoFor={teamLogoUrl} /> },
        { className: `hit-rate-score ${sideClass(side)}`, node: (
          <CgScoreCell
            scoreText={score == null ? '—' : score.toFixed(1)}
            score={score}
            side={side}
            note={scoreNote}
            open={whyOpen}
            onToggle={() => setWhyOpen((current) => !current)}
          />
        ) },
        { className: 'hit-rate-col', node: <HitRateStrip pills={nhlHitPills(item)} /> },
        { className: 'hit-rate-extra', node: item.dvpRank ? ordinal(item.dvpRank) : '—' },
        { node: (
          <div className="nfl-lines-matchup">
            {item.opponent ? <span className="board-vs">{opponentLabel(item.opponent)}</span> : null}
            <span className={`nfl-grade ${gradeClass(grade)}`}>{grade || '—'}</span>
          </div>
        ) },
      ]}
      after={(
        <>
          {whyOpen && scoreNote && (phone
            ? <CgScoreNote note={scoreNote} />
            : <tr className="cg-score-note-row"><td colSpan={6}><CgScoreNote note={scoreNote} /></td></tr>)}
          {open && (phone
            ? <BoardOddsPanel item={item} odds={odds} oddsState={oddsState} seen={seen} />
            : <tr className="nfl-sharp-strip-row"><td colSpan={6}><BoardOddsPanel item={item} odds={odds} oddsState={oddsState} seen={seen} /></td></tr>)}
        </>
      )}
    />
  )
}

export default function NhlPropLines({ onSelectPlayer }) {
  const [projections, setProjections] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [tab, setTab] = useState('All Props')
  const [sortBy, setSortBy] = useState(() => initialBoardSort('nhl', SORT_OPTIONS))
  const phone = usePhoneBoard()
  const changeSort = (value) => {
    setSortBy(value)
    rememberBoardSort('nhl', value)
  }
  const [lockedCount, setLockedCount] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [memberPreview, setMemberPreview] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [openId, setOpenId] = useState(null)
  const { index: oddsIndex, oddsState, reload: reloadOdds } = useBoardOdds(
    ({ fresh = false } = {}) => fetchNhlSharpOdds({ fresh }).then(({ records, preview }) => ({ records, preview })),
  )

  useEffect(() => {
    let active = true
    fetchNhlProjections()
      .then(({ projections: next, preview, lockedCount: locked, updatedAt: publishedAt, refreshing: pendingRefresh }) => {
        if (!active) return
        setProjections(next)
        setLockedCount(previewLockedCount(preview, locked))
        setMemberPreview(preview === true)
        setRefreshing(pendingRefresh === true)
        setUpdatedAt(publishedAt || null)
        setError('')
        setLoaded(true)
      })
      .catch((loadError) => active && setError(loadError))
    return () => { active = false }
  }, [loadAttempt])

  const [refreshExhausted, clearRefreshExhausted] = useFullBoardRefresh('nhl_projections', (snapshot) => {
    setProjections(Array.isArray(snapshot.data) ? snapshot.data : [])
    setLockedCount(0)
    setRefreshing(false)
    setMemberPreview(false)
    setUpdatedAt(snapshot.updatedAt || null)
    setError('')
    setLoaded(true)
    reloadOdds()
  })
  const phase = useMemberBoardPhase('nhl', { refreshing: refreshing && !refreshExhausted, exhausted: refreshExhausted })
  const hold = phase === 'loading' || phase === 'exhausted'
  const showPaywall = phase === 'free'

  const retryLoad = () => {
    clearRefreshExhausted()
    setError('')
    setLoaded(false)
    setLoadAttempt((current) => current + 1)
  }

  const { showAllLines, setShowAllLines, allPayload } = useShowAllLines(
    `${loadAttempt}:${updatedAt || ''}`,
    () => fetchNhlProjections({ showAllLines: true }),
  )
  const boardProjections = showAllLines && allPayload ? allPayload.projections : projections
  const sortKey = SORT_OPTIONS.includes(sortBy) ? sortBy : 'CG Score'
  const rows = useMemo(() => {
    const rowKey = (item) => item.id || `${item.player}|${item.prop}|${item.line}`
    const prepared = prepareBoardRows(boardProjections).filter((item) => lineMatchesStat(item.prop, item.line))
    const shown = sortBoard(prepared.filter((item) => tab === 'All Props' || item.prop === tab), sortKey)
    if (sortKey !== 'CG Score') return shown
    return stampTipLanes(shown, tipKeys(sortBoard(prepared, 'CG Score'), rowKey), rowKey)
  }, [boardProjections, tab, sortKey])

  return (
    <section className="nfl-lines-page">
      <div className="nfl-lines-tabs">
        {TABS.map((name) => (
          <button key={name} className={name === tab ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>
        ))}
      </div>
      <div className="nfl-board-header">
        <div><p>NHL / PRIZEPICKS</p><h1>Prop Lines</h1><BoardStatus sport="nhl" updatedAt={updatedAt} /></div>
        <div className="nfl-lines-header-actions">
          <span>{hold ? 'lines' : countedLines(rows.length, { locked: showPaywall ? lockedCount : 0 })}</span>
          <ShowAllLinesToggle pressed={showAllLines} onChange={setShowAllLines} />
          <select className="nhl-sort" value={sortKey} onChange={(event) => changeSort(event.target.value)} aria-label="Sort">
            {SORT_OPTIONS.map((option) => <option key={option}>{option}</option>)}
          </select>
        </div>
      </div>
      <TipLaneNote show={sortKey === 'CG Score' && rows.some((row) => row.tipLane)} />
      {hold && <MemberBoardStatus phase={phase} onRetry={retryLoad} />}
      <QuietMemberPreview phase={phase} preview={memberPreview} refreshing={refreshing} onRetry={retryLoad} />
      {!hold && error && <BoardLoadError error={error} prefix="Unable to load the NHL board:" onRetry={retryLoad} />}
      {showPaywall && <MemberPreviewNotice exhausted={refreshExhausted} onRetry={retryLoad} />}
      {!hold && !error && !loaded && (
        <div role="status" aria-label="Loading NHL prop lines">
          <BoardSkeleton />
        </div>
      )}
      {!hold && !error && loaded && !rows.length && <div className="nfl-notice">No NHL prop lines are posted for tonight. Check back closer to puck drop.</div>}
      {!hold && !!rows.length && (
        <BoardSurface
          phone={phone}
          wrapClass="nfl-lines-table-wrap"
          tableClass="nfl-lines-table hit-rate-board"
          head={<><th>Lines</th><th>L10 Chart</th><th>CG Score</th><th>Over hit rate</th><th>DVP</th><th>Matchup</th></>}
        >
          {rows.map((item) => {
            const id = item.id || `${item.player}-${item.prop}-${item.line}`
            const matched = boardOddsFor(oddsIndex, item)
            return (
              <PropRow
                key={id}
                item={item}
                phone={phone}
                onSelectPlayer={onSelectPlayer}
                open={openId === id}
                onToggle={() => setOpenId((current) => current === id ? null : id)}
                odds={matched.odds}
                seen={matched.seen}
                oddsState={oddsState}
              />
            )
          })}
        </BoardSurface>
      )}
      {showPaywall && lockedCount > 0 && <div className="nfl-notice">Free preview: {lockedCount} more {lineClause(lockedCount)} locked.</div>}
    </section>
  )
}
