// Prod pages that never paint are reported. They do not fail the pull request.
// A preview page, preview cold status, preview goblin/demon, or a dirty
// preview odds check does.
export function proofShouldFail({
  previewPages,
  prodPages,
  previewColdStatuses,
  domPromo,
  oddsClean,
  strikeoutOk,
}) {
  const prodFailed = Object.entries(prodPages || {})
    .filter(([, page]) => page?.medianFirstCardMs == null)
    .map(([name]) => name)
  const previewPageFailed = Object.values(previewPages || {}).some((page) => page?.medianFirstCardMs == null)
  const coldFailed = (previewColdStatuses || []).some((status) => status !== 200)
  const fail = previewPageFailed || coldFailed || !!domPromo || !oddsClean || !strikeoutOk
  return { fail, prodFailed }
}
