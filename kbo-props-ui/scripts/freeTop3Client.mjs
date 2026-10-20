// Browser module for the static sport pages (bundled at build time into
// dist/assets/free-top3-<hash>.js by write-free-top3.mjs). It re-reads the
// anonymous free preview and lineup feed, the same public payloads the
// landing reads, and re-renders each block with the same row code the build
// used. No credentials are sent. A failed read leaves no rows.

import { FREE_TOP3_SPORTS, previewRows, renderSportFreeTop3 } from './freeTop3Html.mjs';

async function readDataset(fetchImpl, ds) {
  const res = await fetchImpl(`/api/data?ds=${encodeURIComponent(ds)}`, {
    credentials: 'omit',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function liveRows(sport, fetchImpl, now = Date.now()) {
  const [body, lineups] = await Promise.all([
    readDataset(fetchImpl, sport.ds),
    sport.lineups ? readDataset(fetchImpl, sport.lineups) : Promise.resolve(null),
  ]);
  return previewRows(sport, body, lineups, now);
}

export async function refreshFreeTop3({ root = globalThis.document, fetchImpl = globalThis.fetch?.bind(globalThis), clock = Date.now } = {}) {
  const blocks = Array.from(root.querySelectorAll('.free-top3-block[data-live]'));
  await Promise.all(blocks.map(async (block) => {
    const sport = FREE_TOP3_SPORTS.find((item) => item.id === block.getAttribute('data-sport'));
    if (!sport) return;
    let rows = [];
    try {
      rows = await liveRows(sport, fetchImpl, clock());
    } catch {
      rows = [];
    }
    const heading = block.querySelector('h3') ? 'h3' : 'h2';
    block.outerHTML = renderSportFreeTop3({ sport, rows, now: clock(), heading, live: true });
  }));
}
