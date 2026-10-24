/*
 * Marketing attribution + X (Twitter) pixel purchase tracking (client only).
 *
 * - captureAttribution(): stores utm_* / twclid from the landing URL in
 *   localStorage so they survive sign-up and checkout.
 * - utmParams(): the stored UTM codes, validated to Stripe's Payment Link
 *   rules, so they can be appended to the payment link (Stripe records them on
 *   the payment and passes them back on the after-payment redirect).
 * - trackPurchaseOnce(): fires the X purchase event exactly once per Stripe
 *   Checkout Session, using the session id as conversion_id so X can
 *   de-duplicate it against the server-side Conversions API report sent from
 *   api/stripe-webhook.js.
 */

import { STRIPE_LINKS } from './pricingTiers.js';

export const X_PURCHASE_EVENT = 'tw-pul9k-pul9m';

const ATTRIBUTION_KEY = 'cg_attribution';
const PURCHASES_KEY = 'cg_x_purchases_sent';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
// Stripe Payment Links accept alphanumerics, dashes and underscores, <= 150 chars.
const UTM_VALUE_RE = /^[A-Za-z0-9_-]{1,150}$/;

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

// Last-touch attribution: a visit with new UTM codes replaces the old ones.
export function captureAttribution(search = typeof window !== 'undefined' ? window.location.search : '') {
  const params = new URLSearchParams(search);
  const found = {};
  for (const key of UTM_KEYS) {
    const value = (params.get(key) || '').trim();
    if (value) found[key] = value.slice(0, 150);
  }
  const twclid = (params.get('twclid') || '').trim();
  if (twclid) found.twclid = twclid.slice(0, 200);
  if (!Object.keys(found).length) return;
  writeJson(ATTRIBUTION_KEY, { ...found, captured_at: new Date().toISOString() });
}

export function getAttribution() {
  const stored = readJson(ATTRIBUTION_KEY, null);
  return stored && typeof stored === 'object' ? stored : {};
}

// UTM codes that are safe to append to a Stripe Payment Link.
export function utmParams() {
  const stored = getAttribution();
  const out = {};
  for (const key of UTM_KEYS) {
    if (UTM_VALUE_RE.test(stored[key] || '')) out[key] = stored[key];
  }
  return out;
}

/*
 * Payment Link URL for a plan:
 * - logged in: client_reference_id (Supabase user id) + prefilled_email, so the
 *   webhook links the payment to the account instantly;
 * - logged out: no identifiers; the webhook / sync-subscription match the
 *   payment by the checkout email once the buyer signs up with it.
 * Stored UTM codes are appended in both cases.
 *
 * Weekly does not use prefilled_promo_code. Stripe Payment Links reject XWEEK
 * ("This promotion code is invalid") and leave the price at $9.99. The weekly
 * Buy click uses openWeeklyCheckoutUrl(), which opens a Checkout Session for
 * the same weekly price with XWEEK already applied ($4.99).
 */
export function buildCheckoutUrl(link, user) {
  const url = new URL(link);
  if (user?.id) url.searchParams.set('client_reference_id', user.id);
  if (user?.email) url.searchParams.set('prefilled_email', user.email);
  for (const [key, value] of Object.entries(utmParams())) url.searchParams.set(key, value);
  return url.toString();
}

const CHECKOUT_HOST = 'https://checkout.stripe.com/';

// A URL returned by a Buy click is reused for this long. The server also
// reuses an open Stripe session for the same customer and price. This map
// covers a second click (and guests, who have no Stripe customer yet) so
// the browser does not mint another session.
export const CHECKOUT_URL_REUSE_MS = 60 * 60 * 1000;
const clickUrls = new Map();
const clickInflight = new Map();

function freshClickUrl(key) {
  const hit = clickUrls.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= CHECKOUT_URL_REUSE_MS) {
    clickUrls.delete(key);
    return null;
  }
  return hit.value;
}

// Ask the server for the live weekly Checkout Session (XWEEK applied when the
// code is valid for this buyer; otherwise the full $9.99 weekly checkout).
// Callers are Buy clicks. Do not call this on page load.
export async function requestWeeklyCheckoutUrl({ token, utm = utmParams(), fetchImpl = globalThis.fetch } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl('/api/weekly-checkout', {
    method: 'POST',
    headers,
    body: JSON.stringify(utm || {}),
  });
  if (!res.ok) throw new Error('weekly checkout failed');
  const data = await res.json();
  const url = String(data?.url || '');
  if (!url.startsWith(CHECKOUT_HOST)) throw new Error('unexpected checkout url');
  return url;
}

// Weekly Buy click. Reuses the URL from an earlier click in this tab, and
// shares one in-flight request if the button is hit twice before it returns.
export async function openWeeklyCheckoutUrl(options = {}) {
  const key = `weekly:${options.token || ''}`;
  const cached = freshClickUrl(key);
  if (cached) return cached;
  if (!clickInflight.has(key)) {
    const pending = requestWeeklyCheckoutUrl(options).then((url) => {
      clickUrls.set(key, { value: url, at: Date.now() });
      return url;
    }).finally(() => {
      clickInflight.delete(key);
    });
    clickInflight.set(key, pending);
  }
  return clickInflight.get(key);
}

