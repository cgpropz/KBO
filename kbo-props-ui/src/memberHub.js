// Paid-member Command Center (C5): turns each sport's live board snapshot into
// the few standard-line rows the hub shows. Pure functions, no fetching.
// Scores match the sport boards: KBO CG Score (kboBoardScore.scoreFor),
// NFL nflCgScore, NHL cgScore, WNBA wnbaCgScore, NBA prop.rating.
import { cgScore, lineMatchesStat } from './cgScore.js'
import { gameAlreadyStarted, gameStartFields } from './gameStarted.js'
import { hasModelNumber, kboRawRating, scoreFor as kboCgScore } from './kboBoardScore.js'
import { manualPlayerPng } from './fitImage.js'
import { pointsOverDisposition, prepareBoardRows } from './nhl/pointsGate.js'
import { nflCgScore, nflRawScore } from './nfl/nflLineFloors.js'
import { wnbaCgScore } from './wnba/wnbaScore.js'
import { chartWindowRate, kboHitPills, kboLoggedValues, nflHitPills, nhlHitPills, pillById, wnbaHitPills, wnbaLoggedValues } from './hitRateStrip.js'
import { EXCLUDED_PROP_LABELS, nbaHitPills, statValue, storedL10Values } from './nba/nbaPropLines.js'
import { nbaHighRisk, nbaRiskInput } from './nba/nbaRisk.js'
import { compareSymmetric, rankable } from './sideRank.js'
import { EXCLUDED_PROP_LABELS as WNBA_EXCLUDED_PROP_LABELS } from './wnba/excludedProps.js'

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

const isStandard = (type) => type == null || String(type).toLowerCase() === 'standard'

function sideFor(projection, line, rec) {
  const r = String(rec || '').toUpperCase()
  if (r === 'OVER' || r === 'UNDER') return r
  // A pending row has no projection: no side (Number(null) would read as 0).
  if (projection == null || (typeof projection === 'string' && projection.trim() === '')) return null
  const p = num(projection)
  const l = num(line)
  if (!Number.isFinite(p) || !Number.isFinite(l)) return null
  // On the line is no pick: no side (and no O/U letter in the hub).
  if (p === l) return null
  return p > l ? 'OVER' : 'UNDER'
}

// Same normalisation the KBO board (PlayerPropsUI) uses for player_photos.json keys.
export function normalizePlayerName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Same compact rule as nhl/availability.py blocked_status. OUT, IR, LTIR,
// scratched, and suspended come off. GTD, questionable, and probable stay.
export function blockedAvailability(value) {
  const compact = String(value || '').toUpperCase().replace(/[^A-Z]/g, '')
  if (!compact) return null
  if (compact.includes('LTIR') || compact === 'LONGTERMIR' || compact === 'LONGTERMINJUREDRESERVE' || compact === 'IRLT') return 'LTIR'
  if (compact === 'IR' || compact === 'INJUREDRESERVE') return 'IR'
  if (compact === 'OUT' || compact.startsWith('OUT')) return 'OUT'
  if (compact.includes('SCRATCH')) return 'SCRATCHED'
  if (compact.startsWith('SUSPEN')) return 'SUSPENDED'
  return null
}

// Same pulled statuses as the server (PULLED_PP_STATUSES in src/nhl/pointsGate.js).
const HELD_STATUS = new Set(['held', 'hold', 'onhold', 'suspended', 'removed', 'out', 'replaced', 'superseded'])

function statusText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z]/g, '')
}

function availabilityOf(source) {
  const src = source && typeof source === 'object' ? source : {}
  return {
    status: src.status ?? src.injury_status ?? null,
    injury: src.injury ?? src.injuryStatus ?? null,
    ppStatus: src.pp_status ?? src.ppStatus ?? src.board_status ?? src.boardStatus ?? src.line_status ?? src.lineStatus ?? null,
    held: src.held === true || src.isHeld === true || src.onHold === true || src.on_hold === true || src.is_held === true,
  }
}

