import { supabase } from './supabaseClient';

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
const STALE_SNAPSHOT_MINUTES = 90;

function parseTimestampMs(value) {
  if (!value) return NaN;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

function snapshotDataTimestampMs(payloadData) {
  if (!payloadData || typeof payloadData !== 'object') return NaN;
  return (
    parseTimestampMs(payloadData.generated_at) ||
    parseTimestampMs(payloadData.updated_at) ||
    parseTimestampMs(payloadData.last_updated)
  );
}

export const dataUrl = (path) =>
  `${import.meta.env.BASE_URL}data/${path}?v=${Date.now()}`;

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
  if (import.meta.env.PROD && PROTECTED_FILES.has(path) && supabasePayload) {
    return supabasePayload;
  }

  const supabaseUpdatedAtMs = parseTimestampMs(supabasePayload?.updatedAt);
  const payloadTimestampMs = snapshotDataTimestampMs(supabasePayload?.data);
  const freshnessTimestampMs = Number.isFinite(payloadTimestampMs)
    ? payloadTimestampMs
    : supabaseUpdatedAtMs;

  const supabaseAgeMinutes = Number.isFinite(freshnessTimestampMs)
    ? (Date.now() - freshnessTimestampMs) / 60000
    : NaN;

  if (supabasePayload && Number.isFinite(supabaseAgeMinutes) && supabaseAgeMinutes <= STALE_SNAPSHOT_MINUTES) {
    return supabasePayload;
  }

  try {
    const response = await fetch(dataUrl(path));
    if (!response.ok) throw new Error(`Failed to load ${path}`);
    return {
      data: await response.json(),
      updatedAt: null,
      source: supabasePayload ? 'static_stale_fallback' : 'static',
    };
  } catch (err) {
    if (supabasePayload) return supabasePayload;
    if (import.meta.env.PROD && PROTECTED_FILES.has(path)) {
      throw new Error(`Protected dataset unavailable in Supabase and static fallback failed: ${path}`);
    }
    throw err;
  }
}

export async function fetchData(path) {
  const snapshot = await fetchDataSnapshot(path);
  return snapshot.data;
}
