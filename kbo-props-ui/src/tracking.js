/*
 * Marketing attribution + X (Twitter) pixel purchase tracking (client only).
 *
 * - captureAttribution(): stores utm_* / twclid from the landing URL in
 *   localStorage so they survive sign-up and checkout.
 * - utmParams(): the stored UTM codes, validated to Stripe's Payment Link
 *   rules, so they can be appended to the payment link (Stripe records them on
 *   the payment and passes them back on the after-payment redirect).
 * - trackPurchaseOnce(): fires the X purchase event exactly once per Stripe
 *   Checkout Session. The session id is stored in localStorage and
 *   sessionStorage before the call, and sent as conversion_id so a reload
 *   cannot double-fire and X can de-duplicate the browser event against the
 *   server-side Conversions API report from api/stripe-webhook.js.
 */

import { STRIPE_LINKS } from './pricingTiers.js';
import { DEFAULT_X_PURCHASE_EVENT_ID, activeXPurchaseEventId } from './xPixelIds.js';

export const X_PURCHASE_EVENT = DEFAULT_X_PURCHASE_EVENT_ID;

const ATTRIBUTION_KEY = 'cg_attribution';
const PURCHASES_KEY = 'cg_x_purchases_sent';
const PURCHASE_SESSION_KEY = 'cg_x_purchase_sessions';
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

function readIdList(storage, key) {
  try {
    const raw = storage?.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rememberId(storage, key, sessionId) {
  if (!storage || !sessionId) return;
  try {
    const prev = readIdList(storage, key);
    if (prev.includes(sessionId)) return;
    storage.setItem(key, JSON.stringify([...prev, sessionId].slice(-20)));
  } catch { /* storage unavailable */ }
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

// UTM codes on a landing URL. Values that fail Stripe's metadata rules are dropped.
export function utmFromSearch(search = '') {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const out = {};
  for (const key of UTM_KEYS) {
    const value = (params.get(key) || '').trim();
    if (UTM_VALUE_RE.test(value)) out[key] = value;
  }
  return out;
}

// The landing URL wins over an older stored visit.
export function campaignUtm(search = '') {
  return { ...utmParams(), ...utmFromSearch(search) };
}

// Checkout fields the existing weekly flow sets itself. prefilled_promo_code
// is omitted on purpose: Stripe Payment Links reject XWEEK in that field.
const CHECKOUT_OWNED_PARAMS = new Set([
  'client_reference_id',
  'prefilled_email',
  'prefilled_promo_code',
]);

// Copy every incoming query param onto a checkout URL, without replacing
// params the checkout URL already has.
export function carryQueryParams(url, search = '') {
  const target = new URL(url);
  const incoming = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  for (const [key, value] of incoming.entries()) {
    const name = String(key || '').trim();
    const trimmed = String(value || '').trim().slice(0, 500);
    if (!name || !trimmed || CHECKOUT_OWNED_PARAMS.has(name)) continue;
    if (!target.searchParams.has(name)) target.searchParams.set(name, trimmed);
  }
  return target.toString();
}

// Weekly Payment Link (or a ready XWEEK Checkout Session) plus the landing query.
export function campaignCheckoutHref({ link, user, search = '', sessionUrl = '' } = {}) {
  const base = sessionUrl || buildCheckoutUrl(link, user);
  return carryQueryParams(base, search);
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
 * button uses requestWeeklyCheckoutUrl() instead, which opens a Checkout
 * Session for the same weekly price with XWEEK already applied ($4.99).
 */
export function buildCheckoutUrl(link, user) {
  const url = new URL(link);
  if (user?.id) url.searchParams.set('client_reference_id', user.id);
  if (user?.email) url.searchParams.set('prefilled_email', user.email);
  for (const [key, value] of Object.entries(utmParams())) url.searchParams.set(key, value);
  return url.toString();
}

const CHECKOUT_HOST = 'https://checkout.stripe.com/';

// Session URLs fetched before the click, keyed by access token ('' = guest).
// The weekly button navigates to one of these synchronously. Waiting on the
// network inside the click drops the navigation in in-app browsers.
const readyWeeklyUrls = new Map();

export function readyWeeklyCheckoutUrl(token = '') {
  return readyWeeklyUrls.get(token || '') || null;
}

// Ask the server for the live weekly Checkout Session (XWEEK applied when the
// code is valid for this buyer; otherwise the full $9.99 weekly checkout).
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

// Start the weekly Checkout Session request as soon as the page is shown, so
// the button's href is a real checkout URL by the time it's clicked.
const inflightWeekly = new Map();

export function prefetchWeeklyCheckoutUrl(options = {}) {
  const key = options.token || '';
  const ready = readyWeeklyUrls.get(key);
  if (ready) return Promise.resolve(ready);
  if (!inflightWeekly.has(key)) {
    const pending = requestWeeklyCheckoutUrl(options).then((url) => {
      readyWeeklyUrls.set(key, url);
      return url;
    }).finally(() => {
      inflightWeekly.delete(key);
    });
    inflightWeekly.set(key, pending);
  }
  return inflightWeekly.get(key);
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

// URL the weekly button can open immediately. Prefers the Checkout Session.
// If that isn't ready, the weekly Payment Link (no promo param) still charges
// the same plan.
export function weeklyCheckoutHref(user, token = '') {
  return readyWeeklyCheckoutUrl(token) || buildCheckoutUrl(STRIPE_LINKS.weekly, user);
}

// Lifetime ($249.99) and Founders ($99.99) Checkout Sessions. Founders past
// the cap or the deadline is refused: the response has no URL, and reason is
// 'sold_out' or 'expired'. Lifetime is not substituted.
export async function requestOfferCheckoutUrl({ plan, token, utm = utmParams(), fetchImpl = globalThis.fetch } = {}) {
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
  if (!sessionId) return false;
  if (readIdList(globalThis.localStorage, PURCHASES_KEY).includes(sessionId)) return true;
  return readIdList(globalThis.sessionStorage, PURCHASE_SESSION_KEY).includes(sessionId);
}

function rememberPurchase(sessionId) {
  rememberId(globalThis.localStorage, PURCHASES_KEY, sessionId);
  rememberId(globalThis.sessionStorage, PURCHASE_SESSION_KEY, sessionId);
}

function purchaseCurrency(currency) {
  const code = String(currency || 'USD').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : 'USD';
}

// Fire the X purchase event once per Stripe Checkout Session. The session id
// is both the reload guard (localStorage + sessionStorage) and conversion_id.
// No email, name, or customer id. Returns true if this call fired the event.
export function trackPurchaseOnce({ sessionId, value, currency, plan, eventId } = {}) {
  const id = String(eventId == null ? activeXPurchaseEventId() : eventId).trim();
  if (!sessionId || !id) return false;
  if (purchaseAlreadyTracked(sessionId)) return false;
  if (typeof window === 'undefined' || typeof window.twq !== 'function') return false;
  // Record first so a double-mounted effect (React StrictMode) cannot double-fire.
  rememberPurchase(sessionId);
  const payload = { conversion_id: sessionId };
  const amount = Number(value);
  if (Number.isFinite(amount) && amount > 0) {
    const priced = Number(amount.toFixed(2));
    payload.value = priced;
    payload.currency = purchaseCurrency(currency);
    if (plan) {
      payload.contents = [{ content_id: plan, content_name: `CGPropz ${plan} plan`, content_price: priced, num_items: 1 }];
    }
  }
  window.twq('event', id, payload);
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
