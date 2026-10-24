// Server-rendered free top 3 for the static homepage and sport pages.
// Rows come from the anonymous /api/data free preview (the same payload the
// landing reads), go through the same hub row builders, and are ranked by the
// same CG Score order as the landing (publicFreeTopRows). Playable lines:
// demon and goblin unders stay off, and their overs stay. Held, pulled and
// removed lines, rows with no score and started games stay out.

import { rowStartMs } from '../src/etStart.js';
import { UNPROVEN_RANK_NOTE } from '../src/freePreviewCopy.js';
import { publicFreeTopRows, rowsFromSnapshot } from '../src/publicBoard.js';
import { LANDING_SPORTS } from '../src/landingSports.js';
import { escapeHtml, pageUrl } from './seoShared.mjs';

// Plain elements, not HTML comments: the published pages carry no comments.
export const FREE_TOP3_START = '<div class="free-top3-slot">';
export const FREE_TOP3_END = '<i hidden class="free-top3-end"></i></div>';

// Sport, public preview dataset, lineup/injury feed, page path. The dataset
// and lineup feed come from the landing's own sport list, so the static rows
// read the same payloads the landing does. NBA joins once it has a free top 3.
const PAGES = [
  { id: 'kbo', path: '/kbo-player-props', file: 'kbo-player-props.html' },
  { id: 'nfl', path: '/nfl-player-props', file: 'nfl-player-props.html' },
  { id: 'wnba', path: '/wnba-player-props', file: 'wnba-player-props.html' },
  { id: 'nhl', path: '/nhl-player-props', file: 'nhl-player-props.html' },
];

export const FREE_TOP3_SPORTS = PAGES.map((page) => {
  const landing = LANDING_SPORTS.find((sport) => sport.id === page.id);
  return { ...page, name: landing.name, ds: landing.ds, lineups: landing.lineups || null };
});

// A page built from an older read hides its remaining rows after this long, so
// a line pulled or a hold set after the bake cannot stay up for a visitor
// whose browser cannot re-check the live preview. Board publishes queue
// bake-free-top3.yml, and that workflow also runs early each ET morning.
// Until the next bake, the inline script still drops a row whose start has
// passed, then applies this age check to whatever is left.
export const FREE_TOP3_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const ET = 'America/New_York';

export function etIsoDate(time) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: ET })
    .formatToParts(new Date(time)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// "Thu 8:15 PM ET", glued with non-breaking spaces so a pick's kickoff never
// splits across lines on a narrow phone.
export function etKickoffLabel(time) {
  const text = new Date(time).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: ET });
  return `${text.replace(/[\s\u202f]+/g, '\u00a0')}\u00a0ET`;
}

// "Mon, Oct 19, 9:30 PM": the as-of stamp carries the date, not only the clock.
export function etStamp(time) {
  return new Date(time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: ET });
}

// Rows for one sport from a free preview body and its lineup feed body (the
// same OUT/inactive filter the landing applies). publicFreeTopRows drops a
// game that has already started, so a finished row cannot take a slot.
export function freeTop3Rows(sportId, body, now = Date.now(), lineupBody = null) {
  if (!body || body.preview !== true) return [];
  const rows = rowsFromSnapshot(sportId, body.data, lineupBody?.data ?? null);
  return publicFreeTopRows(rows, undefined, now);
}

// Fails closed on the feed itself: a sport with a lineup feed shows no rows
// when that feed did not load. This is a partial OUT filter, not a complete
// one: the anonymous lineup feeds only cover 3 games, so a player ruled OUT
// in any other game is not caught here. The real guard is each sport
// pipeline's availability filter, which keeps OUT players off the free
// preview before it is published.
export function previewRows(sport, body, lineupBody, now = Date.now()) {
  return previewResult(sport, body, lineupBody, now).rows;
}

