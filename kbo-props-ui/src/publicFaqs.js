import { NFL_FREE_PREVIEW_ENABLED } from './nflPreviewFlag.js'

export function publicFaqs() {
  return [
    {
      q: "What's on the page before you subscribe?",
      a: NFL_FREE_PREVIEW_ENABLED
        ? 'This page shows the NFL free top 3. KBO, WNBA, and NHL each keep a free top 3 on their own pages. All-Access unlocks the full boards.'
        : 'This page does not list NFL rows while the NFL free preview is off. KBO, WNBA, and NHL each keep a free top 3 on their own pages. All-Access unlocks the full boards.',
    },
    {
      q: 'Does one login cover every league?',
      a: 'Yes. Weekly, Monthly, Yearly, and Lifetime All-Access unlock KBO, WNBA, NFL, and NHL under one login.',
    },
    {
      q: 'What is CG Score?',
      a: 'CG Score compares our projection with the posted line. 50 means they match. Above 50, the projection is over the line. Below 50, it is under. It measures that gap. It is not a probability that the prop hits.',
    },
    {
      q: 'Can I cancel anytime?',
      a: 'Weekly, Monthly, and Yearly can be cancelled anytime. Access continues until the end of the current period. Lifetime is a one-time purchase. There is no free trial.',
    },
    {
      q: 'Is CGPropz affiliated with a sportsbook?',
      a: 'No. CGPropz is not affiliated with any sportsbook or DFS app. It does not take wagers.',
    },
    {
      q: 'How often is the board updated?',
      a: 'KBO, WNBA, NFL, and NHL boards refresh on their own schedule ahead of first pitch, tip-off, kickoff, and puck drop.',
    },
  ]
}
