// Prerendered homepage body. React replaces #root on mount; crawlers that
// do not run JavaScript still see the title, H1, nav, and footer.

import {
  AGE_LINE,
  GAMBLER_HELP_URL,
  OPERATOR_DISCLAIMER,
  STANDARD_LINE,
} from '../src/responsibleGambling.js';
import { UNPROVEN_RANK_NOTE } from '../src/freePreviewCopy.js';
import { FREE_TOP3_END, FREE_TOP3_START } from './freeTop3Html.mjs';
import { escapeHtml, jsonLdScript, organizationNode, pageUrl, renderDataCredit, websiteNode } from './seoShared.mjs';

const NAV = [
  ['/kbo-player-props', 'KBO player props'],
  ['/nfl-player-props', 'NFL player props'],
  ['/wnba-player-props', 'WNBA player props'],
  ['/nba-player-props', 'NBA player props'],
  ['/nhl-player-props', 'NHL player props'],
  ['/pricing', 'Pricing'],
  ['/policies', 'Plans & Policies'],
  ['/guides/start-here', 'Start Here'],
  ['/guides/cg-score', 'How CG Score works'],
];

const PRERENDER_CSS = `
    body:has(.seo-prerender) {
      margin: 0;
      background: #050506;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.55;
    }
    .seo-prerender { max-width: 980px; margin: 0 auto; padding: 28px 20px 72px; }
    .seo-prerender a { color: #4ade80; font-weight: 700; text-decoration: none; }
    .seo-prerender header { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 28px; }
    .seo-prerender nav { display: flex; flex-wrap: wrap; gap: 14px; }
    .seo-prerender h1 { font-size: clamp(32px, 5vw, 48px); line-height: 1.05; margin: 0 0 12px; letter-spacing: -0.03em; }
    .seo-prerender h2 { font-size: 22px; margin: 28px 0 8px; }
    #free-top-3 { scroll-margin-top: 24px; }
    .free-top3-unproven { color: #a1a1aa; font-size: 14px; line-height: 1.45; margin: 12px 0 0; }
    .seo-prerender footer { margin-top: 28px; color: #a1a1aa; font-size: 14px; }
    .seo-prerender footer .data-credit { margin: 4px 0 0; color: #71717a; font-size: 11px; line-height: 1.3; }
    .seo-prerender footer .data-credit a { color: inherit; font-weight: 400; text-decoration: underline; }
`;

export function homeRootInner() {
  const links = NAV.map(([path, label]) => `<a href="${pageUrl(path)}">${escapeHtml(label)}</a>`).join('\n        ');
  return `<div class="seo-prerender">
    <header>
      <a href="${pageUrl('/')}">cgpropz</a>
      <nav aria-label="Primary">
        ${links}
      </nav>
    </header>
    <main>
      <h1>Every prop line, scored.</h1>
      <p>CG Score rates every standard prop line with our projection, recent hit rates and defense vs position, on one board.</p>
      <section id="free-top-3">
        <h2>Today's free top 3</h2>
        <p>The three standard lines with the highest CG Scores on each board.</p>
        ${FREE_TOP3_START}
        ${FREE_TOP3_END}
        <p class="free-top3-unproven">${escapeHtml(UNPROVEN_RANK_NOTE)}</p>
      </section>
    </main>
    <footer>
      <p><a href="${pageUrl('/guides/start-here')}">Start Here</a> · <a href="${pageUrl('/guides/cg-score')}">How CG Score works</a> · <a href="${pageUrl('/policies')}">Plans &amp; Policies</a> · <a href="${pageUrl('/terms')}">Terms</a> · <a href="${pageUrl('/privacy')}">Privacy</a> · <a href="${pageUrl('/responsible-gaming')}">Responsible Gaming</a> · <a href="${pageUrl('/states-not-available')}">Where CGPropz isn't available</a></p>
      <p>${escapeHtml(STANDARD_LINE)}</p>
      <p>${escapeHtml(OPERATOR_DISCLAIMER)}</p>
      <p>${escapeHtml(AGE_LINE)}</p>
      <p><a href="${GAMBLER_HELP_URL}">ncpgambling.org</a></p>
      ${renderDataCredit()}
    </footer>
    </div>`;
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
  const style = `<!--seo-style-->\n    <style>${PRERENDER_CSS}    </style>\n    <!--/seo-style-->`;
  if (next.includes('<!--seo-style-->')) {
    next = next.replace(/<!--seo-style-->[\s\S]*?<!--\/seo-style-->/, style);
  } else {
    next = next.replace('</head>', `  ${style}\n  </head>`);
  }
  const json = `<!--seo-jsonld-->\n    ${homeJsonLd()}\n    <!--/seo-jsonld-->`;
  if (next.includes('<!--seo-jsonld-->')) {
    next = next.replace(/<!--seo-jsonld-->[\s\S]*?<!--\/seo-jsonld-->/, json);
  } else {
    next = next.replace('</head>', `  ${json}\n  </head>`);
  }
  return next;
}
