// Marketing HTML for /pricing and the sport hubs. No paid board rows.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DISCORD_INVITE_URL } from '../src/discordInvite.js';
import { landingFaqs } from '../src/landingFaq.js';
import { discordPlanCards, TIERS } from '../src/pricingTiers.js';
import { autoRenewalStatement } from '../src/autoRenewal.js';
import {
  AFFILIATION_LINE,
  AGE_LINE,
  CONTACT_ADDRESS,
  GAMBLER_HELP_URL,
  GAMBLER_PHONE,
  LEGAL_ENTITY_NAME,
  OPERATOR_DISCLAIMER,
  STANDARD_LINE,
  UNAVAILABLE_STATES,
  UNDER_REVIEW_STATES,
} from '../src/responsibleGambling.js';
import { appBoardPath } from '../src/appSport.js';
import { NBA_CARD, SPORTS } from '../src/sportsMeta.js';
import { NFL_FREE_PREVIEW_ENABLED } from '../src/nflPreviewFlag.js';
import { applyNbaFreeCopy } from './nbaFreeCopy.mjs';
import {
  assertNoCurlyPlaceholders,
  demoteHeadings,
  hideUnresolved,
  listGuides,
  PAGE_IMAGES,
  renderMarkdown,
  stripGuideSource,
} from './markdownGuide.mjs';
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
  a: "CG Score compares the CGPropz projection to the line. The board also shows DVP and recent hit rates as matchup and form context. The further the score is from 50, the bigger the gap between projection and line. Above 50 leans over, below 50 leans under. It isn't a win probability. A+ through C grades are based on the score. It's a ranking tool, not a guarantee. 21+ · Play responsibly · Entertainment only.",
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
  const name = sportById(id).name;
  const preview = id === 'nfl' && !NFL_FREE_PREVIEW_ENABLED
    ? 'They are on the live NFL board in the CGPropz app, with a CG Score on every standard line. The NFL board is part of All-Access. The NFL free preview is off right now.'
    : `The free top 3 on the CGPropz homepage shows three standard ${name} lines ranked by CG Score. The rest of the live ${name} board is part of All-Access.`;
  return [
    {
      q: `Where are today's ${name} player props?`,
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

function wnbaFinalsSection() {
  const file = join(dirname(fileURLToPath(import.meta.url)), '../content/wnba-finals-player-props-2026.md');
  const { body, faqPage } = stripGuideSource(readFileSync(file, 'utf8'));
  const published = demoteHeadings(hideUnresolved(body));
  assertNoCurlyPlaceholders(published, '/wnba-player-props finals section');
  return { html: renderMarkdown(published), faqPage };
}

// Titles (60 chars max) and meta descriptions (140-155 chars) from the
// Oct 19, 2026 SEO rewrite. og/twitter title and description reuse these.
export const SPORT_META = {
  nfl: {
    title: 'NFL Player Props Today: CG Score & Hit Rates | CGPropz',
    description: 'NFL player props today: CG Score, model projections, L10 hit rates and defense vs position on every standard line. Full NFL board with All-Access. 21+.',
  },
  nhl: {
    title: 'NHL Player Props Today: Free Top 3 & CG Score | CGPropz',
    description: 'NHL player props today: a free top 3 ranked by CG Score, plus projections and L10 hit rates for shots, saves and points. Full board with All-Access. 21+.',
  },
  wnba: {
    title: 'WNBA Player Props Today: Free Top 3 & CG Score | CGPropz',
    description: 'WNBA player props today, including the Finals: a free top 3 ranked by CG Score, with projections, L10 hit rates and DvP. Full board with All-Access. 21+.',
  },
};

export const PRICING_META = {
  title: 'All-Access Pricing: Plans for Every Board | CGPropz',
  description: 'All-Access unlocks every CGPropz board: CG Scores, projections and L10 hit rates. First week $4.99 with code XWEEK, then $9.99/wk, cancel anytime. 21+.',
};

function renderSport(id, path) {
  const sport = sportById(id);
  const finals = id === 'wnba' ? wnbaFinalsSection() : null;
  const { title, description } = SPORT_META[id];
  const faqs = sportFaqs(id);
  const features = sport.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('');
  const bodyHtml = `
      <p class="lede">${escapeHtml(sport.full)} · player props</p>
      <h1>${escapeHtml(sport.name)} player props</h1>
      <p>${escapeHtml(sport.tagline)}</p>
      
      ${boardLinks(path)}
      <div class="actions">
        <a class="btn btn-primary" href="${pageUrl(appBoardPath(id))}">Open the ${escapeHtml(sport.name)} board</a>
        <a class="btn btn-ghost" href="${pageUrl('/pricing')}">See pricing</a>
      </div>
      <h2>How the ${escapeHtml(sport.name)} board works</h2>
      <p>The live board is in the CGPropz app. This page is the public description of that board. It does not include paid board rows.</p>
      <ul>${features}</ul>
      <h2>What CG Score means</h2>
      <p>${escapeHtml(SCORE_FAQ.a)} Read <a href="${pageUrl('/guides/cg-score')}">how CG Score works</a> for the full explanation, including what the score does not tell you.</p>
      ${finals ? finals.html : ''}
      ${renderFaqSection(faqs)}
    `;
  const faq = faqNode(faqs);
  if (finals?.faqPage?.mainEntity) faq.mainEntity.push(...finals.faqPage.mainEntity);
  const image = PAGE_IMAGES[path];
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
      faq,
    ],
    image: image ? pageUrl(image.src) : undefined,
    imageAlt: image?.alt,
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
  const { title, description } = PRICING_META;
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
      <p>These are the published CGPropz plan prices. Checkout stays in the app, which opens the current Stripe session. All-Access covers the KBO, NFL, WNBA, NBA and NHL boards under one login.</p>
      <h2>Auto-renewal</h2>
      <p>${escapeHtml(autoRenewalStatement())}</p>
      <div class="actions">
        <a class="btn btn-primary" href="${pageUrl('/')}#pricing">Continue to checkout</a>
        <a class="btn btn-ghost" href="${pageUrl('/policies')}">Plans &amp; Policies</a>
        <a class="btn btn-ghost" href="${pageUrl('/guides/cg-score')}">How CG Score works</a>
      </div>
      <h2>All-Access</h2>
      <div class="plans">
        ${paid.map(planCard).join('\n')}
      </div>
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

export function renderPoliciesPage() {
  const path = '/policies';
  const title = 'Plans & Policies | CGPropz';
  const description = 'Refund, cancellation, and price-change terms for CGPropz plans. Current prices are on the pricing page.';
  const faqs = [
    {
      q: 'What is the refund policy?',
      a: 'Weekly plans: no refunds once a weekly period has started. Monthly, Yearly and Lifetime: 7-day refund window on the first payment. All plans: cancel anytime.',
    },
    {
      q: 'How do I cancel?',
      a: 'Sign in and open the subscription page from Upgrade, Manage, or View Plans. A renewing plan shows Cancel Subscription. Choose it, then confirm Yes, Cancel. CGPropz tells Stripe to end that subscription at the close of the current billing period, and the page shows the date full access lasts through. Lifetime is a one-time payment, so that page has no cancel button. Discord Only uses the same Cancel Subscription button.',
    },
    {
      q: 'What happens if a price changes?',
      a: 'If a plan price changes, CGPropz will announce the new price before it applies. Current prices are listed on the pricing page.',
    },
    {
      q: 'Can I pause for a week instead of cancelling?',
      a: 'Yes. Cancel Subscription offers Pause 1 week before Yes, Cancel. CGPropz tells Stripe to pause payment collection for 7 days and void any invoice created during that week. Billing resumes automatically, and the page shows the resume date. Paused members keep access. Cancel anytime is unchanged.',
    },
  ];
  const bodyHtml = `
      <p class="lede">Plans</p>
      <h1>Plans &amp; Policies</h1>
      <p>These are the refund, cancellation, and price-change terms for CGPropz plans. Current prices are on the <a href="${pageUrl('/pricing')}">pricing page</a>.</p>
      <h2>Refunds</h2>
      <ul>
        <li>Weekly plans: no refunds once a weekly period has started.</li>
        <li>Monthly, Yearly and Lifetime: 7-day refund window on the first payment.</li>
        <li>All plans: cancel anytime.</li>
      </ul>
      <h2>How to cancel</h2>
      <p>Sign in and open the subscription page. That page is the one behind Upgrade, Manage, or View Plans. A renewing plan shows Cancel Subscription. Choose it, then confirm Yes, Cancel. CGPropz tells Stripe to end that subscription when the current billing period ends. The page then says the subscription has been cancelled and shows the date full access lasts through. Lifetime is a one-time payment and has no cancel button. Discord Only uses the same Cancel Subscription button.</p>
      <h2>Pause for one week</h2>
      <p>Before you cancel, a renewing plan can pause billing for 7 days. CGPropz tells Stripe to pause payment collection and void any invoice created during that week, so that week of billing is skipped. Billing resumes automatically 7 days later, and the subscription page shows that resume date. Pausing does not cancel the plan and does not refund the current period. Paused members keep access, because the subscription stays active and the paid period is not cut short. Cancel anytime is unchanged: Yes, Cancel still ends the subscription when the current billing period ends, and full access lasts through that date. Lifetime has nothing to pause. An email pause link is signed, expires after 48 hours, and pauses billing only when the signed-in member is the member the link was created for.</p>
      <h2>Price changes</h2>
      <p>If a plan price changes, CGPropz will announce the new price before it applies.</p>
      <h2>Contact</h2>
      <p>Questions about a plan go to the <a href="${escapeHtml(DISCORD_INVITE_URL)}">CGPropz Discord</a>.</p>
      <p>${escapeHtml(AGE_LINE)} Play responsibly. ${escapeHtml(AFFILIATION_LINE)}</p>
      ${renderFaqSection(faqs)}
    `;
  return {
    path,
    file: 'policies.html',
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
          { name: 'Plans & Policies', url: pageUrl(path) },
        ]),
        faqNode(faqs),
      ],
    }),
  };
}

