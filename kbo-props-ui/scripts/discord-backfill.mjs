#!/usr/bin/env node
// Back-fill Discord roles for site members who have already connected Discord.
// Does not create Stripe products, change Supabase, or call Vercel.
// Existing hand-assigned roles stay; only the two configured role ids move,
// and only on Discord accounts linked to a site profile.
//
// Required env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCORD_BOT_TOKEN,
// and DISCORD_ADMIN_SECRET (must be set so this is not run by accident).
// Guild and role ids default to the live ⛰GREENLAND⛰ server
// (1175980588579164230, All-Access 1558580149715337216,
// Discord Props 1558580317932224603) unless those env vars override them.
//
//   node scripts/discord-backfill.mjs
//
// Or, against the deployed site, after the secret is set on Vercel:
//   curl -X POST https://www.cgpropz.com/api/discord-backfill \
//     -H "Authorization: Bearer $DISCORD_ADMIN_SECRET"

import { discordConfig } from '../api/_discord.js';
import { createServiceClient, runDiscordBackfill } from '../api/_discordSync.js';

const secret = (process.env.DISCORD_ADMIN_SECRET || '').trim();
if (!secret) {
  console.error('Set DISCORD_ADMIN_SECRET before running the backfill.');
  process.exit(1);
}

const supabase = createServiceClient(process.env);
const config = discordConfig(process.env);
if (!supabase || !config.botReady) {
  console.error('Supabase service role and Discord bot env vars are required.');
  process.exit(1);
}

const summary = await runDiscordBackfill({ supabase, config, env: process.env });
console.log(JSON.stringify({ ok: true, ...summary }));
