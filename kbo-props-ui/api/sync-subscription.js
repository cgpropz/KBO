import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { computeStripeAccess } from './_stripeTier.js';
import { safeDiscordSync, setDiscordOnlyFlag } from './_discordSync.js';
import { profileTierClaim, writeTierClaim } from './_tierClaim.js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

const stripe = new Stripe(cleanEnv(process.env.STRIPE_SECRET_KEY));

const supabase = createClient(
  cleanEnv(process.env.VITE_SUPABASE_URL),
  cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
);

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
export default async function handler(req, res) {
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
  // lapsed Discord-only plan can return to free.
  if (currentTier && currentTier !== 'free' && currentTier !== 'discord') {
    await writeTierClaim(supabase, user.id, currentTier);
    await safeDiscordSync(supabase, user.id);
    return res.status(200).json({ tier: currentTier, synced: false });
  }

  // Look up the user's live Stripe entitlement across all active/trialing
  // subscriptions + any one-time lifetime purchase, mapped to a per-sport tier.
  // Discord-only subscriptions resolve to 'discord' and do not grant site access.
  let access = { tier: 'free', discordOnly: false };
  try {
    access = await computeStripeAccess(stripe, user.email);
  } catch (err) {
    console.error('[sync-subscription] Stripe lookup failed:', err.message);
    if (currentTier === 'discord') {
      await safeDiscordSync(supabase, user.id);
      return res.status(200).json({ tier: 'discord', synced: false });
    }
    return res.status(500).json({ error: 'Stripe lookup failed' });
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
      await writeTierClaim(supabase, user.id, 'free');
      await setDiscordOnlyFlag(supabase, user.id, false);
      await safeDiscordSync(supabase, user.id);
      return res.status(200).json({ tier: 'free', synced: true });
    }
    await writeTierClaim(supabase, user.id, profileTierClaim(currentTier));
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

  await writeTierClaim(supabase, user.id, tier);
  await setDiscordOnlyFlag(supabase, user.id, access.discordOnly);
  await safeDiscordSync(supabase, user.id);
  console.log(`[sync-subscription] granted ${tier} to ${user.email}`);
  return res.status(200).json({ tier, synced: true });
}
