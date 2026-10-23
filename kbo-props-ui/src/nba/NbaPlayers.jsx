import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchNbaData, fetchNbaSnapshot } from './nbaData'
import NbaPlayerChart from './NbaPlayerChart'
import { TREND_METRICS, cardTrend } from './nbaMinutesUsage.js'
import { nbaLogoUrl } from './nbaPropLines'
import { CardTeamLogo } from '../CardTeamLogo'
import { fitImage } from '../fitImage.js'
import { NBA_DVP_POSITIONS } from './positions'
import { pickText } from './nbaTodayPick'
import {
  SORTS, SUMMARY_SEASON, averageMinutes, displaySlot, easternDateKey, filterPlayers, gameText, hitTone,
  isGameDay, playerKey, positionChips, priorTeam, scheduleFromScoreboard, seasonLabel, scheduleFromTeams, sortPlayers, sparkBars,
  teamOptions, todayGame, topPropFor, topProps,
} from './nbaPlayersList.js'
import './nbaPlayersList.css'

const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'
const SKELETON_ROWS = 9
const SEASON_SHORT = `'${SUMMARY_SEASON.slice(2)}`

function statText(value) {
  return value == null || value === '' ? '—' : Number(value).toFixed(1)
}

function positionColor(position) {
  return NBA_DVP_POSITIONS.find((slot) => slot.id === position)?.color || '#9ca3af'
}

function initials(name) {
  return String(name || '').split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function logoSrc(team, width = 40) {
  const url = nbaLogoUrl(team)
  return url ? fitImage(url, width) : ''
}

// ESPN headshot from the roster, as on the dashboard and Edge cards. Initials
// stand in when there is no image or it fails to load.
function PlayerHeadshot({ player, size = 128, className = 'nba-profile-headshot' }) {
  const src = player?.image ? fitImage(player.image, size) : ''
  const [failedSrc, setFailedSrc] = useState('')
  const [loadedSrc, setLoadedSrc] = useState('')
  const color = player?.teamColor || '#1f3f3d'
  const usable = Boolean(src) && src !== failedSrc
  const shown = usable && loadedSrc === src
  // Initials hold the ring until the photo has loaded, so a slow or failed
  // image never leaves it empty.
  return (
    <div className={`${className} nba-headshot-frame`} style={{ borderColor: color }}>
      {!shown && <span>{initials(player?.name)}</span>}
      {usable && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className={shown ? 'is-loaded' : ''}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
        />
      )}
    </div>
  )
}

// Today's scoreboard from ESPN's public feed: opponent and tip time for every
// team, including players with no prop up yet. A failed read is an empty map.
async function fetchSchedule() {
  try {
    const response = await fetch(`${SCOREBOARD_URL}?dates=${easternDateKey()}`)
    if (!response.ok) return new Map()
    return scheduleFromScoreboard(await response.json())
  } catch {
    return new Map()
  }
}

function Spark({ values, line }) {
  const { bars, lineY } = sparkBars(values, line, 16)
  if (!bars.length) return null
  const width = bars.length * 5 - 1
  return (
    <svg className="nba-plist-spark" width={width} height={16} viewBox={`0 0 ${width} 16`} aria-hidden="true">
      {bars.map((bar, index) => (
        <rect key={index} x={index * 5} y={16 - bar.height} width={4} height={bar.height} rx={1} className={bar.hit ? 'hit' : 'miss'} />
      ))}
      {lineY != null && <line x1={0} x2={width} y1={lineY} y2={lineY} className="line" />}
    </svg>
  )
}

function TopPropPill({ top }) {
  if (!top) return null
  const tone = hitTone(top.hitRate)
  const side = top.side === 'OVER' ? 'O' : top.side === 'UNDER' ? 'U' : ''
  return (
    <span className={`nba-plist-prop tone-${tone}`} title={`${top.stat} ${top.line}: L10 ${top.hits ?? '—'}/${top.games ?? '—'} over`}>
      <span className="nba-plist-prop-line">{top.short} {side}{top.line}</span>
      <span className="nba-plist-prop-rate">
        <small>L10</small>
        <b>{top.hitRate == null ? '—' : `${top.hitRate}%`}</b>
      </span>
      <span className="nba-plist-prop-foot">
        <Spark values={top.last5} line={top.line} />
        {pickText(top.projection) && pickText(top.score) && (
          <span className="nba-plist-prop-pick" data-testid="nba-plist-prop-pick">
            {pickText(top.projection)} <small>CG</small> {pickText(top.score)}
          </span>
        )}
      </span>
    </span>
  )
}

