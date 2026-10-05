import { useEffect, useMemo, useState } from 'react'
import PlayerOddsTable from '../PlayerOddsTable'
import { nflOddsRows } from '../playerOdds'
import { fetchNflProjections, fetchNflSharpOdds } from './nflData'
import { teamLogoUrl } from './nflTeams'
import { gameMatchesTeammates, hitRateForValues, teammateFilterLabel } from './teammateFilters'

const PROP_PRIORITY = ['Pass Yards', 'Pass+Rush Yds', 'Pass Completions', 'Pass Attempts', 'Pass TDs', 'Rush Yards', 'Rush Attempts', 'Rush+Rec Yds', 'Receiving Yards', 'Receptions', 'Rec Targets', 'Touchdowns', 'Interceptions']

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
  return url ? <img className={className} src={url} alt={team} loading="lazy" /> : null
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
    fetchNflProjections()
      .then(({ projections: next }) => { if (!active) return; setProjections(next); setLoaded(true) })
      .catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    fetchNflSharpOdds()
      .then(({ records }) => { if (active) setOddsRecords(Array.isArray(records) ? records : []) })
      .catch(() => { if (active) { setOddsRecords([]); setOddsError(true) } })
    return () => { active = false }
  }, [])

  const playerRows = useMemo(() => sortProps(projections
    .filter((item) => item.player === player)
    .map((item) => ({ ...item, score: item.line ? (item.projection / item.line) * 50 : 0 }))), [projections, player])

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

  const recent = Array.isArray(currentRow.recent) ? currentRow.recent : []
  const gameDates = Array.isArray(currentRow.gameDates) ? currentRow.gameDates : []
  const gameOpponents = Array.isArray(currentRow.gameOpponents) ? currentRow.gameOpponents : []
  const gameSeasons = Array.isArray(currentRow.gameSeasons) ? currentRow.gameSeasons : []
  const recentDvpRanks = Array.isArray(currentRow.recentDvpRanks) ? currentRow.recentDvpRanks : []
  const recentSnapPercents = Array.isArray(currentRow.recentSnapPercents) ? currentRow.recentSnapPercents : []
  const recentUsage = Array.isArray(currentRow.recentUsage) ? currentRow.recentUsage : []
  const teammates = (Array.isArray(currentRow.teammates) ? currentRow.teammates : []).filter((item) => item && item.id && item.name)
  const teammateOn = Array.isArray(currentRow.teammateOn) ? currentRow.teammateOn : []
  const usageLabel = currentRow.usageLabel || 'Usage'
  const validSnaps = recentSnapPercents.filter((value) => value != null)
  const validUsage = recentUsage.filter((value) => value != null)
  const defaultDvpThreshold = currentRow.dvpRank ?? 32
  const defaultSnapThreshold = validSnaps.length ? Math.round(average(validSnaps) * 10) / 10 : 0
  const defaultUsageThreshold = validUsage.length ? Math.round(average(validUsage) * 10) / 10 : 0
  const isOver = currentRow.projection >= currentRow.line
  const hits = Math.round((currentRow.hitRate / 100) * currentRow.gamesPlayed)
  const modelDelta = currentRow.projection - currentRow.line
  const currentSeason = currentRow.priorSeasonLabel != null ? currentRow.priorSeasonLabel + 1 : new Date().getFullYear()

  const rangeOptions = [
    { id: 'season', label: String(currentSeason), hitRate: currentRow.seasonHitRate, games: currentRow.seasonGames },
    { id: 'priorSeason', label: currentRow.priorSeasonLabel ? String(currentRow.priorSeasonLabel) : '—', hitRate: currentRow.priorSeasonHitRate, games: currentRow.priorSeasonGames },
    { id: 'h2h', label: 'H2H', hitRate: currentRow.h2hHitRate, games: currentRow.h2hGames },
    { id: 'l5', label: 'L5', hitRate: currentRow.hitRateL5, games: currentRow.gamesL5 },
    { id: 'l10', label: 'L10', hitRate: currentRow.hitRate, games: currentRow.gamesPlayed },
    { id: 'l20', label: 'L20', hitRate: currentRow.hitRateL20, games: currentRow.gamesL20 },
    { id: 'l30', label: 'L30', hitRate: currentRow.hitRateL30, games: currentRow.gamesL30 },
  ]

  // Base indices for the selected range: season/prior season/H2H filter by game metadata, L5-L30 slice the trailing window.
  let baseIndices
  if (selectedRange === 'season') {
    baseIndices = gameSeasons.map((season, index) => (season === currentSeason ? index : -1)).filter((index) => index !== -1)
  } else if (selectedRange === 'priorSeason') {
    baseIndices = gameSeasons.map((season, index) => (season === currentSeason - 1 ? index : -1)).filter((index) => index !== -1)
  } else if (selectedRange === 'h2h') {
    baseIndices = gameOpponents.map((opponent, index) => (opponent === currentRow.opponent ? index : -1)).filter((index) => index !== -1)
  } else {
    const count = selectedRange === 'l5' ? 5 : selectedRange === 'l20' ? 20 : selectedRange === 'l30' ? 30 : 10
    const size = Math.min(count, recent.length)
    baseIndices = Array.from({ length: size }, (_, i) => recent.length - size + i)
  }
  const chartIndices = baseIndices.filter((index) => {
    const passesDvp = dvpThreshold == null || (recentDvpRanks[index] != null && recentDvpRanks[index] <= dvpThreshold)
    const passesSnap = snapThreshold == null || (recentSnapPercents[index] != null && recentSnapPercents[index] >= snapThreshold)
    const passesUsage = usageThreshold == null || (recentUsage[index] != null && recentUsage[index] >= usageThreshold)
    const passesTeammates = gameMatchesTeammates(teammateOn[index], teammateModes)
    return passesDvp && passesSnap && passesUsage && passesTeammates
  })
  const chartValues = chartIndices.map((index) => recent[index])
  const chartDates = chartIndices.map((index) => gameDates[index])
  const chartOpponents = chartIndices.map((index) => gameOpponents[index])
  const maxValue = Math.max(currentRow.line, ...chartValues, 1)
  const linePct = Math.min(100, (currentRow.line / maxValue) * 100)

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
  const chartHit = hitRateForValues(chartValues, currentRow.line)
  const rangeLabel = rangeOptions.find((option) => option.id === selectedRange)?.label || 'Games'
  const filtersActive = Boolean(filterLabel) || dvpThreshold != null || snapThreshold != null || usageThreshold != null
  const sampleShrunk = chartValues.length !== baseIndices.length
  const smallSample = filtersActive && chartHit.games > 0 && chartHit.games < 5

  return (
    <section className="nfl-player-page">
      <button className="nfl-player-back" onClick={onBack}>&larr; Back</button>
      <div className="nfl-player-header">
        <div className="nfl-player-avatar">
          {currentRow.imageUrl ? <img className="nfl-player-avatar-photo" src={currentRow.imageUrl} alt={player} loading="lazy" /> : initials(player)}
        </div>
        <div className="nfl-player-title"><h1>{player}<span>{currentRow.position}</span></h1><p>{currentRow.team} vs {currentRow.opponent}</p></div>
        <div className="nfl-player-prop-pill">
          <TeamLogo team={currentRow.opponent} className="nfl-player-prop-icon" />
          <span>{formatValue(currentRow.line)} {currentRow.prop}</span>
          <b className={isOver ? 'over' : 'under'}>{isOver ? 'OVER' : 'UNDER'} {currentRow.score.toFixed(1)}</b>
        </div>
      </div>

      <div className="nfl-player-tabs">
        {playerRows.map((row) => (
          <button key={row.prop} className={row.prop === currentRow.prop ? 'active' : ''} onClick={() => setSelectedProp(row.prop)}>{row.prop}</button>
        ))}
      </div>

      <div className="nfl-player-summary">
        <div className="nfl-player-hitrate"><small>HIT RATE</small><strong className={hits / currentRow.gamesPlayed >= 0.5 ? 'over' : 'under'}>{currentRow.hitRate}%</strong><span>({hits}/{currentRow.gamesPlayed})</span></div>
        <div><small>LINE</small><strong>{formatValue(currentRow.line)}</strong></div>
        <div><small>MODEL</small><strong>{formatValue(currentRow.projection)}</strong><span className={modelDelta >= 0 ? 'over' : 'under'}>{formatDelta(modelDelta)}</span></div>
        <div><small>SEASON AVG</small><strong>{formatValue(currentRow.seasonAverage)}</strong></div>
        <div><small>DVP RANK</small><strong className={currentRow.dvpRatio >= 1 ? 'over' : 'under'}>{currentRow.dvpRank}<i> /32</i></strong></div>
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
            <b className={option.hitRate == null ? '' : option.hitRate >= 50 ? 'over' : 'under'}>{option.hitRate == null ? '—' : `${option.hitRate}%`}</b>
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
        <strong className={chartHit.rate == null ? '' : chartHit.rate >= 50 ? 'over' : 'under'}>{chartHit.rate == null ? '—' : `${chartHit.rate}%`}</strong>
        <span>{chartHit.games === 0 ? '0 games' : `${chartHit.hits} of ${chartHit.games} hit`}</span>
        {sampleShrunk && <span>{chartHit.games} of {baseIndices.length} games</span>}
        {smallSample && <em>Small sample</em>}
      </div>

      <div className="nfl-player-chart">
        <div className="nfl-player-chart-line" style={{ bottom: `${linePct}%` }}><span>{formatValue(currentRow.line)}</span></div>
        <div className="nfl-player-bars">
          {chartValues.map((value, index) => {
            const hit = value >= currentRow.line
            return (
              <div className="nfl-player-bar-col" key={`${currentRow.id}-${chartIndices[index]}`}>
                <div className={`nfl-player-bar ${hit ? 'hit' : 'miss'}`} style={{ height: `${Math.max(4, (value / maxValue) * 100)}%` }}><i>{formatValue(value)}</i></div>
              </div>
            )
          })}
        </div>
        {!chartValues.length && (
          <div className="nfl-notice nfl-player-chart-empty">
            {filterLabel ? 'No games match. Weeks without snap counts are left out.' : 'No games match these filters.'}
          </div>
        )}
      </div>
      <div className="nfl-player-dates">
        {chartDates.map((date, index) => (
          <span key={`${currentRow.id}-date-${chartIndices[index]}`}>
            <TeamLogo team={chartOpponents[index]} className="nfl-player-date-logo" />
            {date}
          </span>
        ))}
      </div>
      <PlayerOddsTable key={currentRow.prop} propLabel={currentRow.prop} rows={oddsRows} status={oddsStatus} />
    </section>
  )
}
