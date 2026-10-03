// ─── X (Twitter) Conversions API — server-side purchase reporting ───────────
// NOT a route (leading underscore). Imported by api/stripe-webhook.js.
//
// Sends the same purchase event the browser pixel fires on the checkout-success
// screen (twq('event', 'tw-pul9k-pul9m', { conversion_id: <session id> })), so
// X de-duplicates the two using the shared Event ID + conversion_id.
//
// Docs: https://docs.x.com/x-ads-api/measurement/web-conversions
//   POST https://ads-api.x.com/12/measurement/conversions/:pixel_id
//   body: { conversions: [{ conversion_time, event_id, identifiers, value,
//           price_currency, conversion_id, ... }] }
//
// Completely optional: a no-op unless X_PIXEL_ID + X_PURCHASE_EVENT_ID and one
// set of credentials are configured. It never throws; errors are only logged,
// so the Stripe webhook can never fail because of X.
//
// Credentials (pick one):
//   A) OAuth 1.0a user context (the documented auth for custom integrations):
//      X_ADS_CONSUMER_KEY, X_ADS_CONSUMER_SECRET,
//      X_ADS_ACCESS_TOKEN, X_ADS_ACCESS_TOKEN_SECRET
//   B) Events Manager "Conversion API access token", sent as X-Pixel-Token
//      (documented by X for its server-side GTM template): X_CAPI_PIXEL_TOKEN
//   If both are set, OAuth 1.0a is used.

import crypto from 'node:crypto';
import { planForCheckout } from './_stripeTier.js';

export const X_ADS_API_BASE = 'https://ads-api.x.com/12';
const REQUEST_TIMEOUT_MS = 4000;

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

// Returns a config object, or null when server-side reporting is not set up.
export function xConversionsConfig(env = process.env) {
  const pixelId = cleanEnv(env.X_PIXEL_ID);
  const eventId = cleanEnv(env.X_PURCHASE_EVENT_ID);
  if (!pixelId || !eventId) return null;

  const oauth = {
    consumerKey: cleanEnv(env.X_ADS_CONSUMER_KEY),
    consumerSecret: cleanEnv(env.X_ADS_CONSUMER_SECRET),
    token: cleanEnv(env.X_ADS_ACCESS_TOKEN),
    tokenSecret: cleanEnv(env.X_ADS_ACCESS_TOKEN_SECRET),
  };
  if (Object.values(oauth).every(Boolean)) return { pixelId, eventId, auth: 'oauth1', oauth };

  const pixelToken = cleanEnv(env.X_CAPI_PIXEL_TOKEN);
  if (pixelToken) return { pixelId, eventId, auth: 'pixel_token', pixelToken };

  return null;
}

// X spec: trim + lower-case, then unsalted SHA-256 hex.
export function hashEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return null;
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

// RFC 3986 percent-encoding, as OAuth 1.0a requires.
function pct(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

// OAuth 1.0a HMAC-SHA1 Authorization header. `params` are any query/form
// params that must be signed (a JSON request body is NOT signed).
export function oauth1Header({ method, url, consumerKey, consumerSecret, token, tokenSecret, params = {}, nonce, timestamp }) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce || crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: '1.0',
  };
  const all = { ...params, ...oauth };
  const paramString = Object.keys(all)
    .map((k) => [pct(k), pct(all[k])])
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const baseString = [method.toUpperCase(), pct(url), pct(paramString)].join('&');
  const signingKey = `${pct(consumerSecret)}&${pct(tokenSecret || '')}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  const header = { ...oauth, oauth_signature: signature };
  return 'OAuth ' + Object.keys(header).sort().map((k) => `${pct(k)}="${pct(header[k])}"`).join(', ');
}

// Build the conversions[] entry for a completed Stripe Checkout Session.
// Returns null when there is nothing reportable (unpaid, $0 or no email).
export function buildPurchaseConversion(session, { eventId, conversionTime } = {}) {
  if (!session?.id || !eventId) return null;
  const paid = session.payment_status === 'paid';
  const amountCents = Number(session.amount_total) || 0;
  if (!paid || amountCents <= 0) return null;
  const hashed = hashEmail(session.customer_details?.email || session.customer_email);
  if (!hashed) return null; // X needs at least one strong identifier

  const plan = planForCheckout(session);
  const value = (amountCents / 100).toFixed(2);
  return {
    conversion_time: new Date(conversionTime || Date.now()).toISOString(),
    event_id: eventId,
    identifiers: [{ hashed_email: hashed }],
    value,
    price_currency: String(session.currency || 'usd').toUpperCase(),
    number_items: 1,
    conversion_id: session.id,
    contents: [{ content_id: plan, content_name: `CGPropz ${plan} plan`, content_price: Number(value), num_items: 1 }],
  };
}

/**
 * Report a checkout.session.completed purchase to X. Never throws.
 * Returns { sent: boolean, reason?: string, status?: number }.
 */
export async function reportPurchaseToX(session, { env = process.env, fetchImpl = globalThis.fetch, conversionTime } = {}) {
  try {
    const config = xConversionsConfig(env);
    if (!config) return { sent: false, reason: 'not_configured' };

    const conversion = buildPurchaseConversion(session, { eventId: config.eventId, conversionTime });
    if (!conversion) return { sent: false, reason: 'not_reportable' };

    const url = `${X_ADS_API_BASE}/measurement/conversions/${encodeURIComponent(config.pixelId)}`;
    const headers = { 'Content-Type': 'application/json' };
    if (config.auth === 'oauth1') {
      headers.Authorization = oauth1Header({ method: 'POST', url, ...config.oauth });
    } else {
      headers['X-Pixel-Token'] = config.pixelToken;
    }

    const resp = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ conversions: [conversion] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`[x-capi] ${resp.status} for ${session.id}: ${text.slice(0, 300)}`);
      return { sent: false, reason: 'http_error', status: resp.status };
    }
    console.log(`[x-capi] purchase reported for ${session.id} (${conversion.value} ${conversion.price_currency})`);
    return { sent: true, status: resp.status };
  } catch (err) {
    console.error('[x-capi] request failed:', err?.message);
    return { sent: false, reason: 'exception' };
  }
}
