/*
 * Founders $99.99 lifetime window and the live Stripe price ids.
 *
 * The $249.99 lifetime price, the $149.99/yr price, and the Founders price
 * default to the ids below. Server env vars may point checkout at a
 * replacement id; the defaults stay recognized so an override cannot drop
 * access for someone who already paid.
 *
 * Founders ends at the close of 18 Oct 2026 in America/New_York (EDT, UTC-4).
 * The price id is the historical $99.99 lifetime price. Spots are Founders
 * purchases only — not every past charge on that price.
 */

export const LEGACY_LIFETIME_PRICE_ID = 'price_1THZjaPwL0k9PEMvARtuGG1F';
export const DEFAULT_FOUNDERS_PRICE_ID = LEGACY_LIFETIME_PRICE_ID;
export const DEFAULT_LIFETIME_PRICE_ID = 'price_1UPJ78PwL0k9PEMvnZPU3k5a';
export const DEFAULT_LIFETIME_PRODUCT_ID = 'prod_UG5v4BQ2Mo0wie';
export const DEFAULT_YEARLY_PRICE_ID = 'price_1UPJ7DPwL0k9PEMv2Z9Ca8B5';
export const DEFAULT_YEARLY_PRODUCT_ID = 'prod_VQ9PL4yWUC4l6Z';

export const FOUNDERS_PAYMENT_LINK = 'https://buy.stripe.com/8x228t2tN5Mabzsf5C5Ne0b';
export const LEGACY_LIFETIME_PAYMENT_LINK = 'https://buy.stripe.com/dRmeVfd8r3E2avo4qY5Ne03';
export const YEARLY_PAYMENT_LINK = 'https://buy.stripe.com/9B63cxb0jdeCcDw1eM5Ne0a';

export const FOUNDERS_CAP = 25;
// Shown on the card. The countdown instant is midnight at the start of 19 Oct
// ET (the same moment as the end of 18 Oct), so the words say 11:59 PM.
export const FOUNDERS_DEADLINE_LABEL = 'Ends Oct 18 at 11:59 PM ET';
// Narrow pricing cards (the subscription grid) use the shorter phrase.
export const FOUNDERS_DEADLINE_SHORT = 'through Oct 18';

// 19 Oct 2026 00:00 America/New_York. October 2026 is still EDT (UTC-4);
// DST in 2026 ends on 1 Nov. That is one second after 18 Oct 2026 23:59:59 ET.
export const FOUNDERS_DEADLINE_MS = Date.parse('2026-10-19T04:00:00.000Z');

// Historical $99.99 lifetime charges before this instant are not Founders spots.
// Midnight at the start of 11 Oct 2026 ET.
export const FOUNDERS_COUNT_START_MS = Date.parse('2026-10-11T04:00:00.000Z');
export const FOUNDERS_COUNT_START_SEC = Math.floor(FOUNDERS_COUNT_START_MS / 1000);

export function buyLinkKey(url) {
  const match = String(url || '').match(/buy\.stripe\.com\/([A-Za-z0-9]+)/);
  return match ? match[1] : '';
}

export function foundersOfferState({
  now = Date.now(),
  sold = 0,
  cap = FOUNDERS_CAP,
  deadlineMs = FOUNDERS_DEADLINE_MS,
} = {}) {
  const soldCount = Number.isFinite(Number(sold)) ? Math.max(0, Math.floor(Number(sold))) : 0;
  const limit = Number.isFinite(Number(cap)) ? Number(cap) : FOUNDERS_CAP;
  const expired = now >= deadlineMs;
  const soldOut = soldCount >= limit;
  let reason = null;
  if (expired) reason = 'expired';
  else if (soldOut) reason = 'sold_out';
  return {
    open: !expired && !soldOut,
    reason,
    sold: soldCount,
    cap: limit,
    spotsLeft: Math.max(0, limit - soldCount),
    deadlineMs,
    deadlineLabel: FOUNDERS_DEADLINE_LABEL,
  };
}

