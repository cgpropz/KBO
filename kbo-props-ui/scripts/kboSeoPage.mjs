// Build the public KBO player-props page from memory/kbo/*/summary.json.
// Full-board results: every prop the model graded, including misses, pushes,
// and DNPs. Days inside the archive span with no summary stay on the page.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const SITE = 'https://www.cgpropz.com';
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

export function renderKboPage(days) {
  const recorded = days.filter((day) => !day.missing).length;
  const missing = days.filter((day) => day.missing).length;
  const range = days.length
    ? `${formatDayLabel(days[0].iso)} through ${formatDayLabel(days[days.length - 1].iso)}`
    : 'the dates currently in the archive';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>KBO player props and full-board results | CGPropz</title>
  <meta name="description" content="KBO player props on CGPropz: how the model board covers Korea Baseball Organization lines, plus recent full-board results with hits, misses, pushes, and DNPs." />
  <link rel="canonical" href="${PAGE_URL}" />
  <meta name="theme-color" content="#050506" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="CGPropz" />
  <meta property="og:url" content="${PAGE_URL}" />
  <meta property="og:title" content="KBO player props and full-board results | CGPropz" />
  <meta property="og:description" content="Recent KBO player-prop results from the CGPropz model: every graded prop, with hits, misses, pushes, and DNPs." />
  <meta property="og:image" content="${SITE}/og-image.jpg" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="KBO player props and full-board results | CGPropz" />
  <meta name="twitter:description" content="Recent KBO player-prop results from the CGPropz model: every graded prop, with hits, misses, pushes, and DNPs." />
  <meta name="twitter:image" content="${SITE}/og-image.jpg" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #050506;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.55;
    }
    a { color: #4ade80; }
    .wrap { max-width: 980px; margin: 0 auto; padding: 28px 20px 72px; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 28px; }
    .wordmark { color: #fff; font-weight: 800; font-size: 22px; text-decoration: none; letter-spacing: -0.03em; }
    .wordmark span { color: #4ade80; }
    nav { display: flex; gap: 16px; font-size: 14px; font-weight: 700; }
    h1 { font-size: clamp(32px, 5vw, 48px); line-height: 1.05; margin: 0 0 12px; letter-spacing: -0.03em; }
    h2 { margin: 36px 0 10px; font-size: 22px; }
    .lede, .note { color: #a1a1aa; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 22px 0; }
    .btn { display: inline-block; text-decoration: none; font-weight: 800; border-radius: 999px; padding: 10px 16px; }
    .btn-primary { background: #22c55e; color: #04140a; }
    .btn-ghost { border: 1px solid rgba(255,255,255,0.16); color: #fff; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #1e1e2e; vertical-align: top; }
    thead th { color: #a1a1aa; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; }
    .missing-day td { color: #fbbf24; }
    details { margin: 10px 0 18px; }
    summary { cursor: pointer; font-weight: 700; }
    .rg {
      margin-top: 28px;
      padding: 14px 16px;
      border: 1px solid #27272a;
      border-radius: 12px;
      color: #a1a1aa;
      font-size: 14px;
    }
    footer { margin-top: 28px; color: #71717a; font-size: 13px; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <a class="wordmark" href="${SITE}/">cg<span>propz</span></a>
      <nav>
        <a href="${SITE}/">App</a>
        <a href="${SITE}/#pricing">Pricing</a>
      </nav>
    </header>
    <main>
      <p class="lede">Korea Baseball Organization · player props</p>
      <h1>KBO player props, with the full board.</h1>
      <p>
        CGPropz tracks KBO player props for Korea Baseball Organization games: batter lines such as
        hits, runs, and RBIs, and pitcher lines such as strikeouts. Each prop sits next to a model
        number built from recent form, the matchup, and the posted line. The live board is on
        <a href="${SITE}/">cgpropz.com</a>. All-Access plans that include KBO are listed on
        <a href="${SITE}/#pricing">pricing</a>.
      </p>
      <p>
        The table below is the recent <strong>full-board results</strong> archive. A full-board result
        is every prop the model graded that day, including hits, misses, pushes, and DNPs.
        It is the whole graded board for that date. A day with no summary file is still listed.
      </p>
      <div class="actions">
        <a class="btn btn-primary" href="${SITE}/">Open the KBO board</a>
        <a class="btn btn-ghost" href="${SITE}/#pricing">See pricing</a>
      </div>

      <h2>Recent full-board results</h2>
      <p class="note">
        ${recorded} day${recorded === 1 ? '' : 's'} with a summary and ${missing} day${missing === 1 ? '' : 's'} with no summary,
        from ${escapeHtml(range)}. Counts are hits, misses, pushes, DNPs, and voids. The hit count is the recorded grade for that day.
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

      <p class="rg">
        Gambling involves risk. These full-board results are a record of past grades only. Future results can differ.
        If you bet, only risk money you can afford to lose. If gambling is a problem, call 1-800-GAMBLER.
      </p>
    </main>
    <footer>CGPropz · KBO player props · <a href="${PAGE_URL}">${PAGE_URL}</a></footer>
  </div>
</body>
</html>
`;
}

export function renderSitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE}/</loc>
  </url>
  <url>
    <loc>${PAGE_URL}</loc>
  </url>
</urlset>
`;
}
