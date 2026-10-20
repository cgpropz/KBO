import { freeTierFaqAnswer } from './freePreviewCopy.js';

// Visible homepage FAQ. Pricing and other static pages reuse the same answers
// when they show the same questions.
export function landingFaqs() {
  return [
    {
      q: "What's included in the free tier?",
      a: freeTierFaqAnswer(),
    },
    {
      q: 'Does one subscription cover every sport?',
      a: 'Yes — every All-Access plan (Weekly, Monthly, Yearly, or Lifetime) unlocks KBO, WNBA, NFL, NBA, and NHL under one login. Discord Only is separate: props in Discord, not the site boards.',
    },
    {
      q: 'Can I cancel anytime?',
      a: 'Yes. Weekly, Monthly, and Yearly subscriptions can be cancelled at any time, and your access continues until the end of your current billing period. Lifetime is a one-time purchase with nothing to cancel. There is no free trial.',
    },
    {
      q: 'What is Discord Only?',
      a: 'A cheaper plan that posts the props in the CGPropz Discord and gives you the Discord props role. It does not unlock the site boards. All-Access includes the full site and the site-subscriber Discord role.',
    },
    {
      q: 'How often is the data updated?',
      a: 'KBO projections and props refresh multiple times daily before games. WNBA, NFL, and NHL projections, edge, and lineups refresh on their own schedule ahead of tip-off, kickoff, and puck drop, so you always have the latest numbers.',
    },
  ];
}
