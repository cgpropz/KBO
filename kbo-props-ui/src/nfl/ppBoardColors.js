// PrizePicks odds board colors.
// Price color compares a book's American price to the selected Flex/Power
// baseline on implied probability. A higher implied probability pays the
// bettor less, so that price is worse for the bettor (green, +EV on PrizePicks).
// Hit rate color is a three-anchor scale: 30 red, 50 board text, 70 green.

export const PRICE_GREEN = '#7fff68'
export const PRICE_RED = '#ff7b79'
export const PRICE_NEUTRAL = '#b7cac3'

export const HIT_RED = [255, 123, 121]
export const HIT_NEUTRAL = [183, 202, 195]
export const HIT_GREEN = [127, 255, 104]

const HIT_LOW = 30
const HIT_MID = 50
const HIT_HIGH = 70

export function finiteNumber(value) {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function americanImplied(american) {
  const odds = Number(american)
  if (!Number.isFinite(odds) || odds === 0) return null
  if (odds > 0) return 100 / (odds + 100)
  return (-odds) / ((-odds) + 100)
}

// 'worse' = book is a worse number for the bettor than PrizePicks (green, +EV).
// 'better' = book is an easier number than PrizePicks (red, -EV).
export function priceTone(bookAmerican, baselineAmerican) {
  const book = americanImplied(bookAmerican)
  const baseline = americanImplied(baselineAmerican)
  if (book == null || baseline == null) return null
  const delta = book - baseline
  if (Math.abs(delta) <= 1e-9) return 'even'
  return delta > 0 ? 'worse' : 'better'
}

export function priceColor(bookAmerican, baselineAmerican) {
  const tone = priceTone(bookAmerican, baselineAmerican)
  if (tone === 'worse') return PRICE_GREEN
  if (tone === 'better') return PRICE_RED
  if (tone === 'even') return PRICE_NEUTRAL
  return null
}

export function priceEvLabel(bookAmerican, baselineAmerican) {
  const tone = priceTone(bookAmerican, baselineAmerican)
  if (tone === 'worse') return '+EV'
  if (tone === 'better') return '-EV'
  return null
}

function mix(start, end, amount) {
  return start.map((channel, index) => Math.round(channel + (end[index] - channel) * amount))
}

export function hitRateRgb(rate) {
  if (rate == null || rate === '') return null
  const value = Number(rate)
  if (!Number.isFinite(value)) return null
  if (value <= HIT_LOW) return HIT_RED.slice()
  if (value >= HIT_HIGH) return HIT_GREEN.slice()
  if (value <= HIT_MID) return mix(HIT_RED, HIT_NEUTRAL, (value - HIT_LOW) / (HIT_MID - HIT_LOW))
  return mix(HIT_NEUTRAL, HIT_GREEN, (value - HIT_MID) / (HIT_HIGH - HIT_MID))
}

export function hitRateColor(rate) {
  const rgb = hitRateRgb(rate)
  return rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : null
}

export function bestAmerican(books, side) {
  if (side !== 'over' && side !== 'under') return null
  let best = null
  let bestImplied = Infinity
  for (const book of books || []) {
    const price = book?.[side]
    const implied = americanImplied(price)
    if (implied == null) continue
    if (implied < bestImplied - 1e-12) {
      bestImplied = implied
      best = Number(price)
    }
  }
  return best
}

export function sameAmericanPrice(left, right) {
  const a = americanImplied(left)
  const b = americanImplied(right)
  return a != null && b != null && Math.abs(a - b) <= 1e-9
}
