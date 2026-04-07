import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

const stripe = new Stripe(cleanEnv(process.env.STRIPE_SECRET_KEY));

const supabase = createClient(
  cleanEnv(process.env.VITE_SUPABASE_URL),
  cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
);

function inferTierFromAmount(unitAmount) {
  if ((unitAmount || 0) >= 4000) return 'season';
  return 'monthly';
}

function bestTier(a, b) {
  const rank = { free: 0, monthly: 1, season: 2 };
  return (rank[b] || 0) > (rank[a] || 0) ? b : a;
}

function isAuthorizedRequest(req) {
  const cronHeader = req.headers['x-vercel-cron'];
  if (cronHeader) return true;

  const configured = process.env.SUBS_RECONCILE_SECRET;
  if (!configured) return false;

  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const queryToken = (req.query?.token || '').toString().trim();
  return auth === configured || queryToken === configured;
}

async function findUserByEmail(email) {
  const target = (email || '').trim().toLowerCase();
  if (!target) return null;

  if (typeof supabase.auth.admin.getUserByEmail === 'function') {
    const { data, error } = await supabase.auth.admin.getUserByEmail(target);
    if (!error && data?.user) return data.user;
  }

  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) return null;
    const users = data?.users || [];
    const match = users.find((u) => (u.email || '').trim().toLowerCase() === target);
    if (match) return match;
    if (users.length < perPage) break;
    page += 1;
  }

  return null;
}

async function collectActiveSubscriberTiers() {
  const byEmail = new Map();
  let startingAfter;

  while (true) {
    const page = await stripe.subscriptions.list({
      status: 'active',
      limit: 100,
      starting_after: startingAfter,
      expand: ['data.customer', 'data.items.data.price'],
    });

    for (const sub of page.data) {
      const customer = sub.customer;
      const email = (customer && typeof customer === 'object' ? customer.email : null) || '';
      const normalized = email.trim().toLowerCase();
      if (!normalized) continue;

      const price = sub.items?.data?.[0]?.price;
      const tier = inferTierFromAmount(price?.unit_amount || 0);
      const prev = byEmail.get(normalized) || 'free';
      byEmail.set(normalized, bestTier(prev, tier));
    }

    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  return byEmail;
}

async function setTierByEmail(email, tier) {
  const user = await findUserByEmail(email);
  if (!user?.id) {
    return { status: 'missing_account', email };
  }

  const userId = user.id;
  const { data: rows } = await supabase
    .from('user_profiles')
    .select('tier')
    .eq('id', userId)
    .limit(1);

  const current = rows?.[0]?.tier || 'free';
  if (current === 'season' || current === 'monthly') {
    return { status: 'already_paid', email };
  }

  const { error: upsertError } = await supabase
    .from('user_profiles')
    .upsert({ id: userId, tier }, { onConflict: 'id' });

  if (upsertError) {
    console.error('[reconcile] failed upsert for', email, upsertError);
    return { status: 'error', email, error: upsertError.message };
  }

  return { status: 'patched', email, tier };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).end('Method Not Allowed');
  }

  if (!isAuthorizedRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const activeByEmail = await collectActiveSubscriberTiers();
    const results = {
      activeSubscribers: activeByEmail.size,
      alreadyPaid: 0,
      patched: 0,
      missingAccount: 0,
      errors: 0,
      missingEmails: [],
      patchedEmails: [],
    };

    for (const [email, tier] of activeByEmail.entries()) {
      const r = await setTierByEmail(email, tier);
      if (r.status === 'already_paid') results.alreadyPaid += 1;
      if (r.status === 'patched') {
        results.patched += 1;
        results.patchedEmails.push(email);
      }
      if (r.status === 'missing_account') {
        results.missingAccount += 1;
        results.missingEmails.push(email);
      }
      if (r.status === 'error') results.errors += 1;
    }

    console.log('[reconcile] summary', results);
    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('[reconcile] fatal', err);
    return res.status(500).json({ error: 'Reconciliation failed' });
  }
}
