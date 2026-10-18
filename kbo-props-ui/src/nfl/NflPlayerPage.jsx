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
import { cgSide, lineMatchesStat } from '../cgScore'
import { nflCgScore } from './nflLineFloors'
import { buildCgScoreExplainer } from '../cgScoreExplainer'
import { CgScoreNote } from '../CgScoreExplainer'
import { gameMatchesTeammates, teammateFilterLabel } from './teammateFilters'
import { AdjMatchupStat } from './MatchupDefense'
import { useNflMatchupDefense } from './useNflMatchupDefense'

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

// 1 = toughest matchup (red) -> 15 = neutral -> 32 = easiest matchup (green)
function dvpColor(rank) {
  if (!rank) return null
  const value = Math.max(1, Math.min(32, rank))
  const [r, g, b] = value <= 15
    ? mixColor(DVP_RED, DVP_NEUTRAL, (value - 1) / 14)
    : mixColor(DVP_NEUTRAL, DVP_GREEN, (value - 15) / 17)
  return `rgb(${r}, ${g}, ${b})`
}

function TeamLogo({ team, className }) {
  const url = teamLogoUrl(team)
  return url ? <img className={className} src={fitImage(url, 22)} alt={team} loading="lazy" /> : null
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

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
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

function ChartFilterChip({ label, valueLabel, valueColor, open, onToggle, children }) {
  return (
    <div className={`nfl-chart-filter-chip${open ? ' open' : ''}`}>
      <button type="button" onClick={onToggle}>
        <span>{label}</span>
        <b style={valueColor ? { color: valueColor } : undefined}>{valueLabel}</b>
      </button>
      {open && <div className="nfl-chart-filter-popover">{children}</div>}
    </div>
  )
}

export default function NflPlayerPage({ player, prop, onBack }) {
  const matchupDefense = useNflMatchupDefense()
  const [projections, setProjections] = useState([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [selectedProp, setSelectedProp] = useState(prop)
  const [selectedRange, setSelectedRange] = useState('l10')
  const [dvpThreshold, setDvpThreshold] = useState(null)
  const [snapThreshold, setSnapThreshold] = useState(null)
  const [usageThreshold, setUsageThreshold] = useState(null)
  const [teammateModes, setTeammateModes] = useState({})
  const [openFilter, setOpenFilter] = useState(null)
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
    .map((item) => ({ ...item, score: nflCgScore(item.projection, item.line, item.prop) ?? 0 }))), [projections, player])

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
    setDvpThreshold(null)
    setSnapThreshold(null)
    setUsageThreshold(null)
    setTeammateModes({})
    setOpenFilter(null)
  }

  const chartInput = useMemo(() => {
    if (!currentRow) {
      return { posted: null, values: [], chartIndices: [], chartValues: [], chartDates: [], chartOpponents: [], windows: [], baseCount: 0, offered: null }
    }
    const recent = Array.isArray(currentRow.recent) ? currentRow.recent : []
    const gameDates = Array.isArray(currentRow.gameDates) ? currentRow.gameDates : []
    const gameOpponents = Array.isArray(currentRow.gameOpponents) ? currentRow.gameOpponents : []
    const recentDvpRanks = Array.isArray(currentRow.recentDvpRanks) ? currentRow.recentDvpRanks : []
    const recentSnapPercents = Array.isArray(currentRow.recentSnapPercents) ? currentRow.recentSnapPercents : []
    const recentUsage = Array.isArray(currentRow.recentUsage) ? currentRow.recentUsage : []
    const teammateOn = Array.isArray(currentRow.teammateOn) ? currentRow.teammateOn : []
    const passes = (index) => {
      const passesDvp = dvpThreshold == null || (recentDvpRanks[index] != null && recentDvpRanks[index] <= dvpThreshold)
      const passesSnap = snapThreshold == null || (recentSnapPercents[index] != null && recentSnapPercents[index] >= snapThreshold)
      const passesUsage = usageThreshold == null || (recentUsage[index] != null && recentUsage[index] >= usageThreshold)
      return passesDvp && passesSnap && passesUsage && gameMatchesTeammates(teammateOn[index], teammateModes)
    }
    const windows = NFL_RANGES.map((option) => {
      const base = nflIndices(currentRow, option.id, recent.length)
      return { id: option.id, values: base.filter(passes).map((index) => recent[index]), baseCount: base.length }
    })
    const chartIndices = nflIndices(currentRow, selectedRange, recent.length).filter(passes)
    return {
      posted: currentRow.line,
      values: chartIndices.map((index) => recent[index]),
      chartIndices,
      chartValues: chartIndices.map((index) => recent[index]),
      chartDates: chartIndices.map((index) => gameDates[index]),
      chartOpponents: chartIndices.map((index) => gameOpponents[index]),
      windows,
      baseCount: nflIndices(currentRow, selectedRange, recent.length).length,
      offered: offeredLinesForStat([{ prop: currentRow.prop, line: currentRow.line, altLines: currentRow.altLines || currentRow.alt_lines }], currentRow.prop),
    }
  }, [currentRow, selectedRange, dvpThreshold, snapThreshold, usageThreshold, teammateModes])

  const slider = useChartLine({
    postedLine: chartInput.posted,
    values: chartInput.values,
    offeredLines: chartInput.offered,
    resetKey: currentRow?.id || '',
  })

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

  const recentSnapPercents = Array.isArray(currentRow.recentSnapPercents) ? currentRow.recentSnapPercents : []
  const recentUsage = Array.isArray(currentRow.recentUsage) ? currentRow.recentUsage : []
  const teammates = (Array.isArray(currentRow.teammates) ? currentRow.teammates : []).filter((item) => item && item.id && item.name)
  const usageLabel = currentRow.usageLabel || 'Usage'
  const validSnaps = recentSnapPercents.filter((value) => value != null)
  const validUsage = recentUsage.filter((value) => value != null)
  const defaultDvpThreshold = currentRow.dvpRank ?? 32
  const defaultSnapThreshold = validSnaps.length ? Math.round(average(validSnaps) * 10) / 10 : 0
  const defaultUsageThreshold = validUsage.length ? Math.round(average(validUsage) * 10) / 10 : 0
  // Side from the CG Score, same as the Edge Board: exactly 50 is no pick.
  const side = cgSide(currentRow.score)
  const sideClass = side === 'OVER' ? 'over' : side === 'UNDER' ? 'under' : 'neutral'
  const modelDelta = currentRow.projection - currentRow.line
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

  const toggleFilter = (id) => setOpenFilter((current) => (current === id ? null : id))
  const clearFilters = () => { setDvpThreshold(null); setSnapThreshold(null); setUsageThreshold(null); setTeammateModes({}); setOpenFilter(null) }
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
  const filtersActive = Boolean(filterLabel) || dvpThreshold != null || snapThreshold != null || usageThreshold != null
  const sampleShrunk = chartValues.length !== baseCount
  const smallSample = filtersActive && chartHit.games > 0 && chartHit.games < 5
  const hitColor = rateTextColor(chartHit.rate, chartHit.games)

  return (
    <section className="nfl-player-page">
      <button className="nfl-player-back" onClick={onBack}>&larr; Back</button>
      <div className="nfl-player-header">
        <div className="nfl-player-avatar">
          {currentRow.imageUrl ? <img className="nfl-player-avatar-photo" src={fitImage(currentRow.imageUrl, 72)} alt={player} width={72} height={72} /> : initials(player)}
        </div>
        <div className="nfl-player-title"><h1>{player}<span>{currentRow.position}</span></h1><p>{currentRow.team} vs {currentRow.opponent}</p></div>
        <div className="nfl-player-prop-pill">
          <TeamLogo team={currentRow.opponent} className="nfl-player-prop-icon" />
          <span>{formatValue(currentRow.line)} {currentRow.prop}</span>
          <b className={sideClass}>{side ? `${side} ` : ''}{currentRow.score.toFixed(1)}</b>
        </div>
      </div>

      <div className="nfl-player-tabs">
        {playerRows.map((row) => (
          <button key={row.prop} className={row.prop === currentRow.prop ? 'active' : ''} onClick={() => setSelectedProp(row.prop)}>{row.prop}</button>
        ))}
      </div>

      <div className="nfl-player-summary">
        <div className="nfl-player-hitrate" aria-live="polite"><small>HIT RATE</small><strong style={hitColor ? { color: hitColor } : undefined}>{chartHit.rate == null ? '—' : `${chartHit.rate}%`}</strong><span>{chartHit.games ? `(${chartHit.hits}/${chartHit.games}${slider.moved ? ` over ${formatLineValue(slider.line)}` : ''})` : ''}</span></div>
        <div><small>LINE</small><strong>{formatValue(currentRow.line)}</strong></div>
        <div><small>MODEL</small><strong>{formatValue(currentRow.projection)}</strong><span className={modelDelta >= 0 ? 'over' : 'under'}>{formatDelta(modelDelta)}</span></div>
        <div><small>SEASON AVG</small><strong>{formatValue(currentRow.seasonAverage)}</strong></div>
        <div><small>DVP RANK</small><strong className={currentRow.dvpRatio >= 1 ? 'over' : 'under'}>{currentRow.dvpRank}<i> /32</i></strong></div>
        <AdjMatchupStat payload={matchupDefense} prop={currentRow.prop} position={currentRow.position} opponent={currentRow.opponent} />
        <div><small>SNAPS</small><strong>{currentRow.snapCount > 0 ? `${currentRow.snapCount}%` : 'N/A'}</strong></div>
        {(currentRow.position === 'WR' || currentRow.position === 'TE') && currentRow.targetsPerGame != null && (
          <div><small>TARGETS/GM</small><strong>{formatValue(currentRow.targetsPerGame)}</strong></div>
        )}
      </div>

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

      <div className="nfl-chart-filters">
        <span className="nfl-chart-filters-label">Chart Filters</span>
        <button className="nfl-chart-filter-clear" onClick={clearFilters}>Clear all</button>
        <ChartFilterChip
          label="Def Rank"
          valueLabel={dvpThreshold == null ? 'All' : ordinal(dvpThreshold)}
          valueColor={dvpThreshold == null ? null : dvpColor(dvpThreshold)}
          open={openFilter === 'dvp'}
          onToggle={() => toggleFilter('dvp')}
        >
          <input type="range" min={1} max={32} step={1} value={dvpThreshold ?? defaultDvpThreshold} onChange={(event) => setDvpThreshold(Number(event.target.value))} />
          <small>Show games vs. defenses ranked {dvpThreshold ?? defaultDvpThreshold} or tougher</small>
        </ChartFilterChip>
        <ChartFilterChip
          label="Snap %"
          valueLabel={snapThreshold == null ? 'All' : `${snapThreshold}`}
          open={openFilter === 'snap'}
          onToggle={() => toggleFilter('snap')}
        >
          <input type="range" min={0} max={100} step={0.5} value={snapThreshold ?? defaultSnapThreshold} onChange={(event) => setSnapThreshold(Number(event.target.value))} />
          <small>Show games with snap share &ge; {snapThreshold ?? defaultSnapThreshold}%</small>
        </ChartFilterChip>
        <ChartFilterChip
          label={usageLabel}
          valueLabel={usageThreshold == null ? 'All' : `${usageThreshold}`}
          open={openFilter === 'usage'}
          onToggle={() => toggleFilter('usage')}
        >
          <input type="range" min={0} max={Math.max(1, Math.ceil(Math.max(...recentUsage, 1)))} step={0.5} value={usageThreshold ?? defaultUsageThreshold} onChange={(event) => setUsageThreshold(Number(event.target.value))} />
          <small>Show games with {usageLabel.toLowerCase()} &ge; {usageThreshold ?? defaultUsageThreshold}</small>
        </ChartFilterChip>
        <button className="nfl-chart-filter-more" title="More filters coming soon" disabled>More</button>
      </div>

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
            <TeamLogo team={chartOpponents[index]} className="nfl-player-date-logo" />
            {date}
          </span>
        ))}
      </div>
      <div className="cg-score-open">
        <CgScoreNote note={buildCgScoreExplainer({
          player,
          projection: currentRow.projection,
          line: currentRow.line,
          stat: currentRow.prop,
          score: currentRow.score,
          recentValues: currentRow.recent,
        })} />
      </div>
      <AltLinesRow slider={slider} />
      <PlayerOddsTable key={currentRow.prop} propLabel={currentRow.prop} rows={oddsRows} status={oddsStatus} />
    </section>
  )
}
