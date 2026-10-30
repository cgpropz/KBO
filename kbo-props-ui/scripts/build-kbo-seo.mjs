// Writes the public SEO pages, sitemap.xml, and robots.txt, and prerenders
// the homepage shell in index.html.
// The KBO page is the guide only. The daily hit/miss archive is not rendered.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAILY_SPORTS, recentDailyLinks, renderDailyPages } from './dailyPages.mjs';
import { renderGuidesIndex } from './guidesIndex.mjs';
import { patchIndexHtml } from './homeShell.mjs';
import { renderKboPage, renderSitemap, sitemapEntries } from './kboSeoPage.mjs';
import { assertNoCurlyPlaceholders, listGuides } from './markdownGuide.mjs';
import { renderCompliancePages, renderGuidePages, renderNotFoundPage, renderPoliciesPage, renderPricingPage, renderSportPages } from './publicPages.mjs';
import { renderResultsPage } from './resultsPage.mjs';
import { pageUrl, renderRobots } from './seoShared.mjs';

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(uiRoot, 'public/kbo-player-props.html');
const sitemapPath = resolve(uiRoot, 'public/sitemap.xml');

export function writeKboSeo({ htmlPath: html = htmlPath, sitemapPath: sitemap = sitemapPath } = {}) {
  writeFileSync(html, renderKboPage());
  writeFileSync(sitemap, renderSitemap(sitemapEntries()));
  return { wroteHtml: true, days: 0, missing: 0 };
}

function writePage(publicDir, page) {
  const target = join(publicDir, page.file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, page.html);
}

// Puts the recent indexable daily pages on a sport hub, just before its FAQ.
export function withDailyLinks(html, sportId, dailyPages) {
  const block = recentDailyLinks(sportId, dailyPages);
  if (!block) return html;
  const at = html.indexOf('<h2>FAQ</h2>');
  return at < 0 ? html : `${html.slice(0, at)}${block}\n      ${html.slice(at)}`;
}

export function writeSeoSite({
  uiRoot: root = uiRoot,
  guidesDir,
  dailyDir,
} = {}) {
  const publicDir = join(root, 'public');
  mkdirSync(publicDir, { recursive: true });
  const kbo = writeKboSeo({
    htmlPath: join(publicDir, 'kbo-player-props.html'),
    sitemapPath: join(publicDir, 'sitemap.xml'),
  });
  const daily = renderDailyPages(dailyDir);
  for (const page of daily) writePage(publicDir, page);
  const kboHub = join(publicDir, 'kbo-player-props.html');
  writeFileSync(kboHub, withDailyLinks(readFileSync(kboHub, 'utf8'), 'kbo', daily));
  writePage(publicDir, renderPricingPage());
  writePage(publicDir, renderResultsPage());
  writePage(publicDir, renderPoliciesPage());
  for (const page of renderCompliancePages()) writePage(publicDir, page);
  const dailySports = new Set(DAILY_SPORTS.map((sport) => sport.id));
  for (const page of renderSportPages()) {
    const id = page.path.replace(/^\//, '').replace(/-player-props$/, '');
    writePage(publicDir, dailySports.has(id) ? { ...page, html: withDailyLinks(page.html, id, daily) } : page);
  }
  const guides = renderGuidePages(guidesDir);
  for (const guide of guides) writePage(publicDir, guide);
  const recordedGuides = guides.length ? listGuides(guidesDir) : listGuides();
  writePage(publicDir, renderGuidesIndex(recordedGuides));
  writeFileSync(join(publicDir, '404.html'), renderNotFoundPage());
  writeFileSync(join(publicDir, 'robots.txt'), renderRobots());
  const indexPath = join(root, 'index.html');
  if (existsSync(indexPath)) {
    writeFileSync(indexPath, patchIndexHtml(readFileSync(indexPath, 'utf8')));
  }
  // Only indexable daily pages go in the sitemap, each with its own lastmod.
  writeFileSync(join(publicDir, 'sitemap.xml'), renderSitemap(sitemapEntries({
    guides: recordedGuides,
    extra: [
      { loc: pageUrl('/guides'), lastmod: recordedGuides.map((g) => g.lastmod).filter(Boolean).sort().pop() },
      ...daily.filter((page) => page.indexable).map((page) => ({ loc: pageUrl(page.path), lastmod: page.lastmod })),
    ],
  })));
  const htmlFiles = existsSync(indexPath) ? [indexPath] : [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const target = join(dir, name.name);
      if (name.isDirectory()) walk(target);
      else if (name.name.endsWith('.html')) htmlFiles.push(target);
    }
  };
  walk(publicDir);
  for (const file of htmlFiles) assertNoCurlyPlaceholders(readFileSync(file, 'utf8'), file);
  return { ...kbo, guides: guides.map((guide) => guide.path), daily: daily.map((page) => ({ path: page.path, indexable: page.indexable })) };
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const result = writeSeoSite();
  console.log(`[kbo-seo] wrote the KBO page without the results table; guides: ${result.guides.join(', ') || 'none'}`);
}
