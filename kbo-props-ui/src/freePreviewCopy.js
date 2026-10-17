// One switch for the free NFL top rows. The API flag is the source of truth;
// the FAQ reads it so the copy cannot advertise a preview the server withholds.
import { NFL_FREE_PREVIEW_ENABLED } from './nflPreviewFlag.js'

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

const TOP_3_BANNER = "Free preview: you're seeing the top 3 lines on this board."
const NFL_PAUSED_BANNER = 'NFL free preview is paused. Sign up to see the full board.'

// The green bar reads the same flag the API uses. Turning the preview back
// on restores the top-3 sentence on NFL without a copy change.
export function freePreviewBannerText(sport, enabled = NFL_FREE_PREVIEW_ENABLED) {
  if (sport === 'nfl' && !enabled) return NFL_PAUSED_BANNER
  return TOP_3_BANNER
}

const FREE_TOP_3_BOARDS = ['kbo', 'nfl', 'wnba', 'nhl']

// The homepage anchor stays mounted even when a board has no rows. An empty
// NFL board (the free-preview flag withholds those rows) does not remove it.
export function freeTop3SectionState(boards) {
  const availableIds = FREE_TOP_3_BOARDS.filter((id) => boards[id]?.status === 'ready')
  const settled = FREE_TOP_3_BOARDS.every((id) => boards[id] && boards[id].status !== 'loading')
  return {
    availableIds,
    settled,
    showingRows: !(settled && availableIds.length === 0),
    anchorId: 'free-top-3',
  }
}
