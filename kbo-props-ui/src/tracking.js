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
 * Weekly All-Access also prefills promo XWEEK (first-week ad offer).
 */
export function buildCheckoutUrl(link, user) {
  const url = new URL(link);
  if (user?.id) url.searchParams.set('client_reference_id', user.id);
  if (user?.email) url.searchParams.set('prefilled_email', user.email);
  // XWEEK is the first-week ad offer ($4.99 for new customers). Prefill it only
  // on the Weekly All-Access payment link; monthly and lifetime stay full price.
  if (isWeeklyPaymentLink(url)) url.searchParams.set('prefilled_promo_code', 'XWEEK');
  for (const [key, value] of Object.entries(utmParams())) url.searchParams.set(key, value);
  return url.toString();
}

function isWeeklyPaymentLink(url) {
  const weekly = new URL(STRIPE_LINKS.weekly);
  return url.origin === weekly.origin && url.pathname === weekly.pathname;
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
