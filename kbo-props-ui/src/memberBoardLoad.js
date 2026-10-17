// Same ceiling as FETCH_TIMEOUT_MS in apiData.js. Kept here so the retry
// budget can be tested without loading the browser data client.
export const FETCH_BUDGET_MS = 12_000;

// This page only asks for sports the plan includes, so a free preview here
// means the server could not confirm the member (auth or tier lookup blip,
// stale token). A preview, or a failed request, gets one retry with a fresh
// session token and no browser cache before the hub settles on it.
// The wait grows with the sport's place in line, and the retry is skipped
// when it would run past the 12s fetch budget. A slow first answer is kept.
export const BOARD_RETRY_MS = 800;
const MIN_RETRY_SLICE_MS = 1_000;

export function retryBackoffMs(slot = 0) {
  const step = Math.max(0, Number(slot) || 0);
  return BOARD_RETRY_MS * (2 ** Math.min(step, 3));
}

// Delay before another try, or null when that try could not finish inside
// the budget (the 12s data fetch, which also caps the open hooks).
export function retryDelayWithin(slot, elapsedMs, budgetMs = FETCH_BUDGET_MS) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  const delay = retryBackoffMs(slot);
  if (elapsedMs + delay + MIN_RETRY_SLICE_MS > budgetMs) return null;
  return delay;
}

const defaultWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function loadMemberBoard(sport, fetcher, wait = defaultWait, options = {}) {
  const now = options.now || Date.now;
  const budgetMs = options.budgetMs || FETCH_BUDGET_MS;
  const slot = options.slot || 0;
  const started = now();
  const elapsed = () => now() - started;
  const attemptOptions = (fresh) => ({
    devStaticPath: sport.dev,
    fresh,
    priority: options.priority,
    timeoutMs: Math.max(1, budgetMs - elapsed()),
  });

  let first;
  try {
    first = await fetcher(sport.ds, attemptOptions(false));
    if (!first?.preview) return first;
  } catch (err) {
    first = { error: err };
  }
  const delay = retryDelayWithin(slot, elapsed(), budgetMs);
  if (delay == null) {
    if (first.error) throw first.error;
    return first;
  }
  await wait(delay);
  try {
    const again = await fetcher(sport.ds, attemptOptions(true));
    if (again && (!again.preview || first.error)) return again;
  } catch (err) {
    if (first.error) throw err;
  }
  if (first.error) throw first.error;
  return first;
}

// Selected sport first. Later sports wait until the one ahead of them
// finishes, and a sport the member switches to jumps the remaining line.
export async function loadHubSports(sports, selectedId, loadOne, isAlive = () => true) {
  const pending = sports.map((sport) => sport.id);
  const byId = new Map(sports.map((sport) => [sport.id, sport]));
  const current = typeof selectedId === 'function' ? selectedId : () => selectedId;
  while (pending.length && isAlive()) {
    const preferred = current();
    const index = pending.indexOf(preferred);
    const id = index >= 0 ? pending.splice(index, 1)[0] : pending.shift();
    const sport = byId.get(id);
    if (sport) await loadOne(sport);
  }
}
