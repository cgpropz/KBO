// Dates and opponents for the ten mini hit-rate bars on the boards.
//
// The board API trims each row to its last ten chart values and drops the long
// logs (api/_boardPayload.js). It keeps two short label arrays next to the
// chart values so the bars can show a date and an opponent logo:
//   l10Dates / l10Opps on NFL and NHL rows: same order as `recent`
//     (oldest → newest), aligned to recent.slice(-10).
//   l10Dates / l10Opps on each KBO prop: same order as its `recent_values`
//     (newest first), aligned to recent_values.slice(0, 10). Only kept when
//     the card's games give exactly those values.
// A player page, or a static dev file, still has the full arrays, so the same
// helpers derive the labels from them. Labels that cannot be lined up with the
// values are left blank: a bar never shows another game's date.
//
// Shared by the API (server) and the boards (browser). Pure functions only.

export const CHART_LABEL_LIMIT = 10

function text(value) {
  return value == null ? '' : String(value).trim()
}

function list(value) {
  return Array.isArray(value) ? value : null
}

// NFL `gameDates`/`gameOpponents` run parallel to `recent`. NHL rows have
// `gameDates` parallel to `recent` and opponents only on the full log, so the
// log's tail must carry the same dates before its opponents are used.
export function deriveTailLabels(row, limit = CHART_LABEL_LIMIT) {
  const recent = list(row?.recent)
  const dates = list(row?.gameDates)
  if (!recent?.length || !dates || dates.length !== recent.length) return null
  const size = Math.min(limit, recent.length)
  const l10Dates = dates.slice(-size).map(text)
  let opps = null
  const gameOpponents = list(row?.gameOpponents)
  if (gameOpponents && gameOpponents.length === recent.length) {
    opps = gameOpponents.slice(-size)
  } else {
    const logDates = list(row?.logDates)
    const logOpponents = list(row?.logOpponents)
    if (logDates && logOpponents && logDates.length === logOpponents.length && logDates.length >= size) {
      const tail = logDates.slice(-size).map(text)
      if (tail.every((date, index) => date === l10Dates[index])) opps = logOpponents.slice(-size)
    }
  }
  return { l10Dates, l10Opps: opps ? opps.map(text) : l10Dates.map(() => '') }
}

// KBO card games are newest first. A prop's recent_values are usually the
// same games' values, but a pitcher prop can be season-filtered, so the labels
// are only used when the games give exactly the values the bars show.
export function deriveHeadLabels(games, values, getValue, limit = CHART_LABEL_LIMIT) {
  const rows = list(games)
  const shown = (list(values) || []).slice(0, limit)
  if (!rows?.length || !shown.length || typeof getValue !== 'function' || rows.length < shown.length) return null
  const head = rows.slice(0, shown.length)
  const same = head.every((game, index) => Number(getValue(game)) === Number(shown[index]))
  if (!same) return null
  return {
    l10Dates: head.map((game) => text(game?.date)),
    l10Opps: head.map((game) => text(game?.opp ?? game?.opponent)),
  }
}

function zipBars(values, dates, opps) {
  const labelled = Array.isArray(dates) && dates.length === values.length
  return values.map((value, index) => ({
    value,
    date: labelled ? text(dates[index]) : '',
    team: labelled && Array.isArray(opps) ? text(opps[index]) : '',
  }))
}

// NFL / NHL: the last ten `recent` values, oldest on the left.
export function tailChartBars(row, limit = CHART_LABEL_LIMIT) {
  const recent = list(row?.recent) || []
  const values = recent.slice(-limit)
  const labels = list(row?.l10Dates) ? { l10Dates: row.l10Dates, l10Opps: row.l10Opps } : deriveTailLabels(row, limit)
  return zipBars(values, labels?.l10Dates, labels?.l10Opps)
}

// KBO: recent_values are newest first. The bars run oldest on the left.
export function headChartBars(prop, games, getValue, limit = CHART_LABEL_LIMIT) {
  const head = (list(prop?.recent_values) || []).slice(0, limit)
  const labels = list(prop?.l10Dates) ? { l10Dates: prop.l10Dates, l10Opps: prop.l10Opps } : deriveHeadLabels(games, head, getValue, limit)
  return zipBars(head, labels?.l10Dates, labels?.l10Opps).reverse()
}

// NBA / WNBA: newest-first game objects. Games without the stat are skipped,
// exactly like the bar values, so every bar keeps its own game's label.
export function gameChartBars(games, getValue, getOpponent, limit = CHART_LABEL_LIMIT) {
  return (list(games) || [])
    .slice(0, limit)
    .map((game) => ({ value: getValue(game), date: text(game?.date), team: text(getOpponent(game)) }))
    .filter((bar) => bar.value != null)
    .reverse()
}
