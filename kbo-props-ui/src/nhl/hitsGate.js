// NHL Hits rows are admin-only until Code Green decides to open them.
//
// The board builder writes Hits rows only with NHL_HITS_BOARD=1, and every
// row it writes is adminOnly and rankEligible false. The member API strips
// them from nhl_projections (free preview and paid) unless the deployment
// sets NHL_HITS_PUBLIC=1. The Hits tab shows only on a dev server with
// ?nhlhits=1, or in a build with VITE_NHL_HITS=1. Hits is never in ranking
// or the free top 3.

export const HITS_PROP = 'Hits'

export function isHitsRow(row) {
  return String(row?.prop ?? row?.stat ?? '').trim().toLowerCase() === 'hits'
}

export function hitsPublic(env) {
  return String(env?.NHL_HITS_PUBLIC ?? '').trim() === '1'
}

export function dropHitsRows(rows, { allow = false } = {}) {
  if (!Array.isArray(rows)) return rows
  if (allow) return rows
  return rows.filter((row) => !isHitsRow(row))
}

export function hitsTabVisible(isDev, search, buildFlag) {
  if (String(buildFlag ?? '').trim() === '1') return true
  if (!isDev) return false
  const params = new URLSearchParams(typeof search === 'string' ? search : '')
  return params.get('nhlhits') === '1'
}
