// Shared pieces for the static public pages (home shell, sport hubs, pricing,
// guides, 404). The React app is not rendered here.

import {
  AFFILIATION_LINE,
  AGE_LINE,
  GAMBLER_HELP_URL,
  INDEPENDENCE_LINE,
  OPERATOR_DISCLAIMER,
  STANDARD_LINE,
} from '../src/responsibleGambling.js';
import { DATA_CREDIT_NAME, DATA_CREDIT_PREFIX, DATA_CREDIT_URL } from '../src/dataCredit.js';
import { publicLinks } from '../src/resultsPublic.js';

export const SITE = 'https://www.cgpropz.com';
export const PUBLISHED_ON = '2026-10-11';

export const SPORT_PATHS = [
  { path: '/kbo-player-props', file: 'kbo-player-props.html', label: 'KBO' },
  { path: '/nfl-player-props', file: 'nfl-player-props.html', label: 'NFL' },
  { path: '/wnba-player-props', file: 'wnba-player-props.html', label: 'WNBA' },
  { path: '/nba-player-props', file: 'nba-player-props.html', label: 'NBA' },
  { path: '/nhl-player-props', file: 'nhl-player-props.html', label: 'NHL' },
];

export function pageUrl(path) {
  if (!path || path === '/') return `${SITE}/`;
  return `${SITE}${path.startsWith('/') ? path : `/${path}`}`;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function organizationNode() {
  return {
    '@type': 'Organization',
    '@id': `${SITE}/#organization`,
    name: 'CGPropz',
    url: `${SITE}/`,
    logo: `${SITE}/favicon.svg`,
    description: 'CGPropz publishes player-prop projections and boards for entertainment. It is not a sportsbook and does not take wagers.',
  };
}

export function websiteNode() {
  return {
    '@type': 'WebSite',
    '@id': `${SITE}/#website`,
    name: 'CGPropz',
    url: `${SITE}/`,
    publisher: { '@id': `${SITE}/#organization` },
  };
}

export function breadcrumbNode(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function faqNode(faqs) {
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  };
}

export function articleNode({ headline, description, url, datePublished, dateModified }) {
  return {
    '@type': 'Article',
    headline,
    description,
    datePublished,
    dateModified,
    author: { '@type': 'Organization', name: 'CGPropz', url: `${SITE}/` },
    publisher: { '@id': `${SITE}/#organization` },
    mainEntityOfPage: url,
  };
}

export function jsonLdScript(nodes) {
  const list = (nodes || []).filter(Boolean);
  if (!list.length) return '';
  const payload = JSON.stringify({ '@context': 'https://schema.org', '@graph': list }).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${payload}</script>`;
}

export function renderFaqSection(faqs) {
  if (!faqs?.length) return '';
  const blocks = faqs.map((faq) => `<h3>${escapeHtml(faq.q)}</h3>\n<p>${escapeHtml(faq.a)}</p>`).join('\n');
  return `<h2>FAQ</h2>\n<div class="faq">\n${blocks}\n</div>`;
}

const NAV = [
  ['/kbo-player-props', 'KBO'],
  ['/nfl-player-props', 'NFL'],
  ['/wnba-player-props', 'WNBA'],
  ['/nba-player-props', 'NBA'],
  ['/nhl-player-props', 'NHL'],
  ['/results', 'Results'],
  ['/pricing', 'Pricing'],
  ['/guides/cg-score', 'CG Score'],
];

export function renderHeader() {
  const links = publicLinks(NAV).map(([path, label]) => `<a href="${pageUrl(path)}">${label}</a>`).join('\n        ');
  return `<header>
      <a class="wordmark" href="${pageUrl('/')}">cg<span>propz</span></a>
      <nav aria-label="Primary">
        ${links}
      </nav>
    </header>`;
}

const FOOTER_LINKS = [
  ['/guides/start-here', 'Start Here'],
  ['/guides/cg-score', 'How CG Score works'],
  ['/results', 'Results'],
  ['/policies', 'Plans & Policies'],
  ['/terms', 'Terms'],
  ['/privacy', 'Privacy'],
  ['/responsible-gaming', 'Responsible Gaming'],
  ['/states-not-available', "Where CGPropz isn't available"],
];

// Tiny "Data: nflverse" credit, last line of every static footer.
export function renderDataCredit() {
  return `<p class="data-credit">${escapeHtml(DATA_CREDIT_PREFIX)} <a href="${DATA_CREDIT_URL}" target="_blank" rel="noopener noreferrer">${escapeHtml(DATA_CREDIT_NAME)}</a></p>`;
}

export function renderFooter() {
  const links = publicLinks(FOOTER_LINKS).map(([path, label]) => `<a href="${pageUrl(path)}">${escapeHtml(label)}</a>`).join('\n        ');
  return `<footer class="site-footer">
      <p class="footer-links">
        ${links}
      </p>
      <p>${escapeHtml(STANDARD_LINE)}</p>
      <p>${escapeHtml(OPERATOR_DISCLAIMER)}</p>
      <p>${escapeHtml(AGE_LINE)}</p>
      <p>${escapeHtml(AFFILIATION_LINE)}</p>
      <p>${escapeHtml(INDEPENDENCE_LINE)}</p>
      <p><a href="${GAMBLER_HELP_URL}">ncpgambling.org</a></p>
      ${renderDataCredit()}
    </footer>`;
}

const PAGE_CSS = `
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #050506;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.55;
    }
    html { overflow-x: clip; }
    a { color: #4ade80; }
    .wrap { width: min(980px, 100%); max-width: 980px; margin: 0 auto; padding: 28px 20px 72px; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }
    .wordmark { color: #fff; font-weight: 800; font-size: 22px; text-decoration: none; letter-spacing: -0.03em; }
    .wordmark span { color: #4ade80; }
    nav { display: flex; flex-wrap: wrap; gap: 14px; font-size: 14px; font-weight: 700; min-width: 0; }
    h1 { font-size: clamp(32px, 5vw, 48px); line-height: 1.05; margin: 0 0 12px; letter-spacing: -0.03em; }
    h2 { margin: 36px 0 10px; font-size: 22px; }
    h3 { margin: 18px 0 6px; font-size: 17px; }
    .lede, .note { color: #a1a1aa; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 22px 0; }
    .btn { display: inline-block; text-decoration: none; font-weight: 800; border-radius: 999px; padding: 10px 16px; }
    .btn-primary { background: #22c55e; color: #04140a; }
    .btn-ghost { border: 1px solid rgba(255,255,255,0.16); color: #fff; }
    .table-scroll { display: block; max-width: 100%; overflow-x: auto; margin: 12px 0 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 0; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #1e1e2e; vertical-align: top; }
    thead th { color: #a1a1aa; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; }
    .missing-day td { color: #fbbf24; }
    details { margin: 10px 0 18px; }
    summary { cursor: pointer; font-weight: 700; }
    blockquote { margin: 16px 0; padding: 12px 16px; border-left: 3px solid #22c55e; background: #0c1210; }
    ol, ul { padding-left: 1.3em; }
    figure { margin: 18px 0 22px; }
    img { max-width: 100%; height: auto; border-radius: 12px; background: #0c1210; }
    .rg, .site-footer {
      margin-top: 28px;
      padding: 14px 16px;
      border: 1px solid #27272a;
      border-radius: 12px;
      color: #a1a1aa;
      font-size: 14px;
    }
    .footer-links { display: flex; flex-wrap: wrap; gap: 8px 14px; }
    .footer-links a { font-weight: 700; }
    .site-footer .data-credit { margin: 4px 0 0; color: #71717a; font-size: 11px; line-height: 1.3; }
    .site-footer .data-credit a { color: inherit; font-weight: 400; text-decoration: underline; }
    .state-list { margin: 0; padding-left: 1.3em; }
    @media (min-width: 640px) {
      .state-list { columns: 2; max-width: 520px; }
    }
    .plans { display: grid; gap: 12px; }
    .plan { padding: 14px 16px; border: 1px solid #27272a; border-radius: 12px; }
    .plan h3 { margin-top: 0; }
    .price { font-size: 28px; font-weight: 800; color: #fff; }
    .price span { font-size: 14px; font-weight: 600; color: #a1a1aa; }
`;

// Vercel Web Analytics page views for the static pages (the React app mounts
// <Analytics /> instead). Query strings are cut to utm_* only.
export function vercelInsightsScripts() {
  return `<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};window.va('beforeSend',function(e){try{var u=new URL(e.url),k=new URLSearchParams();u.searchParams.forEach(function(v,n){if(/^utm_(source|medium|campaign|term|content)$/.test(n)&&/^[A-Za-z0-9_-]{1,64}$/.test(v))k.set(n,v)});var q=k.toString();return Object.assign({},e,{url:u.origin+u.pathname+(q?'?'+q:'')})}catch(x){return null}});</script>
  <script defer src="/_vercel/insights/script.js"></script>`;
}

export function renderDocument({
  title,
  description,
  path,
  bodyHtml,
  schemas = [],
  robots = '',
  ogType = 'website',
  image,
  imageAlt = '',
}) {
  const url = pageUrl(path);
  const graph = [organizationNode(), ...schemas];
  const robotsMeta = robots ? `\n  <meta name="robots" content="${escapeHtml(robots)}" />` : '';
  const imageUrl = image || `${SITE}/og-image.jpg`;
  const imageAltMeta = imageAlt ? `\n  <meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${url}" />${robotsMeta}
  <meta name="theme-color" content="#050506" />
  <meta property="og:type" content="${escapeHtml(ogType)}" />
  <meta property="og:site_name" content="CGPropz" />
  <meta property="og:url" content="${url}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />${imageAltMeta}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  ${jsonLdScript(graph)}
  ${vercelInsightsScripts()}
  <style>${PAGE_CSS}
  </style>
</head>
<body>
  <div class="wrap">
    ${renderHeader()}
    <main>
      ${bodyHtml}
    </main>
    ${renderFooter()}
  </div>
</body>
</html>
`;
}

export function renderSitemap(entries) {
  const urls = entries.map((entry) => {
    const loc = escapeHtml(entry.loc);
    const lastmod = entry.lastmod ? `\n    <lastmod>${escapeHtml(entry.lastmod)}</lastmod>` : '';
    return `  <url>\n    <loc>${loc}</loc>${lastmod}\n  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function renderRobots() {
  return `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${SITE}/sitemap.xml
`;
}
