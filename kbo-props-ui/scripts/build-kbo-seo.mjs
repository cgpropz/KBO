// Writes public/kbo-player-props.html and public/sitemap.xml.
// When memory/kbo is present (repo checkout or the release build), recent
// full-board results are rendered in. When this directory is built alone,
// an existing page is left in place so a later build cannot blank it.

import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildResultDays, discoverSummaryFiles, renderKboPage, renderSitemap } from './kboSeoPage.mjs';

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const memoryRoot = resolve(uiRoot, '../memory/kbo');
const htmlPath = resolve(uiRoot, 'public/kbo-player-props.html');
const sitemapPath = resolve(uiRoot, 'public/sitemap.xml');

export function writeKboSeo({ memoryRoot: root = memoryRoot, htmlPath: html = htmlPath, sitemapPath: sitemap = sitemapPath } = {}) {
  writeFileSync(sitemap, renderSitemap());
  if (!existsSync(root)) {
    if (existsSync(html)) return { wroteHtml: 'kept', days: null };
    writeFileSync(html, renderKboPage([]));
    return { wroteHtml: true, days: 0, missing: 0 };
  }
  const days = buildResultDays(discoverSummaryFiles(root));
  writeFileSync(html, renderKboPage(days));
  return { wroteHtml: true, days: days.length, missing: days.filter((day) => day.missing).length };
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const result = writeKboSeo();
  console.log('[kbo-seo]', result.wroteHtml === true
    ? `wrote ${result.days} days (${result.missing} without a summary)`
    : 'memory archive not in this build; left the existing page');
}
