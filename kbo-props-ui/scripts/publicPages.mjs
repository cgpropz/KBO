// Marketing HTML for /pricing and the sport hubs. No paid board rows.

import { landingFaqs } from '../src/landingFaq.js';
import { discordPlanCards, TIERS } from '../src/pricingTiers.js';
import { NBA_CARD, SPORTS } from '../src/sportsMeta.js';
import { listGuides } from './markdownGuide.mjs';
import {
  breadcrumbNode,
  escapeHtml,
  faqNode,
  pageUrl,
  PUBLISHED_ON,
  renderDocument,
  renderFaqSection,
  SITE,
} from './seoShared.mjs';

const SCORE_FAQ = {
  q: 'What does CG Score mean?',
  a: 'CG Score compares the CGPropz projection with the posted line. The method stated on the site is projection divided by the line, multiplied by 50. A score of 50 means the projection equals the line. It is not a probability, and a higher score is not a claim that the prop hits more often.',
};

const AFFILIATION_FAQ = {
  q: 'Is CGPropz affiliated with PrizePicks or Underdog?',
  a: 'No. CGPropz is an independent data and analysis site and is not affiliated with PrizePicks or Underdog.',
};

function sportById(id) {
  return [...SPORTS, NBA_CARD].find((sport) => sport.id === id);
}

function boardLinks(path) {
  return `<p>This page is the <a href="${pageUrl(path)}">public board page</a>. Plans are on <a href="${pageUrl('/pricing')}">pricing</a>. The score is explained in <a href="${pageUrl('/guides/cg-score')}">how CG Score works</a>.</p>`;
}

function sportFaqs(id) {
  if (id === 'nba') {
    return [
      {
        q: 'Can I open the NBA board?',
        a: 'The NBA card in the CGPropz app is locked and marked coming soon. This page does not list prop rows.',
      },
      {
        q: 'Where is pricing?',
        a: 'All-Access plans are on the pricing page. NBA access is not part of the open boards yet.',
      },
      SCORE_FAQ,
      AFFILIATION_FAQ,
    ];
  }
  const name = sportById(id).name;
  const preview = id === 'nfl'
    ? 'This page does not list prop rows. NFL lines on the live board are part of All-Access. The free preview described on the pricing page does not include NFL.'
    : `This page does not list prop rows. The app can show a free preview of the top 3 lines on the ${name} board. The rest of the live board is All-Access.`;
  return [
    {
      q: `Does this page list today's ${name} props?`,
      a: preview,
    },
    {
      q: 'Where is pricing?',
      a: 'All-Access plans are on the pricing page.',
    },
    SCORE_FAQ,
    AFFILIATION_FAQ,
  ];
}

function renderSport(id, path) {
  const sport = sportById(id);
  const title = `${sport.name} player props | CGPropz`;
  const description = id === 'nba'
    ? 'NBA player props on CGPropz. The in-app NBA card is locked and marked coming soon. This page does not list prop rows.'
    : `${sport.name} player props on CGPropz: what the ${sport.full.toLowerCase()} board covers, how to read CG Score, and where pricing lives. No prop rows on this page.`;
  const faqs = sportFaqs(id);
  const features = sport.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('');
  const locked = id === 'nba'
    ? '<p>The NBA card in the app is locked and marked coming soon. Nothing on this page is a live prop row.</p>'
    : '';
  const bodyHtml = `
      <p class="lede">${escapeHtml(sport.full)} · player props</p>
      <h1>${escapeHtml(sport.name)} player props</h1>
      <p>${escapeHtml(sport.tagline)}</p>
      ${locked}
      ${boardLinks(path)}
      <div class="actions">
        <a class="btn btn-primary" href="${pageUrl(path)}">Open the ${escapeHtml(sport.name)} board</a>
        <a class="btn btn-ghost" href="${pageUrl('/pricing')}">See pricing</a>
      </div>
      <h2>How the ${escapeHtml(sport.name)} board works</h2>
      <p>The live board is in the CGPropz app. This page is the public description of that board. It does not include paid board rows.</p>
      <ul>${features}</ul>
      <h2>What CG Score means</h2>
      <p>${escapeHtml(SCORE_FAQ.a)} Read <a href="${pageUrl('/guides/cg-score')}">how CG Score works</a> for the full explanation, including what the score does not tell you.</p>
      ${renderFaqSection(faqs)}
    `;
  return renderDocument({
    title,
    description,
    path,
    bodyHtml,
    schemas: [
      breadcrumbNode([
        { name: 'Home', url: pageUrl('/') },
        { name: `${sport.name} player props`, url: pageUrl(path) },
      ]),
      faqNode(faqs),
    ],
  });
}

const SPORT_PAGES = [
  ['nfl', '/nfl-player-props', 'nfl-player-props.html'],
  ['wnba', '/wnba-player-props', 'wnba-player-props.html'],
  ['nba', '/nba-player-props', 'nba-player-props.html'],
  ['nhl', '/nhl-player-props', 'nhl-player-props.html'],
];

