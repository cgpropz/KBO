// Shared guards for Checkout Session creation.
//
// A session is opened from a Buy click. Crawlers, link-preview renderers,
// headless browsers, and prefetch/prerender must not open one. When the
// buyer already has an open session for the same customer and price, that
// URL is returned instead of creating another.

const AUTOMATED_UA_RE = /(?:^|[^a-z])bot\b|[a-z]bot\/|crawl|spider|slurp|preview|facebookexternalhit|embedly|headlesschrome|lighthouse|pagespeed|gtmetrix|pingdom|uptime|curl\/|wget\/|python-requests|python-urllib|aiohttp|axios\/|node-fetch|undici|go-http-client|okhttp|java\/|libwww|httpclient|scrapy|phantomjs|puppeteer|playwright|^whatsapp\/|telegrambot|skypeuripreview/i;

// Real browsers never send these tokens. A missing User-Agent is treated as
// automated: every browser the site supports sends one.
export function isAutomatedClient(headers = {}) {
  const ua = String(headers['user-agent'] || headers['User-Agent'] || '').trim();
  if (!ua) return true;
  if (AUTOMATED_UA_RE.test(ua)) return true;
  const purpose = String(headers.purpose || headers['sec-purpose'] || headers['x-purpose'] || headers['x-moz'] || '').toLowerCase();
  return purpose.includes('prefetch') || purpose.includes('prerender') || purpose.includes('preview');
}

// An open session with less than this left is not reused; Checkout would
// expire it under the buyer. Stripe keeps a new session for 24h.
export const REUSE_MIN_REMAINING_SEC = 30 * 60;

export async function listOpenCheckoutSessions(client, customerId) {
  if (!customerId || typeof client?.checkout?.sessions?.list !== 'function') return [];
  try {
    const page = await client.checkout.sessions.list({
      customer: customerId,
      status: 'open',
      limit: 20,
    });
    return page?.data || [];
  } catch {
    return [];
  }
}

// `match` confirms the session is the same price (and plan). Sessions that
// do not carry the price id are skipped: the list payload has no line items.
export function reusableCheckoutUrl(sessions, nowSec, match) {
  const now = Number(nowSec);
  for (const session of sessions || []) {
    const url = String(session?.url || '');
    if (!url.startsWith('https://checkout.stripe.com/')) continue;
    if (!(Number(session?.expires_at) - now >= REUSE_MIN_REMAINING_SEC)) continue;
    if (typeof match === 'function' && !match(session)) continue;
    return url;
  }
  return null;
}
