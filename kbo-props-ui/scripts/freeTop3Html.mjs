// Server-rendered free top 3 for the static homepage and sport pages.
// Rows come from the anonymous /api/data free preview (the same payload the
// landing reads), go through the same hub row builders, and are ranked by the
// same CG Score order as the landing (publicFreeTopRows). Standard lines only;
// held, pulled and removed lines, rows with no score and started games stay out.

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

// A page built from an older read hides its rows after this long, so a line
// pulled or a hold set after the deploy cannot stay on the page for a visitor
// whose browser cannot re-check the live preview. Data publishes do not
// redeploy, so the build-time read is the only one the HTML itself carries.
export const FREE_TOP3_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const ET = 'America/New_York';

export function etDate(time) {
  return new Date(time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: ET });
}

export function etIsoDate(time) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: ET })
    .formatToParts(new Date(time)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function etShort(time) {
  return new Date(time).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: ET });
}

// "Mon, Oct 19, 9:30 PM": the as-of stamp carries the date, not only the clock.
export function etStamp(time) {
  return new Date(time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: ET });
}

// Rows for one sport from a free preview body and its lineup feed body (the
// same OUT/inactive filter the landing applies). A started game is dropped
// here too, because the page can be served after the preview was read.
export function freeTop3Rows(sportId, body, now = Date.now(), lineupBody = null) {
  if (!body || body.preview !== true) return [];
  const rows = rowsFromSnapshot(sportId, body.data, lineupBody?.data ?? null);
  const live = rows.filter((row) => {
    const start = Date.parse(row?.start || '');
    return !Number.isFinite(start) || start > now;
  });
  return publicFreeTopRows(live);
}

// Game day: the ET date of the earliest game among the rows; the build day
// when no row carries a start time.
export function gameDay(rows, now = Date.now()) {
  const starts = rows.map((row) => Date.parse(row?.start || '')).filter(Number.isFinite);
  return starts.length ? Math.min(...starts) : now;
}

// Fails closed: a sport with a lineup feed shows no rows when that feed did
// not load, so a player ruled OUT cannot reach the page.
export function previewRows(sport, body, lineupBody, now = Date.now()) {
  if (sport.lineups && !(lineupBody && lineupBody.data != null)) return [];
  return freeTop3Rows(sport.id, body, now, sport.lineups ? lineupBody : null);
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
  const start = Date.parse(row?.start || '');
  const startAttr = Number.isFinite(start) ? ` data-start="${new Date(start).toISOString()}"` : '';
  const when = Number.isFinite(start)
    ? ` · <time datetime="${new Date(start).toISOString()}">${escapeHtml(etShort(start))} ET</time>`
    : '';
  const matchup = row.team ? ` (${escapeHtml(row.team)}${row.opponent ? ` vs ${escapeHtml(row.opponent)}` : ''})` : '';
  return `<li${startAttr}><strong>${escapeHtml(row.player)}</strong>${matchup}: ${escapeHtml(row.stat)} ${side ? `${side} ` : ''}${escapeHtml(fmt(row.line))} · CG Score ${escapeHtml(Number(row.score).toFixed(1))}${when}</li>`;
}

// One block per sport. data-built is when the rows were read; data-live marks
// a sport page block that the browser re-reads from the live free preview
// (the homepage's React landing replaces its own copy on load).
export function renderSportFreeTop3({ sport, rows, now = Date.now(), heading = 'h2', live = false }) {
  const boardLink = `<a href="${pageUrl(`/?sport=${sport.id}`)}">Open the ${escapeHtml(sport.name)} board</a>`;
  const built = rows.length ? ` data-built="${new Date(now).toISOString()}"` : '';
  const open = `<div class="free-top3-block" data-sport="${escapeHtml(sport.id)}"${built}${live ? ' data-live' : ''}>`;
  if (!rows.length) {
    return `${open}<${heading}>Today's free ${escapeHtml(sport.name)} top 3</${heading}>
      <p>No ${escapeHtml(sport.name)} free top 3 is posted right now. ${boardLink} for the latest lines.</p></div>`;
  }
  const day = gameDay(rows, now);
  return `${open}<${heading}>Today's free ${escapeHtml(sport.name)} top 3</${heading}>
      <p class="free-top3-stamp">Next game day: <time datetime="${etIsoDate(day)}">${escapeHtml(etDate(day))}</time> (ET) · as of ${escapeHtml(etStamp(now))} ET</p>
      <ol class="free-top3">${rows.map(rowItem).join('')}</ol>
      <p class="note">Standard lines only, ranked by CG Score. Lines can move or come down before the game. ${boardLink} for the current line.</p></div>`;
}

export const FREE_TOP3_STALE_TEXT = 'This free top 3 may be out of date. Open the board for the current lines.';
export const FREE_TOP3_STARTED_TEXT = 'Today\u2019s free top 3 games have started. Open the board for the next slate.';

// Runs as the page parses. It drops rows whose game has started and hides
// every row once the block is older than FREE_TOP3_MAX_AGE_MS. When the build
// shipped the client module (moduleSrc), sport page blocks are then re-read
// from the anonymous live preview and re-rendered; if that fails, their rows
// are hidden rather than left unverified.
export function freeTop3Script(moduleSrc = '') {
  const src = moduleSrc ? JSON.stringify(moduleSrc) : '""';
  return `<script>(function(){var n=Date.now(),M=${FREE_TOP3_MAX_AGE_MS},S=${src};`
    + `function hide(b,t){var ol=b.querySelector('.free-top3');if(!ol)return;var s=b.querySelector('.free-top3-stamp');if(s){s.textContent=t;}ol.remove();}`
    + `document.querySelectorAll('.free-top3-block').forEach(function(b){var t=Date.parse(b.getAttribute('data-built')||'');if(!(t>0)||n-t>M){hide(b,${JSON.stringify(FREE_TOP3_STALE_TEXT)});return;}`
    + `b.querySelectorAll('.free-top3 li[data-start]').forEach(function(li){if(Date.parse(li.getAttribute('data-start'))<=n){li.remove();}});var ol=b.querySelector('.free-top3');if(ol&&!ol.children.length){hide(b,${JSON.stringify(FREE_TOP3_STARTED_TEXT)});}});`
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
