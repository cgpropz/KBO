import { NFL_FREE_PREVIEW_ENABLED } from './nflPreviewFlag.js'

export function publicFaqs() {
  const previewBoards = NFL_FREE_PREVIEW_ENABLED
    ? 'KBO, WNBA, NFL, and NHL'
    : 'KBO, WNBA, and NHL'
  const nflNote = NFL_FREE_PREVIEW_ENABLED
    ? ''
    : ' The NFL free preview is off, so NFL rows are not in that public feed.'
  return [
    {
      q: "What's on the page before you subscribe?",
      a: `You get this page and the public preview of the top lines on the ${previewBoards} boards.${nflNote} All-Access unlocks the full boards.`,
    },
    {
      q: 'Does one login cover every league?',
      a: 'Yes. Weekly, Monthly, Yearly, and Lifetime All-Access unlock KBO, WNBA, NFL, and NHL under one login.',
    },
    {
      q: 'What is CG Score?',
      a: 'CG Score is projection vs line, adjusted for matchup. It is not a probability that the prop hits.',
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
