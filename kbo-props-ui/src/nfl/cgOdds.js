// CG odds: one fair price per NFL prop, compared with the PrizePicks line.
//
// computeCgOdds() is the only entry point the CG odds column in
// NflSharpOdds.jsx reads. Swap CG_METHOD (or the functions below) to change
// the formula; the UI only reads { probability, american, edgePct, ... }.
//
// Method: Sniper Bot spec, /workspace/shared/lab/cg_odds_2026-10-16/spec.md
// (ported from its cg_odds.py reference):
//   1. Per book, both sides at the matched line (row.book_prices), hold in (0, 25%].
//   2. Devig each book with the power method (k > 1, q_o^k + q_u^k = 1).
//   3. Move each book's fair Over from the book line to the PP line
//      (Poisson for count stats, linear per-half-point shift for yardage).
//   4. Combine in logit space with book weights x hold penalty x off-line penalty.
// The weights are the spec's priors, not fitted: there is no stored
// multi-book history yet (spec §7). Not validated by any backtest.
//
// placeholderNoVig() is the earlier placeholder (the Sharp Odds no-vig
// consensus from PR #43). It is kept for comparison only and is not used.
// Nothing here fills a gap: a row without a usable two-sided book returns null.

export const CG_METHOD = 'sniper-spec-2026-10-13:power-devig+book-weights+line-shift'
export const PLACEHOLDER_METHOD = 'placeholder-sharp-odds-no-vig-consensus'

// Book lines further than this from the PrizePicks line are dropped.
export const MAX_LINE_GAP = 0.5

export const BOOK_WEIGHTS = {
  pinnacle: 3.0, circa: 3.0, bookmaker: 2.0, betonline: 1.5, betonlineag: 1.5,
  lowvig: 1.5, buckeye: 1.0, fanduel: 1.0, draftkings: 0.75, caesars: 0.5,
  betmgm: 0.5, betrivers: 0.5, espnbet: 0.5, fanatics: 0.5, hardrock: 0.5, bovada: 0.5,
}
const DEFAULT_WEIGHT = 0.5
const HOLD_PENALTY = 0.10
const MAX_HOLD = 0.25

// Probability shift per half point for yardage props. Count stats are absent
// here and use the Poisson path (spec §4).
export const HALF_POINT_SHIFT = {
  'Receiving Yards': 0.006,
  'Rush Yards': 0.006,
  'Pass Yards': 0.005,
  'Rush+Rec Yds': 0.005,
  'Pass+Rush Yds': 0.005,
}

function finite(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function impliedProbability(american) {
  const a = finite(american)
  if (a == null || a === 0) return null
  return a > 0 ? 100 / (a + 100) : -a / (-a + 100)
}

export function probabilityToAmerican(probability) {
  const p = finite(probability)
  if (p == null || p <= 0 || p >= 1) return null
  return Math.round(p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p)
}

export function devigPower(qOver, qUnder) {
  let lo = 1
  let hi = 10
  let k = 1
  for (let i = 0; i < 100; i += 1) {
    k = (lo + hi) / 2
    if (qOver ** k + qUnder ** k > 1) lo = k
    else hi = k
  }
  return [qOver ** k, qUnder ** k]
}

function poissonCdf(k, lambda) {
  let term = Math.exp(-lambda)
  let total = term
  for (let i = 1; i <= k; i += 1) {
    term *= lambda / i
    total += term
  }
  return total
}

// Python port: nfl/sharp_odds.py shift_over. The parity test compares floats.
export function shiftOver(pOver, bookLine, ppLine, prop) {
  if (bookLine === ppLine) return pOver
  const step = HALF_POINT_SHIFT[prop]
  if (step == null) {
    let lo = 0.01
    let hi = 60
    let lambda = lo
    for (let i = 0; i < 80; i += 1) {
      lambda = (lo + hi) / 2
      if (1 - poissonCdf(Math.floor(bookLine), lambda) < pOver) lo = lambda
      else hi = lambda
    }
    return 1 - poissonCdf(Math.floor(ppLine), lambda)
  }
  return Math.min(0.99, Math.max(0.01, pOver + (step * (bookLine - ppLine)) / 0.5))
}

const logit = (p) => Math.log(p / (1 - p))
const expit = (x) => 1 / (1 + Math.exp(-x))

// Returns { over, under, books, lineAdjusted } or null.
export function cgFair(item) {
  const ppLine = finite(item?.pp_line)
  if (ppLine == null || !Array.isArray(item?.book_prices)) return null
  const bookLine = finite(item?.matched_line) ?? ppLine
  // Code Green's rule: only use book lines within ±0.5 of the PrizePicks line.
  if (Math.abs(bookLine - ppLine) > MAX_LINE_GAP + 1e-9) return null
  let num = 0
  let den = 0
  const books = []
  for (const quote of item.book_prices) {
    const qOver = impliedProbability(quote?.over)
    const qUnder = impliedProbability(quote?.under)
    if (qOver == null || qUnder == null) continue
    const hold = qOver + qUnder - 1
    if (hold <= 0 || hold > MAX_HOLD) continue
    const [fairOver] = devigPower(qOver, qUnder)
    const shifted = shiftOver(fairOver, bookLine, ppLine, item.prop)
    if (!(shifted > 0 && shifted < 1)) continue
    const key = String(quote.book_key || '').toLowerCase()
    let weight = BOOK_WEIGHTS[key] ?? DEFAULT_WEIGHT
    weight *= Math.min(1, hold > HOLD_PENALTY ? HOLD_PENALTY / hold : 1)
    weight *= 0.5 ** (Math.abs(bookLine - ppLine) / 0.5)
    num += weight * logit(shifted)
    den += weight
    books.push(quote.book || key)
  }
  if (!den) return null
  const over = expit(num / den)
  return { over, under: 1 - over, books, lineAdjusted: bookLine !== ppLine }
}

// Earlier placeholder, kept for side-by-side comparison only.
export function placeholderNoVig(item) {
  const over = finite(item?.fair_over_pct)
  const under = finite(item?.fair_under_pct)
  if (over == null || under == null || over <= 0 || under <= 0) return null
  return { over: over / 100, under: under / 100, books: item.fair_books || [], lineAdjusted: false }
}

// side: 'over' | 'under'. breakeven: PrizePicks break-even win probability (0-1).
// Returns { probability, american, edgePct, books, lineAdjusted, method } or null.
export function computeCgOdds(item, side, breakeven) {
  if (side !== 'over' && side !== 'under') return null
  const fair = cgFair(item)
  if (!fair) return null
  const probability = side === 'under' ? fair.under : fair.over
  const be = finite(breakeven)
  return {
    probability,
    american: probabilityToAmerican(probability),
    edgePct: be == null ? null : Math.round((probability - be) * 1000) / 10,
    books: fair.books,
    lineAdjusted: fair.lineAdjusted,
    method: CG_METHOD,
  }
}
