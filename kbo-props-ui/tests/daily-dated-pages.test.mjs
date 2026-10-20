import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { withDailyLinks } from '../scripts/build-kbo-seo.mjs';
import { DAILY_SPORTS, FOOTER_LINE, PROMO_LINE, etIso, isIndexable, readDailyFiles, recentDailyLinks, renderDailyPage, renderDailyPages } from '../scripts/dailyPages.mjs';
import { renderGuidesIndex } from '../scripts/guidesIndex.mjs';
import { sitemapEntries } from '../scripts/kboSeoPage.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'tests/fixtures/daily');
const pages = renderDailyPages(fixtures);
const byPath = Object.fromEntries(pages.map((p) => [p.path, p]));

function jsonLd(html) {
  return JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])['@graph'];
}

test('only sports with a free top 3 get daily pages; NFL and NBA are left out', () => {
  assert.deepEqual(DAILY_SPORTS.map((s) => s.id), ['kbo', 'nhl', 'wnba']);
});

test('a verified day is self-canonical, indexable and shows the three props', () => {
  const page = byPath['/nhl-player-props/2026-10-20'];
  assert.equal(page.indexable, true);
  assert.equal(page.file, 'nhl-player-props/2026-10-20.html');
  assert.match(page.html, /<link rel="canonical" href="https:\/\/www\.cgpropz\.com\/nhl-player-props\/2026-10-20" \/>/);
  assert.match(page.html, /<meta name="robots" content="index,follow" \/>/);
  assert.equal(page.title, 'NHL Player Props Today (Oct 20) | CGPropz');
  assert.ok(page.title.length <= 60);
  assert.ok(page.description.length >= 140 && page.description.length <= 155, `${page.description.length}`);
  for (const name of ['Player 1', 'Player 2', 'Player 3']) assert.ok(page.html.includes(name));
  assert.match(page.html, /7 of 10/);
  assert.ok(page.html.includes('TOR has allowed the most shots to centers.'));
  assert.ok(!page.html.includes('<!--'));
});

test('the CTA and footer carry the exact promo and footer text', () => {
  for (const page of pages) {
    assert.equal(page.html.split(PROMO_LINE).length - 1, 2, page.path);
    assert.ok(page.html.includes(FOOTER_LINE.replace(/·/g, '·')), page.path);
  }
});

test('JSON-LD has BreadcrumbList, FAQPage and one SportsEvent per game', () => {
  const graph = jsonLd(byPath['/nhl-player-props/2026-10-20'].html);
  const types = graph.map((n) => n['@type']);
  assert.ok(types.includes('BreadcrumbList'));
  assert.ok(types.includes('FAQPage'));
  const events = graph.filter((n) => n['@type'] === 'SportsEvent');
  assert.equal(events.length, 2);
  assert.equal(events[0].startDate, '2026-10-20T19:00:00-04:00');
  const crumbs = graph.find((n) => n['@type'] === 'BreadcrumbList').itemListElement;
  assert.deepEqual(crumbs.map((c) => c.item), [
    'https://www.cgpropz.com/',
    'https://www.cgpropz.com/nhl-player-props',
    'https://www.cgpropz.com/nhl-player-props/2026-10-20',
  ]);
});

test('an unverified day is noindex, shows no picks and has no SportsEvent', () => {
  const page = byPath['/nhl-player-props/2026-10-21'];
  assert.equal(page.indexable, false);
  assert.match(page.html, /<meta name="robots" content="noindex,follow" \/>/);
  assert.match(page.html, /<link rel="canonical" href="https:\/\/www\.cgpropz\.com\/nhl-player-props\/2026-10-21" \/>/);
  assert.ok(!page.html.includes('Player 1'));
  assert.ok(!jsonLd(page.html).some((n) => n['@type'] === 'SportsEvent'));
});

test('a day with a non-standard line is never indexable', () => {
  assert.equal(byPath['/kbo-player-props/2026-10-20'].indexable, false);
  const day = readDailyFiles(fixtures).find((d) => d.sport === 'nhl' && d.date === '2026-10-20');
  assert.equal(isIndexable(day), true);
  assert.equal(isIndexable({ ...day, props: day.props.slice(0, 2) }), false);
  assert.equal(isIndexable({ ...day, verified_by: '' }), false);
  assert.equal(isIndexable({ ...day, verified_by: 'someone-else' }), false);
  assert.equal(isIndexable({ ...day, verified_by: 'Board QA' }), false);
  const noType = { ...day.props[2] };
  delete noType.line_type;
  assert.equal(isIndexable({ ...day, props: [...day.props.slice(0, 2), noType] }), false);
  assert.equal(isIndexable({ ...day, props: [...day.props.slice(0, 2), { ...day.props[2], line_type: null }] }), false);
  assert.equal(isIndexable({ ...day, props: [...day.props.slice(0, 2), { ...day.props[2], ledger_id: null }] }), false);
});

