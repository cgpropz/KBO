// One Serverless Function for checkout lookups and the member billing portal.
// vercel.json rewrites the public paths here. The handlers are unchanged.

import { handleBillingPortalRequest } from '../_billingPortal.js';
import { handleCheckoutSessionRequest } from '../_checkoutSession.js';
import { handleWeeklyCheckoutRequest } from '../_weeklyCheckout.js';
import { handleOfferCheckoutRequest } from '../_offerCheckout.js';
import { routeParam } from '../_routeKey.js';

export const CHECKOUT_ACTIONS = {
  session: handleCheckoutSessionRequest,
  weekly: handleWeeklyCheckoutRequest,
  // One-time Lifetime ($249.99).
  lifetime: (req, res) => handleOfferCheckoutRequest(req, res, { plan: 'lifetime' }),
  portal: handleBillingPortalRequest,
};

const CHECKOUT_ALIASES = {
  'checkout-session': 'session',
  'weekly-checkout': 'weekly',
  'billing-portal': 'portal',
};

export default function handler(req, res) {
  const action = routeParam(req, { param: 'action', aliases: CHECKOUT_ALIASES });
  const route = CHECKOUT_ACTIONS[action];
  if (!route) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.status(404).json({ error: 'Not found' });
  }
  return route(req, res);
}
