import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import {
  cleanEnv,
  createPauseLink,
  listRenewingSubscriptions,
  membershipAction,
  pauseRenewingSubscriptions,
  readJsonBody,
  stripeSecretMode,
  subscriptionPauseResume,
  verifyPauseLink,
} from './_pauseSubscription.js';

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

function pauseLinkError(reason) {
  if (reason === 'expired') return { status: 400, error: 'This pause link has expired.' };
  if (reason === 'missing_secret') return { status: 500, error: 'Pause links are not configured' };
  return { status: 400, error: 'This pause link is not valid.' };
}

export async function handleMembershipRequest(req, res, deps = liveDeps()) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const env = deps.env || process.env;
  const supabase = deps.supabase || deps.getSupabase();
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const email = (user.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: 'No email associated with this account' });
  }

  const body = readJsonBody(req);
  const action = membershipAction(body);
  const nowMs = typeof deps.now === 'function' ? deps.now() : Date.now();

  // Pause reads and writes subscriptions. Refuse live and unknown keys before
  // a Stripe client exists, so this path cannot touch a live subscription.
  // Cancel is unchanged and still uses the configured key.
  if (action === 'pause' || action === 'status') {
    const mode = stripeSecretMode(env.STRIPE_SECRET_KEY);
    if (mode !== 'test') {
      return res.status(403).json({ error: 'Pause is limited to Stripe test mode' });
    }
  }

  if (action === 'pause' && body.token) {
    const verdict = verifyPauseLink(body.token, {
      secret: env.PAUSE_LINK_SECRET,
      now: nowMs,
    });
    if (!verdict.ok) {
      const failure = pauseLinkError(verdict.reason);
      return res.status(failure.status).json({ error: failure.error });
    }
    if (verdict.userId !== user.id) {
      return res.status(403).json({ error: 'This pause link belongs to a different member.' });
    }
  }

  const stripe = deps.stripe || deps.getStripe();

  try {
    if (action === 'status') {
      const { subscriptions } = await listRenewingSubscriptions(stripe, email);
      const resumesAt = subscriptions.reduce((max, sub) => {
        const resume = subscriptionPauseResume(sub, nowMs);
        return resume && resume > max ? resume : max;
      }, 0);
      return res.status(200).json({
        paused: resumesAt > 0,
        resumes_at: resumesAt ? new Date(resumesAt * 1000).toISOString() : null,
        access: 'kept',
      });
    }

    const { customers, subscriptions } = await listRenewingSubscriptions(stripe, email);
    if (!customers.length) {
      return res.status(404).json({ error: 'No Stripe subscription found for this account' });
    }
    if (!subscriptions.length) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    if (action === 'pause') {
      const paused = await pauseRenewingSubscriptions(stripe, subscriptions, nowMs);
      console.log(`[pause] Paused billing for ${email} — resumes ${paused.resumes_at} — access kept`);
      return res.status(200).json({
        success: true,
        paused: true,
        resumes_at: paused.resumes_at,
        access: 'kept',
        message: 'Billing is paused and resumes automatically',
      });
    }

    // Cancel at period end (user keeps access until billing period ends).
    const results = [];
    for (const sub of subscriptions) {
      const updated = await stripe.subscriptions.update(sub.id, {
        cancel_at_period_end: true,
      });
      results.push({
        id: updated.id,
        cancel_at_period_end: updated.cancel_at_period_end,
        current_period_end: updated.current_period_end,
      });
    }

    const periodEnd = results[0]?.current_period_end;
    const endDate = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

    console.log(`[cancel] Scheduled cancellation for ${email} — access until ${endDate}`);

    return res.status(200).json({
      success: true,
      message: 'Subscription will cancel at end of billing period',
      access_until: endDate,
    });
  } catch (err) {
    const label = action === 'pause' ? 'pause' : action === 'status' ? 'status' : 'cancel';
    console.error(`[${label}] Error:`, err.message);
    const error = action === 'pause'
      ? 'Failed to pause subscription'
      : action === 'status'
        ? 'Failed to read subscription'
        : 'Failed to cancel subscription';
    return res.status(500).json({ error });
  }
}

export { createPauseLink };

export default function handler(req, res) {
  return handleMembershipRequest(req, res, liveDeps());
}