// A read that failed is not the same as a read that came back empty. failed
// is true when the preview did not load (null, timed out, HTTP error) or is
// not the anonymous preview, or when a sport with a lineup feed got no feed
// or a feed whose data is null. Only a successful, empty read may say that no
// free top 3 is posted.
export function previewResult(sport, body, lineupBody, now = Date.now()) {
  if (!body || typeof body !== 'object' || body.preview !== true) return { rows: [], failed: true };
  if (sport.lineups && !(lineupBody && typeof lineupBody === 'object' && lineupBody.data != null)) return { rows: [], failed: true };
  return { rows: freeTop3Rows(sport.id, body, now, sport.lineups ? lineupBody : null), failed: false };
}

function sideText(row) {
  if (row.side === 'OVER') return 'Over';
  if (row.side === 'UNDER') return 'Under';
  return '';
}

function fmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function rowItem(row) {
  const side = sideText(row);
  const start = rowStartMs(row);
  const startAttr = start != null ? ` data-start="${new Date(start).toISOString()}" data-day="${etIsoDate(start)}"` : '';
  const when = start != null
    ? ` · <time datetime="${new Date(start).toISOString()}">${escapeHtml(etKickoffLabel(start))}</time>`
    : '';
  const matchup = row.team ? ` (${escapeHtml(row.team)}${row.opponent ? ` vs ${escapeHtml(row.opponent)}` : ''})` : '';
  return `<li${startAttr}><strong>${escapeHtml(row.player)}</strong>${matchup}: ${escapeHtml(row.stat)} ${side ? `${side} ` : ''}${escapeHtml(fmt(row.line))} · CG Score ${escapeHtml(Number(row.score).toFixed(1))}${when}</li>`;
}

// Each pick carries its own ET kickoff (rowItem). The stamp names no game
// day: three Sunday picks must not read as if there is no game tonight.
function slateStamp(now) {
  return `Game times in ET · as of ${escapeHtml(etStamp(now))} ET`;
}

// Sits under the free top 3. It names the rest of the ranking and does not
// attach a cash rate, a lock, or a guarantee to those rows.
export function unprovenRankHtml() {
  return `<p class="note free-top3-unproven">${escapeHtml(UNPROVEN_RANK_NOTE)}</p>`;
}

// One block per sport. data-built is when the rows were read (every built
// block carries it, so the inline script can age out an empty or failed block
// too); data-live marks a sport page block that the browser re-reads from the
// live free preview (the homepage's React landing replaces its own copy on
// load). The stamp and rows sit in a data-nosnippet div so a stale or pulled
// row from the build cannot show in a search snippet; the heading, note and
// page stay indexable. failed: the read failed, so the block shows the
// out-of-date note and no rows, never the "nothing posted" claim. The
// .free-top3-stamp paragraph is the one hide()/hideStale() rewrite.
export function renderSportFreeTop3({ sport, rows, now = null, heading = 'h2', live = false, failed = false, unproven = true }) {
  const boardLink = `<a href="${pageUrl(`/?sport=${sport.id}`)}">Open the ${escapeHtml(sport.name)} board</a>`;
  // now == null: the committed static fallback (no read at all). It carries
  // no data-built and makes no claim about what is posted, so the page stays
  // byte-stable between generator runs and a skipped build step says nothing false.
  const built = now == null ? '' : ` data-built="${new Date(now).toISOString()}"`;
  const open = `<div class="free-top3-block" data-sport="${escapeHtml(sport.id)}"${built}${live ? ' data-live' : ''}${failed ? ' data-failed' : ''}>`;
  // A sport whose lines may be off for days (KBO after Oct 21) says when a free
  // top 3 exists instead of promising one today; with rows it is today's.
  const label = unproven ? unprovenRankHtml() : '';
  const conditional = CONDITIONAL_FREE_TOP3.has(sport.id) && !(rows && rows.length);
  const title = conditional
    ? `<${heading}>Free ${escapeHtml(sport.name)} top 3, when lines are posted</${heading}>`
    : `<${heading}>Today's free ${escapeHtml(sport.name)} top 3</${heading}>`;
  if (now == null) {
    const fallback = conditional
      ? `When ${escapeHtml(sport.name)} lines are posted, the free ${escapeHtml(sport.name)} top 3 shows here. Check the live board for current lines.`
      : `Check the live board for today's free ${escapeHtml(sport.name)} top 3.`;
    return `${open}${title}
      <div data-nosnippet><p class="free-top3-stamp">${fallback}</p></div>
      ${label}
      <p class="note">${boardLink} for the latest lines.</p></div>`;
  }
  if (failed) {
    return `${open}${title}
      <div data-nosnippet><p class="free-top3-stamp">${escapeHtml(FREE_TOP3_STALE_TEXT)}</p></div>
      ${label}
      <p class="note">${boardLink} for the current lines.</p></div>`;
  }
  if (!rows.length) {
    return `${open}${title}
      <div data-nosnippet><p class="free-top3-stamp">No ${escapeHtml(sport.name)} free top 3 is posted right now.</p></div>
      ${label}
      <p class="note">${boardLink} for the latest lines.</p></div>`;
  }
  return `${open}${title}
      <div data-nosnippet><p class="free-top3-stamp">${slateStamp(now)}</p>
      <ol class="free-top3">${rows.map(rowItem).join('')}</ol></div>
      ${label}
      <p class="note">Playable lines. Demon and goblin unders stay off. Ranked by CG Score. Lines can move or come down before the game. ${boardLink} for the current line.</p></div>`;
}

