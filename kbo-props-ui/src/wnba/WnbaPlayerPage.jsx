import { useEffect, useMemo, useState } from 'react'
import PlayerOddsTable from '../PlayerOddsTable'
import { AltLinesRow, LinePlot } from '../LineSlider'
import { useChartLine } from '../useChartLine'
import { lineResult, overHitRate } from '../hitRateStrip'
import { formatLineValue, offeredLinesForStat, rateTextColor } from '../lineSlider'
import { rowsFromBookPrices, wnbaOddsRows } from '../playerOdds'
import {
  formatMinutes,
  minutesBounds,
  passesChartFilters,
  recordedMinutes,
  resolveMinutesRange,
} from './chartFilters'
import MinutesRangeSlider from './components/MinutesRangeSlider'
import { fetchWnbaData, fetchWnbaSnapshot } from './wnbaData'
import { wnbaCgScore } from './wnbaScore'
import { buildCgScoreExplainer } from '../cgScoreExplainer'
import { CgScoreNote } from '../CgScoreExplainer'
import { fitImage } from '../fitImage.js'
import { pickSide, sideClass } from '../pickSide.js'
import GameDateLogo from '../GameDateLogo'
import PlayerInsights from '../playerInsights/PlayerInsights'
import { useAuth } from '../AuthContext'
import { sportAccess } from '../entitlements'
import { wnbaInsights } from '../playerInsights/insightsSports'
import { wnbaLogoUrl } from '../slipBoardModel.js'

const PROP_PRIORITY = [
  'Points', 'Rebounds', 'Assists', '3-PT Made', 'Pts+Rebs+Asts', 'Pts+Rebs', 'Pts+Asts', 'Rebs+Asts',
  'Steals', 'Blocks', 'Blks+Stls', 'Turnovers', 'Fantasy Score', 'Double-Double', 'Triple-Double',
]

// Per-game value getters, keyed by the same PrizePicks stat labels used across the WNBA board.
const PROP_GAME_VALUE = {
  Points: g => g.pts ?? 0,
  Rebounds: g => g.reb ?? 0,
  Assists: g => g.ast ?? 0,
  'FG Made': g => g.fgm ?? 0,
  'FG Attempted': g => g.fga ?? 0,
  'Two Pointers Made': g => g.fg2m ?? 0,
  'Two Pointers Attempted': g => g.fg2a ?? 0,
  '3-PT Made': g => g.fg3m ?? 0,
  '3-PT Attempted': g => g.fg3a ?? 0,
  'Free Throws Made': g => g.ftm ?? 0,
  'Free Throws Attempted': g => g.fta ?? 0,
  Steals: g => g.stl ?? 0,
  Blocks: g => g.blk ?? 0,
  'Blocked Shots': g => g.blk ?? 0,
  'Blks+Stls': g => (g.blk ?? 0) + (g.stl ?? 0),
  Turnovers: g => g.tov ?? 0,
  'Offensive Rebounds': g => g.oreb ?? 0,
  'Defensive Rebounds': g => g.dreb ?? 0,
  'Fantasy Score': g => g.fantasy ?? 0,
  'Reb+Asts': g => (g.reb ?? 0) + (g.ast ?? 0),
  'Rebs+Asts': g => (g.reb ?? 0) + (g.ast ?? 0),
  'Pts+Rebs': g => (g.pts ?? 0) + (g.reb ?? 0),
  'Pts+Asts': g => (g.pts ?? 0) + (g.ast ?? 0),
  'Pts+Rebs+Asts': g => (g.pts ?? 0) + (g.reb ?? 0) + (g.ast ?? 0),
  'Double-Double': g => [g.pts, g.reb, g.ast, g.stl, g.blk].filter(v => (v ?? 0) >= 10).length >= 2 ? 1 : 0,
  'Triple-Double': g => [g.pts, g.reb, g.ast, g.stl, g.blk].filter(v => (v ?? 0) >= 10).length >= 3 ? 1 : 0,
}