// "MIN ↑ 31.2 · USG ↓ 22%": L5 average and the L5 vs season arrow.
// Its own full-width row under the name / prop area, so the prop pill never
// clips it. One "vs '25-26" tag when the arrows use last season.
function CardTrends({ player }) {
  const trends = TREND_METRICS.map((metric) => cardTrend(player, metric)).filter(Boolean)
  if (!trends.length) return null
  const labels = [...new Set(trends.map((item) => item.baselineLabel).filter(Boolean))]
  const shared = labels.length === 1 && trends.every((item) => !item.trend || item.baselineLabel === labels[0]) ? labels[0] : null
  return (
    <span className="nba-plist-trends" data-testid="nba-card-trends">
      {trends.map((item) => (
        <span key={item.id} className={`nba-plist-trend ${item.trend || ''}`}>
          <em>{item.short}</em>
          {item.arrow && <b style={{ color: item.color }}>{item.arrow}</b>}
          {item.text}
          {!shared && item.baselineLabel && <small className="nba-plist-trend-base"> vs {item.baselineLabel}</small>}
        </span>
      ))}
      {shared && <small className="nba-plist-trend-base">vs {shared}</small>}
    </span>
  )
}

function PlayerRow({ player, top, game, minutes, onOpen }) {
  const slot = displaySlot(player)
  const prior = priorTeam(player)
  const label = seasonLabel(player, SEASON_SHORT)
  return (
    <button type="button" className="nba-plist-card" data-testid="nba-player-card" onClick={() => onOpen(player)}>
      <span className="nba-plist-accent" style={{ background: player.teamColor || '#1f3f3d' }} />
      <PlayerHeadshot player={player} size={96} className="nba-plist-headshot" />
      <span className="nba-plist-main">
        <span className="nba-plist-name">{player.name}</span>
        <span className="nba-plist-meta">
          <CardTeamLogo team={player.team} src={logoSrc(player.team)} />
          <span className="nba-plist-team">{player.team}</span>
          {slot && <span className="nba-plist-pos" style={{ color: positionColor(slot) }}>{slot}</span>}
          {game && <span className="nba-plist-game">{gameText(game)}</span>}
          {minutes != null && <span className="nba-plist-min">{minutes.toFixed(1)} MIN</span>}
        </span>
        <span
          className="nba-plist-season"
          aria-label={player.gp
            ? `${SEASON_SHORT}${prior ? ` with ${prior}` : ''}: ${statText(player.pts)} points, ${statText(player.reb)} rebounds, ${statText(player.ast)} assists`
            : `${SEASON_SHORT}: no games`}
        >
          <em>{label}</em>
          {player.gp
            ? <>
                <span className="nba-plist-stat">{statText(player.pts)}<i>P</i></span>{' '}
                <span className="nba-plist-stat">{statText(player.reb)}<i>R</i></span>{' '}
                <span className="nba-plist-stat">{statText(player.ast)}<i>A</i></span>
              </>
            : <>no games</>}
        </span>
      </span>
      <TopPropPill top={top} />
      <CardTrends player={player} />
    </button>
  )
}

function SkeletonRows() {
  return (
    <div className="nba-plist-grid" aria-busy="true" aria-label="Loading players">
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <div key={index} className="nba-plist-card nba-plist-skeleton">
          <span className="nba-plist-headshot sk" />
          <span className="nba-plist-main">
            <span className="sk sk-line" style={{ width: '55%' }} />
            <span className="sk sk-line" style={{ width: '38%' }} />
            <span className="sk sk-line" style={{ width: '70%' }} />
          </span>
          <span className="sk sk-pill" />
        </div>
      ))}
    </div>
  )
}

