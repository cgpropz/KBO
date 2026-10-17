// Expected starters stay in the expected column, including a GTD badge.
// The out column is players marked out who are not already shown there.
export function wnbaLineupColumns(team) {
  const expected = (team?.players || []).filter((player) => player && player.status !== 'out')
  const shown = new Set(expected.map((player) => player.name))
  const out = [
    ...(team?.players || []).filter((player) => player && player.status === 'out'),
    ...(team?.inactive || []),
  ].filter((player) => player?.name && !shown.has(player.name))
    .filter((player, index, all) => all.findIndex((item) => item.name === player.name) === index)
  return { expected, out }
}
