import { getDataClient, nbaSectionOpen } from './data.js';

/**
 * GET /api/nba-access
 *
 * Returns { open: true } only when the caller would get full NBA access
 * (owner email, or an all-access tier once nba_public is true). Everyone
 * else, including preview and any lookup failure, gets { open: false }.
 * No email, tier, flag, or dataset payload.
 */
export async function handleNbaAccessRequest(req, res, client) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Vary', 'Authorization');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let open = false;
  try {
    open = await nbaSectionOpen(req, client || getDataClient());
  } catch {
    open = false;
  }
  return res.status(200).json({ open: open === true });
}

export default function handler(req, res) {
  return handleNbaAccessRequest(req, res);
}
