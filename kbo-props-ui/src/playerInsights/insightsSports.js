// Per-sport adapters for the player-page Splits + Advanced stats: how each player page's game
// logs map onto the shared game shape, which splits apply, and which advanced
// metrics the logs can support. Every metric is derived from fields already in
// the page's own logs. No new data source is read here.

import { meanOf, parseGameDay, ratio, sumOf } from './insightsCore.js'

// "Early season" notice below this many games in the current season.
// NBA 82 games, WNBA 44, NFL 17, KBO 144 for hitters and ~30 starts for
// pitchers: roughly the first eighth of a season (NFL: the first month).
export const EARLY_SEASON_GAMES = Object.freeze({ nba: 10, wnba: 6, nfl: 4, kboHitter: 15, kboPitcher: 5, nhl: 10 })

// Rows the pipeline ships per player. A log at its cap starts part-way
// through its oldest season, so that season is labeled "Last N games of ...".
//   KBO: generate_props.py keeps games[:200]
//   WNBA: recentGames is the newest 40 games, playoffs included
//   NFL: recent / gameDates / gameSeasons are the newest 30 games
// NBA gameLogs carry every stored season (no cap).
export const LOG_CAPS = Object.freeze({ kbo: 200, wnba: 40, nfl: 30 })

// Basketball recent-games scope (Code Green, Oct 23): while a player has
// fewer than this many PLAYED games (min > 0) in the current season, the
// Advanced L5/L10 windows and the Venue/Opponent/Result/Rest splits use the
// current + prior season, labeled "both seasons". From this game on they use
// the current season only, labeled "this season". It is the NBA early-season
// threshold, so the early-season note and the switch flip on the same game.
export const SEASON_ONLY_FROM_GAMES = EARLY_SEASON_GAMES.nba

// The league's current season from the calendar, in the label the logs use:
// NBA "2027" for 2026-27 (rolls over in July), WNBA the calendar year.
export function leagueSeasonFor(sport, now = new Date()) {
  const year = now.getFullYear()
  if (sport === 'nba') return String(now.getMonth() >= 6 ? year + 1 : year)
  return String(year)
}

// Returns { recentScope, scopeSeasons }. A player who has not played in the
// league's current season yet counts as 0 games: the scope is 'both', and the
// two seasons are this one (empty) and last, so nothing gets a "both seasons"
// label unless games from two seasons really are mixed.
export function basketballRecentScope(games, currentSeason, leagueSeason = null) {
  const season = leagueSeason ?? currentSeason
  if (season == null) return { recentScope: 'all', scopeSeasons: null }
  // `played` is basketballPlayed(raw) (min > 0), set by the adapters.
  const played = games.filter((game) => game.season === season && game.played === true).length
  if (played >= SEASON_ONLY_FROM_GAMES) return { recentScope: 'season', scopeSeasons: [season] }
  const prior = String(Number(season) - 1)
  return { recentScope: 'both', scopeSeasons: [season, prior] }
}

