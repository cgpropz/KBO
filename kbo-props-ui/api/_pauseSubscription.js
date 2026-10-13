// Membership pause: Stripe pause_collection for 7 days, plus HMAC email links.
//
// Access choice: paused members KEEP access.
// /policies says cancel ends the plan at the close of the paid period and does
// not claw that period back. Pause is not a cancellation and not a refund.
// pause_collection leaves the subscription active, and entitlements follow
// active/trialing status, so access continues. behavior "void" only voids
// invoices created before resumes_at, which skips that week of billing.
// Collection resumes on its own when resumes_at is reached.
//
// This module never calls Stripe. The route refuses any secret key that is
// not Stripe test mode before it constructs a client or updates a subscription.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { customersForEmail } from './_stripeTier.js';
import {
  PAUSE_COLLECTION_BEHAVIOR,
  PAUSE_LINK_TTL_SECONDS,
  pauseResumesAtUnix,
} from '../src/pauseWindow.js';

export function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

// sk_test_ / rk_test_ are Stripe test mode. Live keys are refused by the
// pause route before any Stripe client is constructed.
export function stripeSecretMode(key) {
  const cleaned = cleanEnv(key);
  if (cleaned.startsWith('sk_test_') || cleaned.startsWith('rk_test_')) return 'test';
  if (cleaned.startsWith('sk_live_') || cleaned.startsWith('rk_live_')) return 'live';
  return 'invalid';
}

export function signPauseLink({ userId, secret, now = Date.now(), ttlSeconds = PAUSE_LINK_TTL_SECONDS } = {}) {
  const uid = String(userId || '').trim();
  const key = cleanEnv(secret);
  if (!uid || !key) {
    throw new Error('Pause link requires a member id and PAUSE_LINK_SECRET');
  }
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ uid, exp })).toString('base64url');
  const sig = createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyPauseLink(token, { secret, now = Date.now() } = {}) {
  const key = cleanEnv(secret);
  if (!key) return { ok: false, reason: 'missing_secret' };
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const expected = createHmac('sha256', key).update(parts[0]).digest();
  let actual;
  try {
    actual = Buffer.from(parts[1], 'base64url');
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  let body;
  try {
    body = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!body || typeof body.uid !== 'string' || !body.uid || !Number.isFinite(body.exp)) {
    return { ok: false, reason: 'malformed' };
  }
  if (body.exp * 1000 <= now) return { ok: false, reason: 'expired' };
  return { ok: true, userId: body.uid, exp: body.exp };
}

// Direct link for email. The page posts this token with the member's session;
// the signature alone does not pause anything.
export function createPauseLink({ userId, secret, origin = 'https://www.cgpropz.com/', now, ttlSeconds } = {}) {
  const token = signPauseLink({ userId, secret, now, ttlSeconds });
  const url = new URL(origin);
  url.searchParams.set('pause', token);
  const verified = verifyPauseLink(token, { secret, now });
  return { url: url.toString(), token, exp: verified.exp };
}

export function pauseCollectionParams(nowMs = Date.now()) {
  return {
    behavior: PAUSE_COLLECTION_BEHAVIOR,
    resumes_at: pauseResumesAtUnix(nowMs),
  };
}

export function subscriptionPauseResume(subscription, nowMs = Date.now()) {
  const resumesAt = subscription?.pause_collection?.resumes_at;
  if (!Number.isFinite(resumesAt)) return null;
  if (resumesAt * 1000 <= nowMs) return null;
  return resumesAt;
}

export async function listRenewingSubscriptions(stripe, email) {
  const customers = await customersForEmail(stripe, email);
  const subscriptions = new Map();
  for (const customer of customers) {
    for (const status of ['active', 'trialing']) {
      const page = await stripe.subscriptions.list({
        customer: customer.id,
        status,
        limit: 10,
      });
      for (const sub of page.data || []) subscriptions.set(sub.id, sub);
    }
  }
  return { customers, subscriptions: [...subscriptions.values()] };
}

function isoFromUnix(seconds) {
  return new Date(seconds * 1000).toISOString();
}

// Apply the same resumes_at to every renewing subscription that is not already
// paused. An existing future resumes_at is left alone so a second click does
// not push the week out.
export async function pauseRenewingSubscriptions(stripe, subscriptions, nowMs = Date.now()) {
  const params = pauseCollectionParams(nowMs);
  const results = [];
  for (const sub of subscriptions) {
    const existing = subscriptionPauseResume(sub, nowMs);
    if (existing) {
      results.push({ id: sub.id, resumes_at: existing, already_paused: true });
      continue;
    }
    const updated = await stripe.subscriptions.update(sub.id, {
      pause_collection: params,
    });
    const resumesAt = updated?.pause_collection?.resumes_at || params.resumes_at;
    results.push({ id: updated.id, resumes_at: resumesAt, already_paused: false });
  }
  const resumesAt = results.reduce((max, row) => Math.max(max, row.resumes_at), 0);
  return {
    resumes_at: isoFromUnix(resumesAt),
    resumes_at_unix: resumesAt,
    access: 'kept',
    results,
  };
}

export function readJsonBody(req) {
  const body = req?.body;
  if (!body) return {};
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return {}; }
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) {
    try { return JSON.parse(body.toString('utf8')); } catch { return {}; }
  }
  if (typeof body === 'object') return body;
  return {};
}

export function membershipAction(body) {
  const action = typeof body?.action === 'string' ? body.action : '';
  if (action === 'pause' || action === 'status' || action === 'cancel') return action;
  if (body?.token) return 'pause';
  return 'cancel';
}

// In-memory Stripe stand-in for the Vite dev preview (?previewTier=). It uses
// a fake sk_test_ key and never opens a network connection.
export function devPreviewMembershipDeps(now = Date.now()) {
  const periodEnd = pauseResumesAtUnix(now);
  return {
    env: {
      STRIPE_SECRET_KEY: 'sk_test_dev_preview_only',
      PAUSE_LINK_SECRET: 'dev-preview-pause-link-secret',
    },
    supabase: {
      auth: {
        async getUser(token) {
          if (token !== 'dev-preview') {
            return { data: { user: null }, error: new Error('Invalid or expired token') };
          }
          return {
            data: { user: { id: 'dev-tier-preview', email: 'weekly@preview.local' } },
            error: null,
          };
        },
      },
    },
    stripe: {
      customers: {
        async list() {
          return { data: [{ id: 'cus_dev_preview', email: 'weekly@preview.local' }] };
        },
        async search() {
          return { data: [] };
        },
      },
      subscriptions: {
        async list() {
          return {
            data: [{
              id: 'sub_dev_preview',
              status: 'active',
              pause_collection: null,
              current_period_end: periodEnd,
            }],
          };
        },
        async update(id, params) {
          return {
            id,
            cancel_at_period_end: params.cancel_at_period_end === true,
            current_period_end: periodEnd,
            pause_collection: params.pause_collection || null,
          };
        },
      },
    },
    now: () => now,
  };
}
