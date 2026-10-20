// Server-rendered free top 3 for the static homepage and sport pages.
// Rows come from the anonymous /api/data free preview (the same payload the
// landing reads), go through the same hub row builders, and are ranked by the
// same CG Score order as the landing (publicFreeTopRows). Standard lines only;
// held, pulled and removed lines, rows with no score and started games stay out.

import { publicFreeTopRows, rowsFromSnapshot } from '../src/publicBoard.js';
import { escapeHtml, pageUrl } from './seoShared.mjs';

// Plain elements, not HTML comments: the published pages carry no comments.
export const FREE_TOP3_START = '<div class="free-top3-slot">';
export const FREE_TOP3_END = '<i hidden class="free-top3-end"></i></div>';

// Sport, public preview dataset, page path. NBA joins once it has a free top 3.
export const FREE_TOP3_SPORTS = [
  { id: 'kbo', name: 'KBO', ds: 'prizepicks_props', path: '/kbo-player-props', file: 'kbo-player-props.html' },
  { id: 'nfl', name: 'NFL', ds: 'nfl_projections', path: '/nfl-player-props', file: 'nfl-player-props.html' },
  { id: 'wnba', name: 'WNBA', ds: 'wnba_projections_standard', path: '/wnba-player-props', file: 'wnba-player-props.html' },
  { id: 'nhl', name: 'NHL', ds: 'nhl_projections', path: '/nhl-player-props', file: 'nhl-player-props.html' },
];

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

function etClock(time) {
  return new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: ET });
}

// Rows for one sport from a free preview body. A started game is dropped
// here too, because the page can be served after the preview was read.
export function freeTop3Rows(sportId, body, now = Date.now()) {
  if (!body || body.preview !== true) return [];
  const rows = rowsFromSnapshot(sportId, body.data, null);
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

export function renderSportFreeTop3({ sport, rows, now = Date.now(), heading = 'h2' }) {
  const boardLink = `<a href="${pageUrl(`/?sport=${sport.id}`)}">Open the ${escapeHtml(sport.name)} board</a>`;
  if (!rows.length) {
    return `<${heading}>Today's free ${escapeHtml(sport.name)} top 3</${heading}>
      <p>No ${escapeHtml(sport.name)} free top 3 is posted right now. ${boardLink} for the latest lines.</p>`;
  }
  const day = gameDay(rows, now);
  return `<${heading}>Today's free ${escapeHtml(sport.name)} top 3</${heading}>
      <p class="free-top3-stamp">Next game day: <time datetime="${etIsoDate(day)}">${escapeHtml(etDate(day))}</time> (ET) · as of ${escapeHtml(etClock(now))} ET</p>
      <ol class="free-top3">${rows.map(rowItem).join('')}</ol>
      <p class="note">Standard lines only, ranked by CG Score. Lines can move or come down before the game. ${boardLink} for the current line.</p>`;
}

// Removes rows once their game starts, for a page served after the build.
export const FREE_TOP3_SCRIPT = `<script>(function(){var n=Date.now();document.querySelectorAll('.free-top3 li[data-start]').forEach(function(li){if(Date.parse(li.getAttribute('data-start'))<=n){li.remove();}});document.querySelectorAll('.free-top3').forEach(function(ol){if(!ol.children.length){var s=ol.previousElementSibling;if(s&&s.classList.contains('free-top3-stamp')){s.textContent='Today\\u2019s free top 3 games have started. Open the board for the next slate.';}ol.remove();}});})();</script>`;

export function patchFreeTop3(html, inner) {
  const start = html.indexOf(FREE_TOP3_START);
  const end = html.indexOf(FREE_TOP3_END);
  if (start < 0 || end < start) return html;
  return `${html.slice(0, start + FREE_TOP3_START.length)}\n${inner}\n${FREE_TOP3_SCRIPT}\n${html.slice(end)}`;
}
