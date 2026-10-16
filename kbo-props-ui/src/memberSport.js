// Member sport default. Paid members used to land on KBO for two reasons:
// the Sports Hub featured the first ready board (KBO is first), and App wrote
// every navigation — including pricing hops and a missing value — to
// localStorage `cg_sport`, which then defaulted back to kbo. That legacy key
// is never read. An explicit pick (hub pill or in-board sport switcher) is
// stored under `cg_member_sport`. A `?sport=` link applies to this visit only.

import { APP_SPORTS, sportFromSearch } from './appSport.js'

export const LEGACY_SPORT_STORAGE_KEY = 'cg_sport'
export const MEMBER_SPORT_CHOICE_KEY = 'cg_member_sport'
export const DEFAULT_MEMBER_SPORT = 'nfl'

export function readMemberSportChoice(storage) {
  if (!storage || typeof storage.getItem !== 'function') return null
  let value = null
  try { value = storage.getItem(MEMBER_SPORT_CHOICE_KEY) } catch { return null }
  return APP_SPORTS.includes(value) ? value : null
}

export function rememberMemberSport(storage, sport) {
  if (!storage || typeof storage.setItem !== 'function') return
  if (!APP_SPORTS.includes(sport)) return
  try { storage.setItem(MEMBER_SPORT_CHOICE_KEY, sport) } catch { /* ignore */ }
}

// Query wins for this visit and is not written here. Otherwise the saved
// explicit choice, otherwise NFL. Legacy `cg_sport` is ignored.
export function resolveMemberSport({ search, storage } = {}) {
  const linked = sportFromSearch(search)
  if (linked) return linked
  return readMemberSportChoice(storage) || DEFAULT_MEMBER_SPORT
}

// Hub selection. A ready KBO board must not override the default or a pick.
export function selectedHubSport(picked) {
  return APP_SPORTS.includes(picked) ? picked : DEFAULT_MEMBER_SPORT
}

// Closed NBA is not a new choice. Callers show NFL without writing storage.
export function sportAfterNbaGate(sport, nbaOpen) {
  if (sport === 'nba' && nbaOpen === false) return DEFAULT_MEMBER_SPORT
  return sport
}
