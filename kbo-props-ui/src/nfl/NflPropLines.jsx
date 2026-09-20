import { useEffect, useMemo, useState } from 'react'
import { fetchNflProjections } from './nflData'
import { teamLogoUrl } from './nflTeams'

const PROP_TABS = ['All Props', 'Pass Yards', 'Pass Attempts', 'Pass Completions', 'Rush Yards', 'Rush Attempts', 'Receiving Yards', 'Receptions', 'Rec Targets', 'Pass+Rush Yds', 'Rush+Rec Yds']
const SEASON_LABEL = String(new Date().getFullYear())

function formatValue(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1)
}

function initials(name) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2)
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

// Buckets the DVP rank (1 = toughest matchup, 32 = easiest) into a letter grade, same idea as fantasy matchup grades.
function dvpGrade(rank) {
  if (!rank) return null
  const pct = rank / 32
  if (pct >= .9) return 'A+'
  if (pct >= .78) return 'A'
  if (pct >= .66) return 'A-'
  if (pct >= .56) return 'B+'
  if (pct >= .46) return 'B'
  if (pct >= .36) return 'B-'
  if (pct >= .26) return 'C+'
  if (pct >= .16) return 'C'
  if (pct >= .1) return 'C-'
  if (pct >= .06) return 'D+'
  if (pct >= .03) return 'D'
  return 'F'
}

function gradeClass(grade) {
  if (!grade) return 'grade-na'
  return `grade-${grade[0].toLowerCase()}`
}

function TeamLogo({ team, className }) {
  const url = teamLogoUrl(team)
  return url ? <img className={className} src={url} alt={team} loading="lazy" /> : null
}

function MiniChart({ recent, line }) {
  const maxValue = Math.max(line, ...recent, 1)
  return (
    <div className="nfl-lines-chart" aria-hidden="true">
      {recent.map((value, index) => (
        <span key={index} className={value >= line ? 'hit' : 'miss'} style={{ height: `${Math.max(14, (value / maxValue) * 100)}%` }} />
      ))}
    </div>
  )
}

function PropRow({ item, onSelectPlayer }) {
  const recent = Array.isArray(item.recent) ? item.recent : []
  const isOver = item.projection >= item.line
  const grade = dvpGrade(item.dvpRank)

  return (
    <tr className="nfl-lines-row">
      <td className="nfl-lines-player">
        <div className="nfl-lines-avatar">{item.imageUrl ? <img src={item.imageUrl} alt={item.player} loading="lazy" /> : initials(item.player)}</div>
        <div className="nfl-lines-info">
          <button className="nfl-player-link" onClick={() => onSelectPlayer(item.player, item.prop)}>{item.player}</button>
          <span className="nfl-lines-tag">{item.team}, {item.position}</span>
          <div className={`nfl-lines-line ${isOver ? 'over' : 'under'}`}><b>{isOver ? 'O' : 'U'}</b> {formatValue(item.line)} {item.prop}</div>
        </div>
      </td>
      <td><MiniChart recent={recent} line={item.line} /></td>
      <td className={isOver ? 'over' : 'under'}>{item.score.toFixed(1)}</td>
      <td className={item.seasonHitRate == null ? '' : item.seasonHitRate >= 50 ? 'over' : 'under'}>{item.seasonHitRate == null ? '—' : `${item.seasonHitRate}%`}</td>
      <td className={item.h2hHitRate == null ? '' : item.h2hHitRate >= 50 ? 'over' : 'under'}>{item.h2hHitRate == null ? '—' : `${item.h2hHitRate}%`}</td>
      <td>{item.dvpRank ? ordinal(item.dvpRank) : '—'}</td>
      <td className="nfl-lines-matchup">
        <TeamLogo team={item.opponent} className="nfl-lines-matchup-logo" />
        <span className={`nfl-grade ${gradeClass(grade)}`}>{grade || '—'}</span>
      </td>
    </tr>
  )
}

export default function NflPropLines({ onSelectPlayer }) {
  const [projections, setProjections] = useState([])
  const [error, setError] = useState('')
  const [propTab, setPropTab] = useState('All Props')

  useEffect(() => {
    let active = true
    fetchNflProjections().then(({ projections: next }) => active && setProjections(next)).catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  const rows = useMemo(() => projections
    .map((item) => ({ ...item, score: item.line ? (item.projection / item.line) * 50 : 0 }))
    .filter((item) => propTab === 'All Props' || item.prop === propTab)
    .sort((a, b) => b.hitRate - a.hitRate), [projections, propTab])

  return (
    <section className="nfl-lines-page">
      <div className="nfl-lines-tabs">
        {PROP_TABS.map((tab) => (
          <button key={tab} className={tab === propTab ? 'active' : ''} onClick={() => setPropTab(tab)}>{tab}</button>
        ))}
      </div>
      <div className="nfl-board-header"><div><p>NFL / PRIZEPICKS</p><h1>Prop Lines</h1></div><span>{rows.length} lines · sorted by L10 hit rate</span></div>
      {error && <div className="nfl-notice">Unable to load the NFL snapshot: {error}</div>}
      {!error && !rows.length && <div className="nfl-notice">Loading NFL prop lines.</div>}
      {!!rows.length && (
        <div className="nfl-lines-table-wrap">
          <table className="nfl-lines-table">
            <thead>
              <tr>
                <th>Lines</th><th>L10 Chart</th><th>Edge</th><th>{SEASON_LABEL}</th><th>H2H</th><th>DVP</th><th>Matchup</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => <PropRow key={item.id} item={item} onSelectPlayer={onSelectPlayer} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