// Sports whose free top 3 copy is conditional ("when lines are posted").
export const CONDITIONAL_FREE_TOP3 = new Set(['kbo']);

export const FREE_TOP3_STALE_TEXT = 'This free top 3 may be out of date. Open the board for the current lines.';
export const FREE_TOP3_STARTED_TEXT = 'Today\u2019s free top 3 games have started. Open the board for the next slate.';

// Runs as the page parses. Started rows come off first, even when the bake
// is older than FREE_TOP3_MAX_AGE_MS (that age check used to return before
// the drop, so a stale page source kept a finished game in the DOM until the
// whole list was wiped). An empty list says the games have started. A list
// that still has games, once the bake is too old, is hidden so a pulled line
// cannot sit there. When the build shipped the client module (moduleSrc),
// sport page blocks are then re-read from the anonymous live preview and
// re-rendered; if that fails, their rows are hidden rather than left unverified.
export function freeTop3Script(moduleSrc = '') {
  const src = moduleSrc ? JSON.stringify(moduleSrc) : '""';
  return `<script>(function(){var n=Date.now(),M=${FREE_TOP3_MAX_AGE_MS},S=${src};`
    + `function hide(b,t){var s=b.querySelector('.free-top3-stamp');if(s){s.textContent=t;}var ol=b.querySelector('.free-top3');if(ol){ol.remove();}}`
    + `document.querySelectorAll('.free-top3-block').forEach(function(b){`
    + `b.querySelectorAll('.free-top3 li[data-start]').forEach(function(li){if(Date.parse(li.getAttribute('data-start'))<=n){li.remove();}});`
    + `var ol=b.querySelector('.free-top3');if(ol&&!ol.children.length){hide(b,${JSON.stringify(FREE_TOP3_STARTED_TEXT)});return;}`
    + `var t=Date.parse(b.getAttribute('data-built')||'');if(!(t>0)||n-t>M){hide(b,${JSON.stringify(FREE_TOP3_STALE_TEXT)});}});`
    + `if(S&&document.querySelector('.free-top3-block[data-live]')){import(S).then(function(m){return m.refreshFreeTop3();}).catch(function(){document.querySelectorAll('.free-top3-block[data-live]').forEach(function(b){hide(b,${JSON.stringify(FREE_TOP3_STALE_TEXT)});});});}`
    + `})();</script>`;
}

export const FREE_TOP3_SCRIPT = freeTop3Script();

export function patchFreeTop3(html, inner, script = FREE_TOP3_SCRIPT) {
  const start = html.indexOf(FREE_TOP3_START);
  const end = html.indexOf(FREE_TOP3_END);
  if (start < 0 || end < start) return html;
  return `${html.slice(0, start + FREE_TOP3_START.length)}\n${inner}\n${script}\n${html.slice(end)}`;
}