export function foundersCountdown(now = Date.now(), deadlineMs = FOUNDERS_DEADLINE_MS) {
  const remain = Math.max(0, deadlineMs - now);
  const totalSec = Math.floor(remain / 1000);
  return {
    days: Math.floor(totalSec / 86400),
    hours: Math.floor((totalSec % 86400) / 3600),
    minutes: Math.floor((totalSec % 3600) / 60),
    seconds: totalSec % 60,
    remainingMs: remain,
  };
}

export function formatFoundersCountdown(parts) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${parts.days}d ${pad(parts.hours)}h ${pad(parts.minutes)}m ${pad(parts.seconds)}s`;
}

export function foundersDeadlineText(compact = false) {
  return compact ? FOUNDERS_DEADLINE_SHORT : FOUNDERS_DEADLINE_LABEL;
}

// Replaces the buy button once the offer is closed.
export function foundersClosedLabel(reason) {
  if (reason === 'sold_out') return 'Sold out';
  if (reason === 'expired') return 'Ended';
  return null;
}

export function foundersCardCopy({
  spotsLeft = 0,
  cap = FOUNDERS_CAP,
  soldKnown = false,
  reason = null,
  compact = false,
} = {}) {
  const spots = soldKnown
    ? `${spotsLeft} of ${cap} spots left`
    : `Limited to ${cap} buyers`;
  const deadline = foundersDeadlineText(compact);
  const closedLabel = foundersClosedLabel(reason);
  return {
    meta: compact ? `${spots}, ${deadline}` : `${spots}. ${deadline}`,
    closedLabel,
    showBuy: !closedLabel,
  };
}

function linePriceId(line) {
  const price = line?.price;
  if (typeof price === 'string') return price;
  if (price?.id) return price.id;
  const ref = line?.pricing?.price_details?.price;
  return typeof ref === 'string' ? ref : ref?.id || null;
}

export function sessionPriceIds(session) {
  const lines = session?.line_items?.data || [];
  return lines.map(linePriceId).filter(Boolean);
}

function paymentLinkId(session) {
  const link = session?.payment_link;
  if (!link) return null;
  return typeof link === 'string' ? link : link.id || null;
}

// A paid Checkout Session counts as a Founders spot when it is this offer,
// not a historical Lifetime purchase of the same price id.
export function isFoundersSession(session, {
  priceId,
  foundersLinkId = null,
  legacyLinkId = null,
  countStartSec = FOUNDERS_COUNT_START_SEC,
} = {}) {
  if (!session || session.status !== 'complete' || session.payment_status !== 'paid') return false;
  if (session.metadata?.cg_plan === 'founders') return true;
  const link = paymentLinkId(session);
  if (foundersLinkId && link === foundersLinkId) return true;
  if (legacyLinkId && link === legacyLinkId) return false;
  if (!priceId || !sessionPriceIds(session).includes(priceId)) return false;
  if (!session.created || session.created < countStartSec) return false;
  return true;
}

export function chargePriceIds(charge) {
  const ids = new Set();
  const add = (id) => { if (id) ids.add(id); };
  const invoice = charge?.invoice;
  const lines = invoice && typeof invoice === 'object' ? invoice.lines?.data || [] : [];
  for (const line of lines) add(linePriceId(line));
  for (const line of charge?.lines?.data || []) add(linePriceId(line));
  const price = charge?.price;
  if (typeof price === 'string') add(price);
  else add(price?.id);
  return [...ids];
}

// A paid charge counts toward the same 25-spot cap when it is this offer.
// Historical $99.99 lifetime charges (same price id, before the window, or
// tagged cg_plan=lifetime) do not.
export function isFoundersCharge(charge, {
  priceId,
  countStartSec = FOUNDERS_COUNT_START_SEC,
} = {}) {
  if (!charge?.id) return false;
  if (charge.paid === false || charge.refunded) return false;
  if (charge.status && charge.status !== 'succeeded') return false;
  if (charge.metadata?.cg_plan === 'lifetime') return false;
  if (charge.metadata?.cg_plan === 'founders') return true;
  if (!priceId || !chargePriceIds(charge).includes(priceId)) return false;
  const created = Number(charge.created) || 0;
  if (!created || created < countStartSec) return false;
  return true;
}
