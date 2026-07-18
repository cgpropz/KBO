import { supabase } from '../supabaseClient'

/*
 * WNBA snapshot loader. Mirrors the KBO `dataUrl.js` pattern: each dataset is a
 * single jsonb blob (row id=1) in a Supabase table, with a static snapshot in
 * `public/data/wnba/*.json` as a fallback for local dev / cold Supabase.
 */
const FILE_TO_TABLE = {
  'wnba/projections_standard.json': 'wnba_projections_standard',
  'wnba/projections_demon.json': 'wnba_projections_demon',
  'wnba/projections_goblin.json': 'wnba_projections_goblin',
  'wnba/players.json': 'wnba_players',
  'wnba/teams.json': 'wnba_teams',
  'wnba/lineups.json': 'wnba_lineups',
  'wnba/edge.json': 'wnba_edge',
  'wnba/dvp_guard.json': 'wnba_dvp_guard',
  'wnba/dvp_forward.json': 'wnba_dvp_forward',
  'wnba/dvp_center.json': 'wnba_dvp_center',
}

const STALE_SNAPSHOT_MINUTES = 90

function parseTimestampMs(value) {
  if (!value) return NaN
  let v = String(value)
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(v)) {
    v += 'Z'
  }
  const ms = new Date(v).getTime()
  return Number.isFinite(ms) ? ms : NaN
}

function snapshotFreshnessMs(snapshot) {
  if (!snapshot) return NaN
  const payloadData = snapshot?.data
  if (!payloadData || typeof payloadData !== 'object') return parseTimestampMs(snapshot.updatedAt)
  return (
    parseTimestampMs(payloadData.generated_at) ||
    parseTimestampMs(payloadData.updated_at) ||
    parseTimestampMs(payloadData.last_updated) ||
    parseTimestampMs(snapshot.updatedAt)
  )
}

function staticUrl(path) {
  return `${import.meta.env.BASE_URL}data/${path}?v=${Date.now()}`
}

async function fetchFromSupabase(path) {
  const table = FILE_TO_TABLE[path]
  if (!table || !supabase) return null
  const { data: rows, error } = await supabase
    .from(table)
    .select('data, updated_at')
    .eq('id', 1)
    .limit(1)
  if (error || !Array.isArray(rows) || rows.length === 0) return null
  return { data: rows[0].data, updatedAt: rows[0].updated_at || null, source: 'supabase' }
}

async function fetchStatic(path) {
  const res = await fetch(staticUrl(path), { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to load ${path}`)
  return { data: await res.json(), updatedAt: res.headers.get('last-modified') || null, source: 'static' }
}

export async function fetchWnbaSnapshot(path) {
  let supabasePayload = null
  let staticPayload = null
  try {
    supabasePayload = await fetchFromSupabase(path)
  } catch (err) {
    console.warn(`[wnba] ${path} supabase fetch failed:`, err.message)
  }

  try {
    staticPayload = await fetchStatic(path)
  } catch (err) {
    console.warn(`[wnba] ${path} static fallback failed:`, err.message)
  }

  if (!supabasePayload && staticPayload) return staticPayload
  if (!staticPayload) return supabasePayload

  const supabaseFreshnessMs = snapshotFreshnessMs(supabasePayload)
  const staticFreshnessMs = snapshotFreshnessMs(staticPayload)
  if (Number.isFinite(staticFreshnessMs) && (!Number.isFinite(supabaseFreshnessMs) || staticFreshnessMs > supabaseFreshnessMs)) {
    return staticPayload
  }

  const supabaseAgeMinutes = Number.isFinite(supabaseFreshnessMs)
    ? (Date.now() - supabaseFreshnessMs) / 60000
    : NaN
  if (Number.isFinite(supabaseAgeMinutes) && supabaseAgeMinutes > STALE_SNAPSHOT_MINUTES) {
    return staticPayload
  }

  return supabasePayload
}

export async function fetchWnbaData(path) {
  const snapshot = await fetchWnbaSnapshot(path)
  return snapshot.data
}
