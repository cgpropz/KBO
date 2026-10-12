// Headshots and team logos are shown at 22–72px. The files behind them are
// often 500px PNGs. This builds a same-origin WebP URL at the size on screen.
// Anything that is not a known public logo or headshot host is left unchanged,
// so a paid data URL cannot be tunneled through the image route.

export const IMAGE_WIDTHS = [48, 64, 80, 96, 128, 160]

const REMOTE_HOSTS = [
  /^https:\/\/a\.espncdn\.com\/i\/(?:teamlogos|headshots)\/[a-z0-9/_-]+\.(?:png|jpe?g|webp)$/i,
  /^https:\/\/assets\.nhle\.com\/mugs\/nhl\/[a-z0-9]+\/\d+\.png$/i,
  /^https:\/\/6ptotvmi5753\.edge\.naverncp\.com\/KBO_IMAGE\/person\/[a-z0-9/_-]+\.(?:png|jpe?g)$/i,
  /^https:\/\/mykbostats\.com\/system\/players\/photos\/\d{3}\/\d{3}\/\d{3}\/original\/\d+\.jpe?g$/i,
]

export function snapWidth(cssPx) {
  const wanted = Math.round(Number(cssPx) * 2)
  if (!Number.isFinite(wanted) || wanted <= 0) return 80
  return IMAGE_WIDTHS.reduce((best, width) => (
    Math.abs(width - wanted) < Math.abs(best - wanted) ? width : best
  ))
}

export function isRemoteHeadshotOrLogo(url) {
  if (typeof url !== 'string' || url.includes('..') || url.includes('\\') || url.includes('@')) return false
  return REMOTE_HOSTS.some((pattern) => pattern.test(url))
}

export function parseImageQuery(src, width) {
  const pixels = Number(width)
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
  if (!isRemoteHeadshotOrLogo(url)) return url
  const width = snapWidth(cssPx)
  return `/api/img?src=${encodeURIComponent(url)}&w=${width}`
}
