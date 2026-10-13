// Shared pause window for the membership UI and the Stripe pause handler.
// pause_collection voids invoices created during this week (the skipped bill)
// and resumes_at is now + 7 days, so collection starts again on its own.

export const PAUSE_WEEK_SECONDS = 7 * 24 * 60 * 60;
export const PAUSE_WEEK_MS = PAUSE_WEEK_SECONDS * 1000;

// Email links expire quickly. 48 hours is long enough to open a message the
// next day and short enough that a forwarded link does not stay useful.
export const PAUSE_LINK_TTL_SECONDS = 48 * 60 * 60;

// Stripe pause_collection.behavior. void skips the invoice instead of leaving
// a draft to collect later (keep_as_draft) or marking it uncollectible.
export const PAUSE_COLLECTION_BEHAVIOR = 'void';

export function pauseResumesAtUnix(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000) + PAUSE_WEEK_SECONDS;
}

export function pauseTokenFromSearch(search) {
  const params = new URLSearchParams(typeof search === 'string' ? search : '');
  const token = params.get('pause');
  return token ? token : '';
}
