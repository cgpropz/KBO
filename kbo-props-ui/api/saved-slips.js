import { createClient } from '@supabase/supabase-js';

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
    const { game_date, confidence, avg_edge, total_edge, unique_games, legs } = req.body || {};

    if (!game_date || !Array.isArray(legs) || legs.length === 0) {
      return res.status(400).json({ error: 'game_date and legs[] are required' });
    }

    // Sanitize legs — only keep expected fields
    const cleanLegs = legs.map(l => ({
      name: String(l.name || ''),
      team: String(l.team || ''),
      opponent: String(l.opponent || ''),
      prop: String(l.prop || ''),
      propShort: String(l.propShort || ''),
      line: l.line != null ? Number(l.line) : null,
      projection: l.projection != null ? Number(l.projection) : null,
      edge: l.edge != null ? Number(l.edge) : null,
      side: l.side === 'UNDER' ? 'UNDER' : 'OVER',
      result: 'pending',
      actual: null,
    }));

    const { data, error } = await supabase
      .from('saved_slips')
      .insert({
        user_id: user.id,
        game_date,
        confidence: confidence != null ? Number(confidence) : null,
        avg_edge: avg_edge != null ? Number(avg_edge) : null,
        total_edge: total_edge != null ? Number(total_edge) : null,
        unique_games: unique_games != null ? Number(unique_games) : null,
        legs: cleanLegs,
      })
      .select()
      .single();

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
