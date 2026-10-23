import { useEffect, useMemo, useState } from 'react'
import BatterSplits from './BatterSplits'
import PlayerInsights from './playerInsights/PlayerInsights'
import { insightsLayout } from './playerInsights/insightsPreview'
import { kboInsights } from './playerInsights/insightsSports'
import PitcherMatchup from './PitcherMatchup'
import PlayerOddsTable from './PlayerOddsTable'
import { AltLinesRow, LinePlot } from './LineSlider'
import { useChartLine } from './useChartLine'
import { batterProfile, battingHandPhrase, projectionRow, resolveBattingHand } from './batterSplits'
import { rowsFromBookPrices } from './playerOdds'
import { fetchDataSnapshot } from './dataUrl'
import { lineResult, overHitRate } from './hitRateStrip'
import { formatLineValue, offeredLinesForStat, rateTextColor } from './lineSlider'
import { directionFor, playerHeaderBadge, scoreFor } from './kboBoardScore'
import { buildCgScoreExplainer } from './cgScoreExplainer'
import { CgScoreNote } from './CgScoreExplainer'
import BreakEvenMeter from './BreakEvenMeter'
import { kboBreakEvenWindows } from './prizepicksBreakeven'
import { useAuth } from './AuthContext'
import { sportAccess } from './entitlements'
import GameDateLogo from './GameDateLogo'
import { kboLogoUrl } from './slipBoardModel'