// Which base DVP columns (from wnba/dvp_<position>.json) feed each prop label's Def Rank.
const DVP_COMBO_STATS = {
  'Pts+Asts': ['pts', 'ast'], 'Pts+Rebs': ['pts', 'reb'], 'Pts+Rebs+Asts': ['pts', 'reb', 'ast'],
  'Reb+Asts': ['reb', 'ast'], 'Rebs+Asts': ['reb', 'ast'], 'Blks+Stls': ['blk', 'stl'],
}
const DVP_SINGLE_STAT = {
  Points: 'pts', Rebounds: 'reb', Assists: 'ast', '3-PT Made': 'fg3m', '3-PT Attempted': 'fg3a',
  Steals: 'stl', Blocks: 'blk', 'Blocked Shots': 'blk', 'FG Made': 'fgm', 'FG Attempted': 'fga',
  'Two Pointers Made': 'fg2m', 'Two Pointers Attempted': 'fg2a', 'Free Throws Made': 'ftm', 'Free Throws Attempted': 'fta',
  Turnovers: 'tov', 'Offensive Rebounds': 'oreb', 'Defensive Rebounds': 'dreb',
}

function dvpStatsForLabel(label) {
  return DVP_COMBO_STATS[label] || (DVP_SINGLE_STAT[label] ? [DVP_SINGLE_STAT[label]] : null)
}

function defRankForGame(label, opponent, position, dvpByPosition) {
  const stats = dvpStatsForLabel(label)
  const table = stats && opponent && position ? dvpByPosition[position]?.[opponent] : null
  if (!table) return null
  const ranks = stats.map(s => table[s]).filter(Number.isFinite)
  return ranks.length ? Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length) : null
}