// Held lines (PrizePicks hold / suspended / removed, or an explicit flag) and
// OUT / IR / LTIR / scratched / suspended players. Does not touch the score.
export function rowIsHeldOrOut(row) {
  if (!row || typeof row !== 'object') return false
  const flags = availabilityOf(row)
  if (flags.held) return true
  for (const value of [flags.status, flags.injury, flags.ppStatus]) {
    if (blockedAvailability(value)) return true
    if (HELD_STATUS.has(statusText(value))) return true
  }
  return false
}

// Daily Faceoff "Confirmed" on the lineup snapshot. Likely / probable is not
// a confirmed starter, and a missing goalie is not one either.
export function confirmedGoalieStarters(payload) {
  const starters = new Map()
  const games = Array.isArray(payload) ? payload : []
  for (const game of games) {
    const away = String(game?.awayTeam || game?.away || '').toUpperCase()
    const home = String(game?.homeTeam || game?.home || '').toUpperCase()
    const date = String(game?.date || game?.gameday || '').slice(0, 10)
    for (const [team, goalie] of Object.entries(game?.goalies || {})) {
      if (!goalie || typeof goalie !== 'object' || !goalie.name) continue
      const confirmed = goalie.confirmed === true || String(goalie.status || '').toLowerCase() === 'confirmed'
      if (!confirmed) continue
      const key = `${away}|${home}|${date}|${String(team).toUpperCase()}`
      starters.set(key, normalizePlayerName(goalie.name))
    }
    for (const [team, players] of Object.entries(game?.lineups || {})) {
      const teamKey = String(team).toUpperCase()
      const key = `${away}|${home}|${date}|${teamKey}`
      if (starters.has(key) || !Array.isArray(players)) continue
      for (const player of players) {
        if (String(player?.position || '').toUpperCase() !== 'G') continue
        if (String(player?.status || '').toUpperCase() !== 'CONFIRMED' || !player?.name) continue
        starters.set(key, normalizePlayerName(player.name))
        break
      }
    }
  }
  return starters
}

function goalieProp(row) {
  if (String(row?.position || '').toUpperCase() === 'G') return true
  const prop = String(row?.stat || row?.prop || '').trim().toLowerCase()
  return prop === 'goalie saves' || prop === 'saves'
}

function sameGoalie(player, starter) {
  const name = normalizePlayerName(player)
  if (!name || !starter) return false
  if (name === starter) return true
  const last = name.split(' ').filter(Boolean).pop()
  const starterLast = starter.split(' ').filter(Boolean).pop()
  return Boolean(last && last === starterLast)
}

// Confirmed starter for this row's team. No game on the row matches only
// when every listing for that team names the same goalie.
export function confirmedStarterFor(row, starters) {
  if (!(starters instanceof Map) || starters.size === 0) return null
  const team = String(row?.team || '').toUpperCase()
  if (!team) return null
  const away = String(row?.awayTeam || row?.away || '').toUpperCase()
  const home = String(row?.homeTeam || row?.home || '').toUpperCase()
  const date = String(row?.gameday || row?.date || '').slice(0, 10)
  if (away && home) {
    if (date && starters.has(`${away}|${home}|${date}|${team}`)) {
      return starters.get(`${away}|${home}|${date}|${team}`)
    }
    const matches = []
    for (const [key, name] of starters) {
      const [gameAway, gameHome, , gameTeam] = key.split('|')
      if (gameAway === away && gameHome === home && gameTeam === team) matches.push(name)
    }
    if (matches.length === 1) return matches[0]
    if (matches.length > 1 && matches.every((name) => name === matches[0])) return matches[0]
    if (matches.length) return null
  }
  const named = []
  for (const [key, name] of starters) {
    if (key.endsWith(`|${team}`)) named.push(name)
  }
  if (named.length && named.every((name) => name === named[0])) return named[0]
  return null
}

