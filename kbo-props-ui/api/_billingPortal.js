// Stripe Customer Portal session for the signed-in member.
// NOT a route: the leading underscore keeps Vercel from deploying this file.
// Public POST /api/billing-portal rewrites to /api/checkout/portal.
//
// The customer id and email always come from the verified Supabase session.
// A customer id or email on the request is ignored.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { customersForEmail } from './_stripeTier.js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

export const BILLING_PORTAL_CONFIGURATION = 'bpc_1URCyLPwL0k9PEMv395S66ul';
export const ACCOUNT_PAGE_URL = 'https://www.cgpropz.com/?account=1';
export const ACCOUNT_FALLBACK_URL = 'https://www.cgpropz.com/';
export const NO_ACTIVE_PLAN_MESSAGE = 'No active plan on this email. DM @Cgpropz.';
// Stripe Customer Portal login_page is off, so there is no stable public
// portal URL to paste into email. The account page creates a one-time
// billing_portal session with the secret key and redirects to session.url.
export const PAYMENT_METHOD_UPDATE_FLOW = 'payment_method_update';

const PORTAL_FLOWS = new Set([PAYMENT_METHOD_UPDATE_FLOW]);

function readJsonBody(req) {
  const body = req?.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  if (typeof body === 'string' && body.trim()) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // A bad body still opens the general portal. It never supplies a customer.
    }
  }
  return {};
}

// Customer, configuration, and return URL come from the server. A client
// flow_data object, customer id, or return URL is ignored. The only accepted
// hint is flow=payment_method_update, which opens the portal on update-card.
export function billingPortalSessionParams(customerId, body = {}) {
  const params = {
    customer: customerId,
    configuration: BILLING_PORTAL_CONFIGURATION,
    return_url: billingPortalReturnUrl(),
  };
  const requested = typeof body.flow === 'string' ? body.flow.trim() : '';
  if (PORTAL_FLOWS.has(requested)) {
    params.flow_data = { type: requested };
  }
  return params;
}

const PORTAL_STATUSES = ['active', 'past_due'];

export function billingPortalReturnUrl(candidate = ACCOUNT_PAGE_URL) {
  try {
    const url = new URL(candidate);
    if (url.protocol === 'https:' && url.hostname === 'www.cgpropz.com') {
      return url.toString();
    }
  } catch {
    // A bad account URL falls back to the public homepage.
  }
  return ACCOUNT_FALLBACK_URL;
}

function liveDeps(env = process.env) {
  return {
    env,
    getStripe() {
      return new Stripe(cleanEnv(env.STRIPE_SECRET_KEY));
    },
    getSupabase() {
      return createClient(
        cleanEnv(env.VITE_SUPABASE_URL),
        cleanEnv(env.SUPABASE_SERVICE_ROLE_KEY),
      );
    },
  };
}

function bearerToken(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  return String(authHeader).replace(/^Bearer\s+/i, '').trim();
}

async function qualifyingSubscription(stripe, customerId) {
  for (const status of PORTAL_STATUSES) {
    const page = await stripe.subscriptions.list({
      customer: customerId,
      status,
      limit: 10,
    });
    const match = (page?.data || []).find((row) => row?.status === status);
    if (match) return match;
  }
  return null;
}

// Newest Stripe customer (Customer.created) that still has an active or
// past_due subscription. Canceled-only customers are skipped.
export async function customerForBillingPortal(stripe, email) {
  const customers = await customersForEmail(stripe, email);
  const qualified = [];
  for (const customer of customers) {
    if (!customer?.id) continue;
    const subscription = await qualifyingSubscription(stripe, customer.id);
    if (subscription) qualified.push(customer);
  }
  qualified.sort((a, b) => (Number(b.created) || 0) - (Number(a.created) || 0));
  return qualified[0] || null;
}

export async function handleBillingPortalRequest(req, res, deps = liveDeps()) {
  res.setHeader('Cache-Control', 'private, no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const supabase = deps.supabase || deps.getSupabase();
  const { data: { user } = {}, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const email = (user.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: 'No email associated with this account' });
  }

  const stripe = deps.stripe || deps.getStripe();

  try {
    const customer = await customerForBillingPortal(stripe, email);
    if (!customer) {
      return res.status(404).json({ error: NO_ACTIVE_PLAN_MESSAGE });
    }

    const session = await stripe.billingPortal.sessions.create(
      billingPortalSessionParams(customer.id, readJsonBody(req)),
    );
    if (!session?.url) {
      return res.status(502).json({ error: 'Billing portal did not return a URL' });
    }
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[billing-portal] Error:', err?.message || err);
    return res.status(500).json({ error: 'Failed to open billing portal' });
  }
}

// Vite ?previewTier= screenshots. The dev-preview token resolves, and Stripe
// has no customer, so the account page can show the no-plan message without
// calling Stripe.
export function devPreviewBillingDeps() {
  return {
    env: {
      STRIPE_SECRET_KEY: 'sk_test_dev_preview_only',
    },
    supabase: {
      auth: {
        async getUser(token) {
          if (token !== 'dev-preview') {
            return { data: { user: null }, error: new Error('Invalid or expired token') };
          }
          return {
            data: { user: { id: 'dev-tier-preview', email: 'weekly@preview.local' } },
            error: null,
          };
        },
      },
    },
    stripe: {
      customers: {
        async list() {
          return { data: [] };
        },
        async search() {
          return { data: [] };
        },
      },
      subscriptions: {
        async list() {
          return { data: [] };
        },
      },
      billingPortal: {
        sessions: {
          async create() {
            throw new Error('dev preview must not create a billing portal session');
          },
        },
      },
    },
  };
}

export default function handler(req, res) {
  return handleBillingPortalRequest(req, res, liveDeps());
}
