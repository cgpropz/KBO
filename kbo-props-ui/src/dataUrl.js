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

function snapshotFreshnessMs(snapshot) {
  if (!snapshot) return NaN;
  return (
    snapshotDataTimestampMs(snapshot.data) ||
    parseTimestampMs(snapshot.updatedAt)
  );
}

export const dataUrl = (path) =>
  `${import.meta.env.BASE_URL}data/${path}?v=${Date.now()}`;

async function fetchFromSupabase(path) {
  const table = FILE_TO_TABLE[path];
  if (!table || !supabase) return null;

  const { data: rows, error } = await supabase
    .from(table)
    .select('data, updated_at')
    .eq('id', 1)
    .limit(1);

  if (error || !Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];

  return {
    data: row.data,
    updatedAt: row.updated_at || null,
    source: 'supabase',
  };
}

async function fetchStaticSnapshot(path, source = 'static') {
  const response = await fetch(dataUrl(path), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  const lastModified = response.headers.get('last-modified');
  return {
    data: await response.json(),
    updatedAt: lastModified || null,
    source,
  };
}

export async function fetchDataSnapshot(path) {
  const supabasePayload = await fetchFromSupabase(path);
  let staticPayload = null;
  let staticError = null;

  try {
    staticPayload = await fetchStaticSnapshot(path, supabasePayload ? 'static_fallback' : 'static');
  } catch (err) {
    staticError = err;
  }

  const supabaseFreshnessMs = snapshotFreshnessMs(supabasePayload);
  const staticFreshnessMs = snapshotFreshnessMs(staticPayload);

  if (
    supabasePayload &&
    staticPayload &&
    Number.isFinite(staticFreshnessMs) &&
    (!Number.isFinite(supabaseFreshnessMs) || staticFreshnessMs > supabaseFreshnessMs)
  ) {
    return {
      ...staticPayload,
      source: 'static_fresher',
    };
  }

  const supabaseAgeMinutes = Number.isFinite(supabaseFreshnessMs)
    ? (Date.now() - supabaseFreshnessMs) / 60000
    : NaN;

  if (
    supabasePayload &&
    staticPayload &&
    Number.isFinite(supabaseAgeMinutes) &&
    supabaseAgeMinutes > STALE_SNAPSHOT_MINUTES
  ) {
    console.warn(
      `[data] ${path} supabase snapshot is stale (${Math.round(supabaseAgeMinutes)}m old), using static fallback`,
    );
    return {
      ...staticPayload,
      source: 'static_due_to_stale_supabase',
    };
  }

  if (supabasePayload) {
    if (Number.isFinite(supabaseAgeMinutes) && supabaseAgeMinutes > STALE_SNAPSHOT_MINUTES) {
      console.warn(
        `[data] ${path} supabase snapshot is stale (${Math.round(supabaseAgeMinutes)}m old), static fallback unavailable`,
      );
    }
    return supabasePayload;
  }

  if (staticPayload) {
    return staticPayload;
  }

  if (import.meta.env.PROD && PROTECTED_FILES.has(path)) {
    throw new Error(`Protected dataset unavailable in Supabase and static fallback failed: ${path}`);
  }
  throw staticError || new Error(`Failed to load ${path}`);
}

export async function fetchData(path) {
  const snapshot = await fetchDataSnapshot(path);
  return snapshot.data;
}