function finite(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function distinctSeasons(games) {
  const seen = []
  games.forEach((game) => { if (game.season != null && !seen.includes(game.season)) seen.push(game.season) })
  return seen
}

function seasonsOf(games) {
  const [currentSeason = null, priorSeason = null] = distinctSeasons(games)
  return { currentSeason, priorSeason }
}

// Logs and the board spell some teams differently (GS vs GSV, NY vs NYL,
// ...). Both sides go through these before the opponent split compares them.
const NBA_TEAM_ALIASES = Object.freeze({ GS: 'GSW', NO: 'NOP', NOR: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', PHO: 'PHX', BRK: 'BKN', CHO: 'CHA', WSH: 'WAS' })
const WNBA_TEAM_ALIASES = Object.freeze({ GS: 'GSV', LA: 'LAS', LV: 'LVA', NY: 'NYL', WSH: 'WAS', POR: 'PDX', PHO: 'PHX', CONN: 'CON' })

function teamKeyWith(aliases) {
  return (team) => {
    const code = String(team ?? '').trim().toUpperCase()
    return aliases[code] || code
  }
}

export const nbaTeamKey = teamKeyWith(NBA_TEAM_ALIASES)
export const wnbaTeamKey = teamKeyWith(WNBA_TEAM_ALIASES)

function opponentFrom(matchup) {
  const text = String(matchup || '')
  const match = text.match(/(?:@|vs\.?)\s*([A-Z]{2,4})\s*$/)
  return match ? match[1] : null
}

function homeFrom(matchup) {
  const text = String(matchup || '')
  if (/\svs\.?\s/.test(text)) return true
  if (/\s@\s/.test(text)) return false
  return null
}

// "'26-27" from "2027" / "2026-27"; anything else as written.
export function basketballSeasonLabel(season) {
  const text = String(season ?? '').trim()
  if (/^\d{4}$/.test(text)) return `'${String(Number(text) - 1).slice(2)}-${text.slice(2)}`
  const span = text.match(/^(\d{4})-(\d{2,4})$/)
  if (span) return `'${span[1].slice(2)}-${span[2].slice(-2)}`
  return text
}

const has = (...keys) => (raw) => keys.every((key) => finite(raw?.[key]) != null)

// Basketball: a game counts only with minutes above 0 (a 0 or blank is a
// DNP), the same rule as the NBA Minutes & Usage card. It applies to every
// metric and every split.
export function basketballPlayed(raw) {
  return finite(raw?.min) > 0
}

// ---- NBA / WNBA ------------------------------------------------------------

function basketballMetrics({ usageKey = 'usg' } = {}) {
  return [
    { id: 'usg', label: 'Usage %', format: 'pct100', note: 'Share of team plays used while on court (from the box-score refresh).', has: (raw) => finite(raw?.[usageKey]) != null && finite(raw?.min) > 0, total: (rows) => meanOf(rows, usageKey), game: (raw) => finite(raw?.[usageKey]) },
    { id: 'ts', label: 'True shooting %', format: 'pct', note: 'PTS / (2 × (FGA + 0.44 × FTA)), summed over the games.', has: has('pts', 'fga', 'fta'), total: (rows) => ratio(sumOf(rows, 'pts'), 2 * (sumOf(rows, 'fga') + 0.44 * sumOf(rows, 'fta'))), game: (raw) => ratio(finite(raw.pts), 2 * (finite(raw.fga) + 0.44 * finite(raw.fta))) },
    { id: 'efg', label: 'Effective FG %', format: 'pct', note: '(FGM + 0.5 × 3PM) / FGA.', has: has('fgm', 'fg3m', 'fga'), total: (rows) => ratio(sumOf(rows, 'fgm') + 0.5 * sumOf(rows, 'fg3m'), sumOf(rows, 'fga')), game: (raw) => ratio(finite(raw.fgm) + 0.5 * finite(raw.fg3m), finite(raw.fga)) },
    { id: 'min', label: 'Minutes', format: 'one', note: 'Average minutes per game played; 0-minute games are left out.', has: basketballPlayed, total: (rows) => meanOf(rows, 'min'), game: (raw) => finite(raw.min) },
    { id: 'fg3r', label: '3PA rate', format: 'pct', note: 'Share of shots taken from three: 3PA / FGA.', has: has('fg3a', 'fga'), total: (rows) => ratio(sumOf(rows, 'fg3a'), sumOf(rows, 'fga')), game: (raw) => ratio(finite(raw.fg3a), finite(raw.fga)) },
    { id: 'ftr', label: 'FT rate', format: 'pct', note: 'FTA / FGA.', has: has('fta', 'fga'), total: (rows) => ratio(sumOf(rows, 'fta'), sumOf(rows, 'fga')), game: (raw) => ratio(finite(raw.fta), finite(raw.fga)) },
    { id: 'pts36', label: 'Points per 36', format: 'one', note: 'Points per 36 minutes played.', has: has('pts', 'min'), total: (rows) => ratio(sumOf(rows, 'pts'), sumOf(rows, 'min'), 36), game: (raw) => ratio(finite(raw.pts), finite(raw.min), 36) },
    { id: 'reb36', label: 'Rebounds per 36', format: 'one', note: 'Rebounds per 36 minutes played.', has: has('reb', 'min'), total: (rows) => ratio(sumOf(rows, 'reb'), sumOf(rows, 'min'), 36), game: (raw) => ratio(finite(raw.reb), finite(raw.min), 36) },
    { id: 'ast36', label: 'Assists per 36', format: 'one', note: 'Assists per 36 minutes played.', has: has('ast', 'min'), total: (rows) => ratio(sumOf(rows, 'ast'), sumOf(rows, 'min'), 36), game: (raw) => ratio(finite(raw.ast), finite(raw.min), 36) },
    { id: 'oreb', label: 'Offensive rebounds', format: 'one', note: 'Offensive rebounds per game.', has: has('oreb'), total: (rows) => meanOf(rows, 'oreb'), game: (raw) => finite(raw.oreb) },
    { id: 'asttov', label: 'AST/TO ratio', format: 'two', note: 'Assists per turnover.', has: has('ast', 'tov'), total: (rows) => ratio(sumOf(rows, 'ast'), sumOf(rows, 'tov')), game: (raw) => ratio(finite(raw.ast), finite(raw.tov)) },
  ]
}

export function nbaInsights(logs, { valueOf, opponent = null, now = new Date() } = {}) {
  const games = (Array.isArray(logs) ? logs : []).map((raw) => ({
    raw,
    value: valueOf ? valueOf(raw) : null,
    day: parseGameDay(raw?.date || raw?.gameDate),
    season: raw?.season != null ? String(raw.season) : null,
    opp: opponentFrom(raw?.matchup) || raw?.opponent || null,
    home: homeFrom(raw?.matchup),
    result: raw?.result === 'W' || raw?.result === 'L' ? raw.result : null,
    oppHand: null,
    played: basketballPlayed(raw),
  }))
  const seasons = seasonsOf(games)
  return {
    sport: 'nba',
    games,
    opponent,
    ...seasons,
    seasonLabel: basketballSeasonLabel,
    earlySeasonGames: EARLY_SEASON_GAMES.nba,
    ...basketballRecentScope(games, seasons.currentSeason, leagueSeasonFor('nba', now)),
    oppKey: nbaTeamKey,
    windowFrom: 'logged',
    restApplies: true,
    handApplies: false,
    metrics: basketballMetrics(),
    unavailable: [
      'Starter/bench split: the NBA game logs have no starter flag.',
      'AST % and REB %: need team and opponent totals per game, which the logs do not carry.',
      'Minutes share: needs team minutes per game (overtime changes the 240 total).',
    ],
  }
}

export function wnbaInsights(logs, { valueOf, opponent = null, now = new Date() } = {}) {
  const games = (Array.isArray(logs) ? logs : []).map((raw) => {
    const day = parseGameDay(raw?.date)
    const year = String(raw?.date || '').match(/(\d{4})$/)?.[1] || null
    return {
      raw,
      value: valueOf ? valueOf(raw) : null,
      day,
      season: year,
      opp: raw?.opponent || opponentFrom(raw?.matchup),
      home: homeFrom(raw?.matchup),
      result: raw?.result === 'W' || raw?.result === 'L' ? raw.result : null,
      oppHand: null,
      played: basketballPlayed(raw),
      postseason: raw?.postseason === true,
    }
  })
  const seasons = seasonsOf(games)
  return {
    sport: 'wnba',
    games,
    opponent,
    ...seasons,
    ...basketballRecentScope(games, seasons.currentSeason, leagueSeasonFor('wnba', now)),
    seasonLabel: (season) => String(season ?? ''),
    earlySeasonGames: EARLY_SEASON_GAMES.wnba,
    logCap: LOG_CAPS.wnba,
    oppKey: wnbaTeamKey,
    windowFrom: 'logged',
    restApplies: true,
    handApplies: false,
    metrics: basketballMetrics({ usageKey: 'usagePct' }),
    unavailable: [
      'Wins/Losses: the WNBA game logs have no result.',
      'Starter/bench split: no starter flag in the logs.',
      'AST % and REB %: need team and opponent totals per game.',
    ],
  }
}

// ---- NHL -------------------------------------------------------------------

function nhlYearFor(season) {
  const start = Number(String(season || '').slice(0, 4))
  return (month) => (Number.isFinite(start) && start > 0 ? (month >= 8 ? start : start + 1) : null)
}

// The NHL per-game logs (log/logDates/...) are built from MoneyPuck CSVs
// (nhl/history.py), which Legal flagged as non-commercial only. New displays
// stay off that data: NHL splits render a notice until a licensed or official
// per-game source is approved. Flip this only with that sign-off.
export const NHL_LOG_SOURCE_APPROVED = false

// NHL rows carry parallel arrays, oldest first.
export function nhlInsights(item, { sourceApproved = NHL_LOG_SOURCE_APPROVED } = {}) {
  const values = Array.isArray(item?.log) && item.log.length ? item.log : (Array.isArray(item?.recent) ? item.recent : [])
  const dates = Array.isArray(item?.logDates) && item.logDates.length ? item.logDates : []
  const seasons = Array.isArray(item?.logSeasons) ? item.logSeasons : []
  const opponents = Array.isArray(item?.logOpponents) ? item.logOpponents : []
  const games = !sourceApproved ? [] : values.map((value, index) => ({
    raw: { value },
    value: finite(value),
    day: dates[index] ? parseGameDay(dates[index], nhlYearFor(seasons[index])) : null,
    season: seasons[index] || null,
    opp: opponents[index] || null,
    home: null,
    result: null,
    oppHand: null,
  })).reverse()
  return {
    sport: 'nhl',
    games,
    opponent: item?.opponent || null,
    ...seasonsOf(games),
    seasonLabel: (season) => String(season ?? ''),
    restApplies: true,
    handApplies: false,
    metrics: [],
    unavailable: [
      'All NHL splits: the per-game logs are MoneyPuck data (non-commercial only).',
      'Home/Away and Wins/Losses: the NHL prop logs carry only date, opponent and the stat.',
      'TOI, PP TOI, shots/60, shooting %: the only per-game source in the pipeline today is the MoneyPuck logs, which Legal flagged as non-commercial only. Needs a licensed or official feed (your call).',
    ],
    advancedNote: 'No licensed per-game NHL usage feed yet. Advanced NHL stats stay off until a licensed or official source is approved.',
    splitsBlocked: sourceApproved ? null : 'NHL splits are on hold: the game logs behind them come from a non-commercial source. They switch on once a licensed or official NHL game feed is approved.',
  }
}

// ---- NFL -------------------------------------------------------------------

function nflYearFor(season) {
  const start = Number(season)
  return (month) => (Number.isFinite(start) && start > 0 ? (month >= 8 ? start : start + 1) : null)
}

// Logs and the board spell a few teams differently (LA vs LAR, ...). Both
// sides go through this before the opponent split compares them.
const NFL_TEAM_ALIASES = Object.freeze({ LA: 'LAR', STL: 'LAR', JAC: 'JAX', WSH: 'WAS', OAK: 'LV', LVR: 'LV', SD: 'LAC' })

export function nflTeamKey(team) {
  const code = String(team ?? '').trim().toUpperCase()
  return NFL_TEAM_ALIASES[code] || code
}

function nflKey(season, date) {
  return `${season}|${date}`
}

// `row` is the selected prop; `rows` are every prop the player has today, so
// rate stats (yards per target, catch rate, ...) can pair two props by game.
export function nflInsights(row, rows = [], { currentSeason = null } = {}) {
  const recent = Array.isArray(row?.recent) ? row.recent : []
  const dates = Array.isArray(row?.gameDates) ? row.gameDates : []
  const seasons = Array.isArray(row?.gameSeasons) ? row.gameSeasons : []
  const opponents = Array.isArray(row?.gameOpponents) ? row.gameOpponents : []
  const snaps = Array.isArray(row?.recentSnapPercents) ? row.recentSnapPercents : []
  const usage = Array.isArray(row?.recentUsage) ? row.recentUsage : []
  const byProp = new Map()
  ;(Array.isArray(rows) ? rows : []).forEach((other) => {
    const map = new Map()
    const otherDates = Array.isArray(other?.gameDates) ? other.gameDates : []
    const otherSeasons = Array.isArray(other?.gameSeasons) ? other.gameSeasons : []
    ;(Array.isArray(other?.recent) ? other.recent : []).forEach((value, index) => {
      if (otherDates[index] != null) map.set(nflKey(otherSeasons[index], otherDates[index]), finite(value))
    })
    byProp.set(other.prop, map)
  })
  const usageLabel = row?.usageLabel || 'Usage'
  const games = recent.map((value, index) => {
    const key = nflKey(seasons[index], dates[index])
    const raw = { snap: finite(snaps[index]), usage: finite(usage[index]) }
    byProp.forEach((map, prop) => { if (map.has(key)) raw[prop] = map.get(key) })
    return {
      raw,
      value: finite(value),
      day: dates[index] ? parseGameDay(dates[index], nflYearFor(seasons[index])) : null,
      season: seasons[index] != null ? String(seasons[index]) : null,
      opp: opponents[index] || null,
      home: null,
      result: null,
      oppHand: null,
    }
  }).reverse()
  const props = new Set(byProp.keys())
  const pair = (num, den, label, id, note, format = 'one', scale = 1) => (
    props.has(num) && (den === 'usage' || props.has(den))
      ? [{ id, label, note, format, has: (raw) => finite(raw[num]) != null && finite(raw[den]) != null && raw[den] > 0, total: (list) => ratio(sumOf(list, num), sumOf(list, den), scale), game: (raw) => ratio(raw[num], raw[den], scale) }]
      : []
  )
  const targets = usageLabel === 'Targets'
  const metrics = [
    { id: 'snap', label: 'Snap %', format: 'pct100', note: 'Share of offensive snaps played.', has: (raw) => finite(raw.snap) != null, total: (list) => meanOf(list, 'snap'), game: (raw) => finite(raw.snap) },
    { id: 'usage', label: `${usageLabel} per game`, format: 'one', note: `${usageLabel} per game from the box score.`, has: (raw) => finite(raw.usage) != null, total: (list) => meanOf(list, 'usage'), game: (raw) => finite(raw.usage) },
    ...(targets ? pair('Receptions', 'usage', 'Catch rate', 'catch', 'Receptions / targets.', 'pct') : []),
    ...(targets ? pair('Receiving Yards', 'usage', 'Yards per target', 'ypt', 'Receiving yards / targets.') : []),
    ...pair('Receiving Yards', 'Receptions', 'Yards per catch', 'ypc', 'Receiving yards / receptions.'),
    ...pair('Rush Yards', 'Rush Attempts', 'Yards per carry', 'ypcarry', 'Rush yards / rush attempts.'),
    ...(usageLabel === 'Rush Att' && !props.has('Rush Attempts') ? pair('Rush Yards', 'usage', 'Yards per carry', 'ypcarry', 'Rush yards / rush attempts.') : []),
    ...pair('Pass Yards', 'Pass Attempts', 'Yards per attempt', 'ypa', 'Pass yards / pass attempts.'),
    ...pair('Pass Completions', 'Pass Attempts', 'Completion %', 'comp', 'Completions / attempts.', 'pct'),
    ...pair('Pass TDs', 'Pass Attempts', 'TD rate', 'tdr', 'Pass TDs / attempts.', 'pct'),
  ]
  return {
    sport: 'nfl',
    games,
    opponent: row?.opponent || null,
    currentSeason: currentSeason != null ? String(currentSeason) : seasonsOf(games).currentSeason,
    priorSeason: row?.priorSeasonLabel != null ? String(row.priorSeasonLabel) : seasonsOf(games).priorSeason,
    seasonLabel: (season) => String(season ?? ''),
    earlySeasonGames: EARLY_SEASON_GAMES.nfl,
    logCap: LOG_CAPS.nfl,
    oppKey: nflTeamKey,
    restApplies: false,
    handApplies: false,
    metrics,
    unavailable: [
      'Home/Away and Wins/Losses: the NFL prop logs carry only week date, opponent, snaps and usage.',
      'Rest days: weekly schedule, so 0/1/2+ days does not apply.',
      'Target share, air yards, routes, red-zone touches: not in the pipeline. Needs a licensed play-by-play or charting feed (your call).',
    ],
  }
}

// ---- KBO -------------------------------------------------------------------

function outsOf(raw) {
  const outs = finite(raw?.outs)
  if (outs != null) return outs
  const ip = finite(raw?.ip)
  if (ip == null) return null
  const whole = Math.trunc(ip)
  return whole * 3 + Math.round((ip - whole) * 10)
}

const KBO_BATTER_METRICS = [
  { id: 'avg', label: 'AVG', format: 'avg3', note: 'Hits / at-bats.', has: has('h', 'ab'), total: (rows) => ratio(sumOf(rows, 'h'), sumOf(rows, 'ab')), game: (raw) => ratio(finite(raw.h), finite(raw.ab)) },
  { id: 'obp', label: 'OBP (H+BB)', format: 'avg3', note: '(H + BB) / (AB + BB). The logs have no HBP or sac flies, so this runs slightly off official OBP.', has: has('h', 'ab', 'bb'), total: (rows) => ratio(sumOf(rows, 'h') + sumOf(rows, 'bb'), sumOf(rows, 'ab') + sumOf(rows, 'bb')), game: (raw) => ratio(finite(raw.h) + finite(raw.bb), finite(raw.ab) + finite(raw.bb)) },
  { id: 'slg', label: 'SLG', format: 'avg3', note: 'Total bases / at-bats.', has: has('tb', 'ab'), total: (rows) => ratio(sumOf(rows, 'tb'), sumOf(rows, 'ab')), game: (raw) => ratio(finite(raw.tb), finite(raw.ab)) },
  { id: 'ops', label: 'OPS (H+BB)', format: 'avg3', note: 'OBP (H+BB) + SLG.', has: has('h', 'ab', 'bb', 'tb'), total: (rows) => { const ab = sumOf(rows, 'ab'); const bb = sumOf(rows, 'bb'); const obp = ratio(sumOf(rows, 'h') + bb, ab + bb); const slg = ratio(sumOf(rows, 'tb'), ab); return obp == null || slg == null ? null : obp + slg }, game: null },
  { id: 'iso', label: 'ISO', format: 'avg3', note: 'SLG − AVG: extra bases per at-bat.', has: has('tb', 'h', 'ab'), total: (rows) => ratio(sumOf(rows, 'tb') - sumOf(rows, 'h'), sumOf(rows, 'ab')), game: (raw) => ratio(finite(raw.tb) - finite(raw.h), finite(raw.ab)) },
  { id: 'bbpct', label: 'BB %', format: 'pct', note: 'Walks / (AB + BB).', has: has('bb', 'ab'), total: (rows) => ratio(sumOf(rows, 'bb'), sumOf(rows, 'ab') + sumOf(rows, 'bb')), game: (raw) => ratio(finite(raw.bb), finite(raw.ab) + finite(raw.bb)) },
  { id: 'hr', label: 'HR per game', format: 'two', note: 'Home runs per game played.', has: has('hr'), total: (rows) => meanOf(rows, 'hr'), game: (raw) => finite(raw.hr) },
  { id: 'rrbi', label: 'R + RBI per game', format: 'one', note: 'Runs plus RBIs per game.', has: has('r', 'rbi'), total: (rows) => meanOf(rows, (raw) => finite(raw.r) + finite(raw.rbi)), game: (raw) => finite(raw.r) + finite(raw.rbi) },
]

const KBO_PITCHER_METRICS = [
  { id: 'k9', label: 'K/9', format: 'two', note: 'Strikeouts per 9 innings.', has: (raw) => finite(raw.so) != null && outsOf(raw) > 0, total: (rows) => ratio(sumOf(rows, 'so'), sumOf(rows, outsOf), 27), game: (raw) => ratio(finite(raw.so), outsOf(raw), 27) },
  { id: 'bb9', lowerIsBetter: true, label: 'BB/9', format: 'two', note: 'Walks per 9 innings.', has: (raw) => finite(raw.bb) != null && outsOf(raw) > 0, total: (rows) => ratio(sumOf(rows, 'bb'), sumOf(rows, outsOf), 27), game: (raw) => ratio(finite(raw.bb), outsOf(raw), 27) },
  { id: 'whip', lowerIsBetter: true, label: 'WHIP', format: 'two', note: '(Walks + hits) per inning.', has: (raw) => finite(raw.bb) != null && finite(raw.ha) != null && outsOf(raw) > 0, total: (rows) => ratio(sumOf(rows, 'bb') + sumOf(rows, 'ha'), sumOf(rows, outsOf), 3), game: (raw) => ratio(finite(raw.bb) + finite(raw.ha), outsOf(raw), 3) },
  { id: 'era', lowerIsBetter: true, label: 'ERA', format: 'two', note: 'Earned runs per 9 innings.', has: (raw) => finite(raw.er) != null && outsOf(raw) > 0, total: (rows) => ratio(sumOf(rows, 'er'), sumOf(rows, outsOf), 27), game: (raw) => ratio(finite(raw.er), outsOf(raw), 27) },
  { id: 'kbb', label: 'K/BB', format: 'two', note: 'Strikeouts per walk.', has: has('so', 'bb'), total: (rows) => ratio(sumOf(rows, 'so'), sumOf(rows, 'bb')), game: (raw) => ratio(finite(raw.so), finite(raw.bb)) },
  { id: 'h9', lowerIsBetter: true, label: 'H/9', format: 'two', note: 'Hits allowed per 9 innings.', has: (raw) => finite(raw.ha) != null && outsOf(raw) > 0, total: (rows) => ratio(sumOf(rows, 'ha'), sumOf(rows, outsOf), 27), game: (raw) => ratio(finite(raw.ha), outsOf(raw), 27) },
  { id: 'outs', label: 'Outs per start', format: 'one', note: 'Average outs recorded per start.', has: (raw) => outsOf(raw) != null, total: (rows) => meanOf(rows, outsOf), game: (raw) => outsOf(raw) },
]

export function kboInsights(player, { valueOf } = {}) {
  const pitcher = player?.type === 'pitcher'
  const games = (Array.isArray(player?.games) ? player.games : []).map((raw) => ({
    raw,
    value: valueOf ? finite(valueOf(raw)) : null,
    day: parseGameDay(raw?.date),
    season: raw?.season != null ? String(raw.season) : null,
    opp: raw?.opp || null,
    home: null,
    result: null,
    oppHand: !pitcher && (raw?.opp_hand === 'L' || raw?.opp_hand === 'R') ? raw.opp_hand : null,
  }))
  return {
    sport: 'kbo',
    games,
    opponent: player?.opponent || null,
    ...seasonsOf(games),
    seasonLabel: (season) => String(season ?? ''),
    earlySeasonGames: pitcher ? EARLY_SEASON_GAMES.kboPitcher : EARLY_SEASON_GAMES.kboHitter,
    logCap: LOG_CAPS.kbo,
    // Starters rarely pitch on 0 or 1 day of rest; empty rows are noise.
    hideEmptyRest: pitcher,
    restApplies: true,
    handApplies: !pitcher,
    metrics: pitcher ? KBO_PITCHER_METRICS : KBO_BATTER_METRICS,
    unavailable: pitcher
      ? ['Home/Away and Wins/Losses: the KBO pitcher logs have no venue or result.']
      : [
          'Home/Away and Wins/Losses: the KBO batter logs have no venue or result.',
          'K %: the batter logs have no strikeouts.',
        ],
  }
}
