// Count paid Founders Checkout Sessions. Not a route.
//
// The Founders price id is also the historical $99.99 Lifetime price, so this
// does not count every charge of that amount. A session counts when it is
// stamped cg_plan=founders, was opened from the Founders Payment Link, or
// paid for the Founders price during the offer window and is not the legacy
// Lifetime Payment Link.

import {
  FOUNDERS_PAYMENT_LINK,
  LEGACY_LIFETIME_PAYMENT_LINK,
  buyLinkKey,
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
  const consider = (session) => {
    if (!session?.id || seen.has(session.id)) return;
    if (!isFoundersSession(session, { priceId, foundersLinkId, legacyLinkId })) return;
    seen.add(session.id);
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
    created: { gte: Math.floor(Date.parse('2026-10-11T04:00:00.000Z') / 1000) },
    expand: ['data.line_items.data.price'],
  });

  return seen.size;
}
