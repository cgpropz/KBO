// Market signals for the paid Command Center. Rows come from
// /api/data?ds=market_signals. This module does not score a prop and does
// not read a projection. The chip, the clock, and the team homepage are
// display only.
import { sportAccess } from './entitlements.js'

export const SIGNAL_KINDS = {
  line_pulled: 'Line pulled',
  line_back: 'Line back',
  big_move: 'Big move',
}

const NFL_HOME = {
  ARI: 'https://www.azcardinals.com/', ATL: 'https://www.atlantafalcons.com/',
  BAL: 'https://www.baltimoreravens.com/', BUF: 'https://www.buffalobills.com/',
  CAR: 'https://www.panthers.com/', CHI: 'https://www.chicagobears.com/',
  CIN: 'https://www.bengals.com/', CLE: 'https://www.clevelandbrowns.com/',
  DAL: 'https://www.dallascowboys.com/', DEN: 'https://www.denverbroncos.com/',
  DET: 'https://www.detroitlions.com/', GB: 'https://www.packers.com/',
  HOU: 'https://www.houstontexans.com/', IND: 'https://www.colts.com/',
  JAX: 'https://www.jaguars.com/', JAC: 'https://www.jaguars.com/',
  KC: 'https://www.chiefs.com/', LAC: 'https://www.chargers.com/',
  LAR: 'https://www.therams.com/', LA: 'https://www.therams.com/',
  LV: 'https://www.raiders.com/', MIA: 'https://www.miamidolphins.com/',
  MIN: 'https://www.vikings.com/', NE: 'https://www.patriots.com/',
  NO: 'https://www.neworleanssaints.com/', NYG: 'https://www.giants.com/',
  NYJ: 'https://www.newyorkjets.com/', PHI: 'https://www.philadelphiaeagles.com/',
  PIT: 'https://www.steelers.com/', SEA: 'https://www.seahawks.com/',
  SF: 'https://www.49ers.com/', TB: 'https://www.buccaneers.com/',
  TEN: 'https://www.tennesseetitans.com/', WAS: 'https://www.commanders.com/',
  WSH: 'https://www.commanders.com/',
}

const NHL_HOME = {
  ANA: 'https://www.nhl.com/ducks', BOS: 'https://www.nhl.com/bruins',
  BUF: 'https://www.nhl.com/sabres', CAR: 'https://www.nhl.com/hurricanes',
  CBJ: 'https://www.nhl.com/bluejackets', CGY: 'https://www.nhl.com/flames',
  CHI: 'https://www.nhl.com/blackhawks', COL: 'https://www.nhl.com/avalanche',
  DAL: 'https://www.nhl.com/stars', DET: 'https://www.nhl.com/redwings',
  EDM: 'https://www.nhl.com/oilers', FLA: 'https://www.nhl.com/panthers',
  LAK: 'https://www.nhl.com/kings', LA: 'https://www.nhl.com/kings',
  MIN: 'https://www.nhl.com/wild', MTL: 'https://www.nhl.com/canadiens',
  NJD: 'https://www.nhl.com/devils', NJ: 'https://www.nhl.com/devils',
  NSH: 'https://www.nhl.com/predators', NYI: 'https://www.nhl.com/islanders',
  NYR: 'https://www.nhl.com/rangers', OTT: 'https://www.nhl.com/senators',
  PHI: 'https://www.nhl.com/flyers', PIT: 'https://www.nhl.com/penguins',
  SEA: 'https://www.nhl.com/kraken', SJS: 'https://www.nhl.com/sharks',
  SJ: 'https://www.nhl.com/sharks', STL: 'https://www.nhl.com/blues',
  TBL: 'https://www.nhl.com/lightning', TB: 'https://www.nhl.com/lightning',
  TOR: 'https://www.nhl.com/mapleleafs', UTA: 'https://www.nhl.com/mammoth',
  VAN: 'https://www.nhl.com/canucks', VGK: 'https://www.nhl.com/goldenknights',
  WPG: 'https://www.nhl.com/jets', WSH: 'https://www.nhl.com/capitals',
  WAS: 'https://www.nhl.com/capitals',
}

const NBA_HOME = {
  ATL: 'https://www.nba.com/hawks', BOS: 'https://www.nba.com/celtics',
  BKN: 'https://www.nba.com/nets', BRK: 'https://www.nba.com/nets',
  CHA: 'https://www.nba.com/hornets', CHO: 'https://www.nba.com/hornets',
  CHI: 'https://www.nba.com/bulls', CLE: 'https://www.nba.com/cavaliers',
  DAL: 'https://www.nba.com/mavericks', DEN: 'https://www.nba.com/nuggets',
  DET: 'https://www.nba.com/pistons', GS: 'https://www.nba.com/warriors',
  GSW: 'https://www.nba.com/warriors', HOU: 'https://www.nba.com/rockets',
  IND: 'https://www.nba.com/pacers', LAC: 'https://www.nba.com/clippers',
  LAL: 'https://www.nba.com/lakers', MEM: 'https://www.nba.com/grizzlies',
  MIA: 'https://www.nba.com/heat', MIL: 'https://www.nba.com/bucks',
  MIN: 'https://www.nba.com/timberwolves', NO: 'https://www.nba.com/pelicans',
  NOP: 'https://www.nba.com/pelicans', NY: 'https://www.nba.com/knicks',
  NYK: 'https://www.nba.com/knicks', OKC: 'https://www.nba.com/thunder',
  ORL: 'https://www.nba.com/magic', PHI: 'https://www.nba.com/sixers',
  PHX: 'https://www.nba.com/suns', PHO: 'https://www.nba.com/suns',
  POR: 'https://www.nba.com/blazers', SAC: 'https://www.nba.com/kings',
  SA: 'https://www.nba.com/spurs', SAS: 'https://www.nba.com/spurs',
  TOR: 'https://www.nba.com/raptors', UTA: 'https://www.nba.com/jazz',
  UTAH: 'https://www.nba.com/jazz', WSH: 'https://www.nba.com/wizards',
  WAS: 'https://www.nba.com/wizards',
}