const NBA_GUIDE = join(dirname(fileURLToPath(import.meta.url)), '../content/nba-player-props.md');

export function renderNbaPlayerPropsPage() {
  const raw = applyNbaFreeCopy(readFileSync(NBA_GUIDE, 'utf8')).replaceAll(
    '{{NBA BOARD URL: CONFIRM WITH GIT BOT}}',
    appBoardPath('nba'),
  );
  const { meta, body, faqPage } = stripGuideSource(raw);
  const published = hideUnresolved(body);
  assertNoCurlyPlaceholders(published, '/nba-player-props');
  if (!faqPage?.mainEntity?.length) throw new Error('NBA guide is missing FAQPage JSON-LD');
  const path = '/nba-player-props';
  const title = meta.title_tag || 'NBA player props | CGPropz';
  const description = meta.meta_description || '';
  const image = PAGE_IMAGES[path];
  const html = renderDocument({
    title,
    description,
    path,
    image: image ? pageUrl(image.src) : undefined,
    imageAlt: image?.alt,
    bodyHtml: renderMarkdown(published),
    schemas: [
      breadcrumbNode([
        { name: 'Home', url: pageUrl('/') },
        { name: 'NBA player props', url: pageUrl(path) },
      ]),
      faqPage,
    ],
  });
  assertNoCurlyPlaceholders(html, '/nba-player-props html');
  return { path, file: 'nba-player-props.html', title, description, html, faqPage };
}

