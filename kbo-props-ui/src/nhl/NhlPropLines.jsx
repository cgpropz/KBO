import { useEffect, useMemo, useState } from 'react'
import { dvpGrade } from '../nfl/matchupGrade'
import { BoardOddsPanel, OddsChevron, boardOddsFor, useBoardOdds } from '../nfl/BoardOddsPanel'
import { fetchNhlProjections, fetchNhlSharpOdds } from './nhlData'
import { teamLogoUrl } from './nhlTeams'

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
        <span key={index} className={value > line ? 'hit' : 'miss'} style={{ height: `${Math.max(14, (value / maxValue) * 100)}%` }} />
      ))}
    </div>
  )
}

function rowScore(item) {
  const line = Number(item.line)
  const projection = Number(item.projection)
  return line > 0 && Number.isFinite(projection) ? (projection / line) * 50 : 0
}

export function sortBoard(rows, sortBy) {
  return [...rows].sort((a, b) => {
    const ae = a.rankEligible === false ? 1 : 0
    const be = b.rankEligible === false ? 1 : 0
    if (ae !== be) return ae - be
    if (sortBy === 'CG Score') return rowScore(b) - rowScore(a)
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
  const grade = dvpGrade(item.dvpRank)
  const logo = teamLogoUrl(item.opponent)
  return (
    <>
    <tr className={`nfl-lines-row${open ? ' is-open' : ''}`} onClick={onToggle}>
      <td className="nfl-lines-player">
        <div className="nfl-lines-avatar">{item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : initials(item.player)}</div>
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
      </td>
      <td><MiniChart recent={recent} line={Number(item.line)} /></td>
      <td className={isOver ? 'over' : 'under'}>{score.toFixed(1)}</td>
      <td className={item.seasonHitRate == null ? '' : item.seasonHitRate >= 50 ? 'over' : 'under'}>{item.seasonHitRate == null ? '—' : `${item.seasonHitRate}%`}</td>
      <td className={item.h2hHitRate == null ? '' : item.h2hHitRate >= 50 ? 'over' : 'under'}>
        {item.h2hHitRate == null ? '—' : `${item.h2hHitRate}%`}
        {item.h2hIncludesPriorSeason ? <small className="nhl-odds">last yr</small> : null}
      </td>
      <td>{item.dvpRank ? ordinal(item.dvpRank) : '—'}</td>
      <td className="nfl-lines-matchup">
        {logo && <img className="nfl-lines-matchup-logo" src={logo} alt={item.opponent} />}
        <span className={`nfl-grade ${gradeClass(grade)}`}>{grade || '—'}</span>
      </td>
    </tr>
    {open && (
      <tr className="nfl-sharp-strip-row">
        <td colSpan={7}>
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
  const [openId, setOpenId] = useState(null)
  const { index: oddsIndex, oddsState } = useBoardOdds(
    () => fetchNhlSharpOdds().then(({ records, preview }) => ({ records, preview })),
  )

  useEffect(() => {
    let active = true
    fetchNhlProjections()
      .then(({ projections: next, preview, lockedCount: locked }) => {
        if (!active) return
        setProjections(next)
        setLockedCount(preview ? locked : 0)
        setLoaded(true)
      })
      .catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  const rows = useMemo(() => {
    const filtered = projections.filter((item) => tab === 'All Props' || item.prop === tab)
    return sortBoard(filtered, sortBy)
  }, [projections, tab, sortBy])

  return (
    <section className="nfl-lines-page">
      <div className="nfl-lines-tabs">
        {TABS.map((name) => (
          <button key={name} className={name === tab ? 'active' : ''} onClick={() => setTab(name)}>{name}</button>
        ))}
      </div>
      <div className="nfl-board-header">
        <div><p>NHL / PRIZEPICKS</p><h1>Prop Lines</h1></div>
        <div className="nfl-lines-header-actions">
          <span>{rows.length}{lockedCount > 0 ? ` + ${lockedCount} locked` : ''} lines</span>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort">
            <option>CG Score</option>
            <option>Hit Rate</option>
            <option>Season</option>
            <option>H2H</option>
            <option>DVP</option>
          </select>
        </div>
      </div>
      <p className="nhl-note">
        CG Score is the projection divided by the line, times 50. The {SEASON} column is this season only.
        The chart and H2H can include 2025-26, and those are labeled. Probable goalies stay off the top of the list until they are confirmed.
        Rank 1 is the toughest matchup for the over.
      </p>
      {error && <div className="nfl-notice">Unable to load the NHL board: {error}</div>}
      {!error && !loaded && <div className="nfl-notice">Loading NHL prop lines.</div>}
      {!error && loaded && !rows.length && <div className="nfl-notice">No NHL prop lines are posted for tonight. Check back closer to puck drop.</div>}
      {!!rows.length && (
        <div className="nfl-lines-table-wrap">
          <table className="nfl-lines-table">
            <thead>
              <tr>
                <th>Lines</th><th>L10 Chart</th><th>CG Score</th><th>{SEASON}</th><th>H2H</th><th>DVP</th><th>Matchup</th>
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
