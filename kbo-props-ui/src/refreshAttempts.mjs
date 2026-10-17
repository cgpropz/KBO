// One background pass over the retry delays. 'full' stops with a replacement.
// 'stop' means this preview is the right board for the tier. Anything else,
// including a thrown attempt, keeps going. gaveUp is true only when the
// delays run out without a full board.
export async function runRefreshAttempts({ delays, sleepFn, attempt }) {
  let replaced = false
  let stopped = false
  for (const delay of delays) {
    await sleepFn(delay)
    let outcome = 'again'
    try {
      outcome = await attempt()
    } catch {
      outcome = 'again'
    }
    if (outcome === 'full') {
      replaced = true
      break
    }
    if (outcome === 'stop') {
      stopped = true
      break
    }
  }
  return { replaced, gaveUp: !replaced && !stopped }
}