const WNBA_HOME = {
  ATL: 'https://dream.wnba.com/', CHI: 'https://sky.wnba.com/',
  CON: 'https://sun.wnba.com/', CONN: 'https://sun.wnba.com/',
  DAL: 'https://wings.wnba.com/', GS: 'https://valkyries.wnba.com/',
  GSV: 'https://valkyries.wnba.com/', IND: 'https://fever.wnba.com/',
  LA: 'https://sparks.wnba.com/', LAS: 'https://sparks.wnba.com/',
  LV: 'https://aces.wnba.com/', LVA: 'https://aces.wnba.com/',
  MIN: 'https://lynx.wnba.com/', NY: 'https://liberty.wnba.com/',
  NYL: 'https://liberty.wnba.com/', PHX: 'https://mercury.wnba.com/',
  PHO: 'https://mercury.wnba.com/', SEA: 'https://storm.wnba.com/',
  WSH: 'https://mystics.wnba.com/', WAS: 'https://mystics.wnba.com/',
}

const KBO_HOME = {
  Doosan: 'https://www.doosanbears.com/', Hanwha: 'https://www.hanwhaeagles.co.kr/',
  Kia: 'https://www.tigers.co.kr/', KIA: 'https://www.tigers.co.kr/',
  Kiwoom: 'https://www.heroesbaseball.co.kr/', KT: 'https://www.ktwiz.co.kr/',
  LG: 'https://www.lgtwins.com/', Lotte: 'https://www.giantsclub.com/',
  NC: 'https://www.ncdinos.com/', Samsung: 'https://www.samsunglions.com/',
  SSG: 'https://www.ssglanders.com/',
}

const HOMES = { nfl: NFL_HOME, nhl: NHL_HOME, nba: NBA_HOME, wnba: WNBA_HOME, kbo: KBO_HOME }

export function teamHomeUrl(sport, team) {
  const table = HOMES[sport]
  if (!table || team == null) return null
  if (sport === 'kbo') return table[team] || table[String(team).trim()] || null
  return table[String(team).trim().toUpperCase()] || null
}

export function formatSignalTime(iso) {
  const stamp = Date.parse(iso)
  if (!Number.isFinite(stamp)) return ''
  const clock = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(new Date(stamp))
  return `${clock} ET`
}

// Fields the panel is allowed to render. A projection or CG Score on the
// row is dropped here so the signal list cannot change either number.
export function presentSignal(row) {
  if (!row || !SIGNAL_KINDS[row.kind]) return null
  return {
    signal_key: row.signal_key,
    sport: row.sport,
    kind: row.kind,
    player: row.player,
    team: row.team || '',
    game_start: row.game_start,
    signaled_at: row.signaled_at,
  }
}

export function signalsForViewer(rows, tier, now = new Date()) {
  const access = sportAccess(tier)
  const allAccess = access.kbo && access.wnba && access.nfl && access.nhl
  const instant = now.getTime()
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.player !== 'string' || !SIGNAL_KINDS[row.kind]) continue
    if (row.sport === 'nba') {
      if (!allAccess) continue
    } else if (access[row.sport] !== true) continue
    const lock = Date.parse(row.game_start)
    if (!Number.isFinite(lock) || lock <= instant) continue
    const safe = presentSignal(row)
    if (safe) out.push(safe)
  }
  return out
}

export function signalsForSport(rows, sport) {
  const sorted = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && row.sport === sport && SIGNAL_KINDS[row.kind])
    .slice()
    .sort((a, b) => String(b.signaled_at).localeCompare(String(a.signaled_at)))
  // PrizePicks and Unabated can both flag the same player. Show that chip once.
  const seen = new Set()
  const out = []
  for (const row of sorted) {
    const key = `${row.kind}|${row.player}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

// Dev screenshots only. The command center renders these when
// import.meta.env.DEV and ?exampleSignals=1 are both set. Production builds
// replace DEV with false, so members never see this list.
export function exampleSignals(now = new Date()) {
  const lock = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString()
  const at = (minutes) => new Date(now.getTime() - minutes * 60 * 1000).toISOString()
  return [
    { signal_key: 'example-pulled', sport: 'nfl', kind: 'line_pulled', player: 'Alex Example', team: 'CIN', game_start: lock, signaled_at: at(12) },
    { signal_key: 'example-back', sport: 'nfl', kind: 'line_back', player: 'Riley Example', team: 'BAL', game_start: lock, signaled_at: at(4) },
    { signal_key: 'example-move', sport: 'nfl', kind: 'big_move', player: 'Jordan Example', team: 'KC', game_start: lock, signaled_at: at(25) },
  ]
}