export function playableRows(rows, unavailableNames, starters) {
  const blocked = unavailableNames instanceof Set ? unavailableNames : new Set()
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (rowIsHeldOrOut(row)) return false
    if (row?.player && blocked.has(normalizePlayerName(row.player))) return false
    const starter = confirmedStarterFor(row, starters)
    if (starter && goalieProp(row) && !sameGoalie(row.player, starter)) return false
    return true
  })
}

function addBlockedName(names, name, status) {
  if (!name || !blockedAvailability(status)) return
  names.add(normalizePlayerName(name))
}

// Players the lineup snapshots already mark unavailable. WNBA "out" matches
// Lineups.jsx; inactive names are the same list that page groups with OUT.
// NFL and NHL read the injury report and any lineup row carrying that status.
export function unavailableFromLineups(sport, payload) {
  const names = new Set()
  const games = Array.isArray(payload) ? payload : []
  if (sport === 'wnba') {
    for (const game of games) {
      for (const side of ['visitor', 'home', 'away']) {
        const team = game?.[side]
        if (!team || typeof team !== 'object') continue
        for (const player of team.players || []) addBlockedName(names, player?.name, player?.status)
        for (const player of team.inactive || []) {
          if (!player?.name) continue
          if (player.status === 'gtd' || player.status === 'questionable') continue
          names.add(normalizePlayerName(player.name))
        }
      }
    }
    return names
  }
  if (sport === 'nfl' || sport === 'nhl') {
    for (const game of games) {
      for (const list of Object.values(game?.injuries || {})) {
        for (const player of list || []) addBlockedName(names, player?.name, player?.status)
      }
      for (const list of Object.values(game?.lineups || {})) {
        for (const player of list || []) addBlockedName(names, player?.name, player?.status || player?.injury)
      }
    }
  }
  return names
}

function scheduleFields(...sources) {
  const checks = []
  for (const source of sources) {
    const fields = gameStartFields(source)
    if (Object.keys(fields).length) checks.push(fields)
  }
  return checks.length ? { startChecks: checks } : {}
}

function finiteOrNull(value) {
  // Number(null) and Number('') are 0. A missing stored rate is not a 0% L10.
  if (value == null || value === '') return null
  const n = num(value)
  return Number.isFinite(n) ? n : null
}

// Opponent ranks are 1–32. A non-integer factor is not a rank.
function rankOrNull(value) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 32) return null
  return n
}

// Chart bars run oldest → newest. Board logs are newest-first unless noted.
function chartValues(values, newestFirst, limit = 10) {
  const nums = (Array.isArray(values) ? values : []).map((value) => Number(value)).filter((value) => Number.isFinite(value))
  const window = newestFirst ? nums.slice(0, limit) : nums.slice(-limit)
  return newestFirst ? window.reverse() : window
}

function l10FromPills(pills, storedRate) {
  const pill = pillById(pills, 'l10')
  const stored = finiteOrNull(storedRate)
  return {
    hitRate: stored != null ? stored : (pill ? pill.rate : null),
    hitGames: pill ? pill.games : null,
    hitHits: pill && Number.isFinite(pill.hits) ? pill.hits : null,
  }
}

// The Today chart and the L10 pill share one count. A full 10-game window
// uses the bars (side, numeric line, pushes left out). A shorter log does
// not invent an L10; it keeps a stored rate when the board sent one. The
// hits/games fraction still follows those bars when the decided count is the
// pill's sample, so a 7-game 57% reads 4/7.
function l10ForRow(recent, line, side, pills, storedRate) {
  const plotted = Array.isArray(recent) ? recent : []
  const fromChart = plotted.length ? chartWindowRate(plotted, line, side) : null
  if (plotted.length >= 10) {
    if (!fromChart) return { hitRate: null, hitGames: null, hitHits: null }
    return { hitRate: fromChart.rate, hitGames: fromChart.games, hitHits: fromChart.hits }
  }
  const stored = l10FromPills(pills, storedRate)
  if (stored.hitHits != null || !fromChart) return stored
  if (stored.hitGames == null || stored.hitGames === fromChart.games) {
    return { ...stored, hitHits: fromChart.hits, hitGames: fromChart.games }
  }
  return stored
}

