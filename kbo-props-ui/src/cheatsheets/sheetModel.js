// Sheet shape shared by the EXAMPLE fixtures and the live board mappers.
// Display only. This file does not score a game.

import example from './gameProjExample.json' with { type: 'json' }

export function indexGames(games) {
  return games.map((game, boardIndex) => ({ ...game, boardIndex }))
}

export function makeGame(spec) {
  const away = spec.away
  const home = spec.home
  return {
    id: spec.id,
    listKick: spec.listKick,
    kickSort: spec.kickSort,
    game: {
      away,
      home,
      kickoff: spec.kickoff,
      venue: spec.venue || '',
      surface: spec.surface || '',
    },
    market: {
      books: spec.books ?? 12,
      bookName: spec.bookName || '',
      total: spec.total,
      spread: { favorite: spec.favorite, line: spec.spread },
      ml: { [away.abbr]: spec.mlAway, [home.abbr]: spec.mlHome },
    },
    cg: {
      away_score: spec.awayScore,
      home_score: spec.homeScore,
      total: spec.cgTotal,
      total_edge: spec.totalEdge,
      total_lean: spec.totalLean,
      side_proj: spec.sideProj,
      side_lean: spec.sideLean,
      side_edge: spec.sideEdge,
      // Example sheets copy the locked mock's display chips. Not the board formula.
      cg_score_total: spec.cgTotalScore ?? null,
      cg_score_spread: spec.cgSpreadScore ?? null,
    },
    hit_rates_over: spec.hits || null,
    historical_totals: spec.bars || null,
    matchups: spec.matchups || null,
    pace: spec.pace || null,
    dvp: spec.dvp || null,
    components: spec.components || null,
  }
}

export function hits(l3, l6, l12, season) {
  return [
    { window: 'L3', rate: l3 },
    { window: 'L6', rate: l6 },
    { window: 'L12', rate: l12 },
    { window: 'Season', rate: season },
  ]
}

export function bars(values) {
  return values.map((total, index) => ({ label: `G${index + 1}`, total }))
}

export function statRows(labels, lines) {
  return labels.map((stat, index) => ({
    stat,
    off: lines[index][0],
    off_rk: lines[index][1],
    def: lines[index][2],
    def_rk: lines[index][3],
    edge: lines[index][4],
  }))
}

export function paceBlock(labels, away, home, expectedLabel, expected, situationalLabel, situational) {
  return {
    metrics: labels.map((label, index) => ({ label, away: away[index], home: home[index] })),
    expected_label: expectedLabel,
    expected,
    situational_label: situationalLabel,
    situational,
  }
}

export function dvpBlock(labels, awayDef, homeDef) {
  return {
    labels,
    away_def: awayDef,
    home_def: homeDef,
    note: 'Higher = softer matchup for that position (EXAMPLE)',
  }
}

export function componentRows(rows) {
  return rows.map(([name, away, home]) => ({ name, away, home }))
}

export function gameFromLockedExample(raw = example) {
  const away = raw.game.away.abbr
  const home = raw.game.home.abbr
  return {
    id: 'nfl-dal-phi',
    listKick: '4:25 PM',
    kickSort: '2026-11-02T16:25',
    game: raw.game,
    market: { ...raw.market, bookName: '' },
    cg: raw.cg,
    hit_rates_over: raw.hit_rates_over,
    historical_totals: raw.historical_totals,
    matchups: {
      away_off: raw.matchups.dal_off_vs_phi_def,
      home_off: raw.matchups.phi_off_vs_dal_def,
    },
    pace: {
      metrics: [
        { label: 'SECS/PLAY', away: raw.pace.secs_per_play[away], home: raw.pace.secs_per_play[home] },
        { label: 'PLAYS/G', away: raw.pace.plays_per_game[away], home: raw.pace.plays_per_game[home] },
      ],
      expected_label: 'EXP PLAYS',
      expected: raw.pace.expected_plays,
      situational_label: 'SECS/PLAY BY SITUATION',
      situational: raw.pace.situational.map((row) => ({
        sit: row.sit,
        away: row.dal,
        home: row.phi,
      })),
    },
    dvp: {
      labels: raw.dvp.labels.map((label) => label.replace(/^vs\s+/i, '')),
      away_def: raw.dvp.dal_def,
      home_def: raw.dvp.phi_def,
      note: 'Higher = softer matchup for that position (EXAMPLE)',
    },
    components: raw.components,
  }
}
