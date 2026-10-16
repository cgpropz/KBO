// Reads the published NFL snapshots and writes the free preview only.
// Started games stay out. Total edges stay out. The full board is not written.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { gameAlreadyStarted, shapeForTier, sportAccess } from '../api/_dataAccess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATASETS = ['nfl_projections', 'nfl_game_markets', 'nhl_projections'];

function clean(value) {
  return String(value || '').replace(/\\n/g, '').trim();
}

export function landingPreviewBody(ds, row) {
  const shaped = shapeForTier(ds, row?.data, 'free');
  if (shaped.preview !== true) throw new Error(`${ds} did not return a free preview`);
  if (ds === 'nfl_projections') {
    const rows = Array.isArray(shaped.data) ? shaped.data : [];
    if (rows.length > 3) throw new Error('NFL preview has more than 3 rows');
    if (rows.some((item) => gameAlreadyStarted(item))) throw new Error('NFL preview includes a started game');
  }
  if (ds === 'nfl_game_markets') {
    const games = Array.isArray(shaped.data?.games) ? shaped.data.games : [];
    if (games.length > 3) throw new Error('NFL markets preview has more than 3 games');
    if (games.some((game) => game?.total && Object.hasOwn(game.total, 'edge'))) {
      throw new Error('NFL preview includes a total edge');
    }
  }
  if (ds === 'nhl_projections') {
    const rows = Array.isArray(shaped.data) ? shaped.data : [];
    if (rows.length > 3) throw new Error('NHL preview has more than 3 rows');
  }
  return {
    data: shaped.data,
    updatedAt: row?.updated_at || null,
    preview: true,
    lockedCount: shaped.lockedCount,
    tier: 'free',
    access: sportAccess('free'),
  };
}

async function readSnapshot(client, table) {
  const { data, error } = await client.from(table).select('data, updated_at').eq('id', 1).maybeSingle();
  if (error) throw new Error(`${table} read failed`);
  if (!data?.data) throw new Error(`${table} is not published`);
  return data;
}

async function main() {
  const url = clean(process.env.VITE_SUPABASE_URL);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const started = Date.now();
  const client = createClient(url, key, { auth: { persistSession: false } });
  const baked = { nfl_projections: null, nfl_game_markets: null, nhl_projections: null };
  for (const ds of DATASETS) {
    const row = await readSnapshot(client, ds);
    baked[ds] = landingPreviewBody(ds, row);
  }
  const apiFile = join(root, 'api', '_landingPreview.json');
  const landingDir = join(root, 'public', 'landing');
  await mkdir(landingDir, { recursive: true });
  await writeFile(apiFile, `${JSON.stringify(baked)}\n`);
  for (const ds of DATASETS) {
    await writeFile(join(landingDir, `${ds}.json`), `${JSON.stringify(baked[ds])}\n`);
  }
  const props = baked.nfl_projections;
  const markets = baked.nfl_game_markets;
  const bytes = Buffer.byteLength(JSON.stringify(baked));
  console.log(
    `baked nfl preview rows=${Array.isArray(props.data) ? props.data.length : 0}`
    + ` locked=${props.lockedCount}`
    + ` games=${Array.isArray(markets.data?.games) ? markets.data.games.length : 0}`
    + ` nhlRows=${Array.isArray(baked.nhl_projections?.data) ? baked.nhl_projections.data.length : 0}`
    + ` bytes=${bytes} ms=${Date.now() - started}`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