function availabilityLabel(source) {
  const flags = availabilityOf(source)
  for (const value of [flags.injury, flags.status]) {
    if (!value || blockedAvailability(value) || HELD_STATUS.has(statusText(value))) continue
    const text = String(value).trim()
    if (!text || /^(active|healthy|available|standard)$/i.test(text)) continue
    return text
  }
  return null
}

function kboCardImage(card, named) {
  const fromCard = String(card?.image_url || card?.ppImageUrl || '').trim()
  if (manualPlayerPng(fromCard)) return fromCard
  return named || null
}

export function kboHubRows(data, photos = {}) {
  const lookup = {}
  for (const [name, url] of Object.entries(photos || {})) lookup[normalizePlayerName(name)] = url
  const rows = []
  for (const card of Array.isArray(data?.cards) ? data.cards : []) {
    for (const prop of Array.isArray(card?.props) ? card.props : []) {
      if (!isStandard(prop?.odds_type)) continue
      if (!lineMatchesStat(prop?.stat, prop?.line)) continue
      // No model number: not a hub/landing row (no 0 score, no side from avg).
      if (!hasModelNumber(prop)) continue
      // Rank by the KBO CG Score (same as the board and the ledger), not by
      // the cg_projection confidence number. Raw score breaks ties at 100.
      const cg = kboCgScore(prop)
      const score = cg == null ? NaN : cg
      const logged = Array.isArray(prop?.recent_values) && prop.recent_values.length
        ? prop.recent_values
        : kboLoggedValues(card.games, prop.stat)
      const pills = kboHitPills({ games: card.games, stat: prop.stat, line: prop.line, opponent: card.opponent })
      const recent = chartValues(logged, true)
      const side = sideFor(prop.projection ?? prop.avg, prop.line, prop.recommendation)
      rows.push({
        player: card.name,
        team: card.team,
        opponent: card.opponent,
        stat: prop.stat,
        line: prop.line,
        projection: prop.projection ?? prop.avg,
        side,
        score,
        rawScore: kboRawRating(prop.projection, prop.line, prop.stat),
        image: kboCardImage(card, photos?.[card.name] || lookup[normalizePlayerName(card.name)]),
        ppImageUrl: card.image_url || card.ppImageUrl || null,
        sport: 'kbo',
        start: card.start_time || card.game_time || null,
        ...scheduleFields(card, prop),
        recent,
        ...l10ForRow(recent, prop.line, side, pills, prop.hit_rate_l10),
        oppRank: null,
        statusLabel: availabilityLabel({ ...card, ...prop }),
        ...availabilityOf({ ...card, ...prop }),
      })
    }
  }
  return rows
}

export function nflHubRows(data) {
  return (Array.isArray(data) ? data : [])
    .filter((row) => isStandard(row?.line_type ?? row?.oddsType))
    .map((row) => {
      const recent = chartValues(row.recent, false)
      const score = num(nflCgScore(row.projection, row.line, row.prop ?? row.stat))
      // Exactly 50 is no pick: no side, and it stays out of the top list.
      const neutral = score === 50
      const side = neutral ? null : sideFor(row.projection, row.line)
      return {
        player: row.player,
        team: row.team,
        opponent: row.opponent,
        stat: row.prop ?? row.stat,
        line: row.line,
        projection: row.projection,
        side,
        score,
        neutral,
        rawScore: nflRawScore(row.projection, row.line, row.prop ?? row.stat),
        // NFL pilot rank inputs (src/sideRank.js): board games window and
        // PrizePicks wager types when the board carries them.
        sport: 'nfl',
        gamesPlayed: finiteOrNull(row.gamesPlayed),
        wagerTypes: row.wagerTypes ?? null,
        image: row.imageUrl || null,
        ppImageUrl: row.ppImageUrl || row.imageUrl || null,
        start: row.start_time || null,
        ...scheduleFields(row),
        recent,
        ...l10ForRow(recent, row.line, side, nflHitPills(row), null),
        oppRank: rankOrNull(row.dvpRank),
        statusLabel: availabilityLabel(row),
        ...availabilityOf(row),
      }
    })
}

