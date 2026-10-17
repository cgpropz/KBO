import { FETCH_BUDGET_MS, retryDelayWithin } from './memberBoardLoad.js';

// Each open-hook attempt stays inside its 8s cap. A retry only starts when
// the backoff still fits in the same 12s budget as /api/data.
export const OPEN_ATTEMPT_MS = 8_000;

export async function readOpenFlag(url, {
  token,
  fetchImpl = globalThis.fetch,
  budgetMs = FETCH_BUDGET_MS,
  attemptMs = OPEN_ATTEMPT_MS,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  cancelled = () => false,
} = {}) {
  const started = now();
  let attempt = 0;
  while (!cancelled()) {
    const left = budgetMs - (now() - started);
    if (left < 250) break;
    try {
      const res = await fetchImpl(url, {
        cache: 'no-store',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(Math.min(attemptMs, left)),
      });
      if (cancelled()) return false;
      if (!res.ok) return false;
      const body = await res.json();
      return body?.open === true;
    } catch {
      if (cancelled()) return false;
      const delay = retryDelayWithin(attempt, now() - started, budgetMs);
      if (delay == null) break;
      await wait(delay);
      attempt += 1;
    }
  }
  return false;
}
