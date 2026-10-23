import { useEffect, useMemo, useState } from 'react'
import PlayerOddsTable from '../PlayerOddsTable'
import { AltLinesRow, LinePlot } from '../LineSlider'
import { useChartLine } from '../useChartLine'
import { nflOddsRows } from '../playerOdds'
import { fetchApiDataset } from '../apiData'
import { fetchNflSharpOdds } from './nflData'
import { teamLogoUrl } from './nflTeams'
import { fitImage } from '../fitImage.js'
import { lineResult, nflCurrentSeason, overHitRate } from '../hitRateStrip'
import { formatLineValue, offeredLinesForStat, rateTextColor } from '../lineSlider'
import { lineMatchesStat } from '../cgScore'
import { nflCgScore } from './nflLineFloors'
import { buildCgScoreExplainer } from '../cgScoreExplainer'
import { CgScoreNote } from '../CgScoreExplainer'
import { gameMatchesTeammates, teammateFilterLabel } from './teammateFilters'
import { AdjMatchupStat } from './MatchupDefense'
import { useNflMatchupDefense } from './useNflMatchupDefense'
import { nflSeasonAverage } from './seasonAverage'
import GameDateLogo from '../GameDateLogo'
import PlayerInsights from '../playerInsights/PlayerInsights'
import { useAuth } from '../AuthContext'
import { sportAccess } from '../entitlements'
import { nflInsights } from '../playerInsights/insightsSports'
import NbaRangeSlider from '../nba/NbaRangeSlider'
import { formatMetric } from '../nba/nbaGameFilters'
import NflSnapsUsage from './NflSnapsUsage'
import {
  PENDING, gamePassesRanges, hiddenForMissing, nflGameFilters, nflGameLog, nflTodayPick, nflTrendMetrics, pickText, rangesActive, resolveFilterRanges,
} from './nflPlayerGames.js'
import './nflPlayerParity.css'

// This season's per-game average, or '—' (src/nfl/seasonAverage.js).
function seasonAvgText(row) {
  const season = nflSeasonAverage(row)
  return season ? formatValue(season.average) : '—'
}

const PROP_PRIORITY = ['Pass Yards', 'Pass+Rush Yds', 'Pass Completions', 'Pass Attempts', 'Pass TDs', 'Rush Yards', 'Rush Attempts', 'Rush+Rec Yds', 'Receiving Yards', 'Receptions', 'Rec Targets', 'Touchdowns', 'Interceptions']

const NFL_RANGES = [
  { id: 'season', labelKey: 'season' },
  { id: 'priorSeason', labelKey: 'prior' },
  { id: 'h2h', label: 'H2H' },
  { id: 'l5', label: 'L5' },
  { id: 'l10', label: 'L10' },
  { id: 'l20', label: 'L20' },
  { id: 'l30', label: 'L30' },
]

function nflIndices(row, rangeId, recentLength) {
  const gameSeasons = Array.isArray(row.gameSeasons) ? row.gameSeasons : []
  const gameOpponents = Array.isArray(row.gameOpponents) ? row.gameOpponents : []
  const currentSeason = nflCurrentSeason(row) ?? new Date().getFullYear()
  if (rangeId === 'season') return gameSeasons.map((season, index) => (Number(season) === currentSeason ? index : -1)).filter((index) => index !== -1)
  if (rangeId === 'priorSeason') return gameSeasons.map((season, index) => (Number(season) === currentSeason - 1 ? index : -1)).filter((index) => index !== -1)
  if (rangeId === 'h2h') {
    const opponent = String(row.opponent ?? '').trim().toUpperCase()
    return gameOpponents.map((team, index) => (String(team ?? '').trim().toUpperCase() === opponent ? index : -1)).filter((index) => index !== -1)
  }
  const count = rangeId === 'l5' ? 5 : rangeId === 'l20' ? 20 : rangeId === 'l30' ? 30 : 10
  const size = Math.min(count, recentLength)
  return Array.from({ length: size }, (_, index) => recentLength - size + index)
}

