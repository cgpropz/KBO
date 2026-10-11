// Build the public KBO player-props page from memory/kbo/*/summary.json.
// Full-board results: every prop the model graded, including misses, pushes,
// and DNPs. Days inside the archive span with no summary stay on the page.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  breadcrumbNode,
  faqNode,
  pageUrl,
  PUBLISHED_ON,
  renderDocument,
  renderFaqSection,
  renderSitemap as renderSitemapXml,
  SITE,
  SPORT_PATHS,
} from './seoShared.mjs';
import { listGuides } from './markdownGuide.mjs';

export { SITE };
export const PAGE_PATH = '/kbo-player-props';
export const PAGE_URL = `${SITE}${PAGE_PATH}`;

const RESULT_LISTS = [
  ['props_hit', 'HIT'],
  ['props_miss', 'MISS'],
  ['props_push', 'PUSH'],
  ['props_dnp', 'DNP'],
  ['props_void', 'VOID'],
];

export function addDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calendarDays(startIso, endIso) {
  if (!startIso || !endIso || startIso > endIso) return [];
  const days = [];
  for (let iso = startIso; iso <= endIso; iso = addDays(iso, 1)) days.push(iso);
  return days;
}

export function discoverSummaryFiles(memoryRoot) {
  const found = [];
  if (!memoryRoot || !existsSync(memoryRoot)) return found;
  let months = [];
  try { months = readdirSync(memoryRoot, { withFileTypes: true }); } catch { return found; }
  for (const month of months) {
    if (!month.isDirectory() || !/^\d{2}$/.test(month.name)) continue;
    const monthDir = join(memoryRoot, month.name);
    for (const day of readdirSync(monthDir, { withFileTypes: true })) {
      if (!day.isDirectory() || !/^\d{2}$/.test(day.name)) continue;
      const dayDir = join(monthDir, day.name);
      for (const year of readdirSync(dayDir, { withFileTypes: true })) {
        if (!year.isDirectory() || !/^\d{4}$/.test(year.name)) continue;
        const iso = `${year.name}-${month.name}-${day.name}`;
        const summaryPath = join(dayDir, year.name, 'summary.json');
        found.push({ iso, summaryPath, hasSummary: existsSync(summaryPath) });
      }
    }
  }
  found.sort((a, b) => a.iso.localeCompare(b.iso));
  return found;
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function propRows(summary) {
  const rows = [];
  for (const [key, fallback] of RESULT_LISTS) {
    const list = Array.isArray(summary?.[key]) ? summary[key] : [];
    for (const prop of list) {
      rows.push({
        player: String(prop?.player || 'Unknown'),
        team: String(prop?.team || ''),
        stat: String(prop?.stat || ''),
        side: String(prop?.side || ''),
        line: prop?.line ?? '',
        actual: prop?.actual ?? '',
        result: String(prop?.model_result || fallback),
      });
    }
  }
  return rows;
}

export function readSummary(summaryPath) {
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  return {
    hits: numberOrZero(summary.hits),
    misses: numberOrZero(summary.misses),
    pushes: numberOrZero(summary.pushes),
    dnps: numberOrZero(summary.dnps),
    voids: numberOrZero(summary.voids),
    graded: numberOrZero(summary.props_graded ?? summary.props_total),
    rows: propRows(summary),
  };
}

// Every calendar day from the first archived date through the last.
// A day with no summary.json is kept and marked missing.
export function buildResultDays(files) {
  if (!files.length) return [];
  const byIso = new Map(files.map((file) => [file.iso, file]));
  const start = files[0].iso;
  const end = files[files.length - 1].iso;
  return calendarDays(start, end).map((iso) => {
    const file = byIso.get(iso);
    if (!file?.hasSummary) {
      return { iso, missing: true, hits: null, misses: null, pushes: null, dnps: null, voids: null, graded: null, rows: [] };
    }
    return { iso, missing: false, ...readSummary(file.summaryPath) };
  });
}

export function formatDayLabel(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function countCell(value) {
  return value == null ? '—' : String(value);
}

function dayRow(day) {
  if (day.missing) {
    return `<tr class="missing-day">
      <th scope="row">${escapeHtml(formatDayLabel(day.iso))}</th>
      <td colspan="6">No full-board results for this date.</td>
    </tr>`;
  }
  return `<tr>
      <th scope="row">${escapeHtml(formatDayLabel(day.iso))}</th>
      <td>${countCell(day.hits)}</td>
      <td>${countCell(day.misses)}</td>
      <td>${countCell(day.pushes)}</td>
      <td>${countCell(day.dnps)}</td>
      <td>${countCell(day.voids)}</td>
      <td>${countCell(day.graded)}</td>
    </tr>`;
}

function propTable(day) {
  if (day.missing || day.rows.length === 0) return '';
  const rows = day.rows.map((prop) => `<tr>
      <td>${escapeHtml(prop.player)}</td>
      <td>${escapeHtml(prop.team)}</td>
      <td>${escapeHtml(prop.stat)}</td>
      <td>${escapeHtml(prop.side)}</td>
      <td>${escapeHtml(prop.line)}</td>
      <td>${escapeHtml(prop.actual)}</td>
      <td>${escapeHtml(prop.result)}</td>
    </tr>`).join('');
  return `<details open>
    <summary>${escapeHtml(formatDayLabel(day.iso))} player rows (${day.rows.length})</summary>
    <table>
      <thead><tr><th>Player</th><th>Team</th><th>Stat</th><th>Side</th><th>Line</th><th>Actual</th><th>Result</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </details>`;
}

const KBO_FAQS = [
  {
    q: 'What is a full-board result?',
    a: 'Every prop the model graded that day, including hits, misses, pushes, and DNPs. It is the whole graded board for that date, not a short list of winners.',
  },
  {
    q: 'What time zone are these dates?',
    a: 'The dates are the calendar dates stored with each KBO slate. Those are Korea game dates, not US Eastern Time.',
  },
  {
    q: 'Where is pricing?',
    a: 'All-Access plans are on the pricing page.',
  },
  {
    q: 'What does CG Score mean?',
    a: 'It compares the projection with the posted line. The guide explains the stated method. A higher score is not a probability and is not a claim that the prop hits more often.',
  },
  {
    q: 'Is CGPropz affiliated with PrizePicks or Underdog?',
    a: 'No. CGPropz is not affiliated with PrizePicks or Underdog.',
  },
];

export function renderKboPage(days) {
  const recorded = days.filter((day) => !day.missing).length;
  const missing = days.filter((day) => day.missing).length;
  const range = days.length
    ? `${formatDayLabel(days[0].iso)} through ${formatDayLabel(days[days.length - 1].iso)}`
    : 'the dates currently in the archive';
  const title = 'KBO player props and full-board results | CGPropz';
  const description = 'KBO player props on CGPropz: how the model board covers Korea Baseball Organization lines, plus recent full-board results with hits, misses, pushes, and DNPs.';

  const bodyHtml = `
      <p class="lede">Korea Baseball Organization · player props</p>
      <h1>KBO player props, with the full board.</h1>
      <p>
        CGPropz tracks KBO player props for Korea Baseball Organization games: batter lines such as
        hits, runs, and RBIs, and pitcher lines such as strikeouts. Each prop sits next to a model
        number built from recent form, the matchup, and the posted line. The public write-up is the
        <a href="${PAGE_URL}">KBO board</a>. All-Access plans that include KBO are listed on
        <a href="${pageUrl('/pricing')}">pricing</a>.
      </p>
      <p>
        The table below is the recent <strong>full-board results</strong> archive. A full-board result
        is every prop the model graded that day, including hits, misses, pushes, and DNPs.
        It is the whole graded board for that date. A day with no summary file is still listed.
        These are graded results, not the live paid board.
      </p>
      <div class="actions">
        <a class="btn btn-primary" href="${PAGE_URL}">Open the KBO board</a>
        <a class="btn btn-ghost" href="${pageUrl('/pricing')}">See pricing</a>
      </div>

      <h2>How the KBO board works</h2>
      <p>
        The live KBO board in the app lines a model number up with the posted prop. The free preview
        shows the top 3 lines. The rest of that live board is All-Access, and those rows are not
        printed here. Graded results for days already in the archive are listed below, including misses.
      </p>

      <h2>What CG Score means</h2>
      <p>
        CG Score compares the CGPropz projection with the posted line. The method stated on the site
        is projection divided by the line, multiplied by 50. A score of 50 means the projection equals
        the line. The score is not a probability, and a higher score is not a claim that the prop hits
        more often. <a href="${pageUrl('/guides/cg-score')}">How CG Score works</a> is the full guide.
      </p>

      <h2>Recent full-board results</h2>
      <p class="note">
        ${recorded} day${recorded === 1 ? '' : 's'} with a summary and ${missing} day${missing === 1 ? '' : 's'} with no summary,
        from ${escapeHtml(range)}. Dates in this table are the calendar dates stored with each KBO slate (Korea game dates), not US Eastern Time.
        Counts are hits, misses, pushes, DNPs, and voids. The hit count is the recorded grade for that day.
      </p>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Hits</th>
            <th>Misses</th>
            <th>Pushes</th>
            <th>DNPs</th>
            <th>Voids</th>
            <th>Graded</th>
          </tr>
        </thead>
        <tbody>
          ${days.map(dayRow).join('\n')}
        </tbody>
      </table>
      <p class="note">
        Push and DNP totals are part of the full board. Where the archive stores a player row, it is listed below,
        including misses. Days without a summary stay in the table.
      </p>
      ${days.map(propTable).join('\n')}

      ${renderFaqSection(KBO_FAQS)}

      <p class="rg">
        Gambling involves risk. These full-board results are a record of past grades only. Future results can differ.
        If you bet, only risk money you can afford to lose. If gambling is a problem, call 1-800-GAMBLER.
      </p>
    `;

  return renderDocument({
    title,
    description,
    path: PAGE_PATH,
    bodyHtml,
    schemas: [
      breadcrumbNode([
        { name: 'Home', url: pageUrl('/') },
        { name: 'KBO player props', url: PAGE_URL },
      ]),
      faqNode(KBO_FAQS),
    ],
  });
}

export function sitemapEntries({ kboLastmod = PUBLISHED_ON, guides = listGuides() } = {}) {
  const lastmod = (value) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : PUBLISHED_ON);
  const pages = [
    { loc: pageUrl('/'), lastmod: PUBLISHED_ON },
    { loc: pageUrl('/pricing'), lastmod: PUBLISHED_ON },
    ...SPORT_PATHS.map((sport) => ({
      loc: pageUrl(sport.path),
      lastmod: sport.path === PAGE_PATH ? lastmod(kboLastmod) : PUBLISHED_ON,
    })),
    ...guides.map((guide) => ({ loc: pageUrl(guide.path), lastmod: guide.lastmod || PUBLISHED_ON })),
  ];
  const seen = new Set();
  return pages.filter((page) => {
    if (seen.has(page.loc)) return false;
    seen.add(page.loc);
    return true;
  });
}

export function renderSitemap(entries) {
  return renderSitemapXml(entries || sitemapEntries());
}
