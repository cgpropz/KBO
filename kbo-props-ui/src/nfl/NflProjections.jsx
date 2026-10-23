import { useEffect, useMemo, useState } from 'react'
import { lineResult, overHitRate } from '../hitRateStrip'
import { lineMatchesStat } from '../cgScore'
import { compareNflScores, nflCgScore, nflRawScore } from './nflLineFloors'
import { nflBoardDvpRank, nflTodayPick } from './nflPlayerGames.js'
import { compareSymmetric, displayScoreText, symmetricRankOn } from '../sideRank'
import { cgSide } from '../cgScore'
import { fetchNflProjections } from './nflData'
import BoardStatus from '../BoardStatus'
import { MemberPreviewNotice } from '../MemberPreviewNotice'
import { QuietMemberPreview } from '../QuietMemberPreview'
import { MemberBoardStatus } from '../MemberBoardStatus'
import { useMemberBoardPhase } from '../useMemberBoardPhase'
import { previewLockedCount, useFullBoardRefresh } from '../useFullBoardRefresh'
import { fitImage } from '../fitImage.js'
import { BoardLoadError } from '../BoardLoadError'
import { teamLogoUrl } from './nflTeams'
import { opponentLabel } from '../cardMark'
import { CardTeamLogo } from '../CardTeamLogo'
import { lineClause } from '../lineCount'
import { nflSeasonAverage } from './seasonAverage'
import { ChartDateRow } from '../MiniHitBars'
import { tailChartBars } from '../chartLabels'

// This season's per-game average, or '—' (src/nfl/seasonAverage.js).
function seasonAvgText(row) {
  const season = nflSeasonAverage(row)
  return season ? formatValue(season.average) : '—'
}

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE']

function formatValue(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1)
}

function initials(name) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2)
}

const SNAP_RED = [255, 123, 121]
const SNAP_NEUTRAL = [120, 145, 138]
const SNAP_GREEN = [127, 255, 104]

function mixColor(a, b, t) {
  return a.map((channel, index) => Math.round(channel + (b[index] - channel) * t))
}

function snapColor(pct) {
  const value = Math.max(0, Math.min(100, pct))
  const [r, g, b] = value <= 50
    ? mixColor(SNAP_RED, SNAP_NEUTRAL, Math.max(0, Math.min(1, (value - 30) / 20)))
    : mixColor(SNAP_NEUTRAL, SNAP_GREEN, Math.max(0, Math.min(1, (value - 50) / 20)))
  return `rgb(${r}, ${g}, ${b})`
}

