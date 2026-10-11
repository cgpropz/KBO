import { getDataClient, nhlSectionOpen } from './data.js';

/**
 * GET /api/nhl-access
 *
 * { open: true } for an active All-Access tier (the same check as KBO, WNBA,
 * and NFL) and for the admin account, both read from the Supabase session.
 * Discord-only, free, and logged-out callers get { open: false }. No email,
 * tier, or dataset payload.
 */
export async function handleNhlAccessRequest(req, res, client) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Authorization');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  let open = false;
  try {
    open = await nhlSectionOpen(req, client || getDataClient());
  } catch {
    open = false;
  }
  return res.status(200).json({ open: open === true });
}

export default function handler(req, res) {
  return handleNhlAccessRequest(req, res);
}
