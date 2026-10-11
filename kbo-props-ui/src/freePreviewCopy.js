// One switch for the free NFL top rows. The API flag is the source of truth;
// the FAQ reads it so the copy cannot advertise a preview the server withholds.
import { NFL_FREE_PREVIEW_ENABLED } from '../api/_dataAccess.js'

const FREE_PREVIEW_BOARDS = NFL_FREE_PREVIEW_ENABLED
  ? 'KBO, WNBA, NFL, and NHL'
  : 'KBO, WNBA, and NHL'

export function freeTierFaqAnswer() {
  return `You get the landing page, today's KBO & WNBA schedules, and a preview of the top 3 lines on the ${FREE_PREVIEW_BOARDS} boards. Upgrade to unlock full projections, prop cards, and the PrizePicks edge board for every sport.`
}

export function freeTierPreviewFeature() {
  return NFL_FREE_PREVIEW_ENABLED
    ? 'Top 3 projections — KBO, WNBA, NFL & NHL'
    : 'Top 3 projections — KBO, WNBA & NHL'
}
