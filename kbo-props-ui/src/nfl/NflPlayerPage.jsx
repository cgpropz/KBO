import { useEffect, useMemo, useState } from 'react'
import { fetchNflProjections } from './nflData'
import { teamLogoUrl } from './nflTeams'

const PROP_PRIORITY = ['Pass Yards', 'Pass+Rush Yds', 'Pass Completions', 'Pass Attempts', 'Rush Yards', 'Rush Attempts', 'Rush+Rec Yds', 'Receiving Yards', 'Receptions', 'Rec Targets', 'Touchdowns', 'Interceptions']

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
  const [selectedProp, setSelectedProp] = useState(prop)
  const [selectedRange, setSelectedRange] = useState('l10')
  const [dvpThreshold, setDvpThreshold] = useState(null)
  const [snapThreshold, setSnapThreshold] = useState(null)
  const [usageThreshold, setUsageThreshold] = useState(null)
  const [openFilter, setOpenFilter] = useState(null)

  useEffect(() => {
    let active = true
    fetchNflProjections().then(({ projections: next }) => active && setProjections(next)).catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  const playerRows = useMemo(() => sortProps(projections
    .filter((item) => item.player === player)
    .map((item) => ({ ...item, score: item.line ? (item.projection / item.line) * 50 : 0 }))), [projections, player])

  const currentRow = useMemo(() => playerRows.find((item) => item.prop === selectedProp) || playerRows[0], [playerRows, selectedProp])

  // Chart filters default to "All" (unfiltered) whenever the player/prop changes, so the chart never starts empty.
  const [seededRowId, setSeededRowId] = useState(null)
  if (currentRow && currentRow.id !== seededRowId) {
    setSeededRowId(currentRow.id)
    setDvpThreshold(null)
    setSnapThreshold(null)
    setUsageThreshold(null)
    setOpenFilter(null)
  }

  if (error) return <div className="nfl-notice">Unable to load player data: {error}</div>
  if (!playerRows.length) return <div className="nfl-notice">Loading player data for {player}.</div>

  const recent = Array.isArray(currentRow.recent) ? currentRow.recent : []
  const gameDates = Array.isArray(currentRow.gameDates) ? currentRow.gameDates : []
  const gameOpponents = Array.isArray(currentRow.gameOpponents) ? currentRow.gameOpponents : []
  const recentDvpRanks = Array.isArray(currentRow.recentDvpRanks) ? currentRow.recentDvpRanks : []
  const recentSnapPercents = Array.isArray(currentRow.recentSnapPercents) ? currentRow.recentSnapPercents : []
  const recentUsage = Array.isArray(currentRow.recentUsage) ? currentRow.recentUsage : []
  const usageLabel = currentRow.usageLabel || 'Usage'
  const validSnaps = recentSnapPercents.filter((value) => value != null)
  const validUsage = recentUsage.filter((value) => value != null)
  const defaultDvpThreshold = currentRow.dvpRank ?? 32
  const defaultSnapThreshold = validSnaps.length ? Math.round(average(validSnaps) * 10) / 10 : 0
  const defaultUsageThreshold = validUsage.length ? Math.round(average(validUsage) * 10) / 10 : 0
  const isOver = currentRow.projection >= currentRow.line
  const hits = Math.round((currentRow.hitRate / 100) * currentRow.gamesPlayed)
  const modelDelta = currentRow.projection - currentRow.line

  const rangeOptions = [
    { id: 'season', label: String(new Date().getFullYear()), hitRate: currentRow.seasonHitRate, games: currentRow.seasonGames },
    { id: 'priorSeason', label: currentRow.priorSeasonLabel ? String(currentRow.priorSeasonLabel) : '—', hitRate: currentRow.priorSeasonHitRate, games: currentRow.priorSeasonGames },
    { id: 'h2h', label: 'H2H', hitRate: currentRow.h2hHitRate, games: currentRow.h2hGames },
    { id: 'l5', label: 'L5', hitRate: currentRow.hitRateL5, games: currentRow.gamesL5 },
    { id: 'l10', label: 'L10', hitRate: currentRow.hitRate, games: currentRow.gamesPlayed },
    { id: 'l20', label: 'L20', hitRate: currentRow.hitRateL20, games: currentRow.gamesL20 },
    { id: 'l30', label: 'L30', hitRate: currentRow.hitRateL30, games: currentRow.gamesL30 },
  ]

  // Only L5/L10 actually change the chart window since we only ship each player's last 10 games; wider ranges just report their official hit rate above.
  const windowSize = selectedRange === 'l5' ? Math.min(5, recent.length) : recent.length
  const windowStart = recent.length - windowSize
  const chartIndices = []
  for (let index = windowStart; index < recent.length; index++) {
    const passesDvp = dvpThreshold == null || (recentDvpRanks[index] != null && recentDvpRanks[index] <= dvpThreshold)
    const passesSnap = snapThreshold == null || (recentSnapPercents[index] != null && recentSnapPercents[index] >= snapThreshold)
    const passesUsage = usageThreshold == null || (recentUsage[index] != null && recentUsage[index] >= usageThreshold)
    if (passesDvp && passesSnap && passesUsage) chartIndices.push(index)
  }
  const chartValues = chartIndices.map((index) => recent[index])
  const chartDates = chartIndices.map((index) => gameDates[index])
  const chartOpponents = chartIndices.map((index) => gameOpponents[index])
  const maxValue = Math.max(currentRow.line, ...chartValues, 1)
  const linePct = Math.min(100, (currentRow.line / maxValue) * 100)

  const toggleFilter = (id) => setOpenFilter((current) => (current === id ? null : id))
  const clearFilters = () => { setDvpThreshold(null); setSnapThreshold(null); setUsageThreshold(null); setOpenFilter(null) }

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
        {!chartValues.length && <div className="nfl-notice nfl-player-chart-empty">No games match these filters.</div>}
      </div>
      <div className="nfl-player-dates">
        {chartDates.map((date, index) => (
          <span key={`${currentRow.id}-date-${chartIndices[index]}`}>
            <TeamLogo team={chartOpponents[index]} className="nfl-player-date-logo" />
            {date}
          </span>
        ))}
      </div>
    </section>
  )
}
