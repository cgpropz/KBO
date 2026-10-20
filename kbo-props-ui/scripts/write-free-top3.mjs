// Build step (after `vite build`): reads the anonymous free preview from the
// live /api/data endpoint, the same public payload the landing shows, and
// writes the free top 3 into dist/index.html and the dist sport pages.
// No credentials are used and nothing paid is read. Any failure leaves the
// static "no free top 3 posted" text in place and never fails the build.
// SEO_FREE_TOP3=off skips it; SEO_FREE_TOP3_API overrides the origin.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FREE_TOP3_SPORTS, freeTop3Rows, patchFreeTop3, renderSportFreeTop3 } from './freeTop3Html.mjs';

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TIMEOUT_MS = 10_000;

async function fetchPreview(origin, ds, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${origin}/api/data?ds=${encodeURIComponent(ds)}`, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function homeFreeTop3(bySport, now) {
  return FREE_TOP3_SPORTS.map((sport) => renderSportFreeTop3({ sport, rows: bySport[sport.id] || [], now, heading: 'h3' })).join('\n');
}

export async function writeFreeTop3({
  distDir = join(uiRoot, 'dist'),
  origin = process.env.SEO_FREE_TOP3_API || 'https://www.cgpropz.com',
  fetchImpl = globalThis.fetch,
  now = Date.now(),
} = {}) {
  const bySport = {};
  for (const sport of FREE_TOP3_SPORTS) {
    const body = await fetchPreview(origin, sport.ds, fetchImpl);
    bySport[sport.id] = body ? freeTop3Rows(sport.id, body, now) : [];
  }
  const written = [];
  for (const sport of FREE_TOP3_SPORTS) {
    const file = join(distDir, sport.file);
    if (!existsSync(file)) continue;
    writeFileSync(file, patchFreeTop3(readFileSync(file, 'utf8'), renderSportFreeTop3({ sport, rows: bySport[sport.id], now })));
    written.push(sport.file);
  }
  const index = join(distDir, 'index.html');
  if (existsSync(index)) {
    writeFileSync(index, patchFreeTop3(readFileSync(index, 'utf8'), homeFreeTop3(bySport, now)));
    written.push('index.html');
  }
  return { written, counts: Object.fromEntries(Object.entries(bySport).map(([id, rows]) => [id, rows.length])) };
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  if (process.env.SEO_FREE_TOP3 === 'off') {
    console.log('[free-top-3] skipped (SEO_FREE_TOP3=off)');
  } else {
    writeFreeTop3()
      .then((result) => console.log(`[free-top-3] ${JSON.stringify(result.counts)} -> ${result.written.join(', ')}`))
      .catch((err) => console.warn(`[free-top-3] left the static text in place: ${err?.message || err}`));
  }
}
