/*
 * Shared, single-source-of-truth pricing data — real Stripe Payment Links
 * and prices, reused by SubscriptionPage.jsx (checkout) and PublicLanding.jsx
 * (marketing pricing preview) so the two never drift out of sync.
 *
 * Lifetime ($249.99) is a Checkout Session, not a Payment Link. Yearly uses
 * its Payment Link. None of these plans include a free trial.
 */
import { YEARLY_PAYMENT_LINK } from './stripePrices.js';
import { freeTierPreviewFeature } from './freePreviewCopy.js';

export const STRIPE_LINKS = {
  weekly:   'https://buy.stripe.com/00wcN7gkD7Ui8ng6z65Ne08', // Weekly All-Access   $9.99  / wk
  monthly:  'https://buy.stripe.com/6oU5kFfgzdeCfPIcXu5Ne09', // Monthly All-Access  $29.99 / mo
  yearly:   YEARLY_PAYMENT_LINK,                              // Yearly All-Access   $149.99 / yr
};

// Existing Weekly All-Access price (price_1TtFEr…, $9.99/week) and the live
// XWEEK promotion code ($5 off once → $4.99 the first week). The weekly button
// applies this code on a Checkout Session. Payment Link `prefilled_promo_code`
// is rejected by Stripe for this code ("This promotion code is invalid.").
export const WEEKLY_PRICE_ID = 'price_1TtFErPwL0k9PEMvIrEJajK1';
export const XWEEK_PROMOTION_CODE_ID = 'promo_1UKqOLPwL0k9PEMvJZQU5GKA';

// Every paid tier unlocks the same full toolkit — tiers differ only by
// billing cadence/price, not by feature.
export const ALL_ACCESS_FEATURES = [
  '⚾🏀🏈🏒 Full KBO, WNBA, NFL, NHL & NBA projections',
  'PrizePicks edge board for every sport',
  'Player prop cards & hit rates',
  'Slip builder, optimizer & prop tracker',
  'Defense vs position & daily lineups',
  'Full game log history',
];

// Order = display order. Weekly is the featured, first-shown plan; Free is last.
export const TIERS = [
  {
    id: 'weekly',
    name: 'Weekly All-Access',
    price: '$9.99',
    period: '/ week',
    badge: 'START HERE',
    featured: true,
    description: 'Try everything, week to week',
    features: ALL_ACCESS_FEATURES,
    limited: [],
    cta: 'Start Weekly',
    ctaStyle: 'weekly',
    link: STRIPE_LINKS.weekly,
  },
  {
    id: 'combined',
    name: 'Monthly All-Access',
    price: '$29.99',
    period: '/ month',
    badge: 'BEST VALUE',
    description: 'Everything unlocked, billed monthly',
    features: [...ALL_ACCESS_FEATURES, 'Save vs. paying weekly'],
    limited: [],
    cta: 'Get Monthly Access',
    ctaStyle: 'combined',
    link: STRIPE_LINKS.monthly,
  },
  {
    id: 'yearly',
    name: 'Yearly All-Access',
    price: '$149.99',
    period: '/ year',
    badge: 'FULL YEAR',
    description: 'Every board for a year, including NHL and NBA',
    features: [...ALL_ACCESS_FEATURES, 'Billed once a year', 'KBO, WNBA, NFL, NHL, and NBA'],
    limited: [],
    cta: 'Get Yearly Access',
    ctaStyle: 'yearly',
    link: STRIPE_LINKS.yearly,
  },
  {
    id: 'lifetime',
    name: 'Lifetime All-Access',
    price: '$249.99',
    period: 'once',
    badge: 'ONE-TIME',
    description: 'Pay once, keep everything forever',
    features: [...ALL_ACCESS_FEATURES, 'Lifetime access — no renewals ever', 'All future features included'],
    limited: [],
    cta: 'Buy Lifetime Access',
    ctaStyle: 'season',
    link: null,
    checkout: 'session',
  },
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '',
    badge: null,
    description: 'Preview CGPropz before you commit',
    features: [
      'Today\'s KBO & WNBA schedules',
      freeTierPreviewFeature(),
      'Landing page overview',
    ],
    limited: [
      'Full KBO, WNBA, NFL, NHL + NBA projections',
      'Player prop cards & PrizePicks edge',
      'Slip builder & optimizer',
      'Matchups, lineups & tracker',
    ],
    cta: 'Current Plan',
    ctaStyle: 'free',
    link: null,
  },
];

export const DISCORD_ONLY_NOTE = 'Props in Discord only. Upgrade to All-Access for the full site.';

// Display strings. VITE_DISCORD_WEEKLY_PRICE / VITE_DISCORD_MONTHLY_PRICE
// override the copy. The charged amount is still the Stripe price on the
// server. Defaults match the live Discord Only prices ($5.99/week, $19.99/month).
export function discordDisplayPrice(raw) {
  const value = String(raw || '').trim();
  if (!/^\$?\d{1,4}(\.\d{2})?$/.test(value)) return '';
  return value.startsWith('$') ? value : `$${value}`;
}

const DISCORD_WEEKLY_DISPLAY = '$5.99';
const DISCORD_MONTHLY_DISPLAY = '$19.99';

export function discordPlanCards(env = {}) {
  const weekly = discordDisplayPrice(env.VITE_DISCORD_WEEKLY_PRICE) || DISCORD_WEEKLY_DISPLAY;
  const monthly = discordDisplayPrice(env.VITE_DISCORD_MONTHLY_PRICE) || DISCORD_MONTHLY_DISPLAY;
  return [
    {
      id: 'discord_weekly',
      plan: 'weekly',
      cadence: 'Weekly',
      price: weekly,
      period: '/ week',
      cta: 'Get Discord Weekly',
      features: ['Props posted in the CGPropz Discord', 'Discord props role while subscribed'],
      limited: 'Full site boards, projections, and tools',
    },
    {
      id: 'discord_monthly',
      plan: 'monthly',
      cadence: 'Monthly',
      price: monthly,
      period: '/ month',
      cta: 'Get Discord Monthly',
      features: ['Props posted in the CGPropz Discord', 'Discord props role while subscribed', 'Save vs. paying weekly'],
      limited: 'Full site boards, projections, and tools',
    },
  ];
}
