// ─── Discord OAuth + role sync (server, shared, NOT a route) ────────────────
// The leading underscore keeps Vercel from exposing this file as an endpoint.
//
// Site subscribers get the All-Access role. Discord-only subscribers get the
// Discord Props role. A member with both plans gets both roles. Guild and
// role ids default to the live server; DISCORD_* env vars override them.
// DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, and DISCORD_CLIENT_SECRET have no
// default — the bot app does not exist until the owner creates it.
// Hand-assigned roles are never removed: we only add or remove the two role
// ids configured here. Discord errors are returned, not thrown, so callers
// (webhook, login sync, reconcile) can log them and keep going.

import crypto from 'node:crypto';

const DISCORD_API = 'https://discord.com/api/v10';
const STATE_TTL_MS = 10 * 60 * 1000;
const SNOWFLAKE_RE = /^\d{5,25}$/;

// Live ⛰GREENLAND⛰ server. Env vars override these. They are not secrets.
// The bot token and OAuth client secret stay env-only; those apps are not
// created yet.
export const DISCORD_GUILD_ID_DEFAULT = '1175980588579164230';
export const DISCORD_ROLE_SITE_SUBSCRIBER_DEFAULT = '1558580149715337216'; // 💎 All-Access
export const DISCORD_ROLE_DISCORD_ONLY_DEFAULT = '1558580317932224603'; // 🎟️ Discord Props

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

function snowflakeOr(value, fallback) {
  const cleaned = cleanEnv(value);
  return SNOWFLAKE_RE.test(cleaned) ? cleaned : fallback;
}

export function discordConfig(env = process.env) {
  const cfg = {
    guildId: snowflakeOr(env?.DISCORD_GUILD_ID, DISCORD_GUILD_ID_DEFAULT),
    botToken: cleanEnv(env?.DISCORD_BOT_TOKEN),
    clientId: cleanEnv(env?.DISCORD_CLIENT_ID),
    clientSecret: cleanEnv(env?.DISCORD_CLIENT_SECRET),
    redirectUri: cleanEnv(env?.DISCORD_REDIRECT_URI),
    returnUrl: cleanEnv(env?.DISCORD_RETURN_URL) || 'https://www.cgpropz.com/',
    siteRoleId: snowflakeOr(env?.DISCORD_ROLE_SITE_SUBSCRIBER, DISCORD_ROLE_SITE_SUBSCRIBER_DEFAULT),
    discordRoleId: snowflakeOr(env?.DISCORD_ROLE_DISCORD_ONLY, DISCORD_ROLE_DISCORD_ONLY_DEFAULT),
    adminSecret: cleanEnv(env?.DISCORD_ADMIN_SECRET),
  };
  cfg.oauthReady = Boolean(cfg.clientId && cfg.clientSecret && cfg.redirectUri);
  cfg.botReady = Boolean(cfg.guildId && cfg.botToken && SNOWFLAKE_RE.test(cfg.guildId));
  return cfg;
}

// Paid site tiers. 'discord' and 'free' are intentionally absent.
export const SITE_ACCESS_TIERS = new Set([
  'owner', 'pro', 'monthly', 'weekly', 'season', 'all', 'combined', 'kbo', 'wnba',
]);

export function isSiteTier(tier) {
  return SITE_ACCESS_TIERS.has(tier);
}

// Roles to assign from the stored profile. Lifetime is stored as a site tier
// (combined), so it keeps the site role with no extra expiry.
export function entitlementsFor({ tier, discordOnly } = {}) {
  return {
    siteSubscriber: isSiteTier(tier),
    discordOnly: discordOnly === true || tier === 'discord',
  };
}

export function managedRoleIds(config) {
  return [config?.siteRoleId, config?.discordRoleId].filter((id) => SNOWFLAKE_RE.test(id || ''));
}

// Keep every role we do not manage. Add the managed roles the member should
// have and drop the managed roles they should not.
export function nextMemberRoles(currentRoles, { siteSubscriber, discordOnly, siteRoleId, discordRoleId } = {}) {
  const managed = [siteRoleId, discordRoleId].filter((id) => SNOWFLAKE_RE.test(id || ''));
  const next = (Array.isArray(currentRoles) ? currentRoles : []).filter((id) => id && !managed.includes(id));
  if (siteSubscriber && siteRoleId && !next.includes(siteRoleId)) next.push(siteRoleId);
  if (discordOnly && discordRoleId && !next.includes(discordRoleId)) next.push(discordRoleId);
  return next;
}

export function rolesChanged(current, next) {
  const a = [...(current || [])].map(String).sort();
  const b = [...(next || [])].map(String).sort();
  if (a.length !== b.length) return true;
  return a.some((id, i) => id !== b[i]);
}

function botAuthorization(token) {
  const value = String(token || '').trim();
  if (!value) return '';
  return /^bot\s+/i.test(value) ? value : `Bot ${value}`;
}