test('past days stay up as results pages and link to neighbouring days', () => {
  const past = byPath['/nhl-player-props/2026-10-19'];
  assert.equal(past.indexable, true);
  assert.match(past.html, /<h2>Results<\/h2>/);
  assert.match(past.html, /<td>Hit<\/td>.*<td>Miss<\/td>.*<td>Push<\/td>/s);
  assert.ok(past.html.includes('href="https://www.cgpropz.com/nhl-player-props/2026-10-20"'));
  assert.ok(!byPath['/nhl-player-props/2026-10-20'].html.includes('<h2>Results</h2>'));
});

test('sitemap lists only indexable daily pages with their own lastmod', () => {
  const extra = pages.filter((p) => p.indexable).map((p) => ({ loc: `https://www.cgpropz.com${p.path}`, lastmod: p.lastmod }));
  const entries = sitemapEntries({ guides: [], extra });
  const daily = entries.filter((e) => /\d{4}-\d{2}-\d{2}$/.test(e.loc));
  assert.deepEqual(daily.map((e) => [e.loc.replace('https://www.cgpropz.com', ''), e.lastmod]).sort(), [
    ['/nhl-player-props/2026-10-19', '2026-10-19'],
    ['/nhl-player-props/2026-10-20', '2026-10-20'],
  ]);
});

test('hubs link to recent indexable days before the FAQ', () => {
  const block = recentDailyLinks('nhl', pages);
  assert.ok(block.indexOf('2026-10-20') < block.indexOf('2026-10-19'));
  assert.ok(!block.includes('2026-10-21'));
  assert.equal(recentDailyLinks('wnba', pages), '');
  const html = withDailyLinks('<main><h2>FAQ</h2></main>', 'nhl', pages);
  assert.ok(html.indexOf('Daily free top 3 pages') < html.indexOf('<h2>FAQ</h2>'));
});

test('ET offsets follow daylight time', () => {
  assert.equal(etIso('2026-11-03T00:30:00Z'), '2026-11-02T19:30:00-05:00');
  assert.equal(etIso('2026-10-20T09:30:00Z'), '2026-10-20T05:30:00-04:00');
});

test('/blog redirects to a real /guides index', () => {
  const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
  const blog = vercel.redirects.find((r) => r.source === '/blog');
  assert.deepEqual(blog, { source: '/blog', destination: '/guides', statusCode: 301 });
  assert.ok(vercel.redirects.some((r) => r.source === '/blog/:path*' && r.destination === '/guides'));
  const index = renderGuidesIndex();
  assert.equal(index.file, 'guides.html');
  assert.ok(index.html.includes('href="https://www.cgpropz.com/guides/cg-score"'));
  assert.ok(index.html.includes('href="https://www.cgpropz.com/guides/start-here"'));
  assert.ok(existsSync(join(root, 'public/guides.html')));
});

test('the committed build writes no daily page without a ledger file', () => {
  const committed = readDailyFiles();
  for (const day of committed) assert.ok(existsSync(join(root, 'public', `${day.sport}-player-props`, `${day.date}.html`)));
});

test('a full site build writes the daily pages and sitemap from a daily dir', async () => {
  const { writeSeoSite } = await import('../scripts/build-kbo-seo.mjs');
  const tmp = mkdtempSync(join(tmpdir(), 'daily-'));
  cpSync(join(root, 'content'), join(tmp, 'content'), { recursive: true });
  const result = writeSeoSite({ uiRoot: tmp, dailyDir: fixtures });
  assert.equal(result.daily.length, 4);
  const sitemap = readFileSync(join(tmp, 'public/sitemap.xml'), 'utf8');
  assert.ok(sitemap.includes('/nhl-player-props/2026-10-20</loc>'));
  assert.ok(!sitemap.includes('/nhl-player-props/2026-10-21'));
  assert.ok(!sitemap.includes('/kbo-player-props/2026-10-20'));
  assert.ok(sitemap.includes('https://www.cgpropz.com/guides</loc>'));
  assert.ok(existsSync(join(tmp, 'public/nhl-player-props/2026-10-21.html')));
  assert.ok(readFileSync(join(tmp, 'public/nhl-player-props.html'), 'utf8').includes('Daily free top 3 pages'));
});

test('hit-rate notes say Over or Under, not "cleared"', () => {
  const day = readDailyFiles(fixtures).find((d) => d.sport === 'nhl' && d.date === '2026-10-20');
  const under = { ...day, props: day.props.map((p, i) => (i === 2 ? { ...p, side: 'Under' } : p)) };
  const { html } = renderDailyPage(under);
  const start = html.indexOf('<h2>Hit-rate notes</h2>');
  const notes = html.slice(start, html.indexOf('</ul>', start));
  assert.equal(notes.includes('cleared'), false);
  assert.equal((notes.match(/went Over /g) || []).length, 2);
  assert.equal((notes.match(/went Under /g) || []).length, 1);
});
