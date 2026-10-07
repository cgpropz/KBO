// Row math for the NBA prop-lines board. Adapted from the WNBA Dashboard
// (src/wnba/Dashboard.jsx): same score, hit-rate, and grade rules, with NBA's
// five positions and a 30-team defense rank.

export const EXCLUDED_PROP_LABELS = new Set(['Points - 1st 3 Minutes'])
export const NBA_TEAM_COUNT = 30
export const PROP_TABS = ['All Props', 'Points', 'Rebounds', 'Assists', '3-PT Made', 'Steals', 'Blocks', 'Turnovers', 'Fantasy Score', 'Pts+Rebs+Asts']
export const SEASON_LABEL = String(new Date().getFullYear())
export const SORT_OPTIONS = ['L10 Hit Rate', 'CG Score', `${SEASON_LABEL} Hit Rate`, 'H2H Hit Rate', 'DVP Rank']
export const HIT_RATE_OPTIONS = [0, 50, 70, 90, 100]
export const GAMES_OPTIONS = [0, 3, 5, 8, 10]
export const POSITIONS = ['All', 'PG', 'SG', 'SF', 'PF', 'C']
export const GRADE_OPTIONS = ['All Grades', 'A', 'B', 'C', 'D', 'F']
export const DEFAULT_FILTERS = {
  side: 'All',
  sortBy: 'L10 Hit Rate',
  minHitRate: 0,
  minGames: 0,
  position: 'All',
  grade: 'All Grades',
  edgeMin: '',
  edgeMax: '',
  lineMin: '',
  lineMax: '',
}

// Counting stats the roster game log actually stores (refresh_nba_data.py).
// Offensive/defensive rebounds, field goals, and free throws are in the box
// score file used to build projections, but they are not copied onto
// players.json, so those props fall back to the stored hit rates.
const LOG_FIELDS = {
  Points: ['pts'],
  Rebounds: ['reb'],
  Assists: ['ast'],
  '3-PT Made': ['fg3m'],
  Steals: ['stl'],
  Blocks: ['blk'],
  'Blocked Shots': ['blk'],
  Turnovers: ['tov'],
  'Fantasy Score': ['pts', 'reb', 'ast', 'stl', 'blk', 'tov'],
  'Reb+Asts': ['reb', 'ast'],
  'Rebs+Asts': ['reb', 'ast'],
  'Pts+Rebs': ['pts', 'reb'],
  'Pts+Asts': ['pts', 'ast'],
  'Pts+Rebs+Asts': ['pts', 'reb', 'ast'],
  'Blks+Stls': ['blk', 'stl'],
  'Double-Double': ['pts', 'reb', 'ast', 'stl', 'blk'],
  'Triple-Double': ['pts', 'reb', 'ast', 'stl', 'blk'],
}

const OPTIONAL_FIELDS = {
  'Offensive Rebounds': 'oreb',
  'Defensive Rebounds': 'dreb',
  'FG Made': 'fgm',
  'FG Attempted': 'fga',
  'Two Pointers Made': 'fg2m',
  'Two Pointers Attempted': 'fg2a',
  '3-PT Attempted': 'fg3a',
  'Free Throws Made': 'ftm',
  'Free Throws Attempted': 'fta',
}

const ESPN_NBA = {
  ATL: 'atl', BOS: 'bos', BKN: 'bkn', BRK: 'bkn', CHA: 'cha', CHO: 'cha',
  CHI: 'chi', CLE: 'cle', DAL: 'dal', DEN: 'den', DET: 'det',
  GS: 'gs', GSW: 'gs', HOU: 'hou', IND: 'ind', LAC: 'lac', LAL: 'lal',
  MEM: 'mem', MIA: 'mia', MIL: 'mil', MIN: 'min', NO: 'no', NOP: 'no',
  NY: 'ny', NYK: 'ny', OKC: 'okc', ORL: 'orl', PHI: 'phi', PHX: 'phx', PHO: 'phx',
  POR: 'por', SAC: 'sac', SA: 'sa', SAS: 'sa', TOR: 'tor', UTAH: 'utah', UTA: 'utah',
  WSH: 'wsh', WAS: 'wsh',
}

export function nbaLogoUrl(team) {
  const slug = ESPN_NBA[String(team || '').trim().toUpperCase()]
  return slug ? `https://a.espncdn.com/i/teamlogos/nba/500/${slug}.png` : null
}

export function opponentFromMatchup(matchup) {
  const text = String(matchup || '').replace(/vs\./gi, '@').replace(/vs/gi, '@')
  const parts = text.split('@')
  return (parts[parts.length - 1] || '').trim().toUpperCase()
}

