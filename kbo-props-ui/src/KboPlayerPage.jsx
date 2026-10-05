import { useEffect, useMemo, useState } from 'react'
import PitcherMatchup from './PitcherMatchup'
import PlayerOddsTable from './PlayerOddsTable'
import { rowsFromBookPrices } from './playerOdds'
import { fetchDataSnapshot } from './dataUrl'

const TEAM_COLORS = {
  Doosan: '#9595d3', Hanwha: '#ff8c00', Kia: '#ff4444', Kiwoom: '#d4a76a',
  KT: '#e0e0e0', LG: '#e8557a', Lotte: '#ff6666', NC: '#5b9bd5',
  Samsung: '#60a5fa', SSG: '#ff5555',
}

// Logos live under kbo-props-ui/public/team-logos/ (shared with LandingPage/MatchupDeepDive).
const TEAM_LOGOS = {
  Doosan: '/team-logos/doosan.svg', Hanwha: '/team-logos/hanwha.svg', Kia: '/team-logos/kia.png',
  Kiwoom: '/team-logos/kiwoom.png', KT: '/team-logos/kt.svg', LG: '/team-logos/lg.svg',
  Lotte: '/team-logos/lotte.svg', NC: '/team-logos/nc.svg', Samsung: '/team-logos/samsung.svg',
  SSG: '/team-logos/ssg.png',
}

// Per-game value getters, keyed by the PrizePicks stat labels used on the KBO board.
// Batter and pitcher stat labels never overlap, so one flat map covers both.
const PROP_GAME_VALUE = {
  'Hits+Runs+RBIs': g => g.hrr ?? 0,
  'Total Bases': g => g.tb ?? 0,
  'Hitter Fantasy Score': g => g.fs ?? 0,
  'Pitcher Strikeouts': g => g.so ?? 0,
  'Pitching Outs': g => g.outs ?? 0,
  'Hits Allowed': g => g.ha ?? 0,
  'Pitcher Hits Allowed': g => g.ha ?? 0,
}

const BATTER_PROP_ORDER = ['Hits+Runs+RBIs', 'Total Bases', 'Hitter Fantasy Score']
const PITCHER_PROP_ORDER = ['Pitcher Strikeouts', 'Pitching Outs', 'Hits Allowed', 'Pitcher Hits Allowed']

