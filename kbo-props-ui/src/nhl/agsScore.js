// Scorer-prop CG Score display. 50 is a league-average scorer.
// The live number is computed in nhl/ags.py. These bands are the approved
// 2025-26 NHL backtest (2026-01-08 to 2026-04-16, n=22,239).

export const SCORE_LINE = '50 = league-average scorer'

export const NHL_AGS_BACKTEST = {
  label: 'Backtest',
  smallSample: 'One season (2026-01-08 to 2026-04-16). Small sample.',
  responsible: '21+ · Play responsibly',
  bands: [
    { band: '<25', n: 5385, hitPct: 5.0 },
    { band: '25-50', n: 6678, hitPct: 10.8 },
    { band: '50-75', n: 5979, hitPct: 19.8 },
    { band: '75-100', n: 3460, hitPct: 28.8 },
    { band: '100+', n: 737, hitPct: 34.7 },
  ],
}

export function formatBacktestBand(band) {
  const hit = Number(band?.hitPct)
  const count = Number(band?.n)
  if (!band?.band || !Number.isFinite(hit) || !Number.isFinite(count)) return ''
  return `${band.band} ${hit.toFixed(1)}% · n=${count.toLocaleString('en-US')}`
}
