// Copy for an empty PP Odds tab. Shared by the NFL and NHL boards.
export const SHARP_ODDS_STARTED_EMPTY = "Today's games have started. PP Odds will be back for the next slate."

// A preview with rows has nothing to say here. When every game has started,
// the tab says so. Any other empty list uses the caller's fallback.
export function sharpOddsEmptyNotice(records, { emptyState, fallback } = {}) {
  if (Array.isArray(records) && records.length > 0) return ''
  if (emptyState === 'started') return SHARP_ODDS_STARTED_EMPTY
  return fallback || ''
}