function ProjectionCard({ item, onSelectPlayer }) {
  // Same ten games as the board chart, each with its own date and opponent.
  const bars = tailChartBars(item)
  const recent = bars.map((bar) => bar.value)
  const maxValue = Math.max(item.line, ...recent, 1)
  // Side comes from the score: exactly 50 is no pick (no side, no color).
  // No CG Score (blank projection or line) shows Pending, never 0 and no side.
  // `score` keeps its old value for sorting; this is display only.
  const pending = item.cgScore == null
  const side = pending ? null : cgSide(item.cgScore)
  const sideClass = side === 'OVER' ? 'over' : side === 'UNDER' ? 'under' : 'neutral'
  // NFL admin pilot: an under shows its same-side strength. Score unchanged.
  const shownScore = pending ? 'Pending' : symmetricRankOn('nfl') && side ? displayScoreText(item.cgScore, side) : item.cgScore.toFixed(1)
  const l10 = overHitRate(recent.slice(-10), item.line)
  const shown = overHitRate(recent, item.line)
  // '—' for an unranked opponent; display only (sort keeps the builder value).
  const shownDvp = nflBoardDvpRank(item)

  return (
    <article className="nfl-edge-card">
      <div className="nfl-card-topline"><span className="nfl-snap-badge" style={item.snapCount > 0 ? { borderColor: snapColor(item.snapCount), color: snapColor(item.snapCount) } : undefined}>{item.snapCount > 0 ? `${item.snapCount}% SNAP` : 'SNAP N/A'}</span><b className={sideClass}>{side ? `${side} ` : ''}{shownScore}</b></div>
      <div className="nfl-card-player">
        <div className="nfl-card-avatar">{item.imageUrl ? <img src={fitImage(item.imageUrl, 42)} alt={item.player} width={42} height={42} loading="lazy" /> : initials(item.player)}</div>
        <div><h2 className="nfl-player-link" onClick={() => onSelectPlayer(item.player, item.prop)}>{item.player}</h2><p><b>{item.position}</b><CardTeamLogo team={item.team} src={teamLogoUrl(item.team) ? fitImage(teamLogoUrl(item.team), 16) : ''} /><span>{item.team}</span>{item.opponent ? <em>{opponentLabel(item.opponent)}</em> : null}</p></div>
      </div>
      <div className="nfl-card-prop">{item.prop}</div>
      <div className="nfl-card-metrics"><div><small>LINE</small><strong>{formatValue(item.line)}</strong></div><div><small>MODEL</small><strong>{formatValue(item.projection)}</strong></div><div><small>SCORE</small><strong className={sideClass}>{shownScore}</strong></div><div><small>DVP RANK</small>{shownDvp == null ? <strong className="neutral" data-testid="nfl-card-dvp">—</strong> : <strong className={item.dvpRatio >= 1 ? 'over' : 'under'} data-testid="nfl-card-dvp">{shownDvp}<i> /32</i></strong>}</div></div>
      <div className="nfl-card-meta"><div><small>SEASON AVG</small><strong>{seasonAvgText(item)}</strong></div><div><small>HIT RATE</small><strong>{l10?.rate == null ? '—' : `${l10.rate}%`}</strong></div><div><small>GAMES</small><strong>{l10?.games ?? 0}</strong></div></div>
      <div className="nfl-history-label"><span>LAST {recent.length} GAMES</span><span>{shown?.rate == null ? '—' : `${shown.rate}% OVER LINE`}</span></div>
      <div className="nfl-history-bars" aria-label={`Last ${recent.length} games for ${item.player}`}>
        {recent.map((value, index) => {
          const date = bars[index]?.date || 'Game log'
          return <span className={lineResult(value, item.line) || 'miss'} style={{ height: `${Math.max(12, (value / maxValue) * 52)}px` }} key={`${item.id}-${index}`} tabIndex={0}><i>{formatValue(value)} · {date}</i></span>
        })}
      </div>
      <ChartDateRow bars={bars} logoFor={teamLogoUrl} />
    </article>
  )
}