export async function discordRequest(path, {
  token, bot = false, method = 'GET', body, fetchImpl = globalThis.fetch,
} = {}) {
  const headers = {};
  if (token) headers.Authorization = bot ? botAuthorization(token) : `Bearer ${token}`;
  let payload;
  if (body != null) {
    if (typeof body === 'string') payload = body;
    else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  const res = await fetchImpl(`${DISCORD_API}${path}`, {
    method,
    headers,
    body: payload,
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return { ok: res.ok, status: res.status, json };
}

function discordError(res) {
  const code = res?.json?.code;
  const message = res?.json?.message;
  return [res?.status, code, message].filter((part) => part != null && part !== '').join(' ');
}

export async function addGuildMember({ discordUserId, userAccessToken, config, fetchImpl }) {
  if (!config?.botReady || !SNOWFLAKE_RE.test(discordUserId || '') || !userAccessToken) {
    return { ok: false, reason: 'not_configured' };
  }
  // Omitting `roles` means an existing member (204) keeps every role they
  // already have, including hand-assigned ones. New members get roles on the
  // follow-up sync.
  const res = await discordRequest(`/guilds/${config.guildId}/members/${discordUserId}`, {
    method: 'PUT',
    bot: true,
    token: config.botToken,
    body: { access_token: userAccessToken },
    fetchImpl,
  });
  if (res.ok) return { ok: true, status: res.status, pending: res.json?.pending === true };
  return { ok: false, reason: 'add_member', detail: discordError(res), status: res.status };
}

export async function syncMemberRoles({ discordUserId, entitlements, config, fetchImpl }) {
  if (!config?.botReady || !SNOWFLAKE_RE.test(discordUserId || '')) {
    return { ok: false, skipped: true, reason: 'not_configured' };
  }
  if (!managedRoleIds(config).length) {
    return { ok: false, skipped: true, reason: 'roles_not_configured' };
  }
  const member = await discordRequest(`/guilds/${config.guildId}/members/${discordUserId}`, {
    bot: true,
    token: config.botToken,
    fetchImpl,
  });
  if (member.status === 404) return { ok: false, reason: 'not_in_guild' };
  if (!member.ok) return { ok: false, reason: 'get_member', detail: discordError(member), status: member.status };

  const current = Array.isArray(member.json?.roles) ? member.json.roles : [];
  const next = nextMemberRoles(current, {
    siteSubscriber: entitlements?.siteSubscriber === true,
    discordOnly: entitlements?.discordOnly === true,
    siteRoleId: config.siteRoleId,
    discordRoleId: config.discordRoleId,
  });
  if (!rolesChanged(current, next)) return { ok: true, changed: false };

  const patched = await discordRequest(`/guilds/${config.guildId}/members/${discordUserId}`, {
    method: 'PATCH',
    bot: true,
    token: config.botToken,
    body: { roles: next },
    fetchImpl,
  });
  if (!patched.ok) return { ok: false, reason: 'patch_roles', detail: discordError(patched), status: patched.status };
  return { ok: true, changed: true };
}

export function signOAuthState(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyOAuthState(state, secret, now = Date.now()) {
  if (!state || !secret || !String(state).includes('.')) return null;
  const parts = String(state).split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload?.uid || !/^[A-Za-z0-9_-]{1,200}$/.test(payload.uid)) return null;
  if (!Number.isFinite(payload.exp) || payload.exp < now) return null;
  return payload;
}

export function oauthStateForUser(userId, secret, now = Date.now()) {
  return signOAuthState({ uid: userId, exp: now + STATE_TTL_MS, n: crypto.randomBytes(8).toString('hex') }, secret);
}

export function discordAuthorizeUrl(config, state) {
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds.join');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export function safeReturnUrl(value) {
  try {
    const url = new URL(value || 'https://www.cgpropz.com/');
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('bad protocol');
    return url;
  } catch {
    return new URL('https://www.cgpropz.com/');
  }
}

export async function exchangeDiscordCode({ code, config, fetchImpl = globalThis.fetch }) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: config.redirectUri,
  });
  const res = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(8000),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    return { ok: false, status: res.status };
  }
  return { ok: true, accessToken: json.access_token };
}

export async function fetchDiscordIdentity({ accessToken, fetchImpl }) {
  const res = await discordRequest('/users/@me', { token: accessToken, fetchImpl });
  const id = String(res.json?.id || '');
  if (!res.ok || !SNOWFLAKE_RE.test(id)) return { ok: false, status: res.status };
  const username = String(res.json.global_name || res.json.username || '').trim().slice(0, 64);
  return { ok: true, id, username };
}

export function isDiscordAdmin(req, env = process.env) {
  const secret = cleanEnv(env?.DISCORD_ADMIN_SECRET);
  if (!secret) return false;
  const header = req?.headers?.authorization || req?.headers?.Authorization || '';
  return safeEqual(header, `Bearer ${secret}`);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
