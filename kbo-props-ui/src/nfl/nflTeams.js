const ESPN_ABBR = { ARI: 'ari', ATL: 'atl', BAL: 'bal', BUF: 'buf', CAR: 'car', CHI: 'chi', CIN: 'cin', CLE: 'cle', DAL: 'dal', DEN: 'den', DET: 'det', GB: 'gb', HOU: 'hou', IND: 'ind', JAC: 'jax', JAX: 'jax', KC: 'kc', LA: 'lar', LAC: 'lac', LAR: 'lar', LV: 'lv', MIA: 'mia', MIN: 'min', NE: 'ne', NO: 'no', NYG: 'nyg', NYJ: 'nyj', PHI: 'phi', PIT: 'pit', SEA: 'sea', SF: 'sf', TB: 'tb', TEN: 'ten', WAS: 'wsh', WSH: 'wsh' }

export function teamLogoUrl(team) {
  const abbr = ESPN_ABBR[String(team || '').toUpperCase()]
  return abbr ? `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr}.png` : null
}

// Used only when the ESPN mark fails to load. Not a card background.
const TEAM_COLOR = {
  ARI: '#97233F', ATL: '#A71930', BAL: '#241773', BUF: '#00338D', CAR: '#0085CA',
  CHI: '#0B162A', CIN: '#FB4F14', CLE: '#311D00', DAL: '#003594', DEN: '#FB4F14',
  DET: '#0076B6', GB: '#203731', HOU: '#03202F', IND: '#002C5F', JAX: '#006778',
  JAC: '#006778', KC: '#E31837', LA: '#003594', LAR: '#003594', LAC: '#0080C6',
  LV: '#000000', MIA: '#008E97', MIN: '#4F2683', NE: '#002244', NO: '#D3BC8D',
  NYG: '#0B2265', NYJ: '#125740', PHI: '#004C54', PIT: '#FFB612', SEA: '#002244',
  SF: '#AA0000', TB: '#D50A0A', TEN: '#0C2340', WAS: '#5A1414', WSH: '#5A1414',
}

export function teamColor(team) {
  return TEAM_COLOR[String(team || '').toUpperCase()] || '#143029'
}
