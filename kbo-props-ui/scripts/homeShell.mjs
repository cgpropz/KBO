// Prerendered homepage body. React replaces #root on mount; crawlers that
// do not run JavaScript still see the title, H1, nav, and footer.

import { AFFILIATION_LINE, AGE_LINE } from '../src/responsibleGambling.js';
import { escapeHtml, jsonLdScript, organizationNode, pageUrl, websiteNode } from './seoShared.mjs';

const NAV = [
  ['/kbo-player-props', 'KBO player props'],
  ['/nfl-player-props', 'NFL player props'],
  ['/wnba-player-props', 'WNBA player props'],
  ['/nba-player-props', 'NBA player props'],
  ['/nhl-player-props', 'NHL player props'],
  ['/pricing', 'Pricing'],
  ['/guides/cg-score', 'CG Score'],
];

export function homeRootInner() {
  const links = NAV.map(([path, label]) => `<a href="${pageUrl(path)}">${escapeHtml(label)}</a>`).join('\n        ');
  return `<header>
      <a href="${pageUrl('/')}">cgpropz</a>
      <nav aria-label="Primary">
        ${links}
      </nav>
    </header>
    <main>
      <h1>One edge. Every sport.</h1>
      <p>Data-driven projections, hit rates, and prop analysis across KBO baseball, WNBA basketball, NFL football, and NHL hockey — all under one login, one subscription.</p>
    </main>
    <footer>
      <p>${escapeHtml(AGE_LINE)}</p>
      <p>${escapeHtml(AFFILIATION_LINE)}</p>
    </footer>`;
}

export function homeJsonLd() {
  return jsonLdScript([organizationNode(), websiteNode()]);
}

export function patchIndexHtml(html) {
  const root = `<!--seo-root-->\n${homeRootInner()}\n<!--/seo-root-->`;
  let next = html;
  if (next.includes('<!--seo-root-->')) {
    next = next.replace(/<!--seo-root-->[\s\S]*?<!--\/seo-root-->/, root);
  } else {
    next = next.replace(/<div id="root">[\s\S]*?<\/div>/, `<div id="root">\n${root}\n    </div>`);
  }
  const json = `<!--seo-jsonld-->\n    ${homeJsonLd()}\n    <!--/seo-jsonld-->`;
  if (next.includes('<!--seo-jsonld-->')) {
    next = next.replace(/<!--seo-jsonld-->[\s\S]*?<!--\/seo-jsonld-->/, json);
  } else {
    next = next.replace('</head>', `  ${json}\n  </head>`);
  }
  return next;
}
