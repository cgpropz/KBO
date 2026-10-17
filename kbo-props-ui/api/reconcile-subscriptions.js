import { timingSafeEqual } from 'node:crypto';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { mergeTier, tierForStripePrice, signalsLifetimePurchase } from './_stripeTier.js';
import { safeDiscordSync, setDiscordOnlyFlag } from './_discordSync.js';
import { writeTierClaim } from './_tierClaim.js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

const stripe = new Stripe(cleanEnv(process.env.STRIPE_SECRET_KEY));

const supabase = createClient(
  cleanEnv(process.env.VITE_SUPABASE_URL),
  cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
);

// Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when the CRON_SECRET
// env var is set on the project (https://vercel.com/docs/cron-jobs/manage-cron-jobs).
// That is the only accepted credential: the old `x-vercel-cron` header check is
// gone because any client can send that header, and query-string tokens leak
// into logs. With no CRON_SECRET configured, every request is rejected.
function isAuthorizedRequest(req) {
  const cronSecret = cleanEnv(process.env.CRON_SECRET);
  if (!cronSecret) return false;
  const header = req.headers.authorization || '';
  return safeEqual(header, `Bearer ${cronSecret}`);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
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

async function walkSubscriptions(status, { byEmail, discordEmails, recordSite }) {
  let startingAfter;

  while (true) {
    const page = await stripe.subscriptions.list({
      status,
      limit: 100,
      starting_after: startingAfter,
      expand: ['data.customer', 'data.items.data.price'],
    });

    for (const sub of page.data) {
      const customer = sub.customer;
      const email = (customer && typeof customer === 'object' ? customer.email : null) || '';
      const normalized = email.trim().toLowerCase();
      if (!normalized) continue;

      // Grant from the live price id (weekly all-access → combined). Amount
      // buckets mislabeled the $9.99 weekly price as monthly and could
      // overwrite a narrower legacy tier. Emails are lowercased so a
      // mixed-case Checkout address still matches the Supabase account.
      // Discord-only prices are recorded separately and are not merged into
      // the site tier, so they cannot grant All-Access.
      const price = sub.items?.data?.[0]?.price;
      const priceId = typeof price === 'string' ? price : price?.id;
      // Product metadata and the live Discord Only product id are checked
      // here. The list expand stops at the price object (Stripe rejects a
      // fifth expand level), so an unknown price is retrieved once.
      const classified = await tierForStripePrice(stripe, price || priceId, { metadata: sub.metadata });
      if (classified === 'discord') {
        discordEmails.add(normalized);
        continue;
      }
      if (!recordSite) continue;
      const tier = classified;
      const prev = byEmail.get(normalized) || 'free';
      byEmail.set(normalized, mergeTier(prev, tier));
    }

    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
}

// One-time Lifetime and Founders purchases are not subscriptions. Scan recent
// paid Checkout Sessions and grant combined when the price id, product id, or
// one-time metadata says so. The legacy $49.99/yr KBO price is recurring and
// is ignored here.
async function collectLifetimeEmails() {
  const emails = new Set();
  let startingAfter;
  const since = Math.floor(Date.now() / 1000) - 120 * 24 * 3600;
  for (let page = 0; page < 10; page += 1) {
    const list = await stripe.checkout.sessions.list({
      status: 'complete',
      limit: 100,
      starting_after: startingAfter,
      created: { gte: since },
      expand: ['data.line_items.data.price'],
    });
    for (const session of list.data || []) {
      if (session.mode !== 'payment' || session.payment_status !== 'paid') continue;
      const email = (session.customer_details?.email || session.customer_email || '').trim().toLowerCase();
      if (!email) continue;
      const lines = session.line_items?.data || [];
      const hit = lines.some((line) => signalsLifetimePurchase({
        price: line?.price,
        priceId: typeof line?.price === 'string' ? line.price : line?.price?.id,
        product: line?.price && typeof line.price === 'object' ? line.price.product : null,
        metadata: session.metadata,
      })) || session.metadata?.cg_plan === 'lifetime' || session.metadata?.cg_plan === 'founders';
      if (hit) emails.add(email);
    }
    if (!list.has_more || !list.data?.length) break;
    startingAfter = list.data[list.data.length - 1].id;
  }
  return emails;
}

async function collectActiveSubscriberTiers() {
  const byEmail = new Map();
  const discordEmails = new Set();
  // Site tiers stay active-only, matching the previous reconcile. Trialing
  // is scanned only so a Discord-only trial still receives its role.
  await walkSubscriptions('active', { byEmail, discordEmails, recordSite: true });
  await walkSubscriptions('trialing', { byEmail, discordEmails, recordSite: false });
  return { byEmail, discordEmails };
}

async function emailForUserId(userId) {
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error || !data?.user?.email) return null;
    return data.user.email.trim().toLowerCase();
  } catch {
    return null;
  }
}

