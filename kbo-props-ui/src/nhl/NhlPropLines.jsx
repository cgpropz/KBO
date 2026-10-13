import { useEffect, useMemo, useState } from 'react'
import { dvpGrade } from '../nfl/matchupGrade'
import { BoardOddsPanel, OddsChevron, boardOddsFor, useBoardOdds } from '../nfl/BoardOddsPanel'
import { fetchNhlProjections, fetchNhlSharpOdds } from './nhlData'
import { teamLogoUrl } from './nhlTeams'
import { fitImage } from '../fitImage.js'
import HitRateStrip from '../HitRateStrip'
import { nhlHitPills } from '../hitRateStrip'
import { cgScore, lineMatchesStat } from '../cgScore'
import { buildCgScoreExplainer } from '../cgScoreExplainer'
import { CgScoreCell, CgScoreNote } from '../CgScoreExplainer'
import BoardStatus from '../BoardStatus'
import { BoardSkeleton } from '../BootScreen.jsx'
import GameSelect from '../GameSelect.jsx'
import { useGameFilter } from '../useGameFilter.js'

const TABS = ['All Props', 'Shots On Goal', 'Goalie Saves', 'Points', 'Power Play Points']
const SEASON = '2026-27'

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

function MiniChart({ recent, line }) {
  const values = Array.isArray(recent) ? recent : []
  const maxValue = Math.max(line || 0, ...values, 1)
  return (
    <div className="nfl-lines-chart" aria-hidden="true">
      {values.map((value, index) => (
        <span key={index} className={value > line ? 'hit' : value === line ? 'push' : 'miss'} style={{ height: `${Math.max(14, (value / maxValue) * 100)}%` }} />
      ))}
    </div>
  )
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

function PropRow({ item, onSelectPlayer, open, onToggle, odds, oddsState, seen }) {
  const recent = Array.isArray(item.recent) ? item.recent : []
  const score = rowScore(item)
  const isOver = Number(item.projection) >= Number(item.line)
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
  const logo = teamLogoUrl(item.opponent)
  return (
    <>
    <tr className={`nfl-lines-row${open ? ' is-open' : ''}`} onClick={onToggle}>
      <td>
        <div className="nfl-lines-player">
          <div className="nfl-lines-avatar">{item.imageUrl ? <img src={fitImage(item.imageUrl, 42)} alt="" loading="lazy" /> : initials(item.player)}</div>
          <div className="nfl-lines-info">
            <button className="nfl-player-link" onClick={(event) => { event.stopPropagation(); onSelectPlayer(item) }}>{item.player}</button>
            {item.goalieStatus === 'probable' && <span className="nhl-probable">PROBABLE</span>}
            {item.goalieStatus === 'confirmed' && <span className="nhl-confirmed">CONFIRMED</span>}
            <span className="nfl-lines-tag">{item.team}, {item.position}</span>
            <div className={`nfl-lines-line ${isOver ? 'over' : 'under'}`}>
              <b>{isOver ? 'O' : 'U'}</b> {formatValue(item.line)} {item.prop}
              {item.oddsType && item.oddsType !== 'standard' && <span className="nhl-odds">{item.oddsType.toUpperCase()}</span>}
            </div>
          </div>
          <OddsChevron open={open} player={item.player} onToggle={onToggle} />
        </div>
      </td>
      <td className="hit-rate-chart"><MiniChart recent={recent} line={Number(item.line)} /></td>
      <td className={`hit-rate-score ${isOver ? 'over' : 'under'}`}>
        <CgScoreCell
          scoreText={score == null ? '—' : score.toFixed(1)}
          note={scoreNote}
          open={whyOpen}
          onToggle={() => setWhyOpen((current) => !current)}
        />
      </td>
      <td className="hit-rate-col"><HitRateStrip pills={nhlHitPills(item)} /></td>
      <td className="hit-rate-extra">{item.dvpRank ? ordinal(item.dvpRank) : '—'}</td>
      <td>
        <div className="nfl-lines-matchup">
          {logo && <img className="nfl-lines-matchup-logo" src={fitImage(logo, 22)} alt={item.opponent} loading="lazy" />}
          <span className={`nfl-grade ${gradeClass(grade)}`}>{grade || '—'}</span>
        </div>
      </td>
    </tr>
    {whyOpen && scoreNote && (
      <tr className="cg-score-note-row">
        <td colSpan={6}>
          <CgScoreNote note={scoreNote} />
        </td>
      </tr>
    )}
    {open && (
      <tr className="nfl-sharp-strip-row">
        <td colSpan={6}>
          <BoardOddsPanel item={item} odds={odds} oddsState={oddsState} seen={seen} />
        </td>
      </tr>
    )}
    </>
  )
}

export default function NhlPropLines({ onSelectPlayer }) {
  const [projections, setProjections] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState('All Props')
  const [sortBy, setSortBy] = useState('CG Score')
  const [lockedCount, setLockedCount] = useState(0)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [openId, setOpenId] = useState(null)
  const { index: oddsIndex, oddsState } = useBoardOdds(
    () => fetchNhlSharpOdds().then(({ records, preview }) => ({ records, preview })),
  )

  useEffect(() => {
    let active = true
    fetchNhlProjections()
      .then(({ projections: next, preview, lockedCount: locked, updatedAt: publishedAt }) => {
        if (!active) return
        setProjections(next)
        setLockedCount(preview ? locked : 0)
        setUpdatedAt(publishedAt || null)
        setLoaded(true)
      })
      .catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  const { games, selected: gameId, setSelected: setGameId, filtered: boardRows } = useGameFilter(projections)
  const rows = useMemo(() => {
    const filtered = boardRows.filter((item) => lineMatchesStat(item.prop, item.line) && (tab === 'All Props' || item.prop === tab))
    return sortBoard(filtered, sortBy)
  }, [boardRows, tab, sortBy])

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
          <span>{rows.length}{lockedCount > 0 ? ` + ${lockedCount} locked` : ''} lines</span>
          <GameSelect games={games} value={gameId} onChange={setGameId} />
          <select className="nhl-sort" value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort">
            <option>CG Score</option>
            <option>Hit Rate</option>
            <option>Season</option>
            <option>H2H</option>
            <option>DVP</option>
          </select>
        </div>
      </div>
      <p className="nhl-note">
        CG Score is the projection divided by the line, times 50. The Season pill is {SEASON} only.
        H2H uses the same games as the player chart, which can include 2025-26. Probable goalies stay off the top of the list until they are confirmed.
        Rank 1 is the toughest matchup for the over.
      </p>
      {error && <div className="nfl-notice">Unable to load the NHL board: {error}</div>}
      {!error && !loaded && (
        <div role="status" aria-label="Loading NHL prop lines">
          <BoardSkeleton />
        </div>
      )}
      {!error && loaded && !projections.length && <div className="nfl-notice">No NHL prop lines are posted for tonight. Check back closer to puck drop.</div>}
      {!error && loaded && !!projections.length && !rows.length && <div className="nfl-notice">No NHL prop lines match these filters.</div>}
      {!!rows.length && (
        <div className="nfl-lines-table-wrap">
          <table className="nfl-lines-table hit-rate-board">
            <thead>
              <tr>
                <th>Lines</th><th>L10 Chart</th><th>CG Score</th><th>Over hit rate</th><th>DVP</th><th>Matchup</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const id = item.id || `${item.player}-${item.prop}-${item.line}`
                const matched = boardOddsFor(oddsIndex, item)
                return (
                  <PropRow
                    key={id}
                    item={item}
                    onSelectPlayer={onSelectPlayer}
                    open={openId === id}
                    onToggle={() => setOpenId((current) => current === id ? null : id)}
                    odds={matched.odds}
                    seen={matched.seen}
                    oddsState={oddsState}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {lockedCount > 0 && <div className="nfl-notice">Free preview: {lockedCount} more lines are locked.</div>}
    </section>
  )
}