export function nhlHubRows(data) {
  return prepareBoardRows(data)
    .filter((row) => isStandard(row?.oddsType ?? row?.odds_type) && row?.rankEligible !== false)
    .map((row) => {
      const recent = chartValues(row.recent, false)
      const side = sideFor(row.projection, row.line)
      return {
      sport: 'nhl',
      player: row.player,
      team: row.team,
      opponent: row.opponent,
      stat: row.prop ?? row.stat,
      line: row.line,
      projection: row.projection,
      side,
      score: num(cgScore(row.projection, row.line, row.prop ?? row.stat)),
      image: row.imageUrl || null,
      ppImageUrl: row.ppImageUrl || row.imageUrl || null,
      playerId: row.playerId || null,
      start: row.start_time || null,
      ...scheduleFields(row),
      recent,
      ...l10ForRow(recent, row.line, side, nhlHitPills(row), row.hitRate),
      oppRank: rankOrNull(row.dvpRank),
      goalieStatus: row.goalieStatus || null,
      statusLabel: row.goalieStatus === 'confirmed' ? 'Confirmed' : row.goalieStatus === 'probable' ? 'Probable' : availabilityLabel(row),
      detail: row,
      ...availabilityOf(row),
      }
    })
}

// Roster image first, then the board row's own image, same as nbaPropLines.buildPropRows.
function rosterImages(roster) {
  const byId = new Map()
  const byName = new Map()
  for (const p of Array.isArray(roster) ? roster : []) {
    if (!p?.image) continue
    if (p.athleteId != null && p.athleteId !== '') byId.set(String(p.athleteId), p.image)
    const name = String(p.name || '').trim().toLowerCase()
    if (name) byName.set(name, p.image)
  }
  return (player) => {
    const id = player?.athleteId == null ? '' : String(player.athleteId)
    return (id && byId.get(id)) || byName.get(String(player?.name || '').trim().toLowerCase()) || null
  }
}

function basketballRows(data, scoreFn, roster, sport) {
  const rows = []
  const imageFor = rosterImages(roster)
  const wnba = sport === 'wnba'
  for (const player of Array.isArray(data) ? data : []) {
    for (const prop of Array.isArray(player?.ppAllProps) ? player.ppAllProps : []) {
      if (!isStandard(prop?.odds_type ?? prop?.oddsType)) continue
      if (prop?.standardLine != null && num(prop.standardLine) !== num(prop.line)) continue
      const games = Array.isArray(player?.recentGames) ? player.recentGames : (Array.isArray(player?.gameLogs) ? player.gameLogs : [])
      const logged = wnba
        ? wnbaLoggedValues(games, prop.stat)
        : games.map((game) => statValue(game, prop.stat)).filter((value) => value != null)
      const series = logged.length ? logged : (storedL10Values(prop) || [])
      const pills = wnba
        ? wnbaHitPills({ games, stat: prop.stat, line: prop.line, opponent: prop.opponent || prop.versus })
        : nbaHitPills(games, prop.stat, prop.line, prop.opponent || prop.versus, storedL10Values(prop))
      const recent = chartValues(series, true)
      const side = sideFor(prop.projection, prop.line)
      const riskPlayer = sport === 'nba' ? nbaRiskInput(player) : null
      rows.push({
        sport,
        player: player.name,
        team: player.team,
        opponent: prop.opponent || prop.versus,
        stat: prop.stat,
        line: prop.line,
        projection: prop.projection,
        side,
        score: num(scoreFn(prop)),
        image: imageFor(player) || player.image || player.imageUrl || null,
        ppImageUrl: player.ppImageUrl || player.image_url || null,
        start: prop.start_time || prop.gameDate || null,
        ...scheduleFields(prop, player),
        ...(riskPlayer ? { riskPlayer } : {}),
        recent,
        ...l10ForRow(recent, prop.line, side, pills, prop.hitRates?.L10 ?? prop.hit_rate_l10),
        oppRank: rankOrNull(prop.effectiveDvpRank ?? prop.effectiveDvpFactor),
        statusLabel: availabilityLabel({ ...player, ...prop }),
        ...availabilityOf({ ...player, ...prop }),
        // NBA board fields only. WNBA rows stay without them.
        // sanity_flag and ratio are stored by the projection step. They do not
        // change the score. Only the Top 10 hit-rate list reads the flag.
        ...(sport === 'nba' ? {
          avgMins: player.avgMins,
          sanity_flag: prop.sanity_flag === true,
          ratio: prop.ratio == null || prop.ratio === '' || !Number.isFinite(num(prop.ratio)) ? null : num(prop.ratio),
        } : {}),
      })
    }
  }
  return rows
}

