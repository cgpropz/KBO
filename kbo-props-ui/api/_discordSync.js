// ─── Profile ↔ Discord role sync (server, shared, NOT a route) ──────────────
// Writes discord columns with the service role. Never throws: a Discord or
// schema failure is logged and the Stripe tier write that called us still
// stands. Role changes are retried on the next login sync, reconcile, or
// backfill.

import { createClient } from '@supabase/supabase-js';
import {
  discordConfig,
  entitlementsFor,
  syncMemberRoles,
  addGuildMember,
  exchangeDiscordCode,
  fetchDiscordIdentity,
  verifyOAuthState,
  oauthStateForUser,
  discordAuthorizeUrl,
  safeReturnUrl,
} from './_discord.js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

export function createServiceClient(env = process.env) {
  const url = cleanEnv(env?.VITE_SUPABASE_URL);
  const key = cleanEnv(env?.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) return null;
  return createClient(url, key);
}

export async function userFromBearer(req, supabase) {
  const token = String(req?.headers?.authorization || req?.headers?.Authorization || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  if (!token || !supabase) return null;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    return data.user;
  } catch {
    return null;
  }
}

export async function safeDiscordSync(supabase, userId, deps = {}) {
  if (!supabase || !userId) return { skipped: true, reason: 'no_user' };
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('tier, discord_only, discord_user_id')
      .eq('id', userId)
      .limit(1);
    if (error) {
      console.error('[discord] profile read failed:', error.message);
      return { ok: false, reason: 'profile_read' };
    }
    const row = data?.[0];
    if (!row?.discord_user_id) return { skipped: true, reason: 'not_connected' };
    const result = await syncMemberRoles({
      discordUserId: row.discord_user_id,
      entitlements: entitlementsFor({ tier: row.tier, discordOnly: row.discord_only === true }),
      config: deps.config || discordConfig(deps.env),
      fetchImpl: deps.fetchImpl,
    });
    if (!result.ok && !result.skipped) {
      console.error('[discord] role sync failed', result.reason || '', result.detail || '');
    }
    return result;
  } catch (err) {
    console.error('[discord] role sync error:', err?.message || err);
    return { ok: false, reason: 'exception' };
  }
}

// Separate from the tier upsert so a missing discord_only column cannot
// roll back an All-Access grant applied before this migration is run.
export async function setDiscordOnlyFlag(supabase, userId, value) {
  if (!supabase || !userId) return false;
  try {
    const { error } = await supabase
      .from('user_profiles')
      .update({ discord_only: value === true })
      .eq('id', userId);
    if (error) console.error('[discord] discord_only update failed:', error.message);
    return !error;
  } catch (err) {
    console.error('[discord] discord_only update error:', err?.message || err);
    return false;
  }
}