export function renderSportPages() {
  return SPORT_PAGES.map(([id, path, file]) => {
    if (id === 'nba') {
      const page = renderNbaPlayerPropsPage();
      return { path, file, title: page.title, lastmod: PUBLISHED_ON, html: page.html };
    }
    return {
      path,
      file,
      title: SPORT_META[id].title,
      lastmod: PUBLISHED_ON,
      html: renderSport(id, path),
    };
  });
}

function stateItems(states) {
  return states.map(([code, name]) => `<li>${escapeHtml(name)} (${escapeHtml(code)})</li>`).join('');
}

function complianceDocument({ path, file, title, description, h1, bodyHtml }) {
  return {
    path,
    file,
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
          { name: h1, url: pageUrl(path) },
        ]),
      ],
    }),
  };
}

export function renderResponsibleGamingPage() {
  const path = '/responsible-gaming';
  const h1 = 'Responsible gaming';
  const bodyHtml = `
      <p class="lede">Help</p>
      <h1>${h1}</h1>
      <p>${escapeHtml(OPERATOR_DISCLAIMER)}</p>
      <p>${escapeHtml(STANDARD_LINE)}</p>
      <h2>Get help</h2>
      <p>If you or someone you know has a gambling problem, call or text <strong>${escapeHtml(GAMBLER_PHONE)}</strong>.</p>
      <p><a href="${GAMBLER_HELP_URL}">National Council on Problem Gambling</a> (${GAMBLER_HELP_URL}).</p>
      <h2>Limits you can set</h2>
      <p>Only risk money you can afford to lose. Set a budget before you play and stop when you reach it. CGPropz publishes projections for information and entertainment. A projection is an estimate, not a promise that a result will happen.</p>
      <h2>How to cancel</h2>
      <p>Sign in and open the subscription page from Upgrade, Manage, or View Plans. A renewing plan shows Cancel Subscription. Choose it, then confirm Yes, Cancel. CGPropz tells Stripe to end that subscription at the close of the current billing period, and the page shows the date full access lasts through. The same steps are written on <a href="${pageUrl('/policies')}">Plans &amp; Policies</a>.</p>
      <p>This page is also linked from the site footer. Availability by state is listed on <a href="${pageUrl('/states-not-available')}">where CGPropz isn't available</a>. That list does not check or block your location.</p>
    `;
  return complianceDocument({
    path,
    file: 'responsible-gaming.html',
    title: 'Responsible gaming | CGPropz',
    description: 'Responsible gaming help for CGPropz, including 1-800-GAMBLER and the National Council on Problem Gambling.',
    h1,
    bodyHtml,
  });
}

