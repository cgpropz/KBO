// Expected starters stay in the expected column, including a GTD badge.
// A name with any OUT row is left out of expected and shows under out.
// A GTD or questionable player who is not already shown stays visible too.
export function wnbaLineupColumns(team) {
  const outNames = new Set(
    [...(team?.players || []), ...(team?.inactive || [])]
      .filter((player) => player?.name && player.status === 'out')
      .map((player) => player.name),
  )
  const expected = (team?.players || []).filter((player) => player && player.status !== 'out' && !outNames.has(player.name))
  const shown = new Set(expected.map((player) => player.name))
  const out = [
    ...(team?.players || []).filter((player) => player && player.status === 'out'),
    ...(team?.inactive || []),
  ].filter((player) => player?.name && (player.status === 'out' || !shown.has(player.name)))
    .filter((player, index, all) => all.findIndex((item) => item.name === player.name) === index)
  return { expected, out }
}
