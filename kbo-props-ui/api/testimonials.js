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

const MAX_NAME = 40;
const MAX_QUOTE = 280;

/**
 * /api/testimonials
 *
 * GET  — public: approved testimonials (newest first). If a valid bearer
 *        token is supplied, also returns the caller's own submission
 *        (`mine`) regardless of approval status.
 * POST — requires auth: submit or update the caller's testimonial. Always
 *        resets `approved` to false so edits get re-reviewed. One
 *        testimonial per subscriber (upsert on user_id).
 */
export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { data: approved, error } = await supabase
      .from('testimonials')
      .select('id, display_name, quote, created_at')
      .eq('approved', true)
      .order('created_at', { ascending: false })
      .limit(12);

    if (error) return res.status(500).json({ error: error.message });

    let mine = null;
    const user = await getUser(req);
    if (user) {
      const { data: mineRows } = await supabase
        .from('testimonials')
        .select('id, display_name, quote, approved')
        .eq('user_id', user.id)
        .limit(1);
      mine = mineRows?.[0] || null;
    }

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    return res.status(200).json({ testimonials: approved || [], mine });
  }

  if (req.method === 'POST') {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const displayName = String(req.body?.display_name || '').trim().slice(0, MAX_NAME);
    const quote = String(req.body?.quote || '').trim().slice(0, MAX_QUOTE);

    if (displayName.length < 2 || quote.length < 10) {
      return res.status(400).json({ error: 'Please add your name and at least a short sentence.' });
    }

    const { data, error } = await supabase
      .from('testimonials')
      .upsert(
        { user_id: user.id, display_name: displayName, quote, approved: false },
        { onConflict: 'user_id' }
      )
      .select('id, display_name, quote, approved')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ testimonial: data });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).end('Method Not Allowed');
}
