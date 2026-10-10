// One Serverless Function for every Discord route. Vercel Hobby allows 12.
// Public URLs stay /api/discord-auth, /api/discord-callback, /api/discord-checkout,
// /api/discord-disconnect, and /api/discord-backfill via vercel.json rewrites.
// The OAuth redirect URI registered with Discord is still /api/discord-callback.
// Rewrites must not put a query string on the destination, or code/state from
// Discord would be replaced.

import { handleDiscordBackfill } from '../_discordBackfill.js';
import { handleDiscordCheckoutRequest } from '../_discordCheckout.js';
import { routeParam } from '../_routeKey.js';
import { handleDiscordAuth, handleDiscordCallback, handleDiscordDisconnect } from '../_discordSync.js';

export const DISCORD_ACTIONS = {
  auth: handleDiscordAuth,
  callback: handleDiscordCallback,
  checkout: handleDiscordCheckoutRequest,
  disconnect: handleDiscordDisconnect,
  backfill: handleDiscordBackfill,
};

const DISCORD_ALIASES = {
  'discord-auth': 'auth',
  'discord-callback': 'callback',
  'discord-checkout': 'checkout',
  'discord-disconnect': 'disconnect',
  'discord-backfill': 'backfill',
};

export default function handler(req, res) {
  const action = routeParam(req, { param: 'action', aliases: DISCORD_ALIASES });
  const route = DISCORD_ACTIONS[action];
  if (!route) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.status(404).json({ error: 'Not found' });
  }
  return route(req, res);
}