export const wnbaHubRows = (data, roster) => basketballRows(data, (prop) => wnbaCgScore(prop.projection, prop), roster, 'wnba')
export const nbaHubRows = (data, roster) => basketballRows(data, (prop) => prop.rating, roster, 'nba')

// A row on the line (projection == line) or with a CG Score of exactly 50
// is no pick. It never takes a top-list or hit-leader slot, in any sport.
export function isNeutralHubRow(row) {
  if (row?.neutral === true) return true
  if (num(row?.score) === 50) return true
  const p = num(row?.projection)
  const l = num(row?.line)
  return Number.isFinite(p) && Number.isFinite(l) && p === l
}

// Highest CG Score first, one row per player so the list is not one star's props.
// `symmetric` (NFL admin pilot, src/sideRank.js): same-side strength order,
// and rows that do not rank take no slot.
export function topHubRows(rows, limit = 5, { symmetric = false } = {}) {
  const base = playableRows(rows)
    .filter((r) => r.player && r.stat && Number.isFinite(num(r.line)) && Number.isFinite(r.score) && !isNeutralHubRow(r))
  const valid = symmetric
    ? base.filter((r) => rankable(r)).sort((a, b) => compareSymmetric(a, b))
    : base.sort((a, b) => (b.score - a.score) || ((Number.isFinite(b.rawScore) ? b.rawScore : 0) - (Number.isFinite(a.rawScore) ? a.rawScore : 0)))
  const seen = new Set()
  const out = []
  for (const row of valid) {
    if (seen.has(row.player)) continue
    seen.add(row.player)
    out.push(row)
    if (out.length >= limit) break
  }
  return out
}

export function countPlayable(rows) {
  return playableRows(rows).filter((r) => r.player && Number.isFinite(r.score)).length
}

// O / U letter for a row's side. No side (a neutral 50) shows no letter.
export function sideLetter(side) {
  if (side === 'UNDER') return 'U'
  if (side === 'OVER') return 'O'
  return ''
}

// Why a row is off the hit-rate list for a board rule, or null when the
// hit-rate rules themselves still apply. CG Score order is not this function.
// The first match wins so a fixture can name the check. Any match drops the row.
export function hitRateBlockReason(row, now = new Date()) {
  if (!row || typeof row !== 'object') return null
  const sources = Array.isArray(row.startChecks) && row.startChecks.length ? row.startChecks : [row]
  if (sources.some((source) => gameAlreadyStarted(source, now))) return 'started'
  if (row.sport === 'nba') {
    if (EXCLUDED_PROP_LABELS.has(row.stat)) return 'excluded-prop'
    if (row.riskPlayer && nbaHighRisk(row.riskPlayer)) return 'high-risk'
    if (row.sanity_flag === true) return 'sanity'
  } else if (row.sport === 'wnba') {
    if (WNBA_EXCLUDED_PROP_LABELS.has(row.stat)) return 'excluded-prop'
  } else if (row.sport === 'nfl' || row.sport === 'kbo') {
    if (!lineMatchesStat(row.stat, row.line)) return 'excluded-prop'
  } else if (row.sport === 'nhl') {
    if (!lineMatchesStat(row.stat, row.line) || pointsOverDisposition(row) === 'drop') return 'excluded-prop'
  }
  return null
}

