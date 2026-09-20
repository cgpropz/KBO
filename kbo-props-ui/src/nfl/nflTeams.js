const ESPN_ABBR = { ARI: 'ari', ATL: 'atl', BAL: 'bal', BUF: 'buf', CAR: 'car', CHI: 'chi', CIN: 'cin', CLE: 'cle', DAL: 'dal', DEN: 'den', DET: 'det', GB: 'gb', HOU: 'hou', IND: 'ind', JAC: 'jax', JAX: 'jax', KC: 'kc', LA: 'lar', LAC: 'lac', LAR: 'lar', LV: 'lv', MIA: 'mia', MIN: 'min', NE: 'ne', NO: 'no', NYG: 'nyg', NYJ: 'nyj', PHI: 'phi', PIT: 'pit', SEA: 'sea', SF: 'sf', TB: 'tb', TEN: 'ten', WAS: 'wsh', WSH: 'wsh' }

export function teamLogoUrl(team) {
  const abbr = ESPN_ABBR[String(team || '').toUpperCase()]
  return abbr ? `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr}.png` : null
}
