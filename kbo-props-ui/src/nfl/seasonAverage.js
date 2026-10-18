// SEASON AVG on NFL cards and the player page: this season's per-game
// average for the prop's stat. Display only.
//
// `seasonAverage` on the board row is every game in the builder's history
// window (last season included) and falls back to the line when there is no
// history, so it is not shown as the season average. The builder now
// publishes `currentSeasonAverage`; older snapshots are read from the row's
// own `recent` values and `gameSeasons`. No current-season game shows '—'.

const toNum = (value) => {
  if (value == null || value === '') return NaN
  const n = Number(value)
  return Number.isFinite(n) ? n : NaN
}

export function currentSeasonOf(row) {
  const prior = toNum(row?.priorSeasonLabel)
  if (Number.isFinite(prior)) return prior + 1
  const seasons = (Array.isArray(row?.gameSeasons) ? row.gameSeasons : []).map(toNum).filter(Number.isFinite)
  return seasons.length ? Math.max(...seasons) : null
}

// { average, games } or null.
export function nflSeasonAverage(row) {
  const published = toNum(row?.currentSeasonAverage)
  const publishedGames = toNum(row?.currentSeasonGames)
  if (Number.isFinite(published) && (!Number.isFinite(publishedGames) || publishedGames > 0)) {
    return { average: published, games: Number.isFinite(publishedGames) ? publishedGames : null }
  }
  if (row && Object.prototype.hasOwnProperty.call(row, 'currentSeasonAverage') && row.currentSeasonAverage == null) {
    return null
  }
  const recent = Array.isArray(row?.recent) ? row.recent : []
  const seasons = Array.isArray(row?.gameSeasons) ? row.gameSeasons : []
  if (!recent.length || seasons.length !== recent.length) return null
  const season = currentSeasonOf(row)
  if (season == null) return null
  const values = recent.filter((_, i) => toNum(seasons[i]) === season).map(toNum).filter(Number.isFinite)
  if (!values.length) return null
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  return { average: Math.round(mean * 10) / 10, games: values.length }
}
