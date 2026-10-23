import { useMemo, useState } from 'react'
import { AltLinesRow, LinePlot } from '../LineSlider'
import { useChartLine } from '../useChartLine'
import { lineResult, overHitRate } from '../hitRateStrip'
import { formatLineValue, offeredLinesForStat, rateTextColor } from '../lineSlider'
import { logsSupport, nbaLogoUrl, opponentFromMatchup, statValue, storedL10Values } from './nbaPropLines'
import GameDateLogo from '../GameDateLogo'
import { boundCg, cgScore } from '../cgScore'
import { buildCgScoreExplainer } from '../cgScoreExplainer'
import { CgScoreNote } from '../CgScoreExplainer'
import NbaRangeSlider from './NbaRangeSlider'
import { GAME_FILTERS, filterGames, formatMetric, isFiltered, metricBounds, newestSeasonLogs, resolveRange } from './nbaGameFilters'
import NbaMinutesUsage from './NbaMinutesUsage'
import { PENDING, pickText, seasonShortLabel, todayPick } from './nbaTodayPick'
import PlayerInsights from '../playerInsights/PlayerInsights'
import { nbaInsights } from '../playerInsights/insightsSports'

const RANGES = [
  { id: 'l5', label: 'L5', count: 5 },
  { id: 'l10', label: 'L10', count: 10 },
  { id: 'l20', label: 'L20', count: 20 },
  { id: 'season', label: 'Season', count: Infinity },
]

const PROP_ORDER = ['Points', 'Rebounds', 'Assists', '3-PT Made', 'Steals', 'Blocks', 'Turnovers', 'Fantasy Score', 'Pts+Rebs+Asts']

