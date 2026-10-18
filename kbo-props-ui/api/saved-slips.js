import { createClient } from '@supabase/supabase-js';
import { buildSavedSlipRow, legHasUnchosenSide, sportColumnMissing } from '../src/savedSlipPayload.js';

function cleanEnv(value) {
  return (value || '').replace(/\\n/g, '').trim();
}

const supabase = createClient(
  cleanEnv(process.env.VITE_SUPABASE_URL),
  cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY)
);

async function getUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

/**
 * /api/saved-slips
 *
 * GET    — list caller's saved slips (newest first)
 * POST   — save a new slip
 * DELETE  — delete a slip by id (query param ?id=)
 *
 * All routes require a valid Supabase JWT in the Authorization header.
 */
export default async function handler(req, res) {
  const user = await getUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── GET: list slips ──
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('saved_slips')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ slips: data });
  }

  // ── POST: save a new slip ──
  if (req.method === 'POST') {
    // An EVEN leg (no side picked) must not be stored as OVER.
    const incomingLegs = Array.isArray(req.body?.legs) ? req.body.legs : [];
    if (incomingLegs.some(legHasUnchosenSide)) {
      return res.status(400).json({ error: 'Tap OVER or UNDER on every EVEN leg to save.' });
    }
    const row = buildSavedSlipRow(req.body || {});

    if (!row.game_date || !Array.isArray(row.legs) || row.legs.length === 0) {
      return res.status(400).json({ error: 'game_date and legs[] are required' });
    }

    const insertSlip = (payload) => supabase
      .from('saved_slips')
      .insert({ user_id: user.id, ...payload })
      .select()
      .single();

    let { data, error } = await insertSlip(row);
    // The sport column is added by sql/migrations/20261017_saved_slips_sport.sql.
    // Until that runs, keep the sport on each leg and retry without the column.
    if (error && sportColumnMissing(error)) {
      const withoutSport = { ...row };
      delete withoutSport.sport;
      ({ data, error } = await insertSlip(withoutSport));
    }

    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ slip: data });
  }

  // ── DELETE: remove a slip ──
  if (req.method === 'DELETE') {
    const id = req.query?.id || req.body?.id;
    if (!id) return res.status(400).json({ error: 'id is required' });

    // Ensure user owns the slip
    const { data: existing } = await supabase
      .from('saved_slips')
      .select('user_id')
      .eq('id', Number(id))
      .single();

    if (!existing || existing.user_id !== user.id) {
      return res.status(404).json({ error: 'Slip not found' });
    }

    const { error } = await supabase
      .from('saved_slips')
      .delete()
      .eq('id', Number(id));

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ deleted: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).end('Method Not Allowed');
}
