// A preview stays labeled while a paid refresh is in flight. Zeroing the
// lock count made a 3-row member preview look like the full board.
export function previewLockedCount(preview, lockedCount) {
  if (preview !== true) return 0
  const count = Number(lockedCount)
  return Number.isFinite(count) && count > 0 ? count : 0
}
