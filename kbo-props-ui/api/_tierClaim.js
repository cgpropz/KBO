// app_metadata.tier rides in the Supabase access token. The API trusts that
// claim only when it unlocks a sport. free, discord, and a missing claim are
// treated as missing, and the profile is read. Writers keep the claim next to
// user_profiles.tier. A change is in the token the member already holds only
// after the next refresh (access tokens expire in 1 hour).

import { sportAccess } from './_dataAccess.js';

export function tierClaimValue(tier) {
  if (typeof tier !== 'string') return '';
  return tier.trim();
}

// Any true value in sportAccess. free, discord, and unknown tiers do not.
export function claimUnlocksSport(tier) {
  const value = tierClaimValue(tier);
  if (!value) return false;
  return Object.values(sportAccess(value)).some((open) => open === true);
}

// Profile value to store when a login sync finds no paid Stripe plan.
// A blank profile is written as free so a stale paid claim is replaced.
export function profileTierClaim(tier) {
  return tierClaimValue(tier) || 'free';
}

// Stripe should retry customer.subscription.deleted when the claim write fails.
export function subscriptionDeletedClaimResult(wrote) {
  if (wrote) return null;
  return { status: 500, body: { error: 'tier claim failed' } };
}

// Midnight through 5:59 AM America/New_York. Hour 6 is already closed.
export function withinTierBackfillWindow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  let hour = Number(parts.find((part) => part.type === 'hour')?.value);
  if (hour === 24) hour = 0;
  return Number.isInteger(hour) && hour >= 0 && hour < 6;
}

// Keep provider and any other auth fields. Returns null when there is no tier
// to store.
export function appMetadataWithTier(existing, tier) {
  const value = tierClaimValue(tier);
  if (!value) return null;
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  return { ...base, tier: value };
}

export async function writeTierClaim(supabase, userId, tier) {
  const value = tierClaimValue(tier);
  if (!value || !userId || !supabase?.auth?.admin) return false;
  try {
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error || !data?.user) {
      console.error(`[tier-claim] lookup failed for ${userId}`);
      return false;
    }
    if (data.user.app_metadata?.tier === value) return true;
    const app_metadata = appMetadataWithTier(data.user.app_metadata, value);
    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, { app_metadata });
    if (updateError) {
      console.error(`[tier-claim] update failed for ${userId}`);
      return false;
    }
    return true;
  } catch {
    console.error(`[tier-claim] update failed for ${userId}`);
    return false;
  }
}

function clean(value) {
  return String(value || '').replace(/\\n/g, '').trim();
}

// Copy user_profiles.tier onto each auth user when that tier unlocks a sport.
// free, discord, and blank rows are skipped. The service key stays in the
// request headers and is never logged.
export async function backfillTierClaims({
  url,
  key,
  fetchImpl = globalThis.fetch,
  dryRun = false,
  pageSize = 200,
} = {}) {
  const base = clean(url).replace(/\/$/, '');
  const serviceKey = clean(key);
  if (!base || !serviceKey) {
    throw new Error('missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  const summary = { updated: 0, skipped: 0, failed: 0, dryRun: dryRun === true };
  let offset = 0;
  while (true) {
    const listUrl = new URL(`${base}/rest/v1/user_profiles`);
    listUrl.searchParams.set('select', 'id,tier');
    listUrl.searchParams.set('order', 'id.asc');
    listUrl.searchParams.set('limit', String(pageSize));
    listUrl.searchParams.set('offset', String(offset));
    const listed = await fetchImpl(listUrl, { headers });
    if (!listed?.ok) throw new Error(`user_profiles list failed (${listed?.status || 'no response'})`);
    const rows = await listed.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      const tier = tierClaimValue(row?.tier);
      const id = typeof row?.id === 'string' ? row.id : '';
      if (!id || !claimUnlocksSport(tier)) {
        summary.skipped += 1;
        continue;
      }
      const userUrl = `${base}/auth/v1/admin/users/${encodeURIComponent(id)}`;
      const current = await fetchImpl(userUrl, { headers });
      if (!current?.ok) {
        summary.failed += 1;
        continue;
      }
      const user = await current.json();
      const metadata = user?.app_metadata && typeof user.app_metadata === 'object' ? user.app_metadata : {};
      if (metadata.tier === tier) {
        summary.skipped += 1;
        continue;
      }
      if (dryRun) {
        summary.updated += 1;
        continue;
      }
      const written = await fetchImpl(userUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ app_metadata: appMetadataWithTier(metadata, tier) }),
      });
      if (written?.ok) summary.updated += 1;
      else summary.failed += 1;
    }
    if (rows.length < pageSize) break;
    offset += rows.length;
  }
  return summary;
}