function sortProps(rows) {
  return [...rows].sort((a, b) => {
    const ai = PROP_PRIORITY.indexOf(a.stat)
    const bi = PROP_PRIORITY.indexOf(b.stat)
    if (ai === -1 && bi === -1) return a.stat.localeCompare(b.stat)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

function formatValue(value) {
  if (value == null || Number.isNaN(value)) return '—'
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1)
}

function formatDelta(value) {
  const rounded = Number.isInteger(value) ? value : Number(value.toFixed(1))
  return `${rounded >= 0 ? '+' : ''}${rounded}`
}

function fmtDate(dateStr) {
  const [m, d] = String(dateStr || '').split('/')
  return m && d ? `${Number(m)}/${Number(d)}` : (dateStr || '')
}

function initials(name) {
  return String(name || '').split(' ').map(part => part[0]).join('').slice(0, 2)
}

function average(values) {
  const valid = (values || []).filter(v => v != null && Number.isFinite(v))
  return valid.length ? valid.reduce((sum, v) => sum + v, 0) / valid.length : null
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

const DVP_RED = [255, 123, 121]
const DVP_NEUTRAL = [120, 145, 138]
const DVP_GREEN = [127, 255, 104]

function mixColor(a, b, t) {
  return a.map((channel, index) => Math.round(channel + (b[index] - channel) * t))
}

// 1 = toughest matchup (red) -> max = easiest matchup (green)
function dvpColor(rank, max) {
  if (!rank || !max || max <= 1) return null
  const value = Math.max(1, Math.min(max, rank))
  const mid = (max + 1) / 2
  const [r, g, b] = value <= mid
    ? mixColor(DVP_RED, DVP_NEUTRAL, (value - 1) / Math.max(1, mid - 1))
    : mixColor(DVP_NEUTRAL, DVP_GREEN, (value - mid) / Math.max(1, max - mid))
  return `rgb(${r}, ${g}, ${b})`
}

const WNBA_RANGES = [
  { id: '2026', label: '2026' },
  { id: '2025', label: '2025' },
  { id: 'h2h', label: 'H2H' },
  { id: 'l5', label: 'L5' },
  { id: 'l10', label: 'L10' },
  { id: 'l20', label: 'L20' },
  { id: 'l30', label: 'L30' },
]

function wnbaRangeRows(games, range, opponent) {
  switch (range) {
    case 'l5': return games.slice(0, 5)
    case 'l10': return games.slice(0, 10)
    case 'l20': return games.slice(0, 20)
    case 'l30': return games.slice(0, 30)
    case '2026': return games.filter((game) => String(game.date).endsWith('2026'))
    case '2025': return games.filter((game) => String(game.date).endsWith('2025'))
    case 'h2h': return opponent ? games.filter((game) => game.opponent === opponent) : []
    default: return games
  }
}

function ChartFilterChip({ label, valueLabel, valueColor, open, onToggle, children }) {
  return (
    <div className={`wnba-chart-filter-chip${open ? ' open' : ''}`}>
      <button type="button" onClick={onToggle}>
        <span>{label}</span>
        <b style={valueColor ? { color: valueColor } : undefined}>{valueLabel}</b>
      </button>
      {open && <div className="wnba-chart-filter-popover">{children}</div>}
    </div>
  )
}

export default function WnbaPlayerPage({ playerName, onBack }) {
  const [players, setPlayers] = useState([])
  const [teams, setTeams] = useState([])
  const [dvpByPosition, setDvpByPosition] = useState({})
  const [error, setError] = useState('')
  const [selectedStat, setSelectedStat] = useState(null)
  const [selectedRange, setSelectedRange] = useState('l10')
  const [dvpThreshold, setDvpThreshold] = useState(null)
  const [minsRange, setMinsRange] = useState(null)
  const [usageThreshold, setUsageThreshold] = useState(null)
  const [openFilter, setOpenFilter] = useState(null)

  useEffect(() => {
    let active = true
    Promise.all([
      fetchWnbaData('wnba/projections_standard.json', { player: playerName }),
      fetchWnbaData('wnba/teams.json').catch(() => []),
      fetchWnbaData('wnba/dvp_guard.json').catch(() => null),
      fetchWnbaData('wnba/dvp_forward.json').catch(() => null),
      fetchWnbaData('wnba/dvp_center.json').catch(() => null),
    ]).then(([proj, teamList, guard, forward, center]) => {
      if (!active) return
      setPlayers(Array.isArray(proj) ? proj : [])
      setTeams(Array.isArray(teamList) ? teamList : [])
      const byPos = {}
      ;[['Guard', guard], ['Forward', forward], ['Center', center]].forEach(([pos, payload]) => {
        if (!payload?.teams) return
        byPos[pos] = Object.fromEntries(payload.teams.map(t => [t.team, t.dvpRanks || {}]))
        byPos[`${pos}__max`] = payload.teams.length
      })
      setDvpByPosition(byPos)
    }).catch(err => active && setError(err.message))
    return () => { active = false }
  }, [playerName])

  const player = useMemo(() => players.find(p => p.name === playerName), [players, playerName])
  const teamColorLookup = useMemo(() => Object.fromEntries(teams.map(t => [t.abbr, t.color])), [teams])

  const propRows = useMemo(() => sortProps(player?.ppAllProps || []), [player])
  const currentProp = useMemo(() => propRows.find(p => p.stat === selectedStat) || propRows[0], [propRows, selectedStat])
  const [oddsRecords, setOddsRecords] = useState(null)
  const [oddsError, setOddsError] = useState(false)

  useEffect(() => {
    let active = true
    fetchWnbaSnapshot('wnba/pp_line_matched_odds.json')
      .then((snapshot) => {
        if (!active) return
        // A free preview is only a few rows and would hide this player's books.
        if (snapshot.preview) {
          setOddsRecords(null)
          setOddsError(true)
          return
        }
        const payload = snapshot.data
        setOddsRecords(Array.isArray(payload?.records) ? payload.records : [])
        setOddsError(false)
      })
      .catch(() => { if (active) { setOddsRecords(null); setOddsError(true) } })
    return () => { active = false }
  }, [])

  // A new player gets a fresh minutes range. The logged minutes differ by player,
  // so a range saved for someone else would hide the wrong games.
  const [seededPlayer, setSeededPlayer] = useState(playerName)
  if (playerName !== seededPlayer) {
    setSeededPlayer(playerName)
    setDvpThreshold(null)
    setMinsRange(null)
    setUsageThreshold(null)
    setOpenFilter(null)
  }

  // Chart filters reset to "All" whenever the selected prop changes.
  const [seededStat, setSeededStat] = useState(null)
  if (currentProp && currentProp.stat !== seededStat) {
    setSeededStat(currentProp.stat)
    setSelectedRange('l10')
    setDvpThreshold(null)
    setMinsRange(null)
    setUsageThreshold(null)
    setOpenFilter(null)
  }

  const chartInput = useMemo(() => {
    if (!player || !currentProp) {
      return { posted: null, values: [], filteredGames: [], windows: [], offered: null, games: [], minuteBounds: null, minutesSelection: null, selectedWindow: [], missingMinutes: 0 }
    }
    const games = (player.recentGames || []).map((game) => ({
      ...game,
      defRank: defRankForGame(currentProp.stat, game.opponent, player.position, dvpByPosition),
    }))
    const getValue = PROP_GAME_VALUE[currentProp.stat]
    const posted = currentProp.line ?? currentProp.standardLine
    const opponent = currentProp.opponent
    const bounds = minutesBounds(games)
    const minutesSelection = resolveMinutesRange(bounds, minsRange)
    const passes = (game) => passesChartFilters(game, {
      filterMinutes: Boolean(bounds),
      minutesLow: minutesSelection?.low,
      minutesHigh: minutesSelection?.high,
      dvpThreshold,
      usageThreshold,
    })
    const windows = WNBA_RANGES.map((option) => ({
      ...option,
      rows: wnbaRangeRows(games, option.id, opponent).filter(passes).map((game) => ({
        ...game,
        value: getValue ? getValue(game) : null,
      })),
    }))
    const selected = windows.find((option) => option.id === selectedRange)
    const filteredGames = [...(selected?.rows || [])].reverse()
    const selectedWindow = wnbaRangeRows(games, selectedRange, opponent)
    return {
      posted,
      values: filteredGames.map((game) => game.value),
      filteredGames,
      windows,
      offered: offeredLinesForStat(player.ppAllProps, currentProp.stat),
      games,
      minuteBounds: bounds,
      minutesSelection,
      selectedWindow,
      missingMinutes: selectedWindow.filter((game) => recordedMinutes(game) == null).length,
    }
  }, [player, currentProp, selectedRange, minsRange, dvpThreshold, usageThreshold, dvpByPosition])

  const slider = useChartLine({
    postedLine: chartInput.posted,
    values: chartInput.values,
    offeredLines: chartInput.offered,
    resetKey: `${player?.name || ''}|${currentProp?.stat || ''}`,
  })

  // Splits + Advanced stats: WNBA members only.
  const { tier } = useAuth()
  const insightsAllowed = sportAccess(tier).wnba
  const insightsModel = useMemo(() => {
    if (!insightsAllowed || !player || !currentProp) return null
    const getGameValue = PROP_GAME_VALUE[currentProp.stat]
    return wnbaInsights(player.recentGames || [], { valueOf: getGameValue || (() => null), opponent: currentProp.opponent || null })
  }, [insightsAllowed, player, currentProp])

  if (error) return <div className="wnba-notice">Unable to load player data: {error}</div>
  if (!players.length) return <div className="wnba-notice">Loading player data for {playerName}.</div>
  if (!player || !propRows.length || !currentProp) {
    return <div className="wnba-notice">No active PrizePicks lines for {playerName}.</div>
  }

  const games = chartInput.games
  const getValue = PROP_GAME_VALUE[currentProp.stat]
  const line = currentProp.line ?? currentProp.standardLine
  const { minuteBounds, minutesSelection, selectedWindow, filteredGames, missingMinutes } = chartInput
  const oddsRows = oddsRecords
    ? wnbaOddsRows(oddsRecords, player.name, currentProp.stat, line)
    : rowsFromBookPrices(currentProp.bookPrices, line)
  const oddsStatus = !oddsRecords && !oddsError && !currentProp.bookPrices ? 'loading' : 'ready'
  const opponentToday = currentProp.opponent
  const dvpMax = dvpByPosition[`${player.position}__max`] || 15
  const hasDvpData = !!dvpByPosition[player.position]
  const rangeOptions = chartInput.windows.map((option) => {
    const rated = slider.line == null ? null : overHitRate(option.rows.map((game) => game.value), slider.line)
    return { ...option, pct: rated?.rate ?? null, hits: rated?.hits ?? 0, games: rated?.games ?? 0 }
  })
  const currentRange = rangeOptions.find((option) => option.id === selectedRange)
  const validUsage = selectedWindow.map((game) => game.usagePct).filter((value) => value != null && Number.isFinite(Number(value)))
  const defaultDvpThreshold = currentProp.effectiveDvpFactor ?? Math.round(dvpMax / 2)
  const defaultUsageThreshold = validUsage.length ? Math.round(average(validUsage) * 10) / 10 : 0
  const scaleMax = Math.max(slider.max || 0, 1)
  const chartLine = slider.line ?? line
  const hitColor = rateTextColor(currentRange?.pct, currentRange?.games)
  // Exactly on the line, or a rating of exactly 50, is no pick: no side, no color.
  const side = pickSide(currentProp.projection, line, currentProp.rating)
  const modelDelta = currentProp.projection != null && line != null ? currentProp.projection - line : null

  const seasonAvg = getValue
    ? average(games.filter(g => String(g.date).endsWith('2026')).map(getValue))
    : null
  const expMinutes = player.avgMins
  const usageAvg = average(games.slice(0, 10).map(g => g.usagePct))

  const toggleFilter = id => setOpenFilter(current => (current === id ? null : id))
  const clearFilters = () => { setDvpThreshold(null); setMinsRange(null); setUsageThreshold(null); setOpenFilter(null) }
  const minutesLow = minutesSelection?.low
  const minutesHigh = minutesSelection?.high
  const minutesNarrowed = Boolean(minutesSelection && !minutesSelection.full)
  const setMinutesRange = (low, high) => {
    if (!minuteBounds || (low <= minuteBounds.min && high >= minuteBounds.max)) setMinsRange(null)
    else setMinsRange({ low, high })
  }

  return (
    <div className="wnba-propboard">
      <section className="wnba-player-page">
        <button className="wnba-player-back" onClick={onBack}>&larr; Back</button>
        <div className="wnba-player-header">
          <div className="wnba-player-avatar">
            {player.image ? <img className="wnba-player-avatar-photo" src={fitImage(player.image, 68)} alt={player.name} width={68} height={68} /> : initials(player.name)}
          </div>
          <div className="wnba-player-title">
            <h1>{player.name}<span>{player.position}</span></h1>
            <p>{player.team} vs {opponentToday || '—'}</p>
          </div>
          <div className="wnba-player-prop-pill">
            <span>{formatValue(line)} {currentProp.stat}</span>
            {currentProp.rating != null && (
              <b className={sideClass(side)}>{side ? `${side} ` : ''}{currentProp.rating.toFixed(1)}</b>
            )}
          </div>
        </div>

        <div className="wnba-player-tabs">
          {propRows.map(row => (
            <button key={row.stat} className={row.stat === currentProp.stat ? 'active' : ''} onClick={() => setSelectedStat(row.stat)}>{row.stat}</button>
          ))}
        </div>

        <div className="wnba-player-summary">
          <div className="wnba-player-hitrate" aria-live="polite">
            <small>HIT RATE</small>
            <strong style={hitColor ? { color: hitColor } : undefined}>{currentRange?.pct != null ? `${currentRange.pct}%` : '—'}</strong>
            <span>{currentRange?.games ? `(${currentRange.hits}/${currentRange.games}${slider.moved ? ` over ${formatLineValue(slider.line)}` : ''})` : ''}</span>
          </div>
          <div><small>LINE</small><strong>{formatValue(line)}</strong></div>
          <div>
            <small>MODEL</small>
            <strong>{formatValue(currentProp.projection)}</strong>
            {modelDelta != null && <span className={modelDelta >= 0 ? 'over' : 'under'}>{formatDelta(modelDelta)}</span>}
          </div>
          <div><small>SEASON AVG</small><strong>{formatValue(seasonAvg)}</strong></div>
          <div>
            <small>DVP RANK</small>
            <strong className={currentProp.effectiveDvpFactor != null && currentProp.effectiveDvpFactor >= Math.round(dvpMax / 2) ? 'over' : 'under'}>
              {currentProp.effectiveDvpFactor ?? '—'}<i> /{dvpMax}</i>
            </strong>
          </div>
          <div><small>EXP MINUTES</small><strong>{expMinutes != null ? formatValue(expMinutes) : 'N/A'}</strong></div>
          <div><small>USAGE %</small><strong>{usageAvg != null ? `${usageAvg.toFixed(1)}%` : 'N/A'}</strong></div>
        </div>

        <PlayerInsights model={insightsModel} line={chartLine} statLabel={currentProp.stat}>
        <div className="wnba-player-range-strip">
          {rangeOptions.map(option => (
            <button
              key={option.id}
              className={selectedRange === option.id ? 'active' : ''}
              disabled={option.pct == null}
              onClick={() => setSelectedRange(option.id)}
            >
              <span>{option.label}</span>
              <b style={option.pct == null ? undefined : { color: rateTextColor(option.pct, option.games) || undefined }}>{option.pct == null ? '—' : `${option.pct}%`}</b>
            </button>
          ))}
        </div>

        <div className="wnba-chart-filters">
          <span className="wnba-chart-filters-label">Chart Filters</span>
          <button className="wnba-chart-filter-clear" onClick={clearFilters}>Clear all</button>
          {hasDvpData && (
            <ChartFilterChip
              label="Def Rank"
              valueLabel={dvpThreshold == null ? 'All' : ordinal(dvpThreshold)}
              valueColor={dvpThreshold == null ? null : dvpColor(dvpThreshold, dvpMax)}
              open={openFilter === 'dvp'}
              onToggle={() => toggleFilter('dvp')}
            >
              <input type="range" min={1} max={dvpMax} step={1} value={dvpThreshold ?? defaultDvpThreshold} onChange={event => setDvpThreshold(Number(event.target.value))} />
              <small>Show games vs. defenses ranked {dvpThreshold ?? defaultDvpThreshold} or tougher</small>
            </ChartFilterChip>
          )}
          <ChartFilterChip
            label="Usage %"
            valueLabel={usageThreshold == null ? 'All' : `${usageThreshold}`}
            open={openFilter === 'usage'}
            onToggle={() => toggleFilter('usage')}
          >
            <input type="range" min={0} max={Math.max(1, Math.ceil(Math.max(...validUsage, 1)))} step={0.5} value={usageThreshold ?? defaultUsageThreshold} onChange={event => setUsageThreshold(Number(event.target.value))} />
            <small>Show games with usage % &ge; {usageThreshold ?? defaultUsageThreshold}</small>
          </ChartFilterChip>
          <button className="wnba-chart-filter-more" title="More filters coming soon" disabled>More</button>
        </div>

        <div className={`wnba-minutes-filter${minutesNarrowed ? ' is-narrowed' : ''}`}>
          <div className="wnba-minutes-filter-head">
            <span>Minutes played</span>
            {minuteBounds ? (
              <b aria-live="polite">
                {formatMinutes(minutesLow)}–{formatMinutes(minutesHigh)} min · {filteredGames.length} of {selectedWindow.length} {currentRange?.label || ''} games
              </b>
            ) : (
              <b>No minutes in this log</b>
            )}
          </div>
          {minuteBounds && minuteBounds.max > minuteBounds.min ? (
            <>
              <MinutesRangeSlider
                min={minuteBounds.min}
                max={minuteBounds.max}
                low={minutesLow}
                high={minutesHigh}
                onChange={setMinutesRange}
              />
              <div className="wnba-minutes-scale">
                <span>{formatMinutes(minuteBounds.min)}</span>
                <span>{formatMinutes(minuteBounds.max)}</span>
              </div>
            </>
          ) : minuteBounds ? (
            <p className="wnba-minutes-note">Every logged game is {formatMinutes(minuteBounds.min)} minutes, so the range stays put.</p>
          ) : (
            <p className="wnba-minutes-note">Minutes are not in this game log, so the chart still shows every game.</p>
          )}
          {missingMinutes > 0 && (
            <p className="wnba-minutes-missing">
              {missingMinutes === 1
                ? '1 game has no minutes recorded, so it is left off the chart and out of the hit rates.'
                : `${missingMinutes} games have no minutes recorded, so they are left off the chart and out of the hit rates.`}
            </p>
          )}
        </div>

        <LinePlot className="wnba-player-chart" slider={slider} lineClassName="wnba-player-chart-line">
          <div className="wnba-player-bars">
            {filteredGames.map((g, index) => {
              const kind = lineResult(g.value, chartLine) || 'miss'
              return (
                <div className="wnba-player-bar-col" key={`${currentProp.stat}-${g.date}-${index}`} title={[recordedMinutes(g) == null ? 'No minutes recorded' : `${formatMinutes(recordedMinutes(g))} min`, fmtDate(g.date), g.postseason ? 'Playoffs' : null].filter(Boolean).join(' · ')}>
                  <div className={`wnba-player-bar ${kind}${g.postseason ? ' postseason' : ''}`} style={{ height: `${Math.max(4, ((g.value ?? 0) / scaleMax) * 100)}%` }}><i>{formatValue(g.value)}</i></div>
                </div>
              )
            })}
          </div>
          {!filteredGames.length && <div className="wnba-notice wnba-player-chart-empty">No games match these filters.</div>}
        </LinePlot>
        <div className="wnba-player-dates">
          {filteredGames.map((g, index) => (
            <span key={`date-${g.date}-${index}`}>
              <GameDateLogo
                date={g.date}
                team={g.opponent}
                logo={wnbaLogoUrl(g.opponent)}
                color={teamColorLookup[g.opponent]}
                extra={g.postseason ? <em className="wnba-player-date-po" title="Playoff game">PO</em> : null}
              />
            </span>
          ))}
        </div>
        <div className="cg-score-open">
          <CgScoreNote note={buildCgScoreExplainer({
            player: player.name,
            projection: currentProp.projection,
            line,
            stat: currentProp.stat,
            score: wnbaCgScore(currentProp.projection, currentProp),
            recentValues: (player.recentGames || []).slice(0, 10).map((game) => PROP_GAME_VALUE[currentProp.stat]?.(game)),
            newestFirst: true,
          })} />
        </div>
        <AltLinesRow slider={slider} />
        </PlayerInsights>
        <PlayerOddsTable key={currentProp.stat} propLabel={currentProp.stat} rows={oddsRows} status={oddsStatus} />
      </section>
    </div>
  )
}