function num(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function fieldPresent(games, field) {
  return (games || []).some((game) => game && game[field] != null && game[field] !== '')
}

function fantasyScore(game) {
  if (game?.fantasy != null && game.fantasy !== '') return Number(game.fantasy) || 0
  return (Number(game?.pts) || 0)
    + (Number(game?.reb) || 0) * 1.2
    + (Number(game?.ast) || 0) * 1.5
    + (Number(game?.stl) || 0) * 3
    + (Number(game?.blk) || 0) * 3
    - (Number(game?.tov) || 0)
}

function doubleDouble(game) {
  const cats = [game?.pts, game?.reb, game?.ast, game?.stl, game?.blk].map((value) => Number(value) || 0)
  return cats.filter((value) => value >= 10).length >= 2 ? 1 : 0
}

function tripleDouble(game) {
  const cats = [game?.pts, game?.reb, game?.ast, game?.stl, game?.blk].map((value) => Number(value) || 0)
  return cats.filter((value) => value >= 10).length >= 3 ? 1 : 0
}

export function logsSupport(games, label) {
  if (!games?.length) return false
  if (Object.prototype.hasOwnProperty.call(LOG_FIELDS, label)) {
    return LOG_FIELDS[label].every((field) => fieldPresent(games, field))
  }
  const optional = OPTIONAL_FIELDS[label]
  return optional ? fieldPresent(games, optional) : false
}

export function statValue(game, label) {
  if (label === 'Fantasy Score') return fantasyScore(game)
  if (label === 'Double-Double') return doubleDouble(game)
  if (label === 'Triple-Double') return tripleDouble(game)
  if (label === 'Reb+Asts' || label === 'Rebs+Asts') return (Number(game?.reb) || 0) + (Number(game?.ast) || 0)
  if (label === 'Pts+Rebs') return (Number(game?.pts) || 0) + (Number(game?.reb) || 0)
  if (label === 'Pts+Asts') return (Number(game?.pts) || 0) + (Number(game?.ast) || 0)
  if (label === 'Pts+Rebs+Asts') return (Number(game?.pts) || 0) + (Number(game?.reb) || 0) + (Number(game?.ast) || 0)
  if (label === 'Blks+Stls') return (Number(game?.blk) || 0) + (Number(game?.stl) || 0)
  if (label === 'Blocks' || label === 'Blocked Shots') return Number(game?.blk) || 0
  const direct = {
    Points: 'pts',
    Rebounds: 'reb',
    Assists: 'ast',
    '3-PT Made': 'fg3m',
    Steals: 'stl',
    Turnovers: 'tov',
    ...OPTIONAL_FIELDS,
  }[label]
  if (!direct) return null
  return Number(game?.[direct]) || 0
}

export function computeRate(games, label, line) {
  const numericLine = num(line)
  if (!games?.length || numericLine == null || !logsSupport(games, label)) return null
  let hits = 0
  let counted = 0
  games.forEach((game) => {
    const value = statValue(game, label)
    if (value == null) return
    counted += 1
    if (value > numericLine) hits += 1
  })
  if (!counted) return null
  return { hits, total: counted, pct: (hits / counted) * 100 }
}

export function computeH2H(games, label, line, opponent) {
  const target = String(opponent || '').trim().toUpperCase()
  if (!target) return null
  const matched = (games || []).filter((game) => opponentFromMatchup(game?.matchup) === target)
  return computeRate(matched, label, line)
}

export function dvpGrade(rank, teamCount = NBA_TEAM_COUNT) {
  const value = num(rank)
  if (!value) return null
  const pct = value / teamCount
  if (pct >= 0.9) return 'A+'
  if (pct >= 0.78) return 'A'
  if (pct >= 0.66) return 'A-'
  if (pct >= 0.56) return 'B+'
  if (pct >= 0.46) return 'B'
  if (pct >= 0.36) return 'B-'
  if (pct >= 0.26) return 'C+'
  if (pct >= 0.16) return 'C'
  if (pct >= 0.1) return 'C-'
  if (pct >= 0.06) return 'D+'
  if (pct >= 0.03) return 'D'
  return 'F'
}

const DVP_RED = [255, 123, 121]
const DVP_NEUTRAL = [120, 145, 138]
const DVP_GREEN = [127, 255, 104]

function mixColor(a, b, t) {
  return a.map((channel, index) => Math.round(channel + (b[index] - channel) * t))
}

export function dvpColor(rank, teamCount = NBA_TEAM_COUNT) {
  const value = num(rank)
  if (!value) return null
  const clamped = Math.max(1, Math.min(teamCount, value))
  const mid = teamCount / 2
  const [r, g, b] = clamped <= mid
    ? mixColor(DVP_RED, DVP_NEUTRAL, (clamped - 1) / Math.max(1, mid - 1))
    : mixColor(DVP_NEUTRAL, DVP_GREEN, (clamped - mid) / mid)
  return `rgb(${r}, ${g}, ${b})`
}

function percent(value) {
  const n = num(value)
  return n == null ? null : Math.round(n)
}

function rosterMatch(player, byId, byName) {
  const id = player?.athleteId == null ? '' : String(player.athleteId)
  if (id && byId.has(id)) return byId.get(id)
  const name = String(player?.name || '').trim().toLowerCase()
  return name && byName.has(name) ? byName.get(name) : null
}

function gameLogs(player, rosterPlayer) {
  const direct = player?.gameLogs || player?.recentGames
  if (Array.isArray(direct) && direct.length) return direct
  const joined = rosterPlayer?.gameLogs || rosterPlayer?.recentGames
  return Array.isArray(joined) ? joined : []
}

export function buildPropRows(projections, players) {
  const byId = new Map()
  const byName = new Map()
  ;(Array.isArray(players) ? players : []).forEach((player) => {
    if (player?.athleteId != null && player.athleteId !== '') byId.set(String(player.athleteId), player)
    const name = String(player?.name || '').trim().toLowerCase()
    if (name) byName.set(name, player)
  })

  const rows = []
  ;(Array.isArray(projections) ? projections : []).forEach((player) => {
    const rosterPlayer = rosterMatch(player, byId, byName)
    const logs = gameLogs(player, rosterPlayer)
    const imageUrl = rosterPlayer?.image || player?.image || null
    const position = rosterPlayer?.position || player?.position || ''
    const team = player?.team || rosterPlayer?.team || ''
    ;(player?.ppAllProps || []).forEach((prop) => {
      if (!prop || EXCLUDED_PROP_LABELS.has(prop.stat)) return
      const rawLine = num(prop.line)
      const standard = num(prop.standardLine)
      const line = standard ?? rawLine
      const projection = num(prop.projection)
      if (projection == null || line == null || line <= 0) return

      const recentGames = logsSupport(logs, prop.stat) ? logs : []
      const l10Games = recentGames.slice(0, 10)
      const l10Obj = computeRate(l10Games, prop.stat, line)
      const seasonObj = computeRate(recentGames, prop.stat, line)
      const h2hObj = computeH2H(recentGames, prop.stat, line, prop.opponent ?? null)
      const recent = l10Obj
        ? l10Games.map((game) => statValue(game, prop.stat)).filter((value) => value != null).reverse()
        : []
      const storedL10 = percent(prop.hitRates?.L10)
      const storedSeason = percent(prop.hitRates?.FULL)
      const gamesPlayed = l10Obj
        ? l10Obj.total
        : (storedL10 == null ? 0 : Math.min(10, num(player.gp) || num(rosterPlayer?.gp) || 10))

      rows.push({
        id: `${player.athleteId || player.name}-${prop.stat}-${line}`,
        player: player.name,
        team,
        position,
        imageUrl,
        opponent: prop.opponent ?? null,
        prop: prop.stat,
        line,
        projection,
        score: (projection / line) * 50,
        isOver: projection >= line,
        recent,
        hitRate: l10Obj ? Math.round(l10Obj.pct) : (storedL10 ?? 0),
        gamesPlayed,
        seasonHitRate: seasonObj ? Math.round(seasonObj.pct) : storedSeason,
        h2hHitRate: h2hObj ? Math.round(h2hObj.pct) : null,
        dvpRank: num(prop.effectiveDvpRank),
        _player: { name: player.name, team, image: imageUrl },
        _hit: l10Obj,
        _edgePct: rawLine && rawLine > 0 ? ((projection - rawLine) / rawLine) * 100 : 0,
      })
    })
  })
  return rows
}

export function filterAndSortRows(allRows, propTab, filters) {
  const edgeMin = filters.edgeMin === '' ? -Infinity : Number(filters.edgeMin)
  const edgeMax = filters.edgeMax === '' ? Infinity : Number(filters.edgeMax)
  const lineMin = filters.lineMin === '' ? -Infinity : Number(filters.lineMin)
  const lineMax = filters.lineMax === '' ? Infinity : Number(filters.lineMax)

  const filtered = allRows
    .filter((item) => propTab === 'All Props' || item.prop === propTab)
    .filter((item) => filters.side === 'All' || (filters.side === 'Overs' ? item.isOver : !item.isOver))
    .filter((item) => item.hitRate >= filters.minHitRate)
    .filter((item) => item.gamesPlayed >= filters.minGames)
    .filter((item) => filters.position === 'All' || item.position === filters.position)
    .filter((item) => item.score >= edgeMin && item.score <= edgeMax)
    .filter((item) => item.line >= lineMin && item.line <= lineMax)
    .filter((item) => {
      if (filters.grade === 'All Grades') return true
      const grade = dvpGrade(item.dvpRank)
      return grade && grade[0] === filters.grade
    })

  return filtered.sort((a, b) => {
    if (filters.sortBy === 'CG Score') return b.score - a.score
    if (filters.sortBy === `${SEASON_LABEL} Hit Rate`) return (b.seasonHitRate ?? -1) - (a.seasonHitRate ?? -1)
    if (filters.sortBy === 'H2H Hit Rate') return (b.h2hHitRate ?? -1) - (a.h2hHitRate ?? -1)
    if (filters.sortBy === 'DVP Rank') return (b.dvpRank ?? 0) - (a.dvpRank ?? 0)
    return b.hitRate - a.hitRate
  })
}
