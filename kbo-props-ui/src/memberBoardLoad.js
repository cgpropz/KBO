// Same ceiling as FETCH_TIMEOUT_MS in apiData.js. The open-hook retry still
// uses this 12s budget. A member tile does not: it shows the error once an
// attempt misses, and keeps trying on its own for about a minute.
export const FETCH_BUDGET_MS = 12_000;
export const TILE_ATTEMPT_MS = 7_000;
export const BOARD_RETRY_WINDOW_MS = 60_000;

// This page only asks for sports the plan includes, so a free preview here
// means the server could not confirm the member. A preview, a tier_pending
// 503, or a failed request is retried with backoff. Each attempt is capped
// near 7s so the tile can leave Loading, and retries continue until the
// window is used or the board arrives. The access token is not refreshed
// on those retries; the hub refreshes it once per load.
export const MEMBER_BOARD_ATTEMPTS = 8;
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

function boardTimeout(ms) {
  const err = new Error('Board request timed out');
  err.code = 'BOARD_TIMEOUT';
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => reject(err), Math.max(1, ms));
  });
  return {
    expired,
    cancel() { clearTimeout(timer); },
  };
}

// Race the fetch against the remaining budget. apiData.js only starts its
// own timer after the access token resolves, so a hung session would
// otherwise leave the tile on Loading.
async function fetchWithinBudget(fetcher, sport, attempt, ms) {
  const limit = boardTimeout(ms);
  try {
    return await Promise.race([fetcher(sport.ds, attempt), limit.expired]);
  } finally {
    limit.cancel();
  }
}

function needsAnotherTry(snap) {
  if (!snap || snap.error) return true;
  if (snap.code === 'tier_pending') return true;
  return snap.preview === true;
}

// A late preview or error must not replace a board the tile already showed.
// null means leave the current tile alone.
export function memberBoardPatch(current, snap) {
  const failed = !snap || snap.preview === true || snap.error;
  if (current?.status === 'ready' && failed) return null;
  if (failed) return { status: 'error', raw: null, preview: snap?.preview === true };
  return {
    status: 'ready',
    raw: snap.data,
    updatedAt: snap.updatedAt ?? null,
    preview: false,
    lockedCount: snap.lockedCount,
  };
}

export async function loadMemberBoard(sport, fetcher, wait = defaultWait, options = {}) {
  const now = options.now || Date.now;
  const budgetMs = options.budgetMs || BOARD_RETRY_WINDOW_MS;
  const attemptCap = options.attemptMs || TILE_ATTEMPT_MS;
  const slot = options.slot || 0;
  const started = now();
  const elapsed = () => now() - started;
  let noticed = false;
  const note = (snap) => {
    if (noticed) return;
    noticed = true;
    if (typeof options.onUnresolved === 'function') options.onUnresolved(snap);
  };

  let last;
  for (let attempt = 0; attempt < MEMBER_BOARD_ATTEMPTS; attempt += 1) {
    if (typeof options.alive === 'function' && !options.alive()) break;
    const remaining = budgetMs - elapsed();
    if (remaining < 1) break;
    const timeoutMs = Math.max(1, Math.min(attemptCap, remaining));
    try {
      const snap = await fetchWithinBudget(
        fetcher,
        sport,
        {
          devStaticPath: sport.dev,
          fresh: false,
          retried: attempt > 0,
          priority: options.priority,
          timeoutMs,
        },
        timeoutMs,
      );
      if (!needsAnotherTry(snap)) return snap;
      last = snap;
    } catch (err) {
      last = { error: err, code: err?.code || '' };
    }
    note(last);
    if (attempt === MEMBER_BOARD_ATTEMPTS - 1) break;
    const delay = retryDelayWithin(slot + attempt, elapsed(), budgetMs);
    if (delay == null) break;
    await wait(delay);
  }
  note(last);
  if (last?.error) throw last.error;
  return last;
}

// Selected sport is started first. Every sport then loads on its own, so a
// slow or failed board cannot keep the others on Loading.
export async function loadHubSports(sports, selectedId, loadOne, isAlive = () => true) {
  const current = typeof selectedId === 'function' ? selectedId : () => selectedId;
  const preferred = current();
  const ordered = [...sports].sort((a, b) => {
    if (a.id === preferred) return -1;
    if (b.id === preferred) return 1;
    return 0;
  });
  await Promise.all(ordered.map(async (sport) => {
    if (!isAlive()) return;
    try {
      await loadOne(sport);
    } catch {
      // loadOne records its own error. One throw must not cancel the rest.
    }
  }));
}

// The token read is capped by the caller. A hang or a thrown client import
// still starts the sports, so the tiles cannot stay on Loading.
export async function beginHubLoad(loadHub, readToken, isAlive = () => true) {
  let token;
  try {
    token = await readToken();
  } catch {
    token = undefined;
  } finally {
    if (isAlive()) await loadHub(token || undefined);
  }
}

// Each sport has its own retry ticket. Refreshing the token for sport A can
// take up to 2s. A retry or a tap of sport B during that wait must not drop
// A's ticket, or A stays on loading with no Retry button. A newer retry of
// the same sport still supersedes the older one. Clearing the map on hub
// reload cancels every in-flight retry.
export function nextSportRetry(tickets, id) {
  const current = tickets && typeof tickets === 'object' ? tickets : {};
  const ticket = (current[id] || 0) + 1;
  return { tickets: { ...current, [id]: ticket }, ticket };
}

export function sportRetryStillCurrent(tickets, id, ticket) {
  return Boolean(tickets && tickets[id] === ticket);
}

// A manual Retry reuses the hub token while it is still valid. An expired
// token is refreshed first. A failed refresh keeps the token already in hand.
export async function hubTokenForRetry(current, { cached, refresh }) {
  const stillValid = typeof cached === 'function' ? cached() : null;
  if (stillValid) return stillValid;
  try {
    const next = await refresh();
    return next || current;
  } catch {
    return current;
  }
}
