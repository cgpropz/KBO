// Writes the public SEO pages, sitemap.xml, and robots.txt, and prerenders
// the homepage shell in index.html.
// When memory/kbo is present (repo checkout or the release build), recent
// full-board results are rendered in. When this directory is built alone,
// an existing KBO page is left in place so a later build cannot blank it.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchIndexHtml } from './homeShell.mjs';
import { buildResultDays, discoverSummaryFiles, renderKboPage, renderSitemap, sitemapEntries } from './kboSeoPage.mjs';
import { assertNoCurlyPlaceholders, listGuides } from './markdownGuide.mjs';
import { renderGuidePages, renderNotFoundPage, renderPoliciesPage, renderPricingPage, renderSportPages } from './publicPages.mjs';
import { renderRobots } from './seoShared.mjs';

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const memoryRoot = resolve(uiRoot, '../memory/kbo');
const htmlPath = resolve(uiRoot, 'public/kbo-player-props.html');
const sitemapPath = resolve(uiRoot, 'public/sitemap.xml');

export function writeKboSeo({ memoryRoot: root = memoryRoot, htmlPath: html = htmlPath, sitemapPath: sitemap = sitemapPath } = {}) {
  let result;
  let kboLastmod;
  if (!existsSync(root)) {
    if (existsSync(html)) result = { wroteHtml: 'kept', days: null };
    else {
      writeFileSync(html, renderKboPage([]));
      result = { wroteHtml: true, days: 0, missing: 0 };
    }
  } else {
    const days = buildResultDays(discoverSummaryFiles(root));
    writeFileSync(html, renderKboPage(days));
    const recorded = days.filter((day) => !day.missing);
    kboLastmod = (recorded.at(-1) || days.at(-1))?.iso;
    result = { wroteHtml: true, days: days.length, missing: days.filter((day) => day.missing).length, kboLastmod };
  }
  writeFileSync(sitemap, renderSitemap(sitemapEntries({ kboLastmod })));
  return result;
}

function writePage(publicDir, page) {
  const target = join(publicDir, page.file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, page.html);
}

export function writeSeoSite({
  uiRoot: root = uiRoot,
  memoryRoot: memory = memoryRoot,
  guidesDir,
} = {}) {
  const publicDir = join(root, 'public');
  mkdirSync(publicDir, { recursive: true });
  const kbo = writeKboSeo({
    memoryRoot: memory,
    htmlPath: join(publicDir, 'kbo-player-props.html'),
    sitemapPath: join(publicDir, 'sitemap.xml'),
  });
  writePage(publicDir, renderPricingPage());
  writePage(publicDir, renderPoliciesPage());
  for (const page of renderSportPages()) writePage(publicDir, page);
  const guides = renderGuidePages(guidesDir);
  for (const guide of guides) writePage(publicDir, guide);
  writeFileSync(join(publicDir, '404.html'), renderNotFoundPage());
  writeFileSync(join(publicDir, 'robots.txt'), renderRobots());
  const indexPath = join(root, 'index.html');
  if (existsSync(indexPath)) {
    writeFileSync(indexPath, patchIndexHtml(readFileSync(indexPath, 'utf8')));
  }
  const recorded = guides.length ? listGuides(guidesDir) : listGuides();
  writeFileSync(join(publicDir, 'sitemap.xml'), renderSitemap(sitemapEntries({
    kboLastmod: kbo.kboLastmod,
    guides: recorded,
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
  return { ...kbo, guides: guides.map((guide) => guide.path) };
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const result = writeSeoSite();
  console.log('[kbo-seo]', result.wroteHtml === true
    ? `wrote ${result.days} KBO days (${result.missing} without a summary); guides: ${result.guides.join(', ') || 'none'}`
    : `memory archive not in this build; left the existing KBO page; guides: ${result.guides.join(', ') || 'none'}`);
}
