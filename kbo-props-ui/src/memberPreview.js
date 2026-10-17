import { datasetSport, sportAccess } from './entitlements.js';

// Retry a free preview only when this session's cached tier unlocks that
// dataset. A KBO plan, an admin tier, or a tier cached for someone else
// is the preview the server meant, not a failed paid read.
export function memberPreviewIsDowngrade(ds, body, { session, tierCache } = {}) {
  if (!body || body.preview !== true) return false;
  const sessionUserId = session?.user?.id;
  if (!sessionUserId || !tierCache || typeof tierCache.getItem !== 'function') return false;
  let cached = null;
  try {
    cached = JSON.parse(tierCache.getItem('cg_tier') || 'null');
  } catch {
    return false;
  }
  if (!cached || cached.userId !== sessionUserId) return false;
  const sport = datasetSport(ds);
  if (!sport) return false;
  return sportAccess(cached.tier)[sport] === true;
}
