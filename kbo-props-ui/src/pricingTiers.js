/*
 * Shared, single-source-of-truth pricing data — real Stripe Payment Links
 * and prices, reused by SubscriptionPage.jsx (checkout) and PublicLanding.jsx
 * (marketing pricing preview) so the two never drift out of sync.
 */
export const STRIPE_LINKS = {
  weekly:   'https://buy.stripe.com/00wcN7gkD7Ui8ng6z65Ne08', // Weekly All-Access   $9.99  / wk
  monthly:  'https://buy.stripe.com/6oU5kFfgzdeCfPIcXu5Ne09', // Monthly All-Access  $29.99 / mo
  lifetime: 'https://buy.stripe.com/dRmeVfd8r3E2avo4qY5Ne03', // Lifetime All-Access $99.99 once
};

// Every paid tier unlocks the same full toolkit — tiers differ only by
// billing cadence/price, not by feature.
export const ALL_ACCESS_FEATURES = [
  '⚾🏀🏈 Full KBO, WNBA & NFL projections',
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
    id: 'lifetime',
    name: 'Lifetime All-Access',
    price: '$99.99',
    period: 'once',
    badge: 'ONE-TIME',
    description: 'Pay once, keep everything forever',
    features: [...ALL_ACCESS_FEATURES, 'Lifetime access — no renewals ever', 'All future features included'],
    limited: [],
    cta: 'Buy Lifetime Access',
    ctaStyle: 'season',
    link: STRIPE_LINKS.lifetime,
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
      'Top 3 projections — KBO, WNBA & NFL',
      'Landing page overview',
    ],
    limited: [
      'Full KBO, WNBA + NFL projections',
      'Player prop cards & PrizePicks edge',
      'Slip builder & optimizer',
      'Matchups, lineups & tracker',
    ],
    cta: 'Current Plan',
    ctaStyle: 'free',
    link: null,
  },
];
