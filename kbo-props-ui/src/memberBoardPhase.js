import { canSeeNba, sportAccess } from './entitlements.js'

// 'free' is a confirmed signed-out visitor or a confirmed plan that does not
// include this sport. 'loading' is a signed-in plan check or a member refresh.
// 'exhausted' is that wait after the retries stop. 'member' is the full board.
export function memberBoardPhase({ signedIn, tierConfirmed, sportUnlocked, refreshing, exhausted }) {
  if (!signedIn) return 'free'
  if (tierConfirmed && !sportUnlocked) return 'free'
  if (exhausted && !refreshing) return 'exhausted'
  if (!tierConfirmed || refreshing) return 'loading'
  return 'member'
}

export function sportUnlockedFor(sport, tier, user) {
  if (sport === 'nba') return canSeeNba(user)
  return sportAccess(tier)[sport] === true
}

// A confirmed member still sitting on the preview, with the refresh finished
// or never started, needs the free-preview label and a Retry.
export function memberSeesQuietPreview(phase, preview, refreshing) {
  return phase === 'member' && preview === true && refreshing !== true
}
