// Build step (after `vite build`): reads the anonymous free preview and the
// lineup/injury feeds from the live /api/data endpoint, the same public
// payloads the landing shows, and writes the free top 3 into dist/index.html
// and the dist sport pages. No credentials are used and nothing paid is read.
// A failed or timed-out read (or a missing or null lineup feed) renders the
// "may be out of date" note with no rows, never the "no free top 3 posted"
// text, and never fails the build. Only a successful empty read says nothing
// is posted.
//
// Board publishes do not change this file by themselves. .github/workflows/bake-free-top3.yml
// rebuilds and deploys after those publishes, and again early morning ET, so
// the stamp moves. The build also bundles a small browser module
// (scripts/freeTop3Client.mjs -> dist/assets/free-top3-<hash>.js). On the
// sport pages it re-reads the same anonymous preview and re-renders the rows,
// so a pulled line, a KBO hold or the end of a hold shows up without waiting
// for that deploy. The inline script drops a started game even when the bake
// is older than FREE_TOP3_MAX_AGE_MS, then hides whatever is left. SEO_FREE_TOP3=off
// skips it; SEO_FREE_TOP3_API overrides the origin.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FREE_TOP3_SPORTS, freeTop3Script, patchFreeTop3, previewResult, renderSportFreeTop3 } from './freeTop3Html.mjs';

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

// Bundles the browser module into dist/assets with a content hash (the
// /assets/ cache header is immutable). Returns its URL path, or '' on failure.
export async function buildClientModule(distDir) {
  const out = mkdtempSync(join(tmpdir(), 'free-top3-client-'));
  try {
    const { build } = await import('vite');
    await build({
      configFile: false,
      logLevel: 'warn',
      root: uiRoot,
      publicDir: false,
      build: {
        outDir: out,
        emptyOutDir: true,
        minify: true,
        lib: { entry: join(uiRoot, 'scripts/freeTop3Client.mjs'), formats: ['es'], fileName: () => 'free-top3.js' },
      },
    });
    const code = readFileSync(join(out, 'free-top3.js'));
    const name = `free-top3-${createHash('sha256').update(code).digest('hex').slice(0, 10)}.js`;
    mkdirSync(join(distDir, 'assets'), { recursive: true });
    writeFileSync(join(distDir, 'assets', name), code);
    return `/assets/${name}`;
  } catch (err) {
    console.warn(`[free-top-3] browser re-check not bundled: ${err?.message || err}`);
    return '';
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

export function homeFreeTop3(bySport, now, failed = {}) {
  return FREE_TOP3_SPORTS.map((sport) => renderSportFreeTop3({ sport, rows: bySport[sport.id] || [], now, heading: 'h3', failed: failed[sport.id] === true })).join('\n');
}

export async function writeFreeTop3({
  distDir = join(uiRoot, 'dist'),
  origin = process.env.SEO_FREE_TOP3_API || 'https://www.cgpropz.com',
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  clientModule = buildClientModule,
} = {}) {
  const bySport = {};
  const failed = {};
  for (const sport of FREE_TOP3_SPORTS) {
    const body = await fetchPreview(origin, sport.ds, fetchImpl);
    const lineups = body && sport.lineups ? await fetchPreview(origin, sport.lineups, fetchImpl) : null;
    const result = previewResult(sport, body, lineups, now);
    bySport[sport.id] = result.rows;
    failed[sport.id] = result.failed;
  }
  const moduleSrc = clientModule ? await clientModule(distDir) : '';
  const script = freeTop3Script(moduleSrc);
  const written = [];
  for (const sport of FREE_TOP3_SPORTS) {
    const file = join(distDir, sport.file);
    if (!existsSync(file)) continue;
    writeFileSync(file, patchFreeTop3(readFileSync(file, 'utf8'), renderSportFreeTop3({ sport, rows: bySport[sport.id], now, live: true, failed: failed[sport.id] === true }), script));
    written.push(sport.file);
  }
  const index = join(distDir, 'index.html');
  if (existsSync(index)) {
    writeFileSync(index, patchFreeTop3(readFileSync(index, 'utf8'), homeFreeTop3(bySport, now, failed), script));
    written.push('index.html');
  }
  return { written, moduleSrc, counts: Object.fromEntries(Object.entries(bySport).map(([id, rows]) => [id, rows.length])), failed: Object.keys(failed).filter((id) => failed[id]) };
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
