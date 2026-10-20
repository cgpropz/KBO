// Browser module for the static sport pages (bundled at build time into
// dist/assets/free-top3-<hash>.js by write-free-top3.mjs). It re-reads the
// anonymous free preview and lineup feed, the same public payloads the
// landing reads, and re-renders each block with the same row code the build
// used. No credentials are sent. A failed read hides the build-time rows and
// shows the "may be out of date" note; it never claims nothing is posted.

import { FREE_TOP3_SPORTS, FREE_TOP3_STALE_TEXT, previewResult, renderSportFreeTop3 } from './freeTop3Html.mjs';

async function readDataset(fetchImpl, ds) {
  const res = await fetchImpl(`/api/data?ds=${encodeURIComponent(ds)}`, {
    credentials: 'omit',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Same effect as the inline script's hide(): say the list may be out of date
// (rewriting the stamp paragraph, which an empty or failed block also has)
// and drop any rows.
export function hideStale(block) {
  const stamp = block.querySelector('.free-top3-stamp');
  if (stamp) stamp.textContent = FREE_TOP3_STALE_TEXT;
  const ol = block.querySelector('.free-top3');
  if (ol) ol.remove();
}

export async function liveRows(sport, fetchImpl, now = Date.now()) {
  const [body, lineups] = await Promise.all([
    readDataset(fetchImpl, sport.ds),
    sport.lineups ? readDataset(fetchImpl, sport.lineups) : Promise.resolve(null),
  ]);
  // Credentials are omitted, so anything but the anonymous preview, or a
  // lineup feed with no data, is a failed read, not an empty board.
  const result = previewResult(sport, body, lineups, now);
  if (result.failed) throw new Error('free preview read failed');
  return result.rows;
}

export async function refreshFreeTop3({ root = globalThis.document, fetchImpl = globalThis.fetch?.bind(globalThis), clock = Date.now } = {}) {
  const blocks = Array.from(root.querySelectorAll('.free-top3-block[data-live]'));
  await Promise.all(blocks.map(async (block) => {
    const sport = FREE_TOP3_SPORTS.find((item) => item.id === block.getAttribute('data-sport'));
    if (!sport) return;
    let rows;
    try {
      rows = await liveRows(sport, fetchImpl, clock());
    } catch {
      hideStale(block);
      return;
    }
    const heading = block.querySelector('h3') ? 'h3' : 'h2';
    block.outerHTML = renderSportFreeTop3({ sport, rows, now: clock(), heading, live: true });
  }));
}