export async function saveDiscordLink(supabase, userId, { discordUserId, username }) {
  const { data: others, error: otherError } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('discord_user_id', discordUserId)
    .neq('id', userId);
  if (otherError) throw new Error(otherError.message);
  for (const other of others || []) {
    const { error } = await supabase
      .from('user_profiles')
      .update({ discord_user_id: null, discord_username: null })
      .eq('id', other.id);
    if (error) throw new Error(error.message);
  }

  const { data: existing, error: readError } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('id', userId)
    .limit(1);
  if (readError) throw new Error(readError.message);

  if (!existing?.length) {
    const { error } = await supabase
      .from('user_profiles')
      .upsert({
        id: userId,
        tier: 'free',
        discord_user_id: discordUserId,
        discord_username: username || null,
      }, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from('user_profiles')
    .update({
      discord_user_id: discordUserId,
      discord_username: username || null,
    })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

export async function clearDiscordLink(supabase, userId) {
  const { error } = await supabase
    .from('user_profiles')
    .update({ discord_user_id: null, discord_username: null })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}

async function profileDiscordId(supabase, userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('discord_user_id')
    .eq('id', userId)
    .limit(1);
  if (error) return { error };
  return { discordUserId: data?.[0]?.discord_user_id || null };
}

export async function handleDiscordAuth(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const env = deps.env || process.env;
  const config = deps.config || discordConfig(env);
  if (!config.oauthReady) return res.status(503).json({ error: 'Discord connect is not configured' });
  const supabase = deps.supabase || createServiceClient(env);
  const user = deps.user !== undefined ? deps.user : await userFromBearer(req, supabase);
  if (!user?.id) return res.status(401).json({ error: 'Unauthorized' });
  const state = oauthStateForUser(user.id, config.clientSecret);
  return res.status(200).json({ url: discordAuthorizeUrl(config, state) });
}

export async function handleDiscordCallback(req, res, deps = {}) {
  const env = deps.env || process.env;
  const config = deps.config || discordConfig(env);
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const redirect = (status) => {
    const url = safeReturnUrl(config.returnUrl);
    url.searchParams.set('discord', status);
    res.writeHead(302, { Location: url.toString(), 'Cache-Control': 'no-store' });
    res.end();
  };

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end('Method Not Allowed');
  }

  const query = req.query || {};
  if (query.error || !query.code) return redirect('error');
  const payload = verifyOAuthState(query.state, config.clientSecret);
  if (!payload || !config.oauthReady) return redirect('error');

  const supabase = deps.supabase || createServiceClient(env);
  if (!supabase) return redirect('error');

  try {
    const token = await exchangeDiscordCode({ code: query.code, config, fetchImpl });
    if (!token.ok) {
      console.error('[discord] token exchange failed:', token.status);
      return redirect('error');
    }
    const me = await fetchDiscordIdentity({ accessToken: token.accessToken, fetchImpl });
    if (!me.ok) {
      console.error('[discord] identify failed:', me.status);
      return redirect('error');
    }

    const previous = await profileDiscordId(supabase, payload.uid);
    if (!previous.error && previous.discordUserId && previous.discordUserId !== me.id) {
      // Drop the managed roles on the account being replaced. Hand-assigned
      // roles stay. A failure here does not block the new link.
      const removed = await syncMemberRoles({
        discordUserId: previous.discordUserId,
        entitlements: { siteSubscriber: false, discordOnly: false },
        config,
        fetchImpl,
      });
      if (!removed.ok && removed.reason !== 'not_in_guild' && !removed.skipped) {
        console.error('[discord] previous account role clear failed:', removed.reason, removed.detail || '');
      }
    }

    await saveDiscordLink(supabase, payload.uid, { discordUserId: me.id, username: me.username });
    const joined = await addGuildMember({
      discordUserId: me.id,
      userAccessToken: token.accessToken,
      config,
      fetchImpl,
    });
    if (!joined.ok) console.error('[discord] guild join failed:', joined.reason, joined.detail || '');
    const synced = await safeDiscordSync(supabase, payload.uid, { config, fetchImpl });
    if (!synced.ok && !synced.skipped) {
      console.error('[discord] post-connect sync failed:', synced.reason, synced.detail || '');
    }
    return redirect('connected');
  } catch (err) {
    console.error('[discord] callback failed:', err?.message || err);
    return redirect('error');
  }
}

export async function handleDiscordDisconnect(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const env = deps.env || process.env;
  const config = deps.config || discordConfig(env);
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const supabase = deps.supabase || createServiceClient(env);
  const user = deps.user !== undefined ? deps.user : await userFromBearer(req, supabase);
  if (!user?.id || !supabase) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const current = await profileDiscordId(supabase, user.id);
    if (current.error) return res.status(500).json({ error: 'Profile read failed' });
    if (current.discordUserId) {
      const removed = await syncMemberRoles({
        discordUserId: current.discordUserId,
        entitlements: { siteSubscriber: false, discordOnly: false },
        config,
        fetchImpl,
      });
      const removable = removed.ok || removed.reason === 'not_in_guild' || removed.skipped;
      if (!removable) {
        console.error('[discord] disconnect role clear failed:', removed.reason, removed.detail || '');
        return res.status(502).json({ error: 'Discord role update failed. Try again.' });
      }
    }
    await clearDiscordLink(supabase, user.id);
    return res.status(200).json({ disconnected: true });
  } catch (err) {
    console.error('[discord] disconnect failed:', err?.message || err);
    return res.status(500).json({ error: 'Disconnect failed' });
  }
}

export async function runDiscordBackfill({ supabase, config, fetchImpl, env }) {
  const resolved = config || discordConfig(env);
  const results = { connected: 0, synced: 0, unchanged: 0, skipped: 0, failed: 0 };
  const pageSize = 200;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, tier, discord_only, discord_user_id')
      .not('discord_user_id', 'is', null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    for (const row of rows) {
      results.connected += 1;
      try {
        const result = await syncMemberRoles({
          discordUserId: row.discord_user_id,
          entitlements: entitlementsFor({ tier: row.tier, discordOnly: row.discord_only === true }),
          config: resolved,
          fetchImpl,
        });
        if (result.skipped) results.skipped += 1;
        else if (!result.ok) results.failed += 1;
        else if (result.changed) results.synced += 1;
        else results.unchanged += 1;
      } catch (err) {
        results.failed += 1;
        console.error('[discord] backfill row failed:', err?.message || err);
      }
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return results;
}
