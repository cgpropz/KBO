// Loads the cheatsheet for one sport from the feeds the boards already use.
// A preview snapshot is not the sheet. A missing game model becomes an
// unavailable pack, not the EXAMPLE fixtures.

import { fetchDataSnapshot } from '../dataUrl.js'
import { fetchNbaGameMarkets } from '../nba/nbaData.js'
import { fetchNflGameMarkets, fetchNflLineups } from '../nfl/nflData.js'
import { fetchNhlLineups, fetchNhlProjections } from '../nhl/nhlData.js'
import { fetchWnbaSnapshot } from '../wnba/wnbaData.js'
import { attachNflLineupContext, liveNflPack } from './nflGameSheet.js'
import {
  liveKboPack,
  liveNbaPack,
  liveNhlPack,
  liveWnbaPack,
  sportName,
  unavailablePack,
  UNAVAILABLE_NOTES,
} from './liveBoard.js'

async function loadNfl() {
  const markets = await fetchNflGameMarkets()
  const lineups = await fetchNflLineups().catch(() => null)
  const pack = liveNflPack(markets?.payload, { preview: markets?.preview === true })
  if (!pack) {
    return unavailablePack('nfl', markets?.preview ? UNAVAILABLE_NOTES.nflPreview : UNAVAILABLE_NOTES.nflEmpty)
  }
  if (!lineups || lineups.preview === true) return pack
  return attachNflLineupContext(pack, lineups.matchups)
}

async function loadNba() {
  const markets = await fetchNbaGameMarkets()
  if (markets?.preview === true) return unavailablePack('nba', UNAVAILABLE_NOTES.nbaPreview)
  return liveNbaPack(markets?.payload, { preview: false })
    || unavailablePack('nba', UNAVAILABLE_NOTES.nbaEmpty)
}

async function loadNhl() {
  const [lineups, projections] = await Promise.all([
    fetchNhlLineups().catch(() => null),
    fetchNhlProjections().catch(() => null),
  ])
  const pack = liveNhlPack({
    lineups: lineups?.matchups,
    lineupsLoaded: Array.isArray(lineups?.matchups) && lineups.preview !== true,
    lineupsPreview: lineups?.preview === true,
    projections: projections?.projections,
    projectionsPreview: projections?.preview === true,
  })
  if (pack) return pack
  const previewOnly = (lineups?.preview === true || !lineups) && projections?.preview === true
  return unavailablePack('nhl', previewOnly ? UNAVAILABLE_NOTES.nhlPreview : UNAVAILABLE_NOTES.nhlEmpty)
}

async function loadWnba() {
  const snap = await fetchWnbaSnapshot('wnba/lineups.json')
  if (snap?.preview === true) return unavailablePack('wnba', UNAVAILABLE_NOTES.wnbaPreview)
  const rows = Array.isArray(snap?.data) ? snap.data : []
  return liveWnbaPack({ lineups: rows, preview: false })
    || unavailablePack('wnba', UNAVAILABLE_NOTES.wnbaEmpty)
}

async function loadKbo() {
  const [matchups, lines] = await Promise.all([
    fetchDataSnapshot('matchup_data.json'),
    fetchDataSnapshot('game_lines.json').catch(() => ({ data: { games: [] }, preview: false })),
  ])
  if (matchups?.preview === true) return unavailablePack('kbo', UNAVAILABLE_NOTES.kboPreview)
  return liveKboPack({ matchups: matchups?.data, lines: lines?.data, preview: false })
    || unavailablePack('kbo', UNAVAILABLE_NOTES.kboEmpty)
}

const LOADERS = {
  nfl: loadNfl,
  nba: loadNba,
  nhl: loadNhl,
  wnba: loadWnba,
  kbo: loadKbo,
}

export async function loadLivePack(sportId) {
  const id = LOADERS[sportId] ? sportId : 'nfl'
  try {
    return await LOADERS[id]()
  } catch {
    const note = UNAVAILABLE_NOTES[`${id}Load`] || `${sportName(id)} live board did not load.`
    return unavailablePack(id, note)
  }
}
