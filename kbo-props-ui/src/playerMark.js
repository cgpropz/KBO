// Landing avatars. A photo is shown only for a PrizePicks image_url, and only
// while LANDING_HEADSHOTS_ENABLED is on. Anything else is initials on a team
// color. Team logos are not used.

import { isPrizePicksHeadshot } from './fitImage.js'
import { LANDING_HEADSHOTS_ENABLED } from './headshotFlag.js'
import { teamColor as nflTeamColor } from './nfl/nflTeams.js'
import { teamColor as wnbaTeamColor } from './wnba/utils/formatters.js'

const KBO_COLORS = {
  Doosan: '#9595d3', Hanwha: '#ff8c00', Kia: '#ff4444', Kiwoom: '#d4a76a',
  KT: '#e0e0e0', LG: '#e8557a', Lotte: '#ff6666', NC: '#5b9bd5',
  Samsung: '#60a5fa', SSG: '#ff5555',
}

const WNBA_ALIAS = {
  GS: 'GSV', GSV: 'GSV', LA: 'LAS', LAS: 'LAS', LV: 'LVA', LVA: 'LVA',
  NY: 'NYL', NYL: 'NYL', CONN: 'CON', CON: 'CON', WAS: 'WSH', WSH: 'WSH',
  PHO: 'PHX', PHX: 'PHX',
}

// Primary jersey colors. Abbreviations match the board, including the short forms.
const NHL_COLORS = {
  ANA: '#F47A38', BOS: '#FFB81C', BUF: '#003087', CAR: '#CE1126', CBJ: '#002654',
  CGY: '#D2001C', CHI: '#CF0A2C', COL: '#6F263D', DAL: '#006847', DET: '#CE1126',
  EDM: '#041E42', FLA: '#C8102E', LAK: '#A2AAAD', LA: '#A2AAAD', MIN: '#154734',
  MTL: '#AF1E2D', NJD: '#CE1126', NJ: '#CE1126', NSH: '#FFB81C', NYI: '#00539B',
  NYR: '#0038A8', OTT: '#C52032', PHI: '#F74902', PIT: '#FCB514', SEA: '#99D9D9',
  SJS: '#006D75', SJ: '#006D75', STL: '#002F87', TBL: '#002868', TB: '#002868',
  TOR: '#00205B', UTA: '#6CACE4', VAN: '#00205B', VGK: '#B4975A', WPG: '#041E42',
  WSH: '#C8102E', WAS: '#C8102E',
}

const FALLBACK = '#3f3f46'

export function playerInitials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

export function inkOn(hex) {
  const n = Number.parseInt(String(hex || '').replace('#', ''), 16)
  if (!Number.isFinite(n)) return '#fff'
  const y = (((n >> 16) & 255) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000
  return y > 160 ? '#111214' : '#fff'
}

export function landingTeamFill(sportId, team) {
  const sport = String(sportId || '').toLowerCase()
  const raw = String(team || '').trim()
  if (!raw) return FALLBACK
  if (sport === 'nfl') return nflTeamColor(raw)
  if (sport === 'wnba') return wnbaTeamColor(WNBA_ALIAS[raw.toUpperCase()] || raw.toUpperCase())
  if (sport === 'kbo') {
    const hit = Object.keys(KBO_COLORS).find((key) => key.toLowerCase() === raw.toLowerCase())
    return hit ? KBO_COLORS[hit] : FALLBACK
  }
  if (sport === 'nhl') return NHL_COLORS[raw.toUpperCase()] || FALLBACK
  return FALLBACK
}

export function landingHeadshotUrl(row, enabled = LANDING_HEADSHOTS_ENABLED) {
  if (!enabled || !row) return ''
  const url = String(row.ppImageUrl || row.imageUrl || row.image || '').trim()
  return isPrizePicksHeadshot(url) ? url : ''
}

export function avatarSize(size) {
  const px = Number(size)
  if (!Number.isFinite(px) || px < 16 || px > 64) return 32
  return Math.round(px)
}