// Logos live under kbo-props-ui/public/team-logos/ (shared with LandingPage/MatchupDeepDive).
const TEAM_LOGOS = {
  Doosan: '/team-logos/doosan.webp', Hanwha: '/team-logos/hanwha.webp', Kia: '/team-logos/kia.webp',
  Kiwoom: '/team-logos/kiwoom.webp', KT: '/team-logos/kt.webp', LG: '/team-logos/lg.webp',
  Lotte: '/team-logos/lotte.webp', NC: '/team-logos/nc.webp', Samsung: '/team-logos/samsung.webp',
  SSG: '/team-logos/ssg.webp',
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

const KBO_RANGES = [
  { id: '2026', label: '2026' },
  { id: '2025', label: '2025' },
  { id: 'h2h', label: 'H2H' },
  { id: 'l5', label: 'L5' },
  { id: 'l10', label: 'L10' },
  { id: 'l20', label: 'L20' },
  { id: 'l30', label: 'L30' },
]

function kboWindowRows(games, range, opponent, getValue) {
  let rows
  switch (range) {
    case 'l5': rows = games.slice(0, 5); break
    case 'l10': rows = games.slice(0, 10); break
    case 'l20': rows = games.slice(0, 20); break
    case 'l30': rows = games.slice(0, 30); break
    case '2026': rows = games.filter((game) => String(game.season) === '2026'); break
    case '2025': rows = games.filter((game) => String(game.season) === '2025'); break
    case 'h2h': rows = opponent ? games.filter((game) => game.opp === opponent) : []; break
    default: rows = games
  }
  return rows.map((game) => ({ ...game, value: getValue ? getValue(game) : null }))
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
  const { tier } = useAuth()
  const showBreakEven = sportAccess(tier).kbo
  const [cards, setCards] = useState([])
  const [error, setError] = useState('')
  const [matchups, setMatchups] = useState([])
  const [rankings, setRankings] = useState([])
  const [matchupLeague, setMatchupLeague] = useState(null)
  const [matchupSlateDate, setMatchupSlateDate] = useState(null)
  const [leagueFile, setLeagueFile] = useState(null)
  const [seasonRates, setSeasonRates] = useState([])
  const [matchupStatus, setMatchupStatus] = useState('loading')
  const [handContext, setHandContext] = useState(null)
  const [batterProjection, setBatterProjection] = useState(null)
  const [handStatus, setHandStatus] = useState('loading')
  const [selectedStat, setSelectedStat] = useState(null)
  const [selectedRange, setSelectedRange] = useState('l10')
  const [workloadThreshold, setWorkloadThreshold] = useState(null)
  const [openFilter, setOpenFilter] = useState(null)

  useEffect(() => {
    let active = true
    fetchDataSnapshot('prizepicks_props.json', { player: playerName }).then(snapshot => {
      if (!active) return
      setCards(Array.isArray(snapshot.data?.cards) ? snapshot.data.cards : [])
    }).catch(err => active && setError(err.message))
    return () => { active = false }
  }, [playerName])

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

  useEffect(() => {
    if (!player || isPitcher) return undefined
    let active = true
    setHandStatus('loading')
    Promise.all([
      fetchDataSnapshot('kbo_batter_hand_context.json').catch(() => null),
      fetchDataSnapshot('batter_projections.json').catch(() => null),
    ]).then(([handSnap, projectionSnap]) => {
      if (!active) return
      const context = handSnap?.data?.batters ? handSnap.data : null
      const projectionRows = projectionSnap?.data?.projections
      setHandContext(context)
      setBatterProjection(projectionRow(Array.isArray(projectionRows) ? projectionRows : [], playerName))
      setHandStatus(context || (Array.isArray(projectionRows) && projectionRows.length) ? 'ready' : 'error')
    })
    return () => { active = false }
  }, [player, isPitcher, playerName])
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

  const chartInput = useMemo(() => {
    if (!player || !currentProp) {
      return { posted: null, values: [], filteredGames: [], windows: [], offered: null, validWorkload: [], workloadLabel: 'Min AB', pitcher: false }
    }
    const games = player.games || []
    const getValue = PROP_GAME_VALUE[currentProp.stat]
    const opponent = player.opponent
    const pitcher = player.type === 'pitcher'
    const workloadKey = pitcher ? 'ip' : 'ab'
    const windows = KBO_RANGES.map((option) => {
      const rows = kboWindowRows(games, option.id, opponent, getValue)
      const filtered = rows.filter((game) => (
        workloadThreshold == null || (game[workloadKey] != null && game[workloadKey] >= workloadThreshold)
      ))
      return { ...option, rows: filtered }
    })
    const selected = windows.find((option) => option.id === selectedRange)
    const filteredGames = [...(selected?.rows || [])].reverse()
    const validWorkload = kboWindowRows(games, selectedRange, opponent, getValue)
      .map((game) => game[workloadKey])
      .filter((value) => value != null)
    return {
      posted: currentProp.line,
      values: filteredGames.map((game) => game.value),
      filteredGames,
      windows,
      offered: offeredLinesForStat(player.props, currentProp.stat),
      validWorkload,
      workloadLabel: pitcher ? 'Min IP' : 'Min AB',
      pitcher,
    }
  }, [player, currentProp, selectedRange, workloadThreshold])

  const slider = useChartLine({
    postedLine: chartInput.posted,
    values: chartInput.values,
    offeredLines: chartInput.offered,
    resetKey: `${player?.name || ''}|${currentProp?.stat || ''}`,
  })

  const breakEvenSide = directionFor(currentProp) === 'under' ? 'under' : 'over'
  const breakEvenWindows = useMemo(() => kboBreakEvenWindows({
    games: player?.games,
    stat: currentProp?.stat,
    line: slider.line ?? currentProp?.line,
    side: breakEvenSide,
  }), [player, currentProp, slider.line, breakEvenSide])

  // Splits / Advanced preview (?insights=a|b|c). Off by default.
  const insightsMode = useMemo(() => insightsLayout(), [])
  const insightsModel = useMemo(() => {
    if (!insightsMode || !player || !currentProp) return null
    const getGameValue = PROP_GAME_VALUE[currentProp.stat]
    return kboInsights(player, { valueOf: getGameValue || (() => null) })
  }, [insightsMode, player, currentProp])

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

  const rangeOptions = chartInput.windows.map((option) => {
    const rated = slider.line == null ? null : overHitRate(option.rows.map((game) => game.value), slider.line)
    return { ...option, pct: rated?.rate ?? null, hits: rated?.hits ?? 0, games: rated?.games ?? 0 }
  })
  const currentRange = rangeOptions.find((option) => option.id === selectedRange)
  const { filteredGames, validWorkload, workloadLabel } = chartInput
  const defaultWorkloadThreshold = validWorkload.length ? Math.round(average(validWorkload) * 10) / 10 : 0
  const workloadMax = Math.max(1, Math.ceil(Math.max(...validWorkload, isPitcher ? 9 : 5)))
  const scaleMax = Math.max(slider.max || 0, 1)
  const chartLine = slider.line ?? line
  const hitColor = rateTextColor(currentRange?.pct, currentRange?.games)
  const model = currentProp.projection ?? currentProp.avg ?? null
  const headerBadge = playerHeaderBadge(currentProp)
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
  const platoonProfile = !isPitcher ? batterProfile(handContext, player.name) : null
  const shownBattingHand = !isPitcher ? resolveBattingHand(player, platoonProfile, batterProjection) : null
  const battingHandText = battingHandPhrase(shownBattingHand)

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
              {!isPitcher && (
                <>
                  <span className={battingHandText ? 'kbo-bats-known' : 'kbo-bats-unknown'}>
                    {battingHandText || (handStatus === 'loading' ? 'Batting hand…' : 'Batting hand unknown')}
                  </span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              {player.team} vs {' '}
              {TEAM_LOGOS[opponentToday] && <img className="kbo-player-opp-logo" src={TEAM_LOGOS[opponentToday]} alt={opponentToday} />}
              {opponentToday || '—'}
            </p>
          </div>
          <div className="kbo-player-prop-pill">
            <span>{formatValue(line)} {currentProp.stat}</span>
            {headerBadge && (
              <b className={headerBadge.side === 'neutral' ? undefined : headerBadge.side}>
                {headerBadge.label ? `${headerBadge.label} ` : ''}{headerBadge.scoreText}
              </b>
            )}
          </div>
        </div>

        <div className="kbo-player-tabs">
          {propRows.map(row => (
            <button key={row.stat} className={row.stat === currentProp.stat ? 'active' : ''} onClick={() => setSelectedStat(row.stat)}>{row.stat}</button>
          ))}
        </div>

        <div className="kbo-player-summary">
          <div className="kbo-player-hitrate" aria-live="polite">
            <small>HIT RATE</small>
            <strong style={hitColor ? { color: hitColor } : undefined}>{currentRange?.pct != null ? `${currentRange.pct}%` : '—'}</strong>
            <span>{currentRange?.games ? `(${currentRange.hits}/${currentRange.games}${slider.moved ? ` over ${formatLineValue(slider.line)}` : ''})` : ''}</span>
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

        <PlayerInsights layout={insightsMode} model={insightsModel} line={chartLine} statLabel={currentProp.stat}>
        <div className="kbo-player-range-strip">
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

        {!isPitcher && (
          <BatterSplits
            games={games}
            starters={handContext?.starters}
            getValue={getValue}
            line={line}
            season={currentSeason}
            stat={currentProp.stat}
            profile={platoonProfile}
            projection={batterProjection}
            status={handStatus}
          />
        )}

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

        <LinePlot className="kbo-player-chart" slider={slider} lineClassName="kbo-player-chart-line">
          <div className="kbo-player-bars">
            {filteredGames.map((g, index) => {
              const kind = lineResult(g.value, chartLine) || 'miss'
              return (
                <div className="kbo-player-bar-col" key={`${currentProp.stat}-${g.date}-${index}`}>
                  <div className={`kbo-player-bar ${kind}`} style={{ height: `${Math.max(4, ((g.value ?? 0) / scaleMax) * 100)}%` }}><i>{formatValue(g.value)}</i></div>
                </div>
              )
            })}
          </div>
          {!filteredGames.length && <div className="kbo-notice kbo-player-chart-empty">No games match these filters.</div>}
        </LinePlot>
        <div className="kbo-player-dates">
          {filteredGames.map((g, index) => (
            <span key={`date-${g.date}-${index}`}>
              <GameDateLogo date={g.date} team={g.opp} logo={TEAM_LOGOS[g.opp] || kboLogoUrl(g.opp)} />
            </span>
          ))}
        </div>
        {showBreakEven && breakEvenWindows.length > 0 && (
          <div className="kbo-player-chart-meter">
            <BreakEvenMeter
              windows={breakEvenWindows}
              side={breakEvenSide}
              lineText={slider.moved ? formatLineValue(slider.line) : ''}
              chartCountsOvers={breakEvenSide === 'under'}
            />
          </div>
        )}
        <div className="cg-score-open">
          <CgScoreNote note={buildCgScoreExplainer({
            player: player.name,
            projection: currentProp.projection,
            line,
            stat: currentProp.stat,
            score: scoreFor(currentProp),
            recentValues: currentProp.recent_values,
            newestFirst: true,
          })} />
        </div>
        <AltLinesRow slider={slider} />
        </PlayerInsights>
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
