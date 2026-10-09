const ESPN = {
  ANA: 'ana', BOS: 'bos', BUF: 'buf', CAR: 'car', CBJ: 'cbj', CGY: 'cgy', CHI: 'chi', COL: 'col',
  DAL: 'dal', DET: 'det', EDM: 'edm', FLA: 'fla', LAK: 'la', MIN: 'min', MTL: 'mtl', NJD: 'nj',
  NSH: 'nsh', NYI: 'nyi', NYR: 'nyr', OTT: 'ott', PHI: 'phi', PIT: 'pit', SEA: 'sea', SJS: 'sj',
  STL: 'stl', TBL: 'tb', TOR: 'tor', UTA: 'utah', VAN: 'van', VGK: 'vgk', WPG: 'wpg', WSH: 'wsh',
  LA: 'la', NJ: 'nj', SJ: 'sj', TB: 'tb', WAS: 'wsh',
}

export const TEAM_NAMES = {
  ANA: 'Ducks', BOS: 'Bruins', BUF: 'Sabres', CAR: 'Hurricanes', CBJ: 'Blue Jackets', CGY: 'Flames',
  CHI: 'Blackhawks', COL: 'Avalanche', DAL: 'Stars', DET: 'Red Wings', EDM: 'Oilers', FLA: 'Panthers',
  LAK: 'Kings', MIN: 'Wild', MTL: 'Canadiens', NJD: 'Devils', NSH: 'Predators', NYI: 'Islanders',
  NYR: 'Rangers', OTT: 'Senators', PHI: 'Flyers', PIT: 'Penguins', SEA: 'Kraken', SJS: 'Sharks',
  STL: 'Blues', TBL: 'Lightning', TOR: 'Maple Leafs', UTA: 'Mammoth', VAN: 'Canucks', VGK: 'Golden Knights',
  WPG: 'Jets', WSH: 'Capitals',
}

export function teamLogoUrl(team) {
  const slug = ESPN[String(team || '').toUpperCase()]
  return slug ? `https://a.espncdn.com/i/teamlogos/nhl/500/${slug}.png` : null
}