function finiteLine(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function postedLineFor(rows) {
  const standard = rows.find((prop) => finiteLine(prop.standardLine) != null && Number(prop.line) === Number(prop.standardLine))
    || rows.find((prop) => finiteLine(prop.standardLine) != null)
    || rows[0]
  return finiteLine(standard?.standardLine ?? standard?.line)
}

function groupProps(player, projection) {
  const logs = Array.isArray(player?.gameLogs) ? player.gameLogs : []
  const grouped = new Map()
  ;(Array.isArray(projection?.ppAllProps) ? projection.ppAllProps : []).forEach((prop) => {
    if (!prop?.stat || !logsSupport(logs, prop.stat)) return
    if (postedLineFor([prop]) == null) return
    if (!grouped.has(prop.stat)) grouped.set(prop.stat, [])
    grouped.get(prop.stat).push(prop)
  })
  return [...grouped.entries()]
    .map(([stat, rows]) => ({ stat, rows, posted: postedLineFor(rows) }))
    .filter((group) => group.posted != null)
    .sort((a, b) => {
      const ai = PROP_ORDER.indexOf(a.stat)
      const bi = PROP_ORDER.indexOf(b.stat)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.stat.localeCompare(b.stat)
    })
}

// Today's board projection and CG Score beside the PrizePicks line. Both
// show Pending until the board has a projection for this stat.
function TodayPick({ pick }) {
  const projection = pickText(pick.projection)
  const cg = pickText(pick.cg)
  const sideClass = pick.side === 'OVER' ? ' is-over' : pick.side === 'UNDER' ? ' is-under' : ''
  return (
    <div className="nba-player-pick" data-testid="nba-player-pick">
      <span>
        <small>Projection</small>
        <b data-testid="nba-player-projection" className={projection ? '' : 'is-pending'}>{projection || PENDING}</b>
      </span>
      <span>
        <small>CG Score</small>
        <b data-testid="nba-player-cg" className={cg ? sideClass.trim() : 'is-pending'}>{cg || (projection ? '—' : PENDING)}</b>
      </span>
    </div>
  )
}

// No chartable line today: the header still says so, with no numbers.
function NoLineToday({ projection }) {
  const prop = (Array.isArray(projection?.ppAllProps) ? projection.ppAllProps : [])
    .find((row) => row?.stat && postedLineFor([row]) != null)
  const posted = prop ? postedLineFor([prop]) : null
  return (
    <section className="nba-player-chart-card card" aria-label="Today's line">
      <div className="nba-player-chart-head">
        <div>
          <p className="stat-label">PrizePicks line</p>
          <strong>{posted == null ? '—' : `${formatLineValue(posted)} ${prop.stat}`}</strong>
          <span>{posted == null ? 'No line today' : 'No game log for this stat yet'}</span>
        </div>
        <TodayPick pick={todayPick(prop, posted, prop?.stat)} />
      </div>
    </section>
  )
}

function windowLogs(logs, count) {
  const slice = Number.isFinite(count) ? logs.slice(0, count) : logs.slice()
  return slice.reverse()
}

function gameOpponent(game) {
  return opponentFromMatchup(game?.matchup || game?.opponent)
}

function formatBar(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return Number.isInteger(number) ? String(number) : number.toFixed(1)
}

export default function NbaPlayerChart({ player, projection }) {
  const groups = useMemo(() => groupProps(player, projection), [player, projection])
  const [stat, setStat] = useState('')
  const [range, setRange] = useState('l10')
  const [selections, setSelections] = useState({})
  const [selectionKey, setSelectionKey] = useState('')
  const playerKey = String(player?.athleteId || player?.name || '')
  if (selectionKey !== playerKey) {
    setSelectionKey(playerKey)
    setSelections({})
  }
  const current = groups.find((group) => group.stat === stat) || groups[0] || null
  const allLogs = useMemo(() => (Array.isArray(player?.gameLogs) ? player.gameLogs : []), [player])
  const filters = useMemo(() => GAME_FILTERS.map((filter) => {
    const bounds = metricBounds(allLogs, filter.field, filter.step)
    return { ...filter, bounds, range: resolveRange(bounds, selections[filter.id], filter.step) }
  }).filter((filter) => filter.bounds), [allLogs, selections])
  const ranges = useMemo(() => Object.fromEntries(filters.map((filter) => [filter.id, filter.range])), [filters])
  const filteredLogs = useMemo(() => filterGames(allLogs, ranges), [allLogs, ranges])
  const narrowed = isFiltered(ranges)
  const chartInput = useMemo(() => {
    const logs = filteredLogs
    if (!current) return { posted: null, windows: [], games: [], values: [], offered: null }
    const windows = RANGES.map((option) => {
      const games = Number.isFinite(option.count)
        ? windowLogs(logs, option.count)
        : windowLogs(newestSeasonLogs(logs, allLogs[0]?.season), option.count)
      return {
        id: option.id,
        label: option.id === 'season' ? seasonShortLabel(allLogs[0]?.season, option.label) : option.label,
        games,
        values: games.map((game) => statValue(game, current.stat)),
      }
    })
    const selected = windows.find((option) => option.id === range) || windows[1]
    return {
      posted: current.posted,
      windows,
      games: selected.games,
      values: selected.values,
      offered: offeredLinesForStat(current.rows, current.stat),
    }
  }, [allLogs, current, filteredLogs, range])
  const slider = useChartLine({
    postedLine: chartInput.posted,
    values: chartInput.values,
    offeredLines: chartInput.offered,
    resetKey: `${player?.athleteId || player?.name || ''}|${current?.stat || ''}`,
  })

  // Splits + Advanced stats, from the same game logs as the chart. NBA player
  // logs only reach full-access viewers (server gate), so there is no extra
  // client check here.
  const insightsModel = useMemo(() => (current && allLogs.length
    ? nbaInsights(allLogs, {
      valueOf: (game) => statValue(game, current.stat),
      opponent: String(current.rows.find((prop) => prop?.opponent)?.opponent || '').trim().toUpperCase() || null,
    })
    : null), [allLogs, current])

  // Minutes & Usage: the same window over every logged game (newest first);
  // games the sliders filter out stay in place, dimmed.
  const muOption = RANGES.find((option) => option.id === range) || RANGES[1]
  const muPool = Number.isFinite(muOption.count) ? allLogs : newestSeasonLogs(allLogs, allLogs[0]?.season)
  const muWindow = Number.isFinite(muOption.count) ? muPool.slice(0, muOption.count) : muPool.slice()
  const minutesUsage = (
    <NbaMinutesUsage logs={allLogs} windowGames={muWindow} keptGames={narrowed ? new Set(filteredLogs) : null} />
  )

  // No line today: the header card says so, and Minutes & Usage still shows.
  if (!current || slider.line == null) {
    return (
      <>
        <NoLineToday projection={projection} />
        {minutesUsage}
      </>
    )
  }

  const chartProp = current.rows.find((prop) => Number(prop.line) === Number(current.posted)) || current.rows[0]
  const chartLogs = Array.isArray(player?.gameLogs) ? player.gameLogs : []
  const pick = todayPick(chartProp, current.posted, current.stat)
  // A blank projection has no CG Score yet, so there is no note to explain.
  const scoreNote = pick.cg == null ? null : buildCgScoreExplainer({
    player: player?.name,
    projection: chartProp?.projection,
    line: current.posted,
    stat: current.stat,
    score: boundCg(cgScore(chartProp?.projection, current.posted, current.stat)),
    recentValues: logsSupport(chartLogs, current.stat)
      ? chartLogs.slice(0, 10).map((game) => statValue(game, current.stat))
      : storedL10Values(chartProp),
    newestFirst: true,
  })
  const scaleMax = Math.max(slider.max || 0, 1)
  const chartLine = slider.line
  const chartHit = slider.rate || { hits: 0, games: 0, rate: null }
  const hitColor = rateTextColor(chartHit.rate, chartHit.games)

  const chartCard = (
    <section className="nba-player-chart-card card" aria-label="Hit rate chart">
      <div className="nba-player-chart-head">
        <div>
          <p className="stat-label">Hit rate</p>
          <strong style={hitColor ? { color: hitColor } : undefined}>{chartHit.rate == null ? '—' : `${chartHit.rate}%`}</strong>
          <span>{chartHit.games ? `${chartHit.hits}/${chartHit.games}${slider.moved ? ` over ${formatLineValue(chartLine)}` : ''}` : 'No decided games'}</span>
        </div>
        <div className="nba-player-line">
          <p className="stat-label">PrizePicks line</p>
          <strong>{formatLineValue(slider.postedLine)} {current.stat}</strong>
        </div>
        <TodayPick pick={pick} />
      </div>
      {groups.length > 1 && (
        <div className="nba-player-props">
          {groups.map((group) => (
            <button key={group.stat} type="button" className={group.stat === current.stat ? 'active' : ''} onClick={() => setStat(group.stat)}>
              {group.stat}
            </button>
          ))}
        </div>
      )}
      <div className="nba-player-ranges">
        {chartInput.windows.map((option) => {
          const rated = overHitRate(option.values, chartLine)
          const tone = rateTextColor(rated?.rate, rated?.games)
          return (
            <button key={option.id} type="button" className={range === option.id ? 'active' : ''} onClick={() => setRange(option.id)}>
              <span>{option.label}</span>
              <b style={tone ? { color: tone } : undefined}>{rated?.rate == null ? '—' : `${rated.rate}%`}</b>
            </button>
          )
        })}
      </div>
      {filters.length > 0 && (
        <div className={`nba-player-filters${narrowed ? ' is-narrowed' : ''}`} aria-label="Game filters">
          <div className="nba-player-filters-head">
            <span>Filters</span>
            <b>{narrowed ? `filtered: ${filteredLogs.length} games` : `all ${allLogs.length} games`}</b>
            <button type="button" onClick={() => setSelections({})} disabled={!narrowed}>Reset</button>
          </div>
          {filters.map((filter) => (
            <div className="nba-player-filter" key={filter.id}>
              <div className="nba-player-filter-label">
                <span>{filter.label}</span>
                <b>{formatMetric(filter.range.low, filter.step)}–{formatMetric(filter.range.high, filter.step)}{filter.unit === '%' ? '%' : ` ${filter.unit}`}</b>
              </div>
              <NbaRangeSlider
                label={filter.label.toLowerCase()}
                unit={filter.unit}
                step={filter.step}
                min={filter.bounds.min}
                max={filter.bounds.max}
                low={filter.range.low}
                high={filter.range.high}
                onChange={(low, high) => setSelections((prev) => ({ ...prev, [filter.id]: { low, high } }))}
              />
            </div>
          ))}
        </div>
      )}
      <LinePlot className="nba-player-chart" slider={slider} lineClassName="nba-player-chart-line">
        <div className="nba-player-bars">
          {chartInput.games.map((game, index) => {
            const value = chartInput.values[index]
            const kind = lineResult(value, chartLine) || 'miss'
            return (
              <div className="nba-player-bar-col" key={`${game.date || index}-${index}`}>
                <div className={`nba-player-bar ${kind}`} style={{ height: `${Math.max(4, ((Number(value) || 0) / scaleMax) * 100)}%` }}>
                  <i>{formatBar(value)}</i>
                </div>
              </div>
            )
          })}
        </div>
        {!chartInput.games.length && <p className="nba-player-chart-empty">{narrowed ? "No games match these filters." : "No games in this window."}</p>}
      </LinePlot>
      <div className="nba-player-dates">
        {chartInput.games.map((game, index) => (
          <span key={`date-${game.date || index}-${index}`}>
            <GameDateLogo date={game.date || game.gameDate} team={gameOpponent(game)} logo={nbaLogoUrl(gameOpponent(game))} />
          </span>
        ))}
      </div>
      <div className="cg-score-open">
        <CgScoreNote note={scoreNote} />
      </div>
      <AltLinesRow slider={slider} />
    </section>
  )
  return (
    <>
      <PlayerInsights model={insightsModel} line={chartLine} statLabel={current.stat}>
        {chartCard}
      </PlayerInsights>
      {minutesUsage}
    </>
  )
}
