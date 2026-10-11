import { cgScore } from '../cgScore.js'

// CG Score for one WNBA row is projection / that row's line × 50.
//
// standardLine is the companion standard PrizePicks number. The Sep 22
// dashboard redesign stored it in the same variable the score divided by,
// so demon and goblin rows were scored against the standard line. That was
// not a separate scoring rule: the dashboard comment still said the score
// mirrors the projections page, which divides by the pick's own line, and
// KBO and NFL alt rows do the same. NFL per-stat floors stay in nflCgScore
// and are not applied here. A 0.5 WNBA counting line is a real line.
export function wnbaCgScore(projection, prop) {
  return cgScore(projection, prop?.line, prop?.stat ?? prop?.prop)
}
