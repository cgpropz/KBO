import { getDataClient, nhlSectionOpen } from './data.js';

/**
 * GET /api/nhl-access
 *
 * { open: true } only for the admin account, identified from the Supabase
 * session. Paid members and everyone else get { open: false }. No email,
 * tier, flag, or dataset payload.
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
