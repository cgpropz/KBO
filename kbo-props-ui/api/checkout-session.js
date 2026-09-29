import Stripe from 'stripe';
import { planForAmount } from './_stripeTier.js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

// Stripe Checkout Session ids look like cs_live_... / cs_test_... Anything else
// is rejected before we call Stripe.
const SESSION_ID_RE = /^cs_(live|test)_[A-Za-z0-9]{10,250}$/;

let stripe = null;
function getStripe() {
  const key = cleanEnv(process.env.STRIPE_SECRET_KEY);
  if (!key) return null;
  if (!stripe) stripe = new Stripe(key);
  return stripe;
}

/**
 * GET /api/checkout-session?session_id=cs_...
 *
 * Called by the checkout-success screen after a Stripe Payment Link redirects
 * back to https://www.cgpropz.com/?checkout=success&session_id={CHECKOUT_SESSION_ID}.
 * Returns ONLY what the X purchase pixel needs (no email, name or customer id):
 *   { paid, amount, currency, plan }
 * amount is in major units (9.99), currency is upper-case (USD) and plan is
 * 'weekly' | 'monthly' | 'lifetime' | 'other'.
 */
export async function handleCheckoutSessionRequest(req, res, client) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sessionId = String(req.query?.session_id || '').trim();
  if (!SESSION_ID_RE.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid session id' });
  }

  client = client || getStripe();
  if (!client) return res.status(503).json({ error: 'Checkout lookup unavailable' });

  let session;
  try {
    session = await client.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    if (err?.statusCode === 404 || err?.code === 'resource_missing') {
      return res.status(404).json({ error: 'Session not found' });
    }
    console.error('[checkout-session] lookup failed:', err?.message);
    return res.status(502).json({ error: 'Checkout lookup failed' });
  }

  const amountCents = Number(session?.amount_total) || 0;
  const paid = session?.status === 'complete'
    && (session?.payment_status === 'paid' || session?.payment_status === 'no_payment_required');

  return res.status(200).json({
    paid,
    amount: Math.round(amountCents) / 100,
    currency: String(session?.currency || 'usd').toUpperCase(),
    plan: planForAmount(amountCents),
  });
}

export default function handler(req, res) {
  return handleCheckoutSessionRequest(req, res);
}
