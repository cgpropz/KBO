// Display selection for the NBA Edge board. Pending props (no posted
// projection) are left out of the prop tabs, the player list, the cards,
// and the matchup list. Each card is one Edge chip row and one prop pill,
// so a prop that does not come back here is not chipped either.
// This does not score or rank. CG Score stays on the row the board shipped.

import { postedNbaProps } from './nbaPostedProjection.js'

export function nbaEdgePropTypes(data) {
  if (!data) return ['All']
  const set = new Set()
  for (const player of data) {
    for (const prop of postedNbaProps(player?.ppAllProps)) {
      if (prop?.stat) set.add(prop.stat)
    }
  }
  return ['All', ...[...set].sort((a, b) => a.localeCompare(b))]
}

export function nbaEdgeSlateDate(data) {
  if (!data) return null
  const dates = [...new Set(
    data.flatMap((player) => postedNbaProps(player?.ppAllProps).map((prop) => prop?.gameDate).filter(Boolean)),
  )].sort()
  return dates[0] || null
}

export function nbaEdgeMatchups(data, activeSlateDate) {
  if (!data) return []
  const seen = new Map()
  data.forEach((player) => {
    const teamA = (player.team || '').toUpperCase()
    if (!teamA) return
    postedNbaProps(player?.ppAllProps).forEach((prop) => {
      const teamB = (prop.opponent || '').toUpperCase()
      if (!teamB) return
      const [t1, t2] = [teamA, teamB].sort()
      const key = `${t1}_${t2}`
      if (seen.has(key)) return
      const gameDate = prop.gameDate || ''
      let dateLabel = ''
      if (gameDate) {
        dateLabel = gameDate === activeSlateDate
          ? 'Todays slate'
          : new Date(`${gameDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      }
      seen.set(key, { label: `${t1} vs ${t2}`, dateLabel, dateStr: gameDate || '9999' })
    })
  })
  return [...seen.values()].sort((a, b) => {
    if (a.dateStr !== b.dateStr) return a.dateStr.localeCompare(b.dateStr)
    return a.label.localeCompare(b.label)
  })
}

export function nbaEdgePlayers(data, {
  search = '',
  posFilter = 'All',
  matchupFilter = 'All',
  minMinutes = 0,
  propType = 'All',
} = {}) {
  if (!data) return []
  return data.filter((player) => {
    const props = postedNbaProps(player?.ppAllProps)
    const nameMatch = !search || player.name.toLowerCase().includes(search.toLowerCase())
    const posMatch = posFilter === 'All' || player.position === posFilter
    const minutesKnown = player.avgMins != null
    const minMinutesMatch = minMinutes === 0 || (minutesKnown && player.avgMins >= minMinutes)
    const propMatch = propType === 'All'
      ? props.length > 0
      : props.some((prop) => prop?.stat === propType)
    let matchupMatch = true
    if (matchupFilter !== 'All') {
      const [t1, t2] = matchupFilter.split(' vs ')
      const teamUp = (player.team || '').toUpperCase()
      matchupMatch = teamUp === t1 || teamUp === t2
    }
    return nameMatch && posMatch && minMinutesMatch && propMatch && matchupMatch
  })
}

export function nbaEdgeCards(players, { propType = 'All', hitRateSort = 'score' } = {}) {
  const rows = []
  ;(players || []).forEach((player) => {
    const props = postedNbaProps(player?.ppAllProps)
      .filter((prop) => propType === 'All' || prop.stat === propType)
    props.forEach((prop) => {
      rows.push({
        key: `${player.athleteId || player.name}-${prop.stat}-${prop.line}`,
        player,
        stat: prop.stat,
        line: prop.line,
        versus: prop.versus || '',
        opponent: prop.opponent || '',
        gameDate: prop.gameDate || '',
        projection: prop.projection,
        rating: prop.rating,
        hitRates: prop.hitRates || {},
      })
    })
  })
  const sortValue = (card) => (
    hitRateSort === 'score' ? card.rating : card.hitRates?.[hitRateSort]
  )
  rows.sort((a, b) => {
    const left = sortValue(a)
    const right = sortValue(b)
    const leftMissing = left == null || Number.isNaN(Number(left))
    const rightMissing = right == null || Number.isNaN(Number(right))
    if (leftMissing && rightMissing) {
      return a.player.name.localeCompare(b.player.name) || a.stat.localeCompare(b.stat)
    }
    if (leftMissing) return 1
    if (rightMissing) return -1
    const difference = Number(right) - Number(left)
    if (difference !== 0) return difference
    return a.player.name.localeCompare(b.player.name) || a.stat.localeCompare(b.stat)
  })
  return rows
}