export function renderStatesPage() {
  const path = '/states-not-available';
  const h1 = 'Where CGPropz is not available';
  const bodyHtml = `
      <p class="lede">States</p>
      <h1>${h1}</h1>
      <p>This page lists where CGPropz is not available. It is informational. CGPropz does not check your location and does not block the site or checkout from here.</p>
      <h2>Not available</h2>
      <ul class="state-list">
        ${stateItems(UNAVAILABLE_STATES)}
      </ul>
      <h2>Under review</h2>
      <ul class="state-list">
        ${stateItems(UNDER_REVIEW_STATES)}
      </ul>
      <p>Wyoming and Arkansas are under review. Their availability is not confirmed on this page.</p>
      <p>${escapeHtml(OPERATOR_DISCLAIMER)} ${escapeHtml(STANDARD_LINE)}</p>
      <p>Help is on the <a href="${pageUrl('/responsible-gaming')}">responsible gaming</a> page. Call or text <strong>${escapeHtml(GAMBLER_PHONE)}</strong>, or visit <a href="${GAMBLER_HELP_URL}">ncpgambling.org</a>.</p>
    `;
  return complianceDocument({
    path,
    file: 'states-not-available.html',
    title: "Where CGPropz isn't available | CGPropz",
    description: 'States where CGPropz is not available, plus Wyoming and Arkansas under review. This page does not block access by location.',
    h1,
    bodyHtml,
  });
}

export function renderTermsPage() {
  const path = '/terms';
  const h1 = 'Terms';
  const bodyHtml = `
      <p class="lede">Terms</p>
      <h1>${h1}</h1>
      <p>These terms are published by <strong>${escapeHtml(LEGAL_ENTITY_NAME)}</strong>. Mailing address: <strong>${escapeHtml(CONTACT_ADDRESS)}</strong>. The name and address are placeholders until they are supplied. This page does not add legal terms beyond what CGPropz already states on the site.</p>
      <p>${escapeHtml(OPERATOR_DISCLAIMER)}</p>
      <p>CGPropz sells subscription access to statistical projections and analysis. It does not accept wagers, and it is not a sportsbook or operator. ${escapeHtml(AFFILIATION_LINE)}</p>
      <p>${escapeHtml(STANDARD_LINE)} You must be 21 or older to sign up or check out.</p>
      <h2>Auto-renewal</h2>
      <p>${escapeHtml(autoRenewalStatement())}</p>
      <h2>Refunds, cancellation, pause, and price changes</h2>
      <p>Those terms are on <a href="${pageUrl('/policies')}">Plans &amp; Policies</a>. Weekly plans: no refunds once a weekly period has started. Monthly, Yearly and Lifetime: 7-day refund window on the first payment. All plans: cancel anytime. If a plan price changes, CGPropz will announce the new price before it applies. A one-week pause, when offered, skips that week of billing and billing resumes automatically.</p>
      <p>Questions about a plan go to the <a href="${escapeHtml(DISCORD_INVITE_URL)}">CGPropz Discord</a>.</p>
      <p>See also <a href="${pageUrl('/privacy')}">Privacy</a>, <a href="${pageUrl('/responsible-gaming')}">Responsible gaming</a>, and <a href="${pageUrl('/states-not-available')}">where CGPropz isn't available</a>.</p>
    `;
  return complianceDocument({
    path,
    file: 'terms.html',
    title: 'Terms | CGPropz',
    description: 'CGPropz terms, including automatic renewal. The legal entity name is a placeholder.',
    h1,
    bodyHtml,
  });
}

