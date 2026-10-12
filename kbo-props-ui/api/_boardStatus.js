// Public board clocks. The file and the database row must never carry prop
// rows. Callers get one entry per sport and nothing else.

export const BOARD_STATUS_SPORTS = ['kbo', 'wnba', 'nfl', 'nba', 'nhl']

function clock(value) {
  return typeof value === 'string' && value.trim() ? value : null
}

export function publicBoardStatus(payload) {
  const rows = payload && Array.isArray(payload.boards) ? payload.boards : []
  const bySport = new Map()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || !BOARD_STATUS_SPORTS.includes(row.sport)) continue
    const count = row.prop_count
    bySport.set(row.sport, {
      sport: row.sport,
      board_updated_at: clock(row.board_updated_at),
      injuries_checked_at: clock(row.injuries_checked_at),
      prop_count: Number.isInteger(count) && count >= 0 ? count : 0,
      stale: row.stale === true,
    })
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