// Highest L10 hit rate on the board. The sample is the chart's decided games
// (pushes already left out). A log shorter than 10, or a window with no
// decided game, is not an L10 and stays off the list. Started games, excluded
// prop labels, the NBA high-risk screen, and an NBA row with sanity_flag
// use the same board checks. CG Score order, the free top 3, and the main
// board do not read the flag.
export function topHitRateRows(rows, limit = 10, now = new Date()) {
  const ranked = playableRows(rows)
    .filter((row) => (
      // A neutral row (CG exactly 50, or on the line) is no pick, so it is not a hit leader.
      !hitRateBlockReason(row, now)
      && !isNeutralHubRow(row)
      && row?.player
      && row?.stat
      && Array.isArray(row.recent)
      && row.recent.length >= 10
      && Number.isFinite(num(row.line))
      && Number.isFinite(row.hitRate)
      && Number.isFinite(row.hitHits)
      && Number.isFinite(row.hitGames)
      && row.hitGames > 0
    ))
    .sort((a, b) => (
      (b.hitRate - a.hitRate)
      || (b.hitGames - a.hitGames)
      || ((Number.isFinite(b.score) ? b.score : -Infinity) - (Number.isFinite(a.score) ? a.score : -Infinity))
      || String(a.player).localeCompare(String(b.player))
      || String(a.stat).localeCompare(String(b.stat))
    ))
  const seen = new Set()
  const out = []
  for (const row of ranked) {
    const key = `${row.player}|${row.stat}|${row.line}|${row.side || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
    if (out.length >= limit) break
  }
  return out
}

// "Yesterday" in ET. A slate older than that is shown as the last graded slate.
export function etDateIso(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function recapLabel(slateIso, now = new Date()) {
  if (!slateIso) return null
  const today = etDateIso(now)
  const y = new Date(`${today}T12:00:00Z`)
  y.setUTCDate(y.getUTCDate() - 1)
  const yesterday = y.toISOString().slice(0, 10)
  if (slateIso === yesterday) return 'Yesterday'
  if (slateIso === today) return 'Today'
  const d = new Date(`${slateIso}T12:00:00Z`)
  return `Last graded ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`
}

export function formatRecord(r) {
  if (!r) return null
  return `${r.hits}-${r.misses}${r.pushes ? `-${r.pushes}` : ''}`
}

function gameFromSides(team, opponent, start) {
  if (!team) return null
  return { team, opponent: opponent || '', start: start || null }
}

// Slate matchups from lineup cards, then any prop row whose game isn't listed.
export function hubGames(sport, rows, lineups) {
  const games = []
  const seen = new Set()
  const add = (game) => {
    if (!game?.team) return
    const key = [game.team, game.opponent].filter(Boolean).sort().join('|')
    if (seen.has(key)) return
    seen.add(key)
    games.push(game)
  }
  const cards = Array.isArray(lineups) ? lineups : []
  if (sport === 'nhl' || sport === 'nfl') {
    for (const card of cards) add(gameFromSides(card.awayTeam || card.away, card.homeTeam || card.home, card.start_time || card.start || null))
  } else if (sport === 'wnba') {
    for (const card of cards) {
      const away = card.visitor?.abbr || card.visitor?.team || card.away
      const home = card.home?.abbr || card.home?.team || card.homeTeam
      add(gameFromSides(away, home, card.start || card.start_time || null))
    }
  }
  for (const row of rows || []) add(gameFromSides(row.team, row.opponent, row.start))
  return games
}

export function sameMatchup(row, game) {
  if (!game) return true
  const sides = new Set([game.team, game.opponent].filter(Boolean))
  if (!sides.size || !row?.team) return false
  if (!sides.has(row.team)) return false
  return !row.opponent || sides.has(row.opponent)
}

// Status chips the hub can stand behind. Goalie and line wording come from the
// lineup snapshot. The recap chip is the graded record, not a projection.
export function statusChips({ sport, rows, lineups, recap, ready = true, now = new Date() }) {
  const chips = []
  const cards = Array.isArray(lineups) ? lineups : []
  if (sport === 'nhl') {
    let confirmed = 0
    let probable = 0
    for (const card of cards) {
      for (const goalie of Object.values(card?.goalies || {})) {
        if (goalie?.confirmed === true || goalie?.status === 'confirmed') confirmed += 1
        else if (goalie?.status === 'probable') probable += 1
      }
    }
    if (!confirmed) {
      for (const row of rows || []) {
        if (row?.goalieStatus === 'confirmed') confirmed += 1
        else if (row?.goalieStatus === 'probable') probable += 1
      }
    }
    if (confirmed) chips.push({ tone: 'good', text: confirmed > 1 ? `${confirmed} goalies confirmed` : 'Goalie confirmed' })
    else if (probable) chips.push({ tone: 'warn', text: 'Goalie probable' })
    const labels = cards.flatMap((card) => Object.values(card?.lineLabels || {})).map((label) => String(label || ''))
    if (labels.some((label) => /NOT POSTED|LAST GAME/i.test(label))) chips.push({ tone: 'warn', text: 'Lines pending' })
    else if (labels.length && labels.every((label) => /PROJECTED/i.test(label))) chips.push({ tone: 'warn', text: 'Lines projected' })
  } else if (ready && !(rows || []).length) {
    chips.push({ tone: 'warn', text: 'Lines pending' })
  }
  const record = formatRecord(recap)
  if (record && recap?.slate_date_iso) {
    const label = recapLabel(recap.slate_date_iso, now)
    chips.push({
      tone: 'neutral',
      action: 'results',
      text: `${label} ${record} → Results`,
      prefix: label,
      hits: recap.hits,
      misses: recap.misses,
      pushes: recap.pushes || 0,
    })
  }
  return chips
}

// ET calendar day of a row/game start. A bare YYYY-MM-DD is already a gameday.
export function etGameday(start) {
  if (!start) return null
  const s = String(start)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const t = Date.parse(s)
  return Number.isFinite(t) ? etDateIso(new Date(t)) : null
}

function notStarted(start, now) {
  const s = String(start)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s >= etDateIso(now)
  const t = Date.parse(s)
  return Number.isFinite(t) && t > now.getTime()
}

// The next gameday: the earliest ET day that still has a game not yet started.
export function nextGameday(items, now = new Date()) {
  let best = null
  for (const item of items || []) {
    if (!item?.start || !notStarted(item.start, now)) continue
    const day = etGameday(item.start)
    if (day && (!best || day < best)) best = day
  }
  return best
}

// Keep the hub on one slate. Items with no usable start can't be placed on a
// day and stay in; everything dated on another gameday is dropped.
// NFL is a weekly slate (Sunday through Monday night), so it is never scoped.
export const WEEKLY_SLATE_SPORTS = new Set(['nfl'])
export function hubGamedayFor(sport, items, now = new Date()) {
  return WEEKLY_SLATE_SPORTS.has(sport) ? null : nextGameday(items, now)
}

export function scopeToGameday(items, day) {
  if (!day) return items || []
  return (items || []).filter((item) => {
    const d = etGameday(item?.start)
    return !d || d === day
  })
}
