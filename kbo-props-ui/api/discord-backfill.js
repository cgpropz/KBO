import { discordConfig, isDiscordAdmin } from './_discord.js';
import { createServiceClient, runDiscordBackfill } from './_discordSync.js';

/**
 * POST /api/discord-backfill
 * Authorization: Bearer ${DISCORD_ADMIN_SECRET}
 *
 * Assigns the site-subscriber and Discord-only roles for members who have
 * already connected Discord. Roles follow the stored tier. Hand-assigned
 * roles (anything other than the two configured role ids) are left in place,
 * and members who have not connected are not touched.
 *
 * Rejects every request when DISCORD_ADMIN_SECRET is unset.
 */
export async function handleDiscordBackfill(req, res, deps = {}) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const env = deps.env || process.env;
  if (!isDiscordAdmin(req, env)) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = deps.supabase || createServiceClient(env);
  if (!supabase) return res.status(503).json({ error: 'Backfill unavailable' });

  try {
    const summary = await runDiscordBackfill({
      supabase,
      config: deps.config || discordConfig(env),
      fetchImpl: deps.fetchImpl,
      env,
    });
    console.log('[discord] backfill', summary);
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error('[discord] backfill failed:', err?.message || err);
    return res.status(500).json({ error: 'Backfill failed' });
  }
}

export default function handler(req, res) {
  return handleDiscordBackfill(req, res);
}
