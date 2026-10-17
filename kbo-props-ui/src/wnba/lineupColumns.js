// Expected starters stay in the expected column, including a GTD badge.
// An OUT row stays in the out column even when that name is also a starter.
// A GTD or questionable player who is not already shown stays visible too.
export function wnbaLineupColumns(team) {
  const expected = (team?.players || []).filter((player) => player && player.status !== 'out')
  const shown = new Set(expected.map((player) => player.name))
  const out = [
    ...(team?.players || []).filter((player) => player && player.status === 'out'),
    ...(team?.inactive || []),
  ].filter((player) => player?.name && (player.status === 'out' || !shown.has(player.name)))
    .filter((player, index, all) => all.findIndex((item) => item.name === player.name) === index)
  return { expected, out }
}