function sortProps(rows, type) {
  const order = type === 'pitcher' ? PITCHER_PROP_ORDER : BATTER_PROP_ORDER
  return [...rows].sort((a, b) => {
    const ai = order.indexOf(a.stat)
    const bi = order.indexOf(b.stat)
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
  if (value == null) return ''
  const rounded = Number.isInteger(value) ? value : Number(value.toFixed(1))
  return `${rounded >= 0 ? '+' : ''}${rounded}`
}

// Baseball convention: batting average is shown without the leading zero (".287").
function formatAvg(value) {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toFixed(3).replace(/^0\./, '.')
}

// Pitcher dates ship as MM/DD/YYYY; batter dates ship as YYYY-MM-DD. Always render M/D.
function fmtDate(dateStr) {
  const text = String(dateStr || '')
  const [m, d] = text.includes('-') ? text.split('-').slice(1) : text.split('/')
  return m && d ? `${Number(m)}/${Number(d)}` : text
}

function initials(name) {
  return String(name || '').split(' ').map(part => part[0]).join('').slice(0, 2)
}

function average(values) {
  const valid = (values || []).filter(v => v != null && Number.isFinite(v))
  return valid.length ? valid.reduce((sum, v) => sum + v, 0) / valid.length : null
}

function sum(values) {
  return (values || []).filter(v => v != null && Number.isFinite(v)).reduce((total, v) => total + v, 0)
}

function ChartFilterChip({ label, valueLabel, open, onToggle, children }) {
  return (
    <div className={`kbo-chart-filter-chip${open ? ' open' : ''}`}>
      <button type="button" onClick={onToggle}>
        <span>{label}</span>
        <b>{valueLabel}</b>
      </button>
      {open && <div className="kbo-chart-filter-popover">{children}</div>}
    </div>
  )
}

export default function KboPlayerPage({ playerName, onBack }) {
  const [cards, setCards] = useState([])
  const [error, setError] = useState('')
  const [matchups, setMatchups] = useState([])
  const [rankings, setRankings] = useState([])
  const [matchupLeague, setMatchupLeague] = useState(null)
  const [matchupSlateDate, setMatchupSlateDate] = useState(null)
  const [leagueFile, setLeagueFile] = useState(null)
  const [seasonRates, setSeasonRates] = useState([])
  const [matchupStatus, setMatchupStatus] = useState('loading')
  const [selectedStat, setSelectedStat] = useState(null)
  const [selectedRange, setSelectedRange] = useState('l10')
  const [workloadThreshold, setWorkloadThreshold] = useState(null)
  const [openFilter, setOpenFilter] = useState(null)

  useEffect(() => {
    let active = true
    fetchDataSnapshot('prizepicks_props.json').then(snapshot => {
      if (!active) return
      setCards(Array.isArray(snapshot.data?.cards) ? snapshot.data.cards : [])
    }).catch(err => active && setError(err.message))
    return () => { active = false }
  }, [])

  const player = useMemo(() => cards.find(c => c.name === playerName), [cards, playerName])
  const isPitcher = player?.type === 'pitcher'

  useEffect(() => {
    if (!player || isPitcher) return undefined
    let active = true
    Promise.all([
      fetchDataSnapshot('matchup_data.json').catch(() => null),
      fetchDataSnapshot('pitcher_rankings.json').catch(() => null),
      fetchDataSnapshot('kbo_league_pitching.json').catch(() => null),
      fetchDataSnapshot('kbo_pitcher_season_rates.json').catch(() => null),
    ]).then(([matchupSnap, rankingsSnap, leagueSnap, ratesSnap]) => {
      if (!active) return
      const slate = matchupSnap?.data
      setMatchups(Array.isArray(slate?.matchups) ? slate.matchups : [])
      setMatchupSlateDate(slate?.game_date || slate?.gameDate || null)
      setMatchupLeague(slate?.league_pitching || null)
      const rows = rankingsSnap?.data
      setRankings(Array.isArray(rows) ? rows : [])
      setLeagueFile(leagueSnap?.data || null)
      const pitchers = ratesSnap?.data?.pitchers
      setSeasonRates(Array.isArray(pitchers) ? pitchers : [])
      setMatchupStatus(slate ? 'ready' : 'error')
    })
    return () => { active = false }
  }, [player, isPitcher])
  const propRows = useMemo(() => sortProps(player?.props || [], player?.type), [player])
  const currentProp = useMemo(() => propRows.find(p => p.stat === selectedStat) || propRows[0], [propRows, selectedStat])
  const oddsRows = useMemo(
    () => rowsFromBookPrices(currentProp?.bookPrices || currentProp?.book_prices, currentProp?.line),
    [currentProp],
  )

  // Chart filters reset to "All" whenever the selected prop changes.
  const [seededStat, setSeededStat] = useState(null)
  if (currentProp && currentProp.stat !== seededStat) {
    setSeededStat(currentProp.stat)
    setSelectedRange('l10')
    setWorkloadThreshold(null)
    setOpenFilter(null)
  }

  if (error) return <div className="kbo-notice">Unable to load player data: {error}</div>
  if (!cards.length) return <div className="kbo-notice">Loading player data for {playerName}.</div>
  if (!player || !propRows.length || !currentProp) {
    return <div className="kbo-notice">No active PrizePicks lines for {playerName}.</div>
  }

  const games = player.games || []
  const getValue = PROP_GAME_VALUE[currentProp.stat]
  const line = currentProp.line
  const opponentToday = player.opponent
  const currentSeason = games[0]?.season != null ? String(games[0].season) : null

  const rangeGames = range => {
    switch (range) {
      case 'l5': return games.slice(0, 5)
      case 'l10': return games.slice(0, 10)
      case 'l20': return games.slice(0, 20)
      case 'l30': return games.slice(0, 30)
      case '2026': return games.filter(g => String(g.season) === '2026')
      case '2025': return games.filter(g => String(g.season) === '2025')
      case 'h2h': return opponentToday ? games.filter(g => g.opp === opponentToday) : []
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

  // Reliability filter: batters key off at-bats that game, pitchers off innings pitched.
  const workloadKey = isPitcher ? 'ip' : 'ab'
  const workloadLabel = isPitcher ? 'Min IP' : 'Min AB'
  const gamesWithMeta = rangeGames(selectedRange).map(g => ({ ...g, value: getValue ? getValue(g) : null }))
  const validWorkload = gamesWithMeta.map(g => g[workloadKey]).filter(v => v != null)
  const defaultWorkloadThreshold = validWorkload.length ? Math.round(average(validWorkload) * 10) / 10 : 0
  const workloadMax = Math.max(1, Math.ceil(Math.max(...validWorkload, isPitcher ? 9 : 5)))

  // Oldest -> newest so the chart reads left to right.
  const filteredGames = [...gamesWithMeta].filter(g => (
    workloadThreshold == null || (g[workloadKey] != null && g[workloadKey] >= workloadThreshold)
  )).reverse()

  const maxValue = Math.max(line || 0, ...filteredGames.map(g => g.value ?? 0), 1)
  const linePct = line != null ? Math.min(100, (line / maxValue) * 100) : 0
  const model = currentProp.projection ?? currentProp.avg ?? null
  const isOver = model != null && line != null && model >= line
  const modelDelta = model != null && line != null ? model - line : null

  const seasonGames = currentSeason ? games.filter(g => String(g.season) === currentSeason) : games
  const seasonAvg = getValue ? average(seasonGames.map(getValue)) : null

  // Batting average / ERA are true rate stats (sum of parts), not an average of per-game rates.
  const battingAvg = !isPitcher ? (sum(seasonGames.map(g => g.ab)) > 0 ? sum(seasonGames.map(g => g.h)) / sum(seasonGames.map(g => g.ab)) : null) : null
  const homeRuns = !isPitcher ? sum(seasonGames.map(g => g.hr)) : null
  const ipPerGame = isPitcher ? average(seasonGames.map(g => g.ip)) : null
  const era = isPitcher ? (sum(seasonGames.map(g => g.ip)) > 0 ? (sum(seasonGames.map(g => g.er)) * 9) / sum(seasonGames.map(g => g.ip)) : null) : null

  const toggleFilter = id => setOpenFilter(current => (current === id ? null : id))
  const clearFilters = () => { setWorkloadThreshold(null); setOpenFilter(null) }

  return (
    <div className="kbo-lines-page">
      <section className="kbo-player-page">
        <button className="kbo-player-back" onClick={onBack}>&larr; Back</button>
        <div className="kbo-player-header">
          <div className="kbo-player-avatar">
            {initials(player.name)}
            {TEAM_LOGOS[player.team] && <img className="kbo-player-avatar-badge" src={TEAM_LOGOS[player.team]} alt={player.team} />}
          </div>
          <div className="kbo-player-title">
            <h1>{player.name}<span>{isPitcher ? 'P' : 'B'}</span></h1>
            <p>
              {player.team} vs {' '}
              {TEAM_LOGOS[opponentToday] && <img className="kbo-player-opp-logo" src={TEAM_LOGOS[opponentToday]} alt={opponentToday} />}
              {opponentToday || '—'}
            </p>
          </div>
          <div className="kbo-player-prop-pill">
            <span>{formatValue(line)} {currentProp.stat}</span>
            {currentProp.cg_projection != null && (
              <b className={isOver ? 'over' : 'under'}>{isOver ? 'OVER' : 'UNDER'} {Number(currentProp.cg_projection).toFixed(1)}</b>
            )}
          </div>
        </div>

        <div className="kbo-player-tabs">
          {propRows.map(row => (
            <button key={row.stat} className={row.stat === currentProp.stat ? 'active' : ''} onClick={() => setSelectedStat(row.stat)}>{row.stat}</button>
          ))}
        </div>

        <div className="kbo-player-summary">
          <div className="kbo-player-hitrate">
            <small>HIT RATE</small>
            <strong className={currentRange?.pct != null && currentRange.pct >= 50 ? 'over' : 'under'}>{currentRange?.pct != null ? `${currentRange.pct}%` : '—'}</strong>
            <span>{currentRange?.games ? `(${Math.round((currentRange.pct / 100) * currentRange.games)}/${currentRange.games})` : ''}</span>
          </div>
          <div><small>LINE</small><strong>{formatValue(line)}</strong></div>
          <div>
            <small>MODEL</small>
            <strong>{formatValue(model)}</strong>
            {modelDelta != null && <span className={modelDelta >= 0 ? 'over' : 'under'}>{formatDelta(modelDelta)}</span>}
          </div>
          <div><small>SEASON AVG</small><strong>{formatValue(seasonAvg)}</strong></div>
          {isPitcher ? (
            <>
              <div><small>IP/G</small><strong>{formatValue(ipPerGame)}</strong></div>
              <div><small>ERA</small><strong>{era != null ? era.toFixed(2) : '—'}</strong></div>
            </>
          ) : (
            <>
              <div><small>AVG</small><strong>{formatAvg(battingAvg)}</strong></div>
              <div><small>HR</small><strong>{homeRuns != null ? homeRuns : '—'}</strong></div>
            </>
          )}
        </div>

        <div className="kbo-player-range-strip">
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

        <div className="kbo-chart-filters">
          <span className="kbo-chart-filters-label">Chart Filters</span>
          <button className="kbo-chart-filter-clear" onClick={clearFilters}>Clear all</button>
          <ChartFilterChip
            label={workloadLabel}
            valueLabel={workloadThreshold == null ? 'All' : `${workloadThreshold}`}
            open={openFilter === 'workload'}
            onToggle={() => toggleFilter('workload')}
          >
            <input type="range" min={0} max={workloadMax} step={isPitcher ? 0.1 : 1} value={workloadThreshold ?? defaultWorkloadThreshold} onChange={event => setWorkloadThreshold(Number(event.target.value))} />
            <small>Show games with {isPitcher ? 'innings pitched' : 'at-bats'} &ge; {workloadThreshold ?? defaultWorkloadThreshold}</small>
          </ChartFilterChip>
        </div>

        <div className="kbo-player-chart">
          {line != null && <div className="kbo-player-chart-line" style={{ bottom: `${linePct}%` }}><span>{formatValue(line)}</span></div>}
          <div className="kbo-player-bars">
            {filteredGames.map((g, index) => {
              const hit = line != null && g.value != null && g.value > line
              return (
                <div className="kbo-player-bar-col" key={`${currentProp.stat}-${g.date}-${index}`}>
                  <div className={`kbo-player-bar ${hit ? 'hit' : 'miss'}`} style={{ height: `${Math.max(4, ((g.value ?? 0) / maxValue) * 100)}%` }}><i>{formatValue(g.value)}</i></div>
                </div>
              )
            })}
          </div>
          {!filteredGames.length && <div className="kbo-notice kbo-player-chart-empty">No games match these filters.</div>}
        </div>
        <div className="kbo-player-dates">
          {filteredGames.map((g, index) => (
            <span key={`date-${g.date}-${index}`}>
              {TEAM_LOGOS[g.opp] && <img className="kbo-player-date-logo" src={TEAM_LOGOS[g.opp]} alt={g.opp} />}
              <b className="kbo-player-date-team" style={{ color: TEAM_COLORS[g.opp] || '#78918a' }}>{g.opp || '—'}</b>
              {fmtDate(g.date)}
            </span>
          ))}
        </div>
        {!isPitcher && (
          <PitcherMatchup
            batterTeam={player.team}
            opponent={player.opponent}
            card={player}
            prop={currentProp}
            matchups={matchups}
            slateDate={matchupSlateDate}
            rankings={rankings}
            matchupLeague={matchupLeague}
            leagueFile={leagueFile}
            seasonRates={seasonRates}
            status={matchupStatus}
          />
        )}
        <PlayerOddsTable key={currentProp.stat} propLabel={currentProp.stat} rows={oddsRows} status="ready" />
      </section>
    </div>
  )
}
