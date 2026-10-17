import { useAuth } from './AuthContext'
import { memberBoardPhase, sportUnlockedFor } from './memberBoardPhase.js'

export function useMemberBoardPhase(sport, { refreshing = false, exhausted = false } = {}) {
  const { user, tier, tierConfirmed, planCheckExhausted } = useAuth()
  return memberBoardPhase({
    signedIn: Boolean(user),
    tierConfirmed: !user || tierConfirmed === true,
    sportUnlocked: sportUnlockedFor(sport, tier, user),
    refreshing: refreshing === true,
    exhausted: exhausted === true || planCheckExhausted === true,
  })
}