function formatValue(value) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(1)
}

function formatDelta(value) {
  const rounded = Number.isInteger(value) ? value : Number(value.toFixed(1))
  return `${rounded >= 0 ? '+' : ''}${rounded}`
}

function initials(name) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2)
}

// Hide the mark if it fails to load, so its alt text never shows as a broken image.
function TeamLogo({ team, className }) {
  const url = teamLogoUrl(team)
  const src = url ? fitImage(url, 22) : ''
  const [failedSrc, setFailedSrc] = useState('')
  if (!src || src === failedSrc) return null
  return <img className={className} src={src} alt="" aria-hidden="true" loading="lazy" onError={() => setFailedSrc(src)} />
}

function sortProps(rows) {
  return [...rows].sort((a, b) => {
    const ai = PROP_PRIORITY.indexOf(a.prop)
    const bi = PROP_PRIORITY.indexOf(b.prop)
    if (ai === -1 && bi === -1) return a.prop.localeCompare(b.prop)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
}

function TeammateToggle({ teammate, mode, onChange }) {
  return (
    <div className={`nfl-teammate${mode ? ` is-${mode}` : ''}`}>
      <span className="nfl-teammate-name" title={teammate.name}>{teammate.name}</span>
      <div className="nfl-teammate-modes" role="group" aria-label={`${teammate.name} on or off the field`}>
        <button type="button" aria-pressed={mode === 'on'} className={mode === 'on' ? 'active on' : ''} onClick={() => onChange(mode === 'on' ? null : 'on')}>On</button>
        <button type="button" aria-pressed={mode === 'off'} className={mode === 'off' ? 'active off' : ''} onClick={() => onChange(mode === 'off' ? null : 'off')}>Off</button>
      </div>
    </div>
  )
}

// Today's board projection and CG Score beside the PrizePicks line. Both
// show Pending until the board has a projection and a line for this stat.
function TodayPick({ row, pick }) {
  const projection = pickText(pick.projection)
  const cg = pickText(pick.cg)
  const sideClass = pick.side === 'OVER' ? 'is-over' : pick.side === 'UNDER' ? 'is-under' : ''
  return (
    <div className="nfl-pick" data-testid="nfl-player-pick">
      <span className="nfl-pick-line">
        <small>PrizePicks</small>
        <b data-testid="nfl-player-line">{row.line != null ? formatValue(row.line) : PENDING}</b>
        <em>{row.prop}</em>
      </span>
      <span>
        <small>Projection</small>
        <b data-testid="nfl-player-projection" className={projection ? '' : 'is-pending'}>{projection || PENDING}</b>
      </span>
      <span>
        <small>CG Score</small>
        <b data-testid="nfl-player-cg" className={cg ? sideClass : 'is-pending'}>{cg ? `${pick.side ? `${pick.side} ` : ''}${cg}` : (projection ? '—' : PENDING)}</b>
      </span>
    </div>
  )
}

function MatchupLine({ row }) {
  const away = row.awayTeam || null
  const home = row.homeTeam || null
  if (away && home && (row.team === away || row.team === home)) {
    return (
      <p className="nfl-matchup" data-testid="nfl-player-matchup">
        <TeamLogo team={away} className="nfl-matchup-logo" /><span>{away}</span>
        <i>@</i>
        <TeamLogo team={home} className="nfl-matchup-logo" /><span>{home}</span>
      </p>
    )
  }
  return (
    <p className="nfl-matchup" data-testid="nfl-player-matchup">
      <TeamLogo team={row.team} className="nfl-matchup-logo" /><span>{row.team}</span>
      <i>vs</i>
      <TeamLogo team={row.opponent} className="nfl-matchup-logo" /><span>{row.opponent}</span>
    </p>
  )
}

export default function NflPlayerPage({ player, prop, onBack }) {
  const matchupDefense = useNflMatchupDefense()
  const [projections, setProjections] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [selectedProp, setSelectedProp] = useState(prop)
  const [selectedRange, setSelectedRange] = useState('l10')
  const [filterSelections, setFilterSelections] = useState({})
  const [teammateModes, setTeammateModes] = useState({})
  const [oddsRecords, setOddsRecords] = useState(null)
  const [oddsError, setOddsError] = useState(false)

  useEffect(() => {
    let active = true
    fetchApiDataset('nfl_projections', { devStaticPath: 'nfl/projections.json', player })
      .then((snapshot) => { if (!active) return; setProjections(Array.isArray(snapshot.data) ? snapshot.data : []); setLoaded(true) })
      .catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [player])

  useEffect(() => {
    let active = true
    fetchNflSharpOdds()
      .then(({ records }) => { if (active) setOddsRecords(Array.isArray(records) ? records : []) })
      .catch(() => { if (active) { setOddsRecords([]); setOddsError(true) } })
    return () => { active = false }
  }, [])

  const playerRows = useMemo(() => sortProps(projections
    .filter((item) => item.player === player && lineMatchesStat(item.prop, item.line))
    .map((item) => ({ ...item, score: nflCgScore(item.projection, item.line, item.prop) }))), [projections, player])

  const currentRow = useMemo(() => playerRows.find((item) => item.prop === selectedProp) || playerRows[0], [playerRows, selectedProp])
  const oddsRows = useMemo(
    () => nflOddsRows(oddsRecords, player, currentRow?.prop, currentRow?.line),
    [oddsRecords, player, currentRow],
  )
  const oddsStatus = oddsError ? 'error' : oddsRecords == null ? 'loading' : 'ready'

  // Chart filters default to "All" (unfiltered) whenever the player/prop changes, so the chart never starts empty.
  const [seededRowId, setSeededRowId] = useState(null)
  if (currentRow && currentRow.id !== seededRowId) {
    setSeededRowId(currentRow.id)
    setFilterSelections({})
    setTeammateModes({})
  }

  const rowSeason = currentRow ? nflCurrentSeason(currentRow) : null
  const games = useMemo(() => (currentRow ? nflGameLog(currentRow, playerRows, { currentSeason: rowSeason }) : []), [currentRow, playerRows, rowSeason])
  const gameFilters = useMemo(() => nflGameFilters(currentRow, games, { currentSeason: rowSeason }), [currentRow, games, rowSeason])
  const filterRanges = useMemo(() => resolveFilterRanges(gameFilters, filterSelections), [gameFilters, filterSelections])

  const chartInput = useMemo(() => {
    if (!currentRow) {
      return { posted: null, values: [], windowIndices: [], chartIndices: [], chartValues: [], chartDates: [], chartOpponents: [], windows: [], baseCount: 0, offered: null }
    }
    const recent = Array.isArray(currentRow.recent) ? currentRow.recent : []
    const gameDates = Array.isArray(currentRow.gameDates) ? currentRow.gameDates : []
    const gameOpponents = Array.isArray(currentRow.gameOpponents) ? currentRow.gameOpponents : []
    const teammateOn = Array.isArray(currentRow.teammateOn) ? currentRow.teammateOn : []
    const passes = (index) => (
      (!games[index] || gamePassesRanges(games[index], gameFilters, filterRanges))
      && gameMatchesTeammates(teammateOn[index], teammateModes)
    )
    const windows = NFL_RANGES.map((option) => {
      const base = nflIndices(currentRow, option.id, recent.length)
      return { id: option.id, values: base.filter(passes).map((index) => recent[index]), baseCount: base.length }
    })
    const windowIndices = nflIndices(currentRow, selectedRange, recent.length)
    const chartIndices = windowIndices.filter(passes)
    return {
      windowIndices,
      posted: currentRow.line,
      values: chartIndices.map((index) => recent[index]),
      chartIndices,
      chartValues: chartIndices.map((index) => recent[index]),
      chartDates: chartIndices.map((index) => gameDates[index]),
      chartOpponents: chartIndices.map((index) => gameOpponents[index]),
      windows,
      baseCount: windowIndices.length,
      offered: offeredLinesForStat([{ prop: currentRow.prop, line: currentRow.line, altLines: currentRow.altLines || currentRow.alt_lines }], currentRow.prop),
    }
  }, [currentRow, selectedRange, games, gameFilters, filterRanges, teammateModes])

  const slider = useChartLine({
    postedLine: chartInput.posted,
    values: chartInput.values,
    offeredLines: chartInput.offered,
    resetKey: currentRow?.id || '',
  })
  // Splits + Advanced stats: NFL members only.
  const { tier } = useAuth()
  const insightsAllowed = sportAccess(tier).nfl
  const insightsModel = useMemo(() => (insightsAllowed && currentRow
    ? nflInsights(currentRow, playerRows, { currentSeason: nflCurrentSeason(currentRow) })
    : null), [insightsAllowed, currentRow, playerRows])

  if (error) return <div className="nfl-notice">Unable to load player data: {error}</div>
  if (!loaded) return <div className="nfl-notice">Loading player data for {player}.</div>
  if (!playerRows.length) {
    return (
      <div className="nfl-notice">
        No current prop lines for {player}. They may have been pulled from the board, or they are outside your plan&apos;s preview.
        {onBack && <> <button type="button" onClick={onBack}>Back</button></>}
      </div>
    )
  }

  const teammates = (Array.isArray(currentRow.teammates) ? currentRow.teammates : []).filter((item) => item && item.id && item.name)
  // Projection and CG Score: the board row's own values (Pending when blank).
  const pick = nflTodayPick(currentRow)
  const modelDelta = pick.projection != null ? pick.projection - currentRow.line : null
  const currentSeason = nflCurrentSeason(currentRow) ?? new Date().getFullYear()
  const rangeLabels = {
    season: String(currentSeason),
    priorSeason: currentRow.priorSeasonLabel ? String(currentRow.priorSeasonLabel) : '—',
    h2h: 'H2H',
    l5: 'L5',
    l10: 'L10',
    l20: 'L20',
    l30: 'L30',
  }
  const rangeOptions = chartInput.windows.map((option) => {
    const rated = slider.line == null ? null : overHitRate(option.values, slider.line)
    return { ...option, label: rangeLabels[option.id] || option.id, hitRate: rated?.rate ?? null, games: rated?.games ?? 0 }
  })
  const { chartIndices, chartValues, chartDates, chartOpponents, baseCount } = chartInput
  const scaleMax = Math.max(slider.max || 0, 1)
  const chartLine = slider.line ?? currentRow.line
  const chartHit = slider.rate || { hits: 0, games: 0, rate: null }

  const slidersNarrowed = rangesActive(filterRanges)
  const hiddenNotes = hiddenForMissing(chartInput.windowIndices.map((index) => games[index]), gameFilters, filterRanges)
  const clearFilters = () => { setFilterSelections({}); setTeammateModes({}) }
  const setTeammateMode = (id, mode) => {
    setTeammateModes((current) => {
      const next = { ...current }
      if (mode) next[id] = mode
      else delete next[id]
      return next
    })
  }
  const filterLabel = teammateFilterLabel(teammates, teammateModes)
  const rangeLabel = rangeOptions.find((option) => option.id === selectedRange)?.label || 'Games'
  const filtersActive = Boolean(filterLabel) || slidersNarrowed
  const keptGames = filtersActive ? new Set(chartIndices) : null
  const trendMetrics = insightsAllowed ? nflTrendMetrics(currentRow, games) : []
  const sampleShrunk = chartValues.length !== baseCount
  const smallSample = filtersActive && chartHit.games > 0 && chartHit.games < 5
  const hitColor = rateTextColor(chartHit.rate, chartHit.games)

  return (
    <section className="nfl-player-page">
      <button className="nfl-player-back" onClick={onBack}>&larr; Back</button>
      <div className="nfl-player-header">
        <div className="nfl-headshot" data-testid="nfl-player-headshot">
          <div className="nfl-player-avatar">
            {currentRow.imageUrl ? <img className="nfl-player-avatar-photo" src={fitImage(currentRow.imageUrl, 72)} alt={player} width={72} height={72} /> : initials(player)}
          </div>
          <TeamLogo team={currentRow.team} className="nfl-headshot-team" />
        </div>
        <div className="nfl-player-title"><h1>{player}<span>{currentRow.position}</span></h1><MatchupLine row={currentRow} /></div>
        <TodayPick row={currentRow} pick={pick} />
      </div>

      <div className="nfl-player-tabs">
        {playerRows.map((row) => (
          <button key={row.prop} className={row.prop === currentRow.prop ? 'active' : ''} onClick={() => setSelectedProp(row.prop)}>{row.prop}</button>
        ))}
      </div>

      <div className="nfl-player-summary">
        <div className="nfl-player-hitrate" aria-live="polite"><small>HIT RATE</small><strong style={hitColor ? { color: hitColor } : undefined}>{chartHit.rate == null ? '—' : `${chartHit.rate}%`}</strong><span>{chartHit.games ? `(${chartHit.hits}/${chartHit.games}${slider.moved ? ` over ${formatLineValue(slider.line)}` : ''})` : ''}</span></div>
        <div><small>LINE</small><strong>{formatValue(currentRow.line)}</strong></div>
        <div><small>MODEL</small>{modelDelta == null ? <strong className="nfl-pending">{PENDING}</strong> : <><strong>{formatValue(pick.projection)}</strong><span className={modelDelta >= 0 ? 'over' : 'under'}>{formatDelta(modelDelta)}</span></>}</div>
        <div><small>SEASON AVG</small><strong>{seasonAvgText(currentRow)}</strong></div>
        <div><small>DVP RANK</small><strong className={currentRow.dvpRatio >= 1 ? 'over' : 'under'}>{currentRow.dvpRank}<i> /32</i></strong></div>
        <AdjMatchupStat payload={matchupDefense} prop={currentRow.prop} position={currentRow.position} opponent={currentRow.opponent} />
        <div><small>SNAPS</small><strong>{currentRow.snapCount > 0 ? `${currentRow.snapCount}%` : 'N/A'}</strong></div>
        {(currentRow.position === 'WR' || currentRow.position === 'TE') && currentRow.targetsPerGame != null && (
          <div><small>TARGETS/GM</small><strong>{formatValue(currentRow.targetsPerGame)}</strong></div>
        )}
      </div>

      <PlayerInsights model={insightsModel} line={chartLine} statLabel={currentRow.prop}>
      <div className="nfl-player-range-strip">
        {rangeOptions.map((option) => (
          <button
            key={option.id}
            className={selectedRange === option.id ? 'active' : ''}
            disabled={option.hitRate == null}
            onClick={() => setSelectedRange(option.id)}
          >
            <span>{option.label}</span>
            <b style={option.hitRate == null ? undefined : { color: rateTextColor(option.hitRate, option.games) || undefined }}>{option.hitRate == null ? '—' : `${option.hitRate}%`}</b>
          </button>
        ))}
      </div>

      {gameFilters.length > 0 && (
        <div className={`nfl-filters-panel${slidersNarrowed ? ' is-narrowed' : ''}`} aria-label="Game filters" data-testid="nfl-game-filters">
          <div className="nfl-filters-head">
            <span>Filters</span>
            <b>{slidersNarrowed ? `filtered: ${chartIndices.length} of ${baseCount} games` : `all ${baseCount} games`}</b>
            <button type="button" onClick={clearFilters} disabled={!filtersActive}>Reset</button>
          </div>
          {gameFilters.map((filter) => {
            const range = filterRanges[filter.id]
            const hidden = hiddenNotes.find((item) => item.id === filter.id)
            const unitText = filter.unit === '%' ? '%' : filter.unit ? ` ${filter.unit}` : ''
            return (
              <div className="nfl-filter" key={filter.id} data-testid={`nfl-filter-${filter.id}`}>
                <div className="nfl-filter-label">
                  <span>{filter.label}</span>
                  <b>{formatMetric(range.low, filter.step)}–{formatMetric(range.high, filter.step)}{unitText}</b>
                </div>
                <NbaRangeSlider
                  label={filter.label.toLowerCase()}
                  unit={filter.unit}
                  step={filter.step}
                  min={filter.bounds.min}
                  max={filter.bounds.max}
                  low={range.low}
                  high={range.high}
                  onChange={(low, high) => setFilterSelections((prev) => ({ ...prev, [filter.id]: { low, high } }))}
                />
                {hidden && <small className="nfl-filter-hidden" data-testid={`nfl-filter-hidden-${filter.id}`}>{hidden.text}</small>}
              </div>
            )
          })}
          {gameFilters.some((filter) => filter.id === 'dvp') && <small className="nfl-filters-note">Def rank: this season's rank vs this position, 1 = toughest, 32 = easiest. Earlier seasons have no rank.</small>}
        </div>
      )}

      {teammates.length > 0 && (
        <div className="nfl-teammates">
          <div className="nfl-teammates-head">
            <span>Teammates</span>
            <small>On keeps games they played offense. Off keeps games they did not. A game counts only when every choice matches.</small>
          </div>
          <div className="nfl-teammates-list">
            {teammates.map((teammate) => (
              <TeammateToggle
                key={teammate.id}
                teammate={teammate}
                mode={teammateModes[teammate.id] || null}
                onChange={(mode) => setTeammateMode(teammate.id, mode)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="nfl-chart-sample" aria-live="polite">
        <span>{rangeLabel}{filterLabel ? ` · ${filterLabel}` : ''}</span>
        <strong style={hitColor ? { color: hitColor } : undefined}>{chartHit.rate == null ? '—' : `${chartHit.rate}%`}</strong>
        <span>{chartHit.games === 0 ? '0 games' : `${chartHit.hits} of ${chartHit.games} hit`}</span>
        {sampleShrunk && <span>{chartValues.length} of {baseCount} games</span>}
        {smallSample && <em>Small sample</em>}
      </div>

      <LinePlot className="nfl-player-chart" slider={slider} lineClassName="nfl-player-chart-line">
        <div className="nfl-player-bars">
          {chartValues.map((value, index) => {
            const kind = lineResult(value, chartLine) || 'miss'
            return (
              <div className="nfl-player-bar-col" key={`${currentRow.id}-${chartIndices[index]}`}>
                <div className={`nfl-player-bar ${kind}`} style={{ height: `${Math.max(4, ((value ?? 0) / scaleMax) * 100)}%` }}><i>{formatValue(value)}</i></div>
              </div>
            )
          })}
        </div>
        {!chartValues.length && (
          <div className="nfl-notice nfl-player-chart-empty">
            {filterLabel ? 'No games match. Weeks without snap counts are left out.' : 'No games match these filters.'}
          </div>
        )}
      </LinePlot>
      <div className="nfl-player-dates">
        {chartDates.map((date, index) => (
          <span key={`${currentRow.id}-date-${chartIndices[index]}`}>
            <GameDateLogo date={date} team={chartOpponents[index]} logo={teamLogoUrl(chartOpponents[index])} />
          </span>
        ))}
      </div>
      {pick.cg != null && (
        <div className="cg-score-open">
          <CgScoreNote note={buildCgScoreExplainer({
            player,
            projection: pick.projection,
            line: currentRow.line,
            stat: currentRow.prop,
            score: pick.cg,
            recentValues: currentRow.recent,
          })} />
        </div>
      )}
      <AltLinesRow slider={slider} />
      <NflSnapsUsage games={games} windowIndices={chartInput.windowIndices} kept={keptGames} metrics={trendMetrics} currentSeason={currentSeason} />
      </PlayerInsights>
      <PlayerOddsTable key={currentRow.prop} propLabel={currentRow.prop} rows={oddsRows} status={oddsStatus} />
    </section>
  )
}
