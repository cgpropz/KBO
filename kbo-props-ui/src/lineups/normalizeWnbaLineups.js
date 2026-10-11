const STATUS_BADGE = {
  out: 'OUT',
  gtd: 'GTD',
  questionable: 'GTD',
}

function badge(status) {
  return STATUS_BADGE[String(status || '').toLowerCase()] || null
}

function playerRow(player, status) {
  return {
    position: player.pos || player.position || '',
    name: player.name || '',
    status,
    imageUrl: player.imageUrl || '',
  }
}

function injuryRow(player, status) {
  return {
    name: player.name || '',
    position: player.pos || player.position || '',
    status: status || 'OUT',
    detail: player.detail || '',
  }
}

function fromRotowire(game) {
  const lineups = {}
  const injuries = {}
  const sides = [
    ['awayTeam', game.visitor],
    ['homeTeam', game.home],
  ]
  const matchup = {
    gameday: '',
    weekday: '',
    gametime: '',
    kickoffLabel: game.gameTime || 'TBD',
    awayTeam: '',
    homeTeam: '',
    awayRecord: '',
    homeRecord: '',
    spreadLine: null,
    totalLine: null,
    conditions: '—',
    lineups,
    injuries,
  }
  sides.forEach(([key, team]) => {
    const abbr = team?.abbr || ''
    matchup[key] = abbr
    const starters = []
    const report = []
    ;(team?.players || []).forEach((player) => {
      const status = badge(player.status)
      if (player.status === 'out') report.push(injuryRow(player, status))
      else starters.push(playerRow(player, status))
    })
    ;(team?.inactive || []).forEach((player) => {
      report.push(injuryRow(player, badge(player.status)))
    })
    if (abbr) {
      lineups[abbr] = starters
      injuries[abbr] = report
    }
  })
  if (!matchup.awayTeam && !matchup.homeTeam) return null
  return matchup
}

export function normalizeWnbaLineups(rows) {
  if (!Array.isArray(rows)) return []
  return rows.map((game) => {
    if (game && game.awayTeam && game.homeTeam && game.lineups) return game
    return fromRotowire(game || {})
  }).filter(Boolean)
}

export function wnbaSlateHeading(matchups) {
  const day = (matchups || []).find((matchup) => matchup.gameday)?.gameday
  if (!day) return 'Starting Lineups'
  const [year, month, date] = String(day).split('-').map(Number)
  if (!year || !month || !date) return 'Starting Lineups'
  const label = new Date(Date.UTC(year, month - 1, date)).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
  return `${label} Starting Lineups`
}