// Mark active Discord-only subscribers and drop the flag when that
// subscription is gone. Site tiers are not downgraded here — cancellation of
// All-Access / KBO / Lifetime still happens in the webhook recompute.
async function reconcileDiscordFlags(discordEmails) {
  const summary = { flagged: 0, cleared: 0, lapsedDiscordTier: 0 };
  for (const email of discordEmails) {
    const user = await findUserByEmail(email);
    if (!user?.id) continue;
    const { data: rows, error } = await supabase
      .from('user_profiles')
      .select('tier')
      .eq('id', user.id)
      .limit(1);
    if (error) continue;
    const current = rows?.[0]?.tier || 'free';
    const next = mergeTier(current, 'discord');
    if (next !== current) {
      const { error: upsertError } = await supabase
        .from('user_profiles')
        .upsert({ id: user.id, tier: next }, { onConflict: 'id' });
      if (upsertError) continue;
      await writeTierClaim(supabase, user.id, next);
    }
    if (await setDiscordOnlyFlag(supabase, user.id, true)) summary.flagged += 1;
  }

  const candidates = [];
  const pageSize = 200;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, tier, discord_only')
      .or('discord_only.eq.true,tier.eq.discord')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    candidates.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  for (const row of candidates) {
    const email = await emailForUserId(row.id);
    if (!email || discordEmails.has(email)) continue;
    if (row.tier === 'discord') {
      const { error: clearError } = await supabase
        .from('user_profiles')
        .upsert({ id: row.id, tier: 'free' }, { onConflict: 'id' });
      if (!clearError) {
        summary.lapsedDiscordTier += 1;
        await writeTierClaim(supabase, row.id, 'free');
      }
    }
    if (row.discord_only === true && await setDiscordOnlyFlag(supabase, row.id, false)) {
      summary.cleared += 1;
    }
  }
  return summary;
}

async function syncConnectedDiscordRoles() {
  const summary = { connected: 0, synced: 0, failed: 0 };
  const pageSize = 200;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id')
      .not('discord_user_id', 'is', null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    for (const row of rows) {
      summary.connected += 1;
      const result = await safeDiscordSync(supabase, row.id);
      if (result?.ok) summary.synced += 1;
      else if (!result?.skipped) summary.failed += 1;
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return summary;
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
  const next = mergeTier(current, tier);
  if (next === current) {
    return { status: 'already_paid', email };
  }

  const { error: upsertError } = await supabase
    .from('user_profiles')
    .upsert({ id: userId, tier: next }, { onConflict: 'id' });

  if (upsertError) {
    console.error('[reconcile] failed upsert for', email, upsertError);
    return { status: 'error', email, error: upsertError.message };
  }

  await writeTierClaim(supabase, userId, next);
  return { status: 'patched', email, tier: next };
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
    const { byEmail: activeByEmail, discordEmails } = await collectActiveSubscriberTiers();
    const results = {
      activeSubscribers: activeByEmail.size,
      alreadyPaid: 0,
      patched: 0,
      missingAccount: 0,
      errors: 0,
      lifetimeGranted: 0,
    };

    for (const [email, tier] of activeByEmail.entries()) {
      const r = await setTierByEmail(email, tier);
      if (r.status === 'already_paid') results.alreadyPaid += 1;
      if (r.status === 'patched') results.patched += 1;
      if (r.status === 'missing_account') results.missingAccount += 1;
      if (r.status === 'error') results.errors += 1;
    }

    try {
      const lifetimeEmails = await collectLifetimeEmails();
      for (const email of lifetimeEmails) {
        const r = await setTierByEmail(email, 'combined');
        if (r.status === 'patched') results.lifetimeGranted += 1;
        if (r.status === 'already_paid') results.alreadyPaid += 1;
        if (r.status === 'missing_account') results.missingAccount += 1;
        if (r.status === 'error') results.errors += 1;
      }
    } catch (err) {
      console.error('[reconcile] lifetime pass failed:', err?.message || err);
      results.lifetimeError = true;
    }

    let discord = null;
    try {
      const flags = await reconcileDiscordFlags(discordEmails);
      const roles = await syncConnectedDiscordRoles();
      discord = { ...flags, ...roles };
    } catch (err) {
      console.error('[reconcile] discord pass failed:', err?.message || err);
      discord = { error: true };
    }

    // Counts only: customer emails are never returned or logged in the summary.
    console.log('[reconcile] summary', results, discord);
    return res.status(200).json({ ok: true, ...results, discord });
  } catch (err) {
    console.error('[reconcile] fatal', err);
    return res.status(500).json({ error: 'Reconciliation failed' });
  }
}
