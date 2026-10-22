import { useAuth } from './AuthContext'
import { memberBoardPhase, sportUnlockedFor } from './memberBoardPhase.js'
import { useNbaOpen } from './useNbaOpen.js'

export function useMemberBoardPhase(sport, { refreshing = false, exhausted = false } = {}) {
  const { user, tier, tierConfirmed, planCheckExhausted } = useAuth()
  const nba = useNbaOpen()
  // Wait for the NBA access check before deciding, so a member never flashes
  // the free paywall while it is in flight.
  const nbaPending = sport === 'nba' && Boolean(user) && nba.ready !== true
  return memberBoardPhase({
    signedIn: Boolean(user),
    tierConfirmed: !user || (tierConfirmed === true && !nbaPending),
    sportUnlocked: sportUnlockedFor(sport, tier, user, nba.open),
    refreshing: refreshing === true,
    exhausted: exhausted === true || planCheckExhausted === true,
  })
}
