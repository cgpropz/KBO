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
  const current = groups.find((group) => group.stat === stat) || groups[0] || null
  const chartInput = useMemo(() => {
    const logs = Array.isArray(player?.gameLogs) ? player.gameLogs : []
    if (!current) return { posted: null, windows: [], games: [], values: [], offered: null }
    const windows = RANGES.map((option) => {
      const games = windowLogs(logs, option.count)
      return {
        id: option.id,
        label: option.label,
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
  }, [current, player, range])
  const slider = useChartLine({
    postedLine: chartInput.posted,
    values: chartInput.values,
    offeredLines: chartInput.offered,
    resetKey: `${player?.athleteId || player?.name || ''}|${current?.stat || ''}`,
  })

  if (!current || slider.line == null) return null

  const chartProp = current.rows.find((prop) => Number(prop.line) === Number(current.posted)) || current.rows[0]
  const chartLogs = Array.isArray(player?.gameLogs) ? player.gameLogs : []
  const scoreNote = buildCgScoreExplainer({
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

  return (
    <section className="nba-player-chart-card card" aria-label="Hit rate chart">
      <div className="nba-player-chart-head">
        <div>
          <p className="stat-label">Hit rate</p>
          <strong style={hitColor ? { color: hitColor } : undefined}>{chartHit.rate == null ? '—' : `${chartHit.rate}%`}</strong>
          <span>{chartHit.games ? `${chartHit.hits}/${chartHit.games}${slider.moved ? ` over ${formatLineValue(chartLine)}` : ''}` : 'No decided games'}</span>
        </div>
        <div>
          <p className="stat-label">PrizePicks line</p>
          <strong>{formatLineValue(slider.postedLine)} {current.stat}</strong>
        </div>
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
        {!chartInput.games.length && <p className="nba-player-chart-empty">No games in this window.</p>}
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
}