export function renderPrivacyPage() {
  const path = '/privacy';
  const h1 = 'Privacy';
  const bodyHtml = `
      <p class="lede">Privacy</p>
      <h1>${h1}</h1>
      <p>This notice is published by <strong>${escapeHtml(LEGAL_ENTITY_NAME)}</strong>. Mailing address: <strong>${escapeHtml(CONTACT_ADDRESS)}</strong>. The name and address are placeholders until they are supplied. This page describes how the site works today. It does not add a retention period or other privacy terms that are not already part of the product.</p>
      <h2>Account</h2>
      <p>Sign-in uses an email and password through Supabase. When you create an account, marketing codes from the link you arrived on (such as utm tags) and the time you confirmed you are 21 or older can be saved with that account.</p>
      <h2>Payments</h2>
      <p>Card checkout is handled by Stripe. If you are signed in, checkout can send your account id and email so the payment can be matched to the account. If you are not signed in, Stripe collects the email and access is matched when you later sign up with that email.</p>
      <h2>What this browser stores</h2>
      <p>This browser can store the marketing codes from your visit, the time you confirmed you are 21 or older, and a note of purchase events already sent. That age confirmation stays in this browser so you are not asked again on this device.</p>
      <h2>Advertising measurement</h2>
      <p>An X (Twitter) pixel can record a sign-up and a purchase.</p>
      <h2>Site analytics</h2>
      <p>Two tools measure how the site is used: Vercel Web Analytics and PostHog. Neither one receives your name, email, password, account id or payment details.</p>
      <p><strong>Vercel Web Analytics</strong> counts page views. For each page view Vercel can record the page address, the referring site, and the browser, operating system, device type and approximate location that it derives from the request. Before a page address is sent, the site removes every query parameter except a sport name and marketing codes (utm tags) made only of letters, numbers, dashes and underscores, so session ids, tokens, email addresses and ad click IDs are not sent. Vercel Web Analytics does not use cookies. Vercel tells visitors apart with a hash of the request that it discards after 24 hours. It does not check Do Not Track or Global Privacy Control.</p>
      <p><strong>PostHog</strong> records four events, each with fixed values only:</p>
      <ul>
        <li><code>free_top3_view</code>: the free top 3 preview came into view, with the sport.</li>
        <li><code>checkout_click</code>: a checkout button was pressed, with the plan and the sport.</li>
        <li><code>signup</code>: a new account sign-up was accepted, with no other details.</li>
        <li><code>discord_plan_click</code>: a Discord Only plan button was pressed, with the plan.</li>
      </ul>
      <p>Each event also carries the page address, cleaned the same way as for Vercel, the referring site and search engine, cleaned the same way, and browser details such as browser, operating system, screen size, language and time zone. Marketing codes that are not plain letters and numbers, and ad click IDs such as gclid, fbclid and twclid, are removed before anything is sent. PostHog does not capture clicks automatically, does not record sessions, and does not build a profile of you; the site never tells PostHog who you are. PostHog keeps its state in memory only, so it sets no cookies and writes nothing to local storage, and its random visitor id is replaced on the next page load. If your browser sends Do Not Track or Global Privacy Control, PostHog is not loaded and no events are sent. The CGPropz PostHog project is set to discard client IP addresses.</p>
      <p>Questions can go to the <a href="${escapeHtml(DISCORD_INVITE_URL)}">CGPropz Discord</a>. The terms are on <a href="${pageUrl('/terms')}">Terms</a>.</p>
    `;
  return complianceDocument({
    path,
    file: 'privacy.html',
    title: 'Privacy | CGPropz',
    description: 'What CGPropz stores for an account, checkout, and this browser. The legal entity name is a placeholder.',
    h1,
    bodyHtml,
  });
}

export function renderCompliancePages() {
  return [
    renderResponsibleGamingPage(),
    renderStatesPage(),
    renderTermsPage(),
    renderPrivacyPage(),
  ];
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
        <li><a href="${pageUrl('/policies')}">Plans &amp; Policies</a></li>
        <li><a href="${pageUrl('/kbo-player-props')}">KBO player props</a></li>
        <li><a href="${pageUrl('/nfl-player-props')}">NFL player props</a></li>
        <li><a href="${pageUrl('/wnba-player-props')}">WNBA player props</a></li>
        <li><a href="${pageUrl('/nba-player-props')}">NBA player props</a></li>
        <li><a href="${pageUrl('/nhl-player-props')}">NHL player props</a></li>
        <li><a href="${pageUrl('/guides/cg-score')}">How CG Score works</a></li>
        <li><a href="${pageUrl('/terms')}">Terms</a></li>
        <li><a href="${pageUrl('/privacy')}">Privacy</a></li>
        <li><a href="${pageUrl('/responsible-gaming')}">Responsible Gaming</a></li>
        <li><a href="${pageUrl('/states-not-available')}">Where CGPropz isn't available</a></li>
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
