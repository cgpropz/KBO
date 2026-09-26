import { fetchApiDataset } from './apiData';

/*
 * KBO data loader.
 *
 * Paid snapshots are served only through the server-gated /api/data endpoint
 * (full data for paid tiers, a top-rows preview for free/anonymous users).
 * Only genuinely public reference files (player photos, team stats, schedule
 * lines) are still shipped as static files under /data/.
 */
const FILE_TO_DATASET = {
  'strikeout_projections.json': 'strikeout_projections',
  'batter_projections.json': 'batter_projections',
  'pitcher_rankings.json': 'pitcher_rankings',
  'prizepicks_props.json': 'prizepicks_props',
  'matchup_data.json': 'matchup_data',
  'graded_props_history.json': 'graded_props_history',
};

// Public, non-paid static assets that remain in public/data.
const PUBLIC_STATIC_FILES = new Set([
  'player_photos.json',
  'player_names.json',
  'teams.json',
  'team_opponent_stats_2026.json',
  'game_lines.json',
]);

export const dataUrl = (path) =>
  `${import.meta.env.BASE_URL}data/${path}?v=${Date.now()}`;

async function fetchStaticSnapshot(path) {
  const response = await fetch(dataUrl(path), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return {
    data: await response.json(),
    updatedAt: response.headers.get('last-modified') || null,
    source: 'static',
    preview: false,
    lockedCount: 0,
  };
}

// Returns { data, updatedAt, source, preview, lockedCount }.
export async function fetchDataSnapshot(path) {
  const ds = FILE_TO_DATASET[path];
  if (ds) return fetchApiDataset(ds, { devStaticPath: path });
  if (PUBLIC_STATIC_FILES.has(path)) return fetchStaticSnapshot(path);
  throw new Error(`Unknown data file: ${path}`);
}

export async function fetchData(path) {
  const snapshot = await fetchDataSnapshot(path);
  return snapshot.data;
}
