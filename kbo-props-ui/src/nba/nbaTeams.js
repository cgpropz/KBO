// Display names and jersey colors for the cheatsheet. Copied from
// nba/mappings/team_mappings.json (fullName, color) and the alias list in
// nba/game_markets.py TEAM_ALIASES. This file lives inside kbo-props-ui
// because the Vercel upload is that package only. Do not import the
// repo-root JSON from UI code.

const ALIAS = {
  GSW: 'GS',
  NYK: 'NY',
  NOP: 'NO',
  SAS: 'SA',
  UTA: 'UTAH',
  WAS: 'WSH',
  BRK: 'BKN',
  CHO: 'CHA',
  PHO: 'PHX',
}

const TEAMS = {
  ATL: { fullName: 'Atlanta Hawks', color: '#c8102e' },
  BKN: { fullName: 'Brooklyn Nets', color: '#000000' },
  BOS: { fullName: 'Boston Celtics', color: '#008348' },
  CHA: { fullName: 'Charlotte Hornets', color: '#008ca8' },
  CHI: { fullName: 'Chicago Bulls', color: '#ce1141' },
  CLE: { fullName: 'Cleveland Cavaliers', color: '#860038' },
  DAL: { fullName: 'Dallas Mavericks', color: '#0064b1' },
  DEN: { fullName: 'Denver Nuggets', color: '#0e2240' },
  DET: { fullName: 'Detroit Pistons', color: '#1d428a' },
  GS: { fullName: 'Golden State Warriors', color: '#fdb927' },
  HOU: { fullName: 'Houston Rockets', color: '#ce0e2d' },
  IND: { fullName: 'Indiana Pacers', color: '#0c2340' },
  LAC: { fullName: 'LA Clippers', color: '#12173f' },
  LAL: { fullName: 'Los Angeles Lakers', color: '#552583' },
  MEM: { fullName: 'Memphis Grizzlies', color: '#5d76a9' },
  MIA: { fullName: 'Miami Heat', color: '#98002e' },
  MIL: { fullName: 'Milwaukee Bucks', color: '#00471b' },
  MIN: { fullName: 'Minnesota Timberwolves', color: '#266092' },
  NO: { fullName: 'New Orleans Pelicans', color: '#0a2240' },
  NY: { fullName: 'New York Knicks', color: '#1d428a' },
  OKC: { fullName: 'Oklahoma City Thunder', color: '#007ac1' },
  ORL: { fullName: 'Orlando Magic', color: '#0150b5' },
  PHI: { fullName: 'Philadelphia 76ers', color: '#1d428a' },
  PHX: { fullName: 'Phoenix Suns', color: '#29127a' },
  POR: { fullName: 'Portland Trail Blazers', color: '#e03a3e' },
  SA: { fullName: 'San Antonio Spurs', color: '#000000' },
  SAC: { fullName: 'Sacramento Kings', color: '#5a2d81' },
  TOR: { fullName: 'Toronto Raptors', color: '#d91244' },
  UTAH: { fullName: 'Utah Jazz', color: '#4e008e' },
  WSH: { fullName: 'Washington Wizards', color: '#e31837' },
}

export function nbaTeam(abbr) {
  const id = String(abbr || '').toUpperCase()
  const key = ALIAS[id] || id
  return TEAMS[key] || { fullName: '', color: '' }
}
