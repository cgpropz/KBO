// Count paid Founders purchases. Not a route.
//
// In-site Checkout Sessions do not consume the Payment Link's own 25-sale
// cap, so this count is shared: completed Checkout Sessions (including
// Payment Link sales) and charges for the $99.99 Founders price. The price
// id is also the historical Lifetime price, so a charge or session counts
// only when it is stamped cg_plan=founders, was opened from the Founders
// Payment Link, or paid that price during the offer window and is not the
// legacy Lifetime Payment Link. A charge and the session it belongs to
// count once, matched on the PaymentIntent.

import {
  FOUNDERS_COUNT_START_SEC,
  FOUNDERS_PAYMENT_LINK,
  LEGACY_LIFETIME_PAYMENT_LINK,
  buyLinkKey,
  isFoundersCharge,
  isFoundersSession,
} from '../src/foundersOffer.js';
import { activeFoundersPriceId } from './_stripeTier.js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

export function foundersPaymentLink(env = process.env) {
  return cleanEnv(env?.STRIPE_LINK_FOUNDERS) || FOUNDERS_PAYMENT_LINK;
}

async function paymentLinkIdsByKey(stripe) {
  const map = new Map();
  if (typeof stripe.paymentLinks?.list !== 'function') return map;
  let startingAfter;
  for (let page = 0; page < 10; page += 1) {
    const list = await stripe.paymentLinks.list({ limit: 100, starting_after: startingAfter });
    for (const link of list?.data || []) {
      const key = buyLinkKey(link?.url);
      if (key && link?.id) map.set(key, link.id);
    }
    if (!list?.has_more || !list.data?.length) break;
    startingAfter = list.data[list.data.length - 1].id;
  }
  return map;
}

function paymentIntentId(obj) {
  const pi = obj?.payment_intent;
  if (!pi) return null;
  return typeof pi === 'string' ? pi : pi.id || null;
}

async function eachSession(listPage, visit) {
  for (const session of listPage?.data || []) visit(session);
  return listPage;
}

export async function countFoundersPurchases(stripe, env = process.env) {
  const priceId = activeFoundersPriceId(env);
  const linkIds = await paymentLinkIdsByKey(stripe);
  const foundersLinkId = linkIds.get(buyLinkKey(foundersPaymentLink(env))) || null;
  const legacyLinkId = linkIds.get(buyLinkKey(LEGACY_LIFETIME_PAYMENT_LINK)) || null;
  const seen = new Set();
  const rejected = new Set();
  let count = 0;

  const remember = (keys) => {
    for (const key of keys) if (key) seen.add(key);
  };
  const already = (keys) => keys.some((key) => key && seen.has(key));
  const claim = (keys) => {
    const ids = keys.filter(Boolean);
    if (!ids.length) return;
    if (already(ids)) {
      remember(ids);
      return;
    }
    remember(ids);
    count += 1;
  };

  const consider = (session) => {
    if (!session?.id || seen.has(`session:${session.id}`)) return;
    const pi = paymentIntentId(session);
    if (!isFoundersSession(session, { priceId, foundersLinkId, legacyLinkId })) {
      rejected.add(`session:${session.id}`);
      if (pi) rejected.add(`pi:${pi}`);
      return;
    }
    claim([`session:${session.id}`, pi && `pi:${pi}`]);
  };

  const listSessions = async (params) => {
    if (typeof stripe.checkout?.sessions?.list !== 'function') return;
    let startingAfter;
    for (let page = 0; page < 20; page += 1) {
      const list = await stripe.checkout.sessions.list({ ...params, limit: 100, starting_after: startingAfter });
      await eachSession(list, consider);
      if (!list?.has_more || !list.data?.length) break;
      startingAfter = list.data[list.data.length - 1].id;
    }
  };

  if (foundersLinkId) {
    await listSessions({ payment_link: foundersLinkId, status: 'complete' });
  }

  if (typeof stripe.checkout?.sessions?.search === 'function') {
    let nextPage;
    for (let page = 0; page < 10; page += 1) {
      const found = await stripe.checkout.sessions.search({
        query: 'status:"complete" AND metadata["cg_plan"]:"founders"',
        limit: 100,
        page: nextPage,
      });
      await eachSession(found, consider);
      if (!found?.has_more || !found?.next_page) break;
      nextPage = found.next_page;
    }
  }

  await listSessions({
    status: 'complete',
    created: { gte: FOUNDERS_COUNT_START_SEC },
    expand: ['data.line_items.data.price'],
  });

  const foundersCharge = async (charge) => {
    if (isFoundersCharge(charge, { priceId })) return true;
    if (!charge || charge.paid === false || charge.refunded) return false;
    if (charge.status && charge.status !== 'succeeded') return false;
    if (charge.metadata?.cg_plan === 'lifetime') return false;
    const created = Number(charge.created) || 0;
    if (!created || created < FOUNDERS_COUNT_START_SEC) return false;
    const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : null;
    if (!invoiceId || typeof stripe.invoices?.retrieve !== 'function') return false;
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId);
      return isFoundersCharge({ ...charge, invoice }, { priceId });
    } catch {
      return false;
    }
  };

  const considerCharge = async (charge) => {
    if (!charge?.id) return;
    const pi = paymentIntentId(charge);
    if (rejected.has(`charge:${charge.id}`) || (pi && rejected.has(`pi:${pi}`))) return;
    if (already([`charge:${charge.id}`, pi && `pi:${pi}`])) return;
    if (!(await foundersCharge(charge))) return;
    claim([`charge:${charge.id}`, pi && `pi:${pi}`]);
  };

  const listCharges = async (params) => {
    if (typeof stripe.charges?.list !== 'function') return;
    let startingAfter;
    for (let page = 0; page < 20; page += 1) {
      const list = await stripe.charges.list({ ...params, limit: 100, starting_after: startingAfter });
      for (const charge of list?.data || []) await considerCharge(charge);
      if (!list?.has_more || !list.data?.length) break;
      startingAfter = list.data[list.data.length - 1].id;
    }
  };

  if (typeof stripe.charges?.search === 'function') {
    let nextPage;
    for (let page = 0; page < 10; page += 1) {
      const found = await stripe.charges.search({
        query: 'status:"succeeded" AND metadata["cg_plan"]:"founders"',
        limit: 100,
        page: nextPage,
      });
      for (const charge of found?.data || []) await considerCharge(charge);
      if (!found?.has_more || !found?.next_page) break;
      nextPage = found.next_page;
    }
  }

  await listCharges({ created: { gte: FOUNDERS_COUNT_START_SEC } });

  return count;
}