function TeamPicker({ teams, value, onChange }) {
  const [open, setOpen] = useState(false)
  const choose = (team) => {
    onChange(team)
    setOpen(false)
  }
  return (
    <div className="nba-plist-teampick">
      <button
        type="button"
        className={`nba-plist-control${value !== 'All' ? ' active' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Team"
        onClick={() => setOpen((current) => !current)}
      >
        {value !== 'All' && <CardTeamLogo team={value} src={logoSrc(value)} />}
        <span>{value === 'All' ? 'Teams' : value}</span>
        <span className="caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <>
          <button type="button" className="nba-plist-backdrop" aria-label="Close team picker" onClick={() => setOpen(false)} />
          <div className="nba-plist-teamgrid" role="listbox" aria-label="Teams">
            <button type="button" role="option" aria-selected={value === 'All'} className={value === 'All' ? 'active all' : 'all'} onClick={() => choose('All')}>
              All teams
            </button>
            {teams.map((team) => (
              <button key={team} type="button" role="option" aria-selected={value === team} className={value === team ? 'active' : ''} onClick={() => choose(team)}>
                <CardTeamLogo team={team} src={logoSrc(team, 64)} />
                <span>{team}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function projectionFor(board, player) {
  if (!player || !Array.isArray(board)) return null
  const id = player.athleteId == null ? '' : String(player.athleteId)
  const name = String(player.name || '').trim().toLowerCase()
  return board.find((row) => id && String(row.athleteId ?? row.playerId ?? '') === id)
    || board.find((row) => String(row.name || row.player || '').trim().toLowerCase() === name)
    || null
}

export default function NbaPlayers({ initialName = '' }) {
  const [players, setPlayers] = useState(null)
  const [board, setBoard] = useState([])
  const appliedName = useRef('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [posFilter, setPosFilter] = useState('All')
  const [teamFilter, setTeamFilter] = useState('All')
  const [sortBy, setSortBy] = useState('cg')
  const [playingChoice, setPlayingChoice] = useState(null)
  const [schedule, setSchedule] = useState(() => new Map())
  const [selectedId, setSelectedId] = useState(null)
  const listTop = useRef(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [rows, lines, games, teamRows] = await Promise.all([
          fetchNbaData('nba/players.json'),
          fetchNbaData('nba/projections_standard.json').catch(() => []),
          fetchSchedule(),
          fetchNbaData('nba/teams.json').catch(() => []),
        ])
        if (!cancelled) {
          setPlayers(Array.isArray(rows) ? rows : [])
          setBoard(Array.isArray(lines) ? lines : [])
          setSchedule(games.size ? games : scheduleFromTeams(Array.isArray(teamRows) ? teamRows : []))
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!initialName || !players || appliedName.current === initialName) return
    const match = players.find((player) => player.name === initialName)
    if (!match) return
    appliedName.current = initialName
    setSelectedId(match.athleteId)
  }, [initialName, players])

  // The controls stick under the nav when the nav itself is sticky.
  useEffect(() => {
    const root = listTop.current
    const nav = document.querySelector('.wnba-nav')
    if (!root || !nav) return undefined
    const place = () => {
      const sticky = window.getComputedStyle(nav).position === 'sticky'
      root.style.setProperty('--nba-plist-top', sticky ? `${nav.offsetHeight}px` : '0px')
    }
    place()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(place)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [selectedId])

  const tops = useMemo(() => topProps(board, players || []), [board, players])
  const chips = positionChips()
  const teams = useMemo(() => teamOptions(players), [players])
  const gameDay = isGameDay(schedule, tops)
  const playingToday = playingChoice ?? gameDay
  const activePos = chips.includes(posFilter) ? posFilter : 'All'
  const context = useMemo(() => ({ schedule, tops }), [schedule, tops])

  const matching = useMemo(
    () => filterPlayers(players, { search, position: activePos, team: teamFilter }, context),
    [players, search, activePos, teamFilter, context],
  )
  const filtered = useMemo(() => {
    const list = playingToday ? filterPlayers(matching, { playingToday: true }, context) : matching
    return sortPlayers(list, sortBy, context)
  }, [matching, playingToday, sortBy, context])

  const selected = (players || []).find((player) => player.athleteId === selectedId) || null

  useEffect(() => {
    const name = selected?.name
    const id = selected?.athleteId
    if (!name) return undefined
    let cancelled = false
    fetchNbaSnapshot('nba/players.json', { player: name })
      .then((snapshot) => {
        if (cancelled) return
        const rows = Array.isArray(snapshot.data) ? snapshot.data : []
        const match = rows.find((row) => row.athleteId === id) || rows.find((row) => row.name === name)
        if (!match || !Array.isArray(match.gameLogs)) return
        setPlayers((current) => (current || []).map((player) => (
          player.athleteId === id ? { ...player, gameLogs: match.gameLogs } : player
        )))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selected?.athleteId, selected?.name])

  if (selected) {
    const logs = Array.isArray(selected.gameLogs) ? selected.gameLogs : []
    const color = selected.teamColor || '#94a3b8'
    return (
      <div className="fade-in">
        <button className="btn-ghost" onClick={() => setSelectedId(null)}>← Players</button>
        <div className="nba-profile-head">
          <PlayerHeadshot player={selected} />
          <div className="nba-profile-id">
            <h1>{selected.name}</h1>
            <p style={{ color }}>
              <CardTeamLogo team={selected.team} src={nbaLogoUrl(selected.team) ? fitImage(nbaLogoUrl(selected.team), 40) : ''} />
              <span>
                {selected.teamFull || selected.team}
                {displaySlot(selected) ? ` · ${displaySlot(selected)}` : ' · Position unset'}
              </span>
            </p>
          </div>
        </div>
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <p className="stat-label">
            {SUMMARY_SEASON} regular season{priorTeam(selected) ? ` · with ${priorTeam(selected)}` : ''}
          </p>
          <p style={{ margin: '8px 0 0', color: 'white' }}>
            {selected.gp ? `${selected.gp} GP · ${statText(selected.pts)} PTS · ${statText(selected.reb)} REB · ${statText(selected.ast)} AST` : 'No 2025-26 games yet.'}
          </p>
        </div>
        <NbaPlayerChart player={selected} projection={projectionFor(board, selected)} />
        {logs.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No game log yet.</p>
        ) : (
          <div className="card" style={{ padding: 16, overflowX: 'auto' }}>
            {logs.slice(0, 12).map((game) => (
              <div key={`${game.date}-${game.matchup}`} style={{ display: 'flex', gap: 12, justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #1a1a1a', color: '#d4d4d8', fontSize: 13 }}>
                <span>{game.date}</span>
                <span>{game.team} {game.matchup}</span>
                <span>{game.result}</span>
                <span>{statText(game.pts)} PTS</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const openPlayer = (player) => {
    setSelectedId(player.athleteId)
    window.scrollTo?.(0, 0)
  }
  const hiddenToday = playingToday ? matching.length - filtered.length : 0

  return (
    <div className="fade-in nba-plist" ref={listTop}>
      <div className="nba-plist-head">
        <h1>Players</h1>
        <p>
          {players
            ? `${filtered.length} of ${players.length} players${playingToday ? ' · playing today' : ''}`
            : 'Loading roster...'}
        </p>
      </div>
      <div className="nba-plist-controls">
        <input
          className="nba-plist-search"
          type="search"
          placeholder="Search players"
          aria-label="Search players"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="nba-plist-chips" role="group" aria-label="Position">
          {chips.map((position) => (
            <button
              key={position}
              type="button"
              aria-pressed={activePos === position}
              className={`nba-plist-chip${activePos === position ? ' active' : ''}`}
              style={activePos === position && position !== 'All' ? { borderColor: positionColor(position), color: positionColor(position) } : undefined}
              onClick={() => setPosFilter(position)}
            >
              {position}
            </button>
          ))}
        </div>
        <div className="nba-plist-row">
          <TeamPicker teams={teams} value={teamFilter} onChange={setTeamFilter} />
          <button
            type="button"
            role="switch"
            aria-checked={playingToday}
            className={`nba-plist-control nba-plist-toggle${playingToday ? ' active' : ''}`}
            onClick={() => setPlayingChoice(!playingToday)}
          >
            <span className="knob" aria-hidden="true" />
            Playing today
          </button>
          <label className="nba-plist-control nba-plist-sort">
            <span className="sr-only">Sort by</span>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort by">
              {SORTS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
        </div>
      </div>
      {error && (
        <div className="nba-plist-empty error">Failed to load players: {error}.</div>
      )}
      {loading && <SkeletonRows />}
      {!loading && filtered.length > 0 && (
        <div className="nba-plist-grid">
          {filtered.map((player) => {
            const top = topPropFor(tops, player)
            return (
              <PlayerRow
                key={playerKey(player)}
                player={player}
                top={top}
                game={todayGame(player, schedule, top)}
                minutes={sortBy === 'minutes' ? averageMinutes(player) : null}
                onOpen={openPlayer}
              />
            )
          })}
        </div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <div className="nba-plist-empty">
          {hiddenToday > 0
            ? <>No match is playing today. <button type="button" onClick={() => setPlayingChoice(false)}>Show all {hiddenToday}</button></>
            : 'No players match your filters.'}
        </div>
      )}
      {!loading && filtered.length > 0 && hiddenToday > 0 && (
        <div className="nba-plist-empty">
          {hiddenToday} more not playing today. <button type="button" onClick={() => setPlayingChoice(false)}>Show all</button>
        </div>
      )}
    </div>
  )
}
