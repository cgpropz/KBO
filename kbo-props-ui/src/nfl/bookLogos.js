// Local brand marks in public/sportsbooks. Unknown books stay as text.
// Keys are the file names. Unabated often appends a state or ".ag".

const LOGO_KEYS = [
  'barstool',
  'bet105',
  'bet365',
  'betmgm',
  'betonline',
  'betr',
  'betrivers',
  'betus',
  'bookmaker',
  'bovada',
  'buckeye',
  'caesars',
  'circa',
  'draftkings',
  'espnbet',
  'fanatics',
  'fanduel',
  'fliff',
  'goldennugget',
  'hardrock',
  'heritage',
  'kalshi',
  'lowvig',
  'novig',
  'parx',
  'pinnacle',
  'pointsbet',
  'polymarket',
  'prophetx',
  'rebet',
  'sisportsbook',
  'sporttrade',
  'superbook',
  'thescore',
  'unibet',
  'williamhill',
  'wynnbet',
]

// Names that do not share a prefix with the file.
const LOGO_ALIASES = {
  mgm: 'betmgm',
}

function normalizeBookKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function bookLogoKey(bookOrKey) {
  const raw = bookOrKey && typeof bookOrKey === 'object'
    ? (bookOrKey.book_key || bookOrKey.book)
    : bookOrKey
  const key = normalizeBookKey(raw)
  if (!key) return null
  if (LOGO_ALIASES[key]) return LOGO_ALIASES[key]
  if (LOGO_KEYS.includes(key)) return key
  let best = null
  for (const logo of LOGO_KEYS) {
    if (logo.length < 4 || !key.startsWith(logo)) continue
    if (!best || logo.length > best.length) best = logo
  }
  return best
}

function publicBase() {
  const base = import.meta.env?.BASE_URL
  if (!base) return '/'
  return base.endsWith('/') ? base : `${base}/`
}

export function bookLogoSrc(bookOrKey) {
  const key = bookLogoKey(bookOrKey)
  if (!key) return null
  return `${publicBase()}sportsbooks/${key}.svg`
}
