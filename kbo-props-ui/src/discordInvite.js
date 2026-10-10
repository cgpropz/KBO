// Public Discord invite for ⛰GREENLAND⛰. VITE_DISCORD_INVITE_URL overrides
// this when it is an https discord.gg / discord.com link. Anything else
// (empty, javascript:, another host) falls back to the live invite.
export const DISCORD_INVITE_URL = 'https://discord.gg/w3wgbCcxDZ';

export function discordInviteUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return '';
    const host = url.hostname.toLowerCase();
    if (host !== 'discord.gg' && host !== 'discord.com' && host !== 'www.discord.com') return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function discordInviteFromEnv(env) {
  const source = env || (typeof import.meta !== 'undefined' ? import.meta.env : {}) || {};
  return discordInviteUrl(source?.VITE_DISCORD_INVITE_URL) || DISCORD_INVITE_URL;
}
