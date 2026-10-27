import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { cgScore } from '../src/cgScore.js'
import {
  DEFAULT_NHL_FILTERS,
  NHL_PROP_TABS,
  filterNhlRows,
  nhlDisplayedScore,
  nhlFiltersNarrowed,
  nhlMatchupLabel,
  nhlMatchupOptions,
  nhlTeamOptions,
} from '../src/nhl/nhlBoardFilters.js'

const lines = readFileSync(new URL('../src/nhl/NhlPropLines.jsx', import.meta.url), 'utf8')
const board = readFileSync(new URL('../src/nhl/NhlProjections.jsx', import.meta.url), 'utf8')
const panel = readFileSync(new URL('../src/nhl/NhlBoardFilters.jsx', import.meta.url), 'utf8')

function row(overrides) {
  return {
    id: overrides.player,
    player: overrides.player,
    team: 'EDM',
    opponent: 'CGY',
    position: 'F',
    prop: 'Shots On Goal',
    line: 1.5,
    projection: 3,
    hitRate: 80,
    gamesL10: 10,
    home: false,
    dvpRank: 30,
    rankEligible: true,
    ...overrides,
  }
}

const over = row({ player: 'Over Skater' })
const under = row({
  player: 'Under Skater',
  team: 'TOR',
  opponent: 'BOS',
  position: 'D',
  prop: 'Points',
  projection: 0.4,
  line: 1.5,
  hitRate: 40,
  gamesL10: 4,
  home: true,
  dvpRank: 16,
})
const goalie = row({
  player: 'Goalie Mask',
  team: 'STL',
  opponent: 'WPG',
  position: 'G',
  prop: 'Goalie Saves',
  projection: 28,
  line: 24.5,
  hitRate: 90,
  gamesL10: 8,
  home: false,
  dvpRank: 1,
})
const even = row({
  player: 'Even Skater',
  prop: 'Power Play Points',
  projection: 0.5,
  line: 0.5,
  hitRate: null,
  gamesL10: 0,
})
const held = row({ player: 'Held Skater', rankEligible: false, projection: 2.2 })
const slate = [over, under, goalie, even, held]

test('NHL filter tabs match the posted props and do not add faceoffs', () => {
  assert.deepEqual(NHL_PROP_TABS, ['All Props', 'Shots On Goal', 'Goalie Saves', 'Points', 'Power Play Points'])
  assert.equal(NHL_PROP_TABS.some((tab) => /face ?off/i.test(tab)), false)
  assert.match(lines, /filterNhlRows/)
  assert.match(lines, /NhlFiltersButton/)
  assert.match(board, /filterNhlRows/)
  assert.match(board, /MATCHUP/)
  assert.match(panel, /nhl-filters-open/)
  assert.match(panel, /nhl-filter-team/)
  assert.match(panel, /nhl-filter-matchup/)
  assert.doesNotMatch(lines, /Face Offs/)
  assert.doesNotMatch(board, /Face Offs/)
  assert.equal(nhlFiltersNarrowed(DEFAULT_NHL_FILTERS), false)
  assert.equal(nhlFiltersNarrowed({ ...DEFAULT_NHL_FILTERS, team: 'EDM' }), true)
})

test('matchup labels follow home and away, and options come from the board', () => {
  assert.equal(nhlMatchupLabel(over), 'EDM @ CGY')
  assert.equal(nhlMatchupLabel(under), 'BOS @ TOR')
  assert.equal(nhlMatchupLabel({ team: 'NYR', opponent: 'BOS' }), 'BOS vs NYR')
  assert.equal(nhlMatchupLabel({ team: 'NYR' }), '')
  assert.deepEqual(nhlTeamOptions(slate), ['All', 'EDM', 'STL', 'TOR'])
  assert.ok(nhlMatchupOptions(slate).includes('EDM @ CGY'))
  assert.ok(nhlMatchupOptions(slate).includes('BOS @ TOR'))
})

test('side, prop, position, team, and matchup narrow the same rows the board shows', () => {
  const names = (filters, propTab = 'All Props', query = '') => filterNhlRows(slate, { propTab, filters, query }).map((item) => item.player)
  assert.deepEqual(names({ side: 'Overs' }).sort(), ['Goalie Mask', 'Held Skater', 'Over Skater'])
  assert.deepEqual(names({ side: 'Unders' }), ['Under Skater'])
  assert.equal(names({ side: 'Overs' }).includes('Even Skater'), false)
  assert.equal(names({ side: 'Unders' }).includes('Even Skater'), false)
  assert.deepEqual(names({}, 'Goalie Saves'), ['Goalie Mask'])
  assert.deepEqual(names({ position: 'G' }), ['Goalie Mask'])
  assert.deepEqual(names({ position: 'D' }), ['Under Skater'])
  assert.deepEqual(names({ team: 'edm' }).sort(), ['Even Skater', 'Held Skater', 'Over Skater'])
  assert.deepEqual(names({ matchup: 'EDM @ CGY' }).sort(), ['Even Skater', 'Held Skater', 'Over Skater'])
  assert.deepEqual(names({}, 'All Props', 'mask'), ['Goalie Mask'])
  assert.deepEqual(names({}, 'All Props', 'tor'), ['Under Skater'])
  assert.ok(names({}).includes('Held Skater'))
})

test('hit rate, games, grade, and the displayed CG Score filter without using a stale score', () => {
  const names = (filters) => filterNhlRows(slate, { filters }).map((item) => item.player)
  assert.equal(nhlDisplayedScore(over), cgScore(3, 1.5, 'Shots On Goal'))
  assert.deepEqual(names({ minHitRate: 70 }).sort(), ['Goalie Mask', 'Over Skater', 'Held Skater'].sort())
  assert.equal(names({ minHitRate: 50 }).includes('Even Skater'), false)
  assert.equal(names({ minHitRate: 0 }).includes('Even Skater'), true)
  assert.equal(names({ minGames: 8 }).includes('Under Skater'), false)
  assert.equal(names({ minGames: 8 }).includes('Goalie Mask'), true)
  assert.ok(names({ grade: 'A' }).includes('Over Skater'))
  assert.equal(names({ grade: 'A' }).includes('Goalie Mask'), false)
  assert.ok(names({ grade: 'B' }).includes('Under Skater'))
  assert.equal(names({ grade: 'D' }).includes('Over Skater'), false)
  const stale = row({ player: 'Stale Score', score: 10 })
  assert.equal(filterNhlRows([stale], { filters: { edgeMin: '90' } }).length, 1)
  assert.equal(filterNhlRows([stale], { filters: { edgeMin: '101' } }).length, 0)
  const swapped = filterNhlRows(slate, { filters: { edgeMin: '90', edgeMax: '20' } }).map((item) => item.player)
  assert.equal(swapped.includes('Over Skater'), false)
  assert.equal(swapped.includes('Held Skater'), true)
  assert.deepEqual(names({ lineMin: '20', lineMax: '30' }), ['Goalie Mask'])
  assert.equal(filterNhlRows([{ player: 'Blank', prop: 'Shots On Goal', line: 1.5, projection: null, hitRate: 100, gamesL10: 10, position: 'F', team: 'EDM', opponent: 'CGY', home: false }], { filters: { edgeMin: '10' } }).length, 0)
})
