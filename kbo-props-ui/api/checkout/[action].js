// One Serverless Function for GET /api/checkout-session and POST /api/weekly-checkout.
// vercel.json rewrites those public paths here. The handlers are unchanged.

import { handleCheckoutSessionRequest } from '../_checkoutSession.js';
import { handleWeeklyCheckoutRequest } from '../_weeklyCheckout.js';
import { handleOfferCheckoutRequest } from '../_offerCheckout.js';
import { routeParam } from '../_routeKey.js';

export const CHECKOUT_ACTIONS = {
  session: handleCheckoutSessionRequest,
  weekly: handleWeeklyCheckoutRequest,
  // One-time Lifetime and Founders. Founders enforces the 25-spot cap and the
  // 18 Oct 2026 ET deadline, then falls back to the $249.99 price.
  lifetime: (req, res) => handleOfferCheckoutRequest(req, res, { plan: 'lifetime' }),
  founders: (req, res) => handleOfferCheckoutRequest(req, res, { plan: 'founders' }),
};

const CHECKOUT_ALIASES = {
  'checkout-session': 'session',
  'weekly-checkout': 'weekly',
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
