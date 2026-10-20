// Build the public KBO player-props page from the guide.
// The daily hit/miss archive is not part of this page.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  breadcrumbNode,
  pageUrl,
  PUBLISHED_ON,
  renderDocument,
  renderSitemap as renderSitemapXml,
  SITE,
  SPORT_PATHS,
} from './seoShared.mjs';
import {
  assertNoCurlyPlaceholders,
  hideUnresolved,
  PAGE_IMAGES,
  listGuides,
  renderMarkdown,
  stripGuideSource,
} from './markdownGuide.mjs';

import { freeTop3Section } from './publicPages.mjs';

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

const KBO_GUIDE = join(dirname(fileURLToPath(import.meta.url)), '../content/kbo-player-props.md');

// Schedule cells keep their published times. A {{CONFIRM}} note inside a cell
// is removed. The daily hit/miss archive is not rendered on this page.
function stripScheduleMarkers(markdown) {
  return String(markdown).split('\n').map((line) => {
    if (!line.trim().startsWith('|') || !line.includes('{{')) return line;
    return line
      .replace(/;\s*Game 7\s*\{\{CONFIRM\}\}/g, '')
      .replace(/\{\{CONFIRM:[^}]*\}\}/g, '')
      .replace(/\{\{CONFIRM\}\}/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+:/g, ':')
      .replace(/[ \t]+\|/g, ' |');
  }).join('\n');
}

export function kboGuideParts() {
  const prepared = stripScheduleMarkers(readFileSync(KBO_GUIDE, 'utf8'));
  const { meta, body, faqPage } = stripGuideSource(prepared);
  const faqAt = body.indexOf('## FAQ');
  if (faqAt < 0) throw new Error('KBO guide is missing the FAQ section');
  if (!faqPage?.mainEntity?.length) throw new Error('KBO guide is missing FAQPage JSON-LD');
  let intro = body.slice(0, faqAt);
  const resultsAt = intro.indexOf('## Recent full-board results');
  if (resultsAt >= 0) intro = intro.slice(0, resultsAt);
  const before = hideUnresolved(intro);
  const after = hideUnresolved(body.slice(faqAt));
  assertNoCurlyPlaceholders(before, '/kbo-player-props intro');
  assertNoCurlyPlaceholders(after, '/kbo-player-props faq');
  return { meta, before, after, faqPage };
}

export function renderKboPage() {
  const { meta, before, after, faqPage } = kboGuideParts();
  const title = meta.title_tag || 'KBO player props | CGPropz';
  const description = meta.meta_description
    || 'KBO player props on CGPropz: how the model board covers Korea Baseball Organization lines.';

  const bodyHtml = `
      ${renderMarkdown(before)}
      ${freeTop3Section('kbo')}
      ${renderMarkdown(after)}
    `;

  const image = PAGE_IMAGES[PAGE_PATH];
  const html = renderDocument({
    title,
    description,
    path: PAGE_PATH,
    bodyHtml,
    image: image ? pageUrl(image.src) : undefined,
    imageAlt: image?.alt,
    schemas: [
      breadcrumbNode([
        { name: 'Home', url: pageUrl('/') },
        { name: 'KBO player props', url: PAGE_URL },
      ]),
      faqPage,
    ],
  });
  assertNoCurlyPlaceholders(html, '/kbo-player-props html');
  return html;
}

export function sitemapEntries({ kboLastmod = PUBLISHED_ON, guides = listGuides(), extra = [] } = {}) {
  const lastmod = (value) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : PUBLISHED_ON);
  const pages = [
    { loc: pageUrl('/'), lastmod: PUBLISHED_ON },
    { loc: pageUrl('/pricing'), lastmod: PUBLISHED_ON },
    { loc: pageUrl('/policies'), lastmod: PUBLISHED_ON },
    { loc: pageUrl('/terms'), lastmod: PUBLISHED_ON },
    { loc: pageUrl('/privacy'), lastmod: PUBLISHED_ON },
    { loc: pageUrl('/responsible-gaming'), lastmod: PUBLISHED_ON },
    { loc: pageUrl('/states-not-available'), lastmod: PUBLISHED_ON },
    ...SPORT_PATHS.map((sport) => ({
      loc: pageUrl(sport.path),
      lastmod: sport.path === PAGE_PATH ? lastmod(kboLastmod) : PUBLISHED_ON,
    })),
    ...guides.map((guide) => ({ loc: pageUrl(guide.path), lastmod: guide.lastmod || PUBLISHED_ON })),
    ...extra.map((page) => ({ loc: page.loc, lastmod: lastmod(page.lastmod) })),
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
