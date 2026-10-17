import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { accessAfterSyncRecompute } from './_stripeTier.js';
import { safeDiscordSync, setDiscordOnlyFlag } from './_discordSync.js';
import { profileTierClaim, writeTierClaim } from './_tierClaim.js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

let stripeClient = null;
function getStripe() {
  if (!stripeClient) stripeClient = new Stripe(cleanEnv(process.env.STRIPE_SECRET_KEY));
  return stripeClient;
}

let supabaseClient = null;
function getSupabase() {
  if (!supabaseClient) {
    supabaseClient = createClient(
      cleanEnv(process.env.VITE_SUPABASE_URL),
      cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
    );
  }
  return supabaseClient;
}

async function claimOrFail(db, userId, tier) {
  const wrote = await writeTierClaim(db, userId, tier);
  if (wrote) return null;
  console.error(`[sync-subscription] tier claim failed for ${userId}`);
  return { error: 'tier claim failed' };
}

/**
 * POST /api/sync-subscription
 *
 * Called by the frontend on login when no paid tier is found in user_profiles.
 * Verifies the user's Supabase JWT, looks up their email in Stripe, and grants
 * the correct tier if they have an active subscription.
 *
 * Returns: { tier, synced: boolean }
 *
 * Stripe customer lookup is case-insensitive. A logged-out Checkout Session
 * stores the email the buyer typed; Supabase accounts are lowercase.
 */
export async function syncMemberSubscription(req, res, deps = {}) {
  const stripe = deps.stripe || getStripe();
  const supabase = deps.supabase || getSupabase();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  // Verify caller via Supabase JWT
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  // Check if they already have a paid tier — skip Stripe lookup if so
  const { data: rows } = await supabase
    .from('user_profiles')
    .select('tier')
    .eq('id', user.id)
    .limit(1);

  const currentTier = rows?.[0]?.tier;
  // Paid site tiers are not recomputed here (same as before). Discord role
  // sync still runs so a failed webhook role update is retried on login.
  // Discord-only falls through: an All-Access purchase can upgrade it, and a
  // lapsed Discord-only plan can return to free. A free profile is granted
  // only what accessAfterSyncRecompute still sees, so a refunded or disputed
  // current period is not written back.
  let access = { tier: 'free', discordOnly: false, unchanged: false };
  try {
    access = await accessAfterSyncRecompute(stripe, user.email, currentTier);
  } catch (err) {
    console.error('[sync-subscription] Stripe lookup failed:', err.message);
    if (currentTier === 'discord') {
      await safeDiscordSync(supabase, user.id);
      return res.status(200).json({ tier: 'discord', synced: false });
    }
    return res.status(500).json({ error: 'Stripe lookup failed' });
  }

  if (access.unchanged) {
    const claimFailure = await claimOrFail(supabase, user.id, currentTier);
    if (claimFailure) return res.status(500).json(claimFailure);
    await safeDiscordSync(supabase, user.id);
    return res.status(200).json({ tier: currentTier, synced: false });
  }

  const tier = access.tier || 'free';
  if (tier === 'free') {
    if (currentTier === 'discord') {
      const { error: clearError } = await supabase
        .from('user_profiles')
        .upsert({ id: user.id, tier: 'free' }, { onConflict: 'id' });
      if (clearError) {
        console.error('[sync-subscription] clear discord tier failed:', clearError);
        return res.status(500).json({ error: 'DB write failed' });
      }
      const claimFailure = await claimOrFail(supabase, user.id, 'free');
      if (claimFailure) return res.status(500).json(claimFailure);
      await setDiscordOnlyFlag(supabase, user.id, false);
      await safeDiscordSync(supabase, user.id);
      return res.status(200).json({ tier: 'free', synced: true });
    }
    const claimFailure = await claimOrFail(supabase, user.id, profileTierClaim(currentTier));
    if (claimFailure) return res.status(500).json(claimFailure);
    await safeDiscordSync(supabase, user.id);
    return res.status(200).json({ tier: 'free', synced: false });
  }

  // Grant access. The tier upsert stays separate from discord_only so a
  // missing column cannot block the site grant.
  const { error: upsertError } = await supabase
    .from('user_profiles')
    .upsert({ id: user.id, tier }, { onConflict: 'id' });

  if (upsertError) {
    console.error('[sync-subscription] upsert failed:', upsertError);
    return res.status(500).json({ error: 'DB write failed' });
  }

  const claimFailure = await claimOrFail(supabase, user.id, tier);
  if (claimFailure) return res.status(500).json(claimFailure);
  await setDiscordOnlyFlag(supabase, user.id, access.discordOnly);
  await safeDiscordSync(supabase, user.id);
  console.log(`[sync-subscription] granted ${tier} to ${user.email}`);
  return res.status(200).json({ tier, synced: true });
}

export default function handler(req, res) {
  return syncMemberSubscription(req, res);
}
