// Headshots and team logos are shown at 22–72px. The files behind them are
// often 500px PNGs. This builds a same-origin WebP URL at the size on screen.
// Anything that is not a known public logo or headshot host is left unchanged,
// so a paid data URL cannot be tunneled through the image route.

// On-screen marks are 22–72px. Retina asks for about twice that, and 128 is
// the largest file we will resize. 160 was only ever a tie with 128.
export const IMAGE_WIDTHS = [48, 64, 80, 96, 128]

// PrizePicks new_player.image_url. League and player id are path segments.
// Hyphens and repeated underscores show up in real filenames (Jean-Gabriel,
// Evgeni_Malkin__NHL). Other hosts stay off the landing even when an older
// board row still carries an ESPN, league, or team CDN headshot.
export const PRIZEPICKS_HEADSHOT = /^https:\/\/static\.prizepicks\.com\/images\/players\/[A-Za-z0-9]+\/[A-Za-z0-9_-]+\.webp$/

// Hand-uploaded PrizePicks player art. Filenames keep spaces and hyphens
// (Kim Do-yeong.png). The query parser hands the proxy a decoded space, and
// a client may also send the same name already encoded as %20.
export const PRIZEPICKS_MANUAL = /^https:\/\/static\.prizepicks\.com\/images\/manual\/[A-Za-z0-9._~% -]+\.png$/

const NFL_IMAGE = /^https:\/\/static\.www\.nfl\.com\/image\/(private|upload)\/(.+)$/i

const REMOTE_HOSTS = [
  /^https:\/\/a\.espncdn\.com\/i\/(?:teamlogos|headshots)\/[a-z0-9/_-]+\.(?:png|jpe?g|webp)$/i,
  /^https:\/\/assets\.nhle\.com\/mugs\/nhl\/[a-z0-9]+\/\d+\.png$/i,
  /^https:\/\/6ptotvmi5753\.edge\.naverncp\.com\/KBO_IMAGE\/person\/[a-z0-9/_-]+\.(?:png|jpe?g)$/i,
  /^https:\/\/mykbostats\.com\/system\/players\/photos\/\d{3}\/\d{3}\/\d{3}\/original\/\d+\.jpe?g$/i,
  PRIZEPICKS_HEADSHOT,
  PRIZEPICKS_MANUAL,
  /^https:\/\/static\.www\.nfl\.com\/image\/(?:private|upload)\/[a-z0-9,_./=-]+$/i,
  /^https:\/\/cdn\.wnba\.com\/headshots\/wnba\/latest\/\d+x\d+\/\d+\.png$/i,
]

function safeImageUrl(url) {
  return typeof url === 'string' && !url.includes('..') && !url.includes('\\') && !url.includes('@')
}

export function isPrizePicksHeadshot(url) {
  if (!safeImageUrl(url)) return false
  return PRIZEPICKS_HEADSHOT.test(url)
}

export function manualPlayerPng(url) {
  const value = String(url || '').trim()
  if (!safeImageUrl(value) || !PRIZEPICKS_MANUAL.test(value)) return ''
  return value
}

// nfl.com originals are about 3400×2450, past sharp's default pixel cap, so the
// proxy 502s and the page falls back to the full file. Ask Cloudinary for a
// 200px thumb first. A URL that already has a width or thumb is left alone.
// Spaces are not legal in fetch(), so encode them.
export function fetchableImageUrl(url) {
  let value = String(url || '').trim().replace(/ /g, '%20')
  if (!value) return ''
  const match = value.match(NFL_IMAGE)
  if (!match) return value
  const [, kind, rest] = match
  if (/(^|[/,])(?:w_\d+|c_thumb)(?:,|\/|$)/.test(rest)) return value
  const parts = rest.split('/')
  const first = parts[0]
  if (first.includes(',') || /^(?:[fcgwqe]_|e_)/i.test(first)) parts[0] = `${first},c_thumb,w_200`
  else parts.unshift('c_thumb,w_200')
  return `https://static.www.nfl.com/image/${kind}/${parts.join('/')}`
}

export function snapWidth(cssPx) {
  const wanted = Math.round(Number(cssPx) * 2)
  if (!Number.isFinite(wanted) || wanted <= 0) return 80
  return IMAGE_WIDTHS.reduce((best, width) => (
    Math.abs(width - wanted) < Math.abs(best - wanted) ? width : best
  ))
}

export function isRemoteHeadshotOrLogo(url) {
  if (!safeImageUrl(url)) return false
  return REMOTE_HOSTS.some((pattern) => pattern.test(url))
}

export function parseImageQuery(src, width) {
  let pixels = Number(width)
  // Tabs opened before the 128 thumb shipped still request w=160.
  if (pixels === 160) pixels = IMAGE_WIDTHS[IMAGE_WIDTHS.length - 1]
  if (!IMAGE_WIDTHS.includes(pixels)) return null
  if (!isRemoteHeadshotOrLogo(src)) return null
  return { src, width: pixels }
}

// cssPx is the on-screen size. Retina gets about twice that, snapped to a
// small set of widths so the cache does not fill up with one-off sizes.
export function fitImage(url, cssPx = 40) {
  if (typeof url !== 'string' || !url) return ''
  const local = url.match(/^(?:\/)?team-logos\/([a-z0-9-]+)\.(?:png|svg|webp)$/i)
  if (local) {
    const prefix = url.startsWith('/') ? '/team-logos/' : 'team-logos/'
    return `${prefix}${local[1].toLowerCase()}.webp`
  }
  const next = fetchableImageUrl(url)
  if (!isRemoteHeadshotOrLogo(next)) return url
  const width = snapWidth(cssPx)
  return `/api/img?src=${encodeURIComponent(next)}&w=${width}`
}
