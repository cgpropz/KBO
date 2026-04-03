import { supabase } from './supabaseClient';

// Transitional fallback so existing deployments still work while Supabase tables are being populated.
const GITHUB_RAW = 'https://raw.githubusercontent.com/cgpropz/KBO/main/kbo-props-ui/public/data/';

const FILE_TO_TABLE = {
  'strikeout_projections.json': 'strikeout_projections',
  'batter_projections.json': 'batter_projections',
  'pitcher_rankings.json': 'pitcher_rankings',
  'prizepicks_props.json': 'prizepicks_props',
  'matchup_data.json': 'matchup_data',
  'prop_results.json': 'prop_results',
  'pitcher_logs.json': 'pitcher_logs',
};

const PROTECTED_FILES = new Set(Object.keys(FILE_TO_TABLE));

export const dataUrl = (path) =>
  import.meta.env.DEV
    ? `${import.meta.env.BASE_URL}data/${path}?v=${Date.now()}`
    : `${GITHUB_RAW}${path}?v=${Date.now()}`;

async function fetchFromSupabase(path) {
  const table = FILE_TO_TABLE[path];
  if (!table || !supabase) return null;

  const { data, error } = await supabase
    .from(table)
    .select('data, updated_at')
    .eq('id', 1)
    .single();

  if (error || !data) return null;
  return {
    data: data.data,
    updatedAt: data.updated_at || null,
    source: 'supabase',
  };
}

export async function fetchDataSnapshot(path) {
  const supabasePayload = await fetchFromSupabase(path);
  if (supabasePayload) return supabasePayload;

  // In production, protected datasets must come from Supabase.
  if (import.meta.env.PROD && PROTECTED_FILES.has(path)) {
    throw new Error(`Protected dataset unavailable in Supabase: ${path}`);
  }

  const response = await fetch(dataUrl(path));
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return {
    data: await response.json(),
    updatedAt: null,
    source: 'static',
  };
}

export async function fetchData(path) {
  const snapshot = await fetchDataSnapshot(path);
  return snapshot.data;
}