export default function NflProjections({ onSelectPlayer }) {
  const [projections, setProjections] = useState([])
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState('ALL')
  const [prop, setProp] = useState('All props')
  const [matchup, setMatchup] = useState('All matchups')
  const [sort, setSort] = useState('CG Score')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [lockedCount, setLockedCount] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [memberPreview, setMemberPreview] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  useEffect(() => {
    let active = true
    fetchNflProjections()
      .then(({ projections: next, updatedAt: publishedAt, preview, lockedCount: locked, refreshing: pendingRefresh }) => {
        if (!active) return
        setProjections(next)
        setUpdatedAt(publishedAt || null)
        setLockedCount(previewLockedCount(preview, locked))
        setMemberPreview(preview === true)
        setRefreshing(pendingRefresh === true)
        setError('')
        setLoaded(true)
      })
      .catch((loadError) => active && setError(loadError))
    return () => { active = false }
  }, [loadAttempt])

  const [refreshExhausted, clearRefreshExhausted] = useFullBoardRefresh('nfl_projections', (snapshot) => {
    setProjections(Array.isArray(snapshot.data) ? snapshot.data : [])
    setUpdatedAt(snapshot.updatedAt || null)
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
    setError('')
    setLoaded(false)
    setLoadAttempt((current) => current + 1)
  }

  const matchupKey = (item) => [item.team, item.opponent].sort().join(' vs ')
  const props = useMemo(() => ['All props', ...new Set(projections.map((item) => item.prop))].sort((a, b) => a === 'All props' ? -1 : a.localeCompare(b)), [projections])
  const matchups = useMemo(() => ['All matchups', ...new Set(projections.map(matchupKey))].sort((a, b) => a === 'All matchups' ? -1 : a.localeCompare(b)), [projections])
  const rows = useMemo(() => projections
    .filter((item) => lineMatchesStat(item.prop, item.line))
    .map((item) => { const cgScore = nflTodayPick(item).cg; return { ...item, cgScore, score: nflCgScore(item.projection, item.line, item.prop) ?? 0, rawScore: nflRawScore(item.projection, item.line, item.prop) } })
    .filter((item) => position === 'ALL' || item.position === position)
    .filter((item) => prop === 'All props' || item.prop === prop)
    .filter((item) => matchup === 'All matchups' || matchupKey(item) === matchup)
    .filter((item) => item.player.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      if (sort !== 'CG Score') return b.hitRate - a.hitRate
      return symmetricRankOn('nfl') ? compareSymmetric(a, b) : compareNflScores(a.score, a.rawScore, b.score, b.rawScore)
    }), [matchup, position, projections, prop, query, sort])

  return (
    <section className="nfl-edge-board">
      <div className="nfl-board-header"><div><p>NFL / PRIZEPICKS</p><h1>Edge Board</h1><BoardStatus sport="nfl" updatedAt={updatedAt} /></div><span>{rows.length} edges</span></div>
      <section className="nfl-edge-controls" aria-label="NFL projection filters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search player..." />
        <label><span>SORT</span><select aria-label="Sort" value={sort} onChange={(event) => setSort(event.target.value)}><option>CG Score</option><option>Best hit rate</option></select></label>
        <label><span>PROP</span><select aria-label="Prop" value={prop} onChange={(event) => setProp(event.target.value)}>{props.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>MATCHUP</span><select value={matchup} onChange={(event) => setMatchup(event.target.value)}>{matchups.map((item) => <option key={item}>{item}</option>)}</select></label>
        <div className="nfl-position-tabs">{POSITIONS.map((item) => <button key={item} className={position === item ? 'active' : ''} onClick={() => setPosition(item)}>{item}</button>)}</div>
      </section>
      <div className="nfl-board-meta"><span><i /> LIVE MODEL / DVP ADJUSTED</span></div>
      {hold && <MemberBoardStatus phase={phase} onRetry={retryLoad} />}
      <QuietMemberPreview phase={phase} preview={memberPreview} refreshing={refreshing} onRetry={retryLoad} />
      {!hold && error && <BoardLoadError error={error} prefix="Unable to load the NFL snapshot:" onRetry={retryLoad} />}
      {showPaywall && <MemberPreviewNotice exhausted={refreshExhausted} onRetry={retryLoad} />}
      {!hold && !error && !loaded && <div className="nfl-notice">Loading the current PrizePicks board.</div>}
      {!hold && !error && loaded && !projections.length && lockedCount <= 0 && <div className="nfl-notice">No NFL props are on the PrizePicks board right now. Check back closer to kickoff.</div>}
      {!hold && !error && loaded && !!projections.length && !rows.length && <div className="nfl-notice">No edges match these filters.</div>}
      {showPaywall && !error && loaded && lockedCount > 0 && <div className="nfl-notice">{projections.length ? `Free preview: showing the top ${projections.length} edge${projections.length === 1 ? '' : 's'}. ${lockedCount} more are locked. Upgrade to see every edge.` : `The NFL board is locked. ${lockedCount} ${lineClause(lockedCount)} locked. Upgrade to see every edge.`}</div>}
      {!hold && <div className="nfl-edge-grid">{rows.map((item) => <ProjectionCard key={item.id} item={item} onSelectPlayer={onSelectPlayer} />)}</div>}
    </section>
  )
}