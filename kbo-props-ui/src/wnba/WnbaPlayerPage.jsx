import { useEffect, useMemo, useState } from 'react'
import PlayerOddsTable from '../PlayerOddsTable'
import { rowsFromBookPrices, wnbaOddsRows } from '../playerOdds'
import { fetchWnbaData, fetchWnbaSnapshot } from './wnbaData'

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
  const [minsThreshold, setMinsThreshold] = useState(null)
  const [usageThreshold, setUsageThreshold] = useState(null)
  const [openFilter, setOpenFilter] = useState(null)

  useEffect(() => {
    let active = true
    Promise.all([
      fetchWnbaData('wnba/projections_standard.json'),
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
  }, [])

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

  // Chart filters reset to "All" whenever the selected prop changes.
  const [seededStat, setSeededStat] = useState(null)
  if (currentProp && currentProp.stat !== seededStat) {
    setSeededStat(currentProp.stat)
    setSelectedRange('l10')
    setDvpThreshold(null)
    setMinsThreshold(null)
    setUsageThreshold(null)
    setOpenFilter(null)
  }

  if (error) return <div className="wnba-notice">Unable to load player data: {error}</div>
  if (!players.length) return <div className="wnba-notice">Loading player data for {playerName}.</div>
  if (!player || !propRows.length || !currentProp) {
    return <div className="wnba-notice">No active PrizePicks lines for {playerName}.</div>
  }

  const games = player.recentGames || []
  const getValue = PROP_GAME_VALUE[currentProp.stat]
  const line = currentProp.standardLine ?? currentProp.line
  const oddsRows = oddsRecords
    ? wnbaOddsRows(oddsRecords, player.name, currentProp.stat, line)
    : rowsFromBookPrices(currentProp.bookPrices, line)
  const oddsStatus = !oddsRecords && !oddsError && !currentProp.bookPrices ? 'loading' : 'ready'
  const opponentToday = currentProp.opponent
  const dvpMax = dvpByPosition[`${player.position}__max`] || 15
  const hasDvpData = !!dvpByPosition[player.position]

  const rangeGames = range => {
    switch (range) {
      case 'l5': return games.slice(0, 5)
      case 'l10': return games.slice(0, 10)
      case 'l20': return games.slice(0, 20)
      case 'l30': return games.slice(0, 30)
      case '2026': return games.filter(g => String(g.date).endsWith('2026'))
      case '2025': return games.filter(g => String(g.date).endsWith('2025'))
      case 'h2h': return opponentToday ? games.filter(g => g.opponent === opponentToday) : []
      default: return games
    }
  }

  const hitRateFor = range => {
    if (!getValue || line == null) return { pct: null, games: 0 }
    const values = rangeGames(range).map(getValue).filter(v => v != null)
    if (!values.length) return { pct: null, games: 0 }
    const hits = values.filter(v => v > line).length
    return { pct: Math.round((hits / values.length) * 100), games: values.length }
  }

  const rangeOptions = [
    { id: '2026', label: '2026' },
    { id: '2025', label: '2025' },
    { id: 'h2h', label: 'H2H' },
    { id: 'l5', label: 'L5' },
    { id: 'l10', label: 'L10' },
    { id: 'l20', label: 'L20' },
    { id: 'l30', label: 'L30' },
  ].map(opt => ({ ...opt, ...hitRateFor(opt.id) }))
  const currentRange = rangeOptions.find(r => r.id === selectedRange)

  const gamesWithMeta = rangeGames(selectedRange).map(g => ({
    ...g,
    value: getValue ? getValue(g) : null,
    defRank: defRankForGame(currentProp.stat, g.opponent, player.position, dvpByPosition),
  }))

  const validMins = gamesWithMeta.map(g => g.min).filter(v => v != null)
  const validUsage = gamesWithMeta.map(g => g.usagePct).filter(v => v != null)
  const defaultDvpThreshold = currentProp.effectiveDvpFactor ?? Math.round(dvpMax / 2)
  const defaultMinsThreshold = validMins.length ? Math.round(average(validMins) * 10) / 10 : 0
  const defaultUsageThreshold = validUsage.length ? Math.round(average(validUsage) * 10) / 10 : 0

  // Oldest -> newest so the chart reads left to right.
  const filteredGames = [...gamesWithMeta].filter(g => {
    const passDvp = dvpThreshold == null || (g.defRank != null && g.defRank <= dvpThreshold)
    const passMins = minsThreshold == null || (g.min != null && g.min >= minsThreshold)
    const passUsage = usageThreshold == null || (g.usagePct != null && g.usagePct >= usageThreshold)
    return passDvp && passMins && passUsage
  }).reverse()

  const maxValue = Math.max(line || 0, ...filteredGames.map(g => g.value ?? 0), 1)
  const linePct = line != null ? Math.min(100, (line / maxValue) * 100) : 0
  const isOver = currentProp.projection != null && line != null && currentProp.projection >= line
  const modelDelta = currentProp.projection != null && line != null ? currentProp.projection - line : null

  const seasonAvg = getValue
    ? average(games.filter(g => String(g.date).endsWith('2026')).map(getValue))
    : null
  const expMinutes = player.avgMins
  const usageAvg = average(games.slice(0, 10).map(g => g.usagePct))

  const toggleFilter = id => setOpenFilter(current => (current === id ? null : id))
  const clearFilters = () => { setDvpThreshold(null); setMinsThreshold(null); setUsageThreshold(null); setOpenFilter(null) }

  return (
    <div className="wnba-propboard">
      <section className="wnba-player-page">
        <button className="wnba-player-back" onClick={onBack}>&larr; Back</button>
        <div className="wnba-player-header">
          <div className="wnba-player-avatar">
            {player.image ? <img className="wnba-player-avatar-photo" src={player.image} alt={player.name} loading="lazy" /> : initials(player.name)}
          </div>
          <div className="wnba-player-title">
            <h1>{player.name}<span>{player.position}</span></h1>
            <p>{player.team} vs {opponentToday || '—'}</p>
          </div>
          <div className="wnba-player-prop-pill">
            <span>{formatValue(line)} {currentProp.stat}</span>
            {currentProp.rating != null && (
              <b className={isOver ? 'over' : 'under'}>{isOver ? 'OVER' : 'UNDER'} {currentProp.rating.toFixed(1)}</b>
            )}
          </div>
        </div>

        <div className="wnba-player-tabs">
          {propRows.map(row => (
            <button key={row.stat} className={row.stat === currentProp.stat ? 'active' : ''} onClick={() => setSelectedStat(row.stat)}>{row.stat}</button>
          ))}
        </div>

        <div className="wnba-player-summary">
          <div className="wnba-player-hitrate">
            <small>HIT RATE</small>
            <strong className={currentRange?.pct != null && currentRange.pct >= 50 ? 'over' : 'under'}>{currentRange?.pct != null ? `${currentRange.pct}%` : '—'}</strong>
            <span>{currentRange?.games ? `(${Math.round((currentRange.pct / 100) * currentRange.games)}/${currentRange.games})` : ''}</span>
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

        <div className="wnba-player-range-strip">
          {rangeOptions.map(option => (
            <button
              key={option.id}
              className={selectedRange === option.id ? 'active' : ''}
              disabled={option.pct == null}
              onClick={() => setSelectedRange(option.id)}
            >
              <span>{option.label}</span>
              <b className={option.pct == null ? '' : option.pct >= 50 ? 'over' : 'under'}>{option.pct == null ? '—' : `${option.pct}%`}</b>
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
            label="Exp Minutes"
            valueLabel={minsThreshold == null ? 'All' : `${minsThreshold}`}
            open={openFilter === 'mins'}
            onToggle={() => toggleFilter('mins')}
          >
            <input type="range" min={0} max={40} step={0.5} value={minsThreshold ?? defaultMinsThreshold} onChange={event => setMinsThreshold(Number(event.target.value))} />
            <small>Show games with minutes played &ge; {minsThreshold ?? defaultMinsThreshold}</small>
          </ChartFilterChip>
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

        <div className="wnba-player-chart">
          {line != null && <div className="wnba-player-chart-line" style={{ bottom: `${linePct}%` }}><span>{formatValue(line)}</span></div>}
          <div className="wnba-player-bars">
            {filteredGames.map((g, index) => {
              const hit = line != null && g.value != null && g.value > line
              return (
                <div className="wnba-player-bar-col" key={`${currentProp.stat}-${g.date}-${index}`} title={g.postseason ? `Playoffs · ${fmtDate(g.date)}` : undefined}>
                  <div className={`wnba-player-bar ${hit ? 'hit' : 'miss'}${g.postseason ? ' postseason' : ''}`} style={{ height: `${Math.max(4, ((g.value ?? 0) / maxValue) * 100)}%` }}><i>{formatValue(g.value)}</i></div>
                </div>
              )
            })}
          </div>
          {!filteredGames.length && <div className="wnba-notice wnba-player-chart-empty">No games match these filters.</div>}
        </div>
        <div className="wnba-player-dates">
          {filteredGames.map((g, index) => (
            <span key={`date-${g.date}-${index}`}>
              <b className="wnba-player-date-team" style={{ color: teamColorLookup[g.opponent] || '#78918a' }}>{g.opponent || '—'}</b>
              {fmtDate(g.date)}
              {g.postseason && <em className="wnba-player-date-po" title="Playoff game">PO</em>}
            </span>
          ))}
        </div>
        <PlayerOddsTable key={currentProp.stat} propLabel={currentProp.stat} rows={oddsRows} status={oddsStatus} />
      </section>
    </div>
  )
}
