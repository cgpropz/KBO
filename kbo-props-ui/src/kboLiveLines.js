// Matchup page props carry the line from the last build. When the live
// PrizePicks board no longer has that line (pulled, or no KBO lines at all),
// the stored line, edge and pick must not show as live.

// A board that loaded (even with no cards) can confirm a line is gone. A
// failed board fetch cannot, so stored lines stay.
export function boardCanConfirm(prizepicksData) {
  return !!prizepicksData && prizepicksData.failed !== true && Array.isArray(prizepicksData.cards)
}

export function withoutLiveLine(prop) {
  return { ...prop, line: null, edge: null, recommendation: 'NO LINE' }
}