function planCard(tier) {
  const period = tier.period ? ` <span>${escapeHtml(tier.period)}</span>` : '';
  const features = (tier.features || []).map((feature) => `<li>${escapeHtml(feature)}</li>`).join('');
  return `<article class="plan">
      <h3>${escapeHtml(tier.name)}</h3>
      <p class="price">${escapeHtml(tier.price)}${period}</p>
      <p>${escapeHtml(tier.description || '')}</p>
      <ul>${features}</ul>
    </article>`;
}

export function renderPricingPage() {
  const path = '/pricing';
  const title = 'All-Access pricing | CGPropz';
  const description = 'CGPropz All-Access pricing: Weekly $9.99, Monthly $29.99, Yearly $149.99, and Lifetime $249.99. Checkout stays in the app. This page does not list prop rows.';
  const landing = landingFaqs();
  const faqs = [
    landing.find((item) => item.q.startsWith('What\'s included')),
    landing.find((item) => item.q.startsWith('Does one subscription')),
    landing.find((item) => item.q.startsWith('Can I cancel')),
    landing.find((item) => item.q.startsWith('What is Discord')),
    AFFILIATION_FAQ,
  ].filter(Boolean);
  const paid = TIERS.filter((tier) => tier.id !== 'free');
  const free = TIERS.find((tier) => tier.id === 'free');
  const discord = discordPlanCards();
  const bodyHtml = `
      <p class="lede">Plans</p>
      <h1>All-Access pricing</h1>
      <p>These are the published CGPropz plan prices. Checkout stays in the app, which opens the current Stripe session. This page does not list prop rows.</p>
      <div class="actions">
        <a class="btn btn-primary" href="${pageUrl('/')}#pricing">Continue to checkout</a>
        <a class="btn btn-ghost" href="${pageUrl('/guides/cg-score')}">How CG Score works</a>
      </div>
      <h2>All-Access</h2>
      <div class="plans">
        ${paid.map(planCard).join('\n')}
      </div>
      <p class="note">While the Founders offer is open, the app can show a Founders lifetime price of $99.99 through Oct 18, 2026. That buy button appears only while the offer is open. If it is sold out or ended, the app does not offer it. Lifetime All-Access otherwise remains ${escapeHtml(paid.find((tier) => tier.id === 'lifetime')?.price || '$249.99')}.</p>
      <h2>Free</h2>
      ${planCard(free)}
      <h2>Discord Only</h2>
      <p>${escapeHtml(landing.find((item) => item.q.startsWith('What is Discord')).a)}</p>
      <div class="plans">
        ${discord.map((card) => `<article class="plan"><h3>Discord Only · ${escapeHtml(card.cadence)}</h3><p class="price">${escapeHtml(card.price)} <span>${escapeHtml(card.period)}</span></p><ul>${card.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul></article>`).join('\n')}
      </div>
      <h2>Boards</h2>
      <ul>
        <li><a href="${pageUrl('/kbo-player-props')}">KBO player props</a></li>
        <li><a href="${pageUrl('/nfl-player-props')}">NFL player props</a></li>
        <li><a href="${pageUrl('/wnba-player-props')}">WNBA player props</a></li>
        <li><a href="${pageUrl('/nba-player-props')}">NBA player props</a></li>
        <li><a href="${pageUrl('/nhl-player-props')}">NHL player props</a></li>
      </ul>
      ${renderFaqSection(faqs)}
    `;
  return {
    path,
    file: 'pricing.html',
    title,
    description,
    lastmod: PUBLISHED_ON,
    html: renderDocument({
      title,
      description,
      path,
      bodyHtml,
      schemas: [
        breadcrumbNode([
          { name: 'Home', url: pageUrl('/') },
          { name: 'Pricing', url: pageUrl(path) },
        ]),
        faqNode(faqs),
      ],
    }),
  };
}

export function renderSportPages() {
  return SPORT_PAGES.map(([id, path, file]) => ({
    path,
    file,
    title: `${sportById(id).name} player props | CGPropz`,
    lastmod: PUBLISHED_ON,
    html: renderSport(id, path),
  }));
}

export function renderNotFoundPage() {
  const title = 'Page not found | CGPropz';
  const description = 'That URL is not a CGPropz page.';
  const bodyHtml = `
      <h1>Page not found</h1>
      <p>That URL is not a CGPropz page. The public pages are linked below.</p>
      <ul>
        <li><a href="${pageUrl('/')}">Home</a></li>
        <li><a href="${pageUrl('/pricing')}">Pricing</a></li>
        <li><a href="${pageUrl('/kbo-player-props')}">KBO player props</a></li>
        <li><a href="${pageUrl('/nfl-player-props')}">NFL player props</a></li>
        <li><a href="${pageUrl('/wnba-player-props')}">WNBA player props</a></li>
        <li><a href="${pageUrl('/nba-player-props')}">NBA player props</a></li>
        <li><a href="${pageUrl('/nhl-player-props')}">NHL player props</a></li>
        <li><a href="${pageUrl('/guides/cg-score')}">How CG Score works</a></li>
      </ul>
    `;
  return renderDocument({
    title,
    description,
    path: '/404',
    bodyHtml,
    robots: 'noindex',
    schemas: [],
  });
}

export function renderGuidePages(dir) {
  return listGuides(dir);
}

export { SITE };