// Discord-only Checkout Session. The server picks the price from env; the
// client only sends weekly or monthly. No Payment Link fallback: there isn't
// one until those prices exist.
export async function requestDiscordCheckoutUrl({ plan, token, utm = utmParams(), fetchImpl = globalThis.fetch } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl('/api/discord-checkout', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...(utm || {}), plan }),
  });
  if (!res.ok) throw new Error('discord checkout failed');
  const data = await res.json();
  const url = String(data?.url || '');
  if (!url.startsWith(CHECKOUT_HOST)) throw new Error('unexpected checkout url');
  return url;
}

// Lifetime ($249.99) and Founders ($99.99) Checkout Sessions. Founders past
// the cap or the deadline is refused: the response has no URL, and reason is
// 'sold_out' or 'expired'. Lifetime is not substituted. Buy clicks only.
async function fetchOfferCheckoutUrl({ plan, token, utm = utmParams(), fetchImpl = globalThis.fetch } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const path = plan === 'founders' ? '/api/checkout/founders' : '/api/checkout/lifetime';
  const res = await fetchImpl(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(utm || {}),
  });
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const err = new Error(data?.error || 'checkout failed');
    if (data?.reason) err.reason = data.reason;
    throw err;
  }
  const url = String(data?.url || '');
  if (!url.startsWith(CHECKOUT_HOST)) throw new Error('unexpected checkout url');
  return { url, plan: data.plan || plan, fallback: Boolean(data.fallback), reason: data.reason || null };
}

export async function requestOfferCheckoutUrl(options = {}) {
  const key = `offer:${options.plan || ''}:${options.token || ''}`;
  const cached = freshClickUrl(key);
  if (cached) return cached;
  if (!clickInflight.has(key)) {
    const pending = fetchOfferCheckoutUrl(options).then((result) => {
      clickUrls.set(key, { value: result, at: Date.now() });
      return result;
    }).finally(() => {
      clickInflight.delete(key);
    });
    clickInflight.set(key, pending);
  }
  return clickInflight.get(key);
}

// Weekly goes to the XWEEK Checkout Session. If that call fails, fall back to
// the weekly Payment Link (full $9.99, no broken promo param) so the button
// still opens the same plan. Monthly and yearly stay on their Payment Links.
// Lifetime is a Checkout Session (there is no $249.99 Payment Link).
export async function resolvePlanCheckoutUrl(tier, user, options = {}) {
  if (tier?.id === 'weekly') {
    try {
      return await requestWeeklyCheckoutUrl(options);
    } catch {
      return buildCheckoutUrl(STRIPE_LINKS.weekly, user);
    }
  }
  if (tier?.id === 'lifetime' || tier?.checkout === 'session') {
    const session = await requestOfferCheckoutUrl({ ...options, plan: 'lifetime' });
    return session.url;
  }
  if (!tier?.link) return null;
  return buildCheckoutUrl(tier.link, user);
}

export function purchaseAlreadyTracked(sessionId) {
  const sent = readJson(PURCHASES_KEY, []);
  return Array.isArray(sent) && sent.includes(sessionId);
}

// Fire the X purchase event once per checkout session. Returns true if fired.
export function trackPurchaseOnce({ sessionId, value, plan }) {
  if (!sessionId || !(Number(value) > 0)) return false;
  if (purchaseAlreadyTracked(sessionId)) return false;
  // Record first so a double-mounted effect (React StrictMode) cannot double-fire.
  const sent = readJson(PURCHASES_KEY, []);
  writeJson(PURCHASES_KEY, [...(Array.isArray(sent) ? sent : []), sessionId].slice(-20));
  if (typeof window === 'undefined' || typeof window.twq !== 'function') return false;
  const amount = Number(Number(value).toFixed(2));
  window.twq('event', X_PURCHASE_EVENT, {
    value: amount,
    currency: 'USD',
    conversion_id: sessionId,
    contents: plan ? [{ content_id: plan, content_name: `CGPropz ${plan} plan`, content_price: amount, num_items: 1 }] : undefined,
  });
  return true;
}

// Reads ?checkout=success&session_id=cs_... from the current URL.
export function readCheckoutReturn(search = typeof window !== 'undefined' ? window.location.search : '') {
  const params = new URLSearchParams(search);
  if (params.get('checkout') !== 'success') return null;
  const sessionId = (params.get('session_id') || '').trim();
  return { sessionId: /^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId) ? sessionId : null };
}

// Drops checkout=success / session_id from the address bar (keeps anything else).
export function cleanCheckoutParams() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('checkout');
  url.searchParams.delete('session_id');
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, '', next);
}
