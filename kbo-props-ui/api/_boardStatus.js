// Public board clocks. The file and the database row must never carry prop
// rows. NHL entries may also carry the five removed_reason counts, and the
// KBO and WNBA entries may carry note: 'no_lines'.

export const BOARD_STATUS_SPORTS = ['kbo', 'wnba', 'nfl', 'nba', 'nhl']

const REMOVED_REASONS = ['pp_pull', 'superseded_dup', 'manual_out', 'news_out', 'lineup_out']

function removedReasons(sport, value) {
  if (sport !== 'nhl' || !value || typeof value !== 'object' || Array.isArray(value)) return null
  const counts = {}
  for (const reason of REMOVED_REASONS) {
    const raw = value[reason]
    counts[reason] = Number.isInteger(raw) && raw >= 0 ? raw : 0
  }
  return counts
}

function clock(value) {
  return typeof value === 'string' && value.trim() ? value : null
}

export function publicBoardStatus(payload) {
  const rows = payload && Array.isArray(payload.boards) ? payload.boards : []
  const bySport = new Map()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !BOARD_STATUS_SPORTS.includes(row.sport)) continue
    const count = row.prop_count
    const entry = {
      sport: row.sport,
      board_updated_at: clock(row.board_updated_at),
      injuries_checked_at: clock(row.injuries_checked_at),
      prop_count: Number.isInteger(count) && count >= 0 ? count : 0,
      stale: row.stale === true,
    }
    const reasons = removedReasons(row.sport, row.removed_reasons)
    if (reasons) entry.removed_reasons = reasons
    // PrizePicks had 0 KBO props, or the WNBA ppLines map had no live line
    // (pipeline/board_status.py NO_LINES_NOTE).
    if ((row.sport === 'kbo' || row.sport === 'wnba') && row.note === 'no_lines') entry.note = 'no_lines'
    bySport.set(row.sport, entry)
  }
  return {
    boards: BOARD_STATUS_SPORTS.map((sport) => bySport.get(sport) || {
      sport,
      board_updated_at: null,
      injuries_checked_at: null,
      prop_count: 0,
      stale: true,
    }),
  }
}
