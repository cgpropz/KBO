import { useEffect, useMemo, useState } from 'react'
import { fetchNhlProjections } from './nhlData'
import { MemberPreviewNotice } from '../MemberPreviewNotice'
import { QuietMemberPreview } from '../QuietMemberPreview'
import { MemberBoardStatus } from '../MemberBoardStatus'
import { useMemberBoardPhase } from '../useMemberBoardPhase'
import { useFullBoardRefresh } from '../useFullBoardRefresh'
import BoardStatus from '../BoardStatus'
import { sortBoard } from './NhlPropLines'
import { fitImage } from '../fitImage.js'
import { teamLogoUrl } from './nhlTeams'
import { opponentLabel } from '../cardMark'
import { CardTeamLogo } from '../CardTeamLogo'
import { cgScore, lineMatchesStat } from '../cgScore'
import { prepareBoardRows } from './pointsGate.js'
import { BoardLoadError } from '../BoardLoadError'
import { pickSide, sideClass } from '../pickSide.js'

const TABS = ['ALL', 'Shots On Goal', 'Goalie Saves', 'Points', 'Power Play Points']

function formatValue(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

function initials(name) {
  return String(name || '').split(' ').map((part) => part[0]).join('').slice(0, 2)
}

function Card({ item, onSelectPlayer }) {
  const recent = Array.isArray(item.recent) ? item.recent : []
  const dates = Array.isArray(item.gameDates) ? item.gameDates : []
  const seasons = Array.isArray(item.chartSeasons) ? item.chartSeasons : []
  const score = cgScore(item.projection, item.line, item.prop)
  const side = pickSide(item.projection, item.line, score)
  const maxValue = Math.max(item.line, ...recent, 1)
  return (
    <article className="nfl-edge-card">
      <div className="nfl-card-topline">
        <span>{item.goalieStatus === 'probable' ? <b className="nhl-probable">PROBABLE</b> : (typeof item.oddsType === 'string' && item.oddsType && item.oddsType !== 'standard' ? item.oddsType.toUpperCase() : 'FULL GAME')}</span>
        <b className={sideClass(side)}>{side ? `${side} ` : ''}{score == null ? '—' : score.toFixed(1)}</b>
      </div>
      <div className="nfl-card-player">
        <div className="nfl-card-avatar">{item.imageUrl ? <img src={fitImage(item.imageUrl, 42)} alt="" loading="lazy" /> : initials(item.player)}</div>
        <div>
          <h2 className="nfl-player-link" onClick={() => onSelectPlayer(item)}>{item.player}</h2>
          <p><b>{item.position}</b><CardTeamLogo team={item.team} src={teamLogoUrl(item.team) ? fitImage(teamLogoUrl(item.team), 16) : ''} /><span>{item.team}</span>{item.opponent ? <em>{opponentLabel(item.opponent)}</em> : null}</p>
        </div>
      </div>
      <div className="nfl-card-prop">{item.prop}</div>
      <div className="nfl-card-metrics">
        <div><small>LINE</small><strong>{formatValue(item.line)}</strong></div>
        <div><small>MODEL</small><strong>{formatValue(item.projection)}</strong></div>
        <div><small>SCORE</small><strong className={sideClass(side)}>{score == null ? '—' : score.toFixed(1)}</strong></div>
        <div><small>DVP</small><strong>{item.dvpRank || '—'}<i> /32</i></strong></div>
      </div>
      <div className="nfl-card-meta">
        <div><small>2026-27</small><strong>{item.seasonHitRate == null ? '—' : `${item.seasonHitRate}%`}</strong></div>
        <div><small>2025-26</small><strong>{item.priorSeasonHitRate == null ? '—' : `${item.priorSeasonHitRate}%`}</strong></div>
        <div><small>L10</small><strong>{item.hitRate == null ? '—' : `${item.hitRate}%`}</strong></div>
        <div><small>H2H</small><strong>{item.h2hHitRate == null ? '—' : `${item.h2hHitRate}%`}</strong></div>
      </div>
      <div className="nfl-history-label">
        <span>LAST {recent.length}{item.chartIncludesPriorSeason ? ' · INCLUDES 2025-26' : ''}</span>
        <span>{item.hitRate == null ? '' : `${item.hitRate}% OVER`}</span>
      </div>
      <div className="nfl-history-bars">
        {recent.map((value, index) => (
          <span className={value > item.line ? 'hit' : value === item.line ? 'push' : 'miss'} style={{ height: `${Math.max(12, (value / maxValue) * 52)}px` }} key={`${item.id}-${index}`}>
            <i>{formatValue(value)} · {dates[index] || ''} {seasons[index] === '2025-26' ? 'last season' : ''}</i>
          </span>
        ))}
      </div>
    </article>
  )
}

export default function NhlProjections({ onSelectPlayer }) {
  const [projections, setProjections] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [showingPreview, setShowingPreview] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState('ALL')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let active = true
    fetchNhlProjections()
      .then(({ projections: next, updatedAt: publishedAt, preview, refreshing: pendingRefresh }) => {
        if (active) { setProjections(next); setUpdatedAt(publishedAt || null); setShowingPreview(preview === true); setRefreshing(pendingRefresh === true); setError(''); setLoaded(true) }
      })
      .catch((loadError) => active && setError(loadError))
    return () => { active = false }
  }, [loadAttempt])

  const [refreshExhausted, clearRefreshExhausted] = useFullBoardRefresh('nhl_projections', (snapshot) => {
    setProjections(Array.isArray(snapshot.data) ? snapshot.data : [])
    setUpdatedAt(snapshot.updatedAt || null)
    setShowingPreview(false)
    setRefreshing(false)
    setError('')
    setLoaded(true)
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

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = prepareBoardRows(projections).filter((item) => lineMatchesStat(item.prop, item.line) && (tab === 'ALL' || item.prop === tab) && (!needle || item.player.toLowerCase().includes(needle) || item.team.toLowerCase().includes(needle)))
    return sortBoard(filtered, 'CG Score')
  }, [projections, tab, query])

  return (
    <section>
      <div className="nfl-board-header">
        <div><p>NHL / PRIZEPICKS</p><h1>Board</h1><BoardStatus sport="nhl" updatedAt={updatedAt} /></div>
      </div>
      <p className="nhl-note">One card per player and prop. Standard PrizePicks lines only. Probable goalies are tagged and sorted to the bottom. When a starter is confirmed, other goalie lines on that team come off the board.</p>
      <div className="nfl-edge-controls">
        <label><span>PLAYER</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" /></label>
        <div className="nfl-position-tabs">
          {TABS.map((name) => <button key={name} className={name === tab ? 'active' : ''} onClick={() => setTab(name)}>{name === 'ALL' ? 'ALL' : name.split(' ')[0]}</button>)}
        </div>
      </div>
      {hold && <MemberBoardStatus phase={phase} onRetry={retryLoad} />}
      <QuietMemberPreview phase={phase} preview={showingPreview} refreshing={refreshing} onRetry={retryLoad} />
      {!hold && error && <BoardLoadError error={error} prefix="Unable to load the board:" onRetry={retryLoad} />}
      {showPaywall && <MemberPreviewNotice preview={showingPreview} exhausted={refreshExhausted} onRetry={retryLoad} />}
      {!hold && !error && !loaded && <div className="nfl-notice">Loading the PrizePicks board.</div>}
      {!hold && !error && loaded && !rows.length && <div className="nfl-notice">No cards match.</div>}
      {!hold && (
        <div className="nfl-edge-grid">
          {rows.map((item) => <Card key={item.id || `${item.player}-${item.prop}`} item={item} onSelectPlayer={onSelectPlayer} />)}
        </div>
      )}
    </section>
  )
}
