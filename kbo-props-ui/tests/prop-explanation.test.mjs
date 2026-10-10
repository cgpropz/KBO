import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { explainProp, boardFormulaLine } from '../src/propExplanation.js'
import { FORMULA_MODE, PUBLISHED_PARAMS, resolveSpec } from '../src/formulaModel.js'

const ROOT = new URL('../../', import.meta.url)

function readJson(path) {
  return JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'))
}

function textOf(row) {
  return explainProp(row).paragraphs.join('\n')
}

test('published knobs match ml/params and the live formula mode', () => {
  const mode = readJson('pipeline/projection_formula.json').mode
  assert.equal(FORMULA_MODE, mode)
  for (const sport of ['kbo', 'wnba', 'nfl']) {
    for (const [stat, published] of Object.entries(PUBLISHED_PARAMS[sport])) {
      const fileName = {
        'Hits+Runs+RBIs': 'hits_plus_runs_plus_rbis.json',
        'Fantasy Score': 'fantasy_score.json',
        'Hits Allowed': 'hits_allowed.json',
        'Pitching Outs': 'pitching_outs.json',
        Strikeouts: 'strikeouts.json',
        'Total Bases': 'total_bases.json',
        '3-PT Attempted': '3_pt_attempted.json',
        '3-PT Made': '3_pt_made.json',
        Assists: 'assists.json',
        'Blks+Stls': 'blks_plus_stls.json',
        'Blocked Shots': 'blocked_shots.json',
        'Defensive Rebounds': 'defensive_rebounds.json',
        'FG Attempted': 'fg_attempted.json',
        'FG Made': 'fg_made.json',
        'Free Throws Attempted': 'free_throws_attempted.json',
        'Free Throws Made': 'free_throws_made.json',
        'Offensive Rebounds': 'offensive_rebounds.json',
        Points: 'points.json',
        'Pts+Asts': 'pts_plus_asts.json',
        'Pts+Rebs': 'pts_plus_rebs.json',
        'Pts+Rebs+Asts': 'pts_plus_rebs_plus_asts.json',
        Rebounds: 'rebounds.json',
        'Rebs+Asts': 'rebs_plus_asts.json',
        Steals: 'steals.json',
        Turnovers: 'turnovers.json',
        'Two Pointers Attempted': 'two_pointers_attempted.json',
        'Two Pointers Made': 'two_pointers_made.json',
        'Pass Attempts': 'pass_attempts.json',
        'Pass Completions': 'pass_completions.json',
        'Pass+Rush Yds': 'pass_plus_rush_yds.json',
        'Pass Yards': 'pass_yards.json',
        'Rec Targets': 'rec_targets.json',
        'Receiving Yards': 'receiving_yards.json',
        Receptions: 'receptions.json',
        'Rush Attempts': 'rush_attempts.json',
        'Rush+Rec Yds': 'rush_plus_rec_yds.json',
        'Rush Yards': 'rush_yards.json',
      }[stat]
      const raw = readJson(`ml/params/${sport}/${fileName}`)
      assert.equal(published.recommendation, raw.recommendation, stat)
      assert.equal(published.is_current, Boolean(raw.formula?.is_current), stat)
      assert.deepEqual(published.knobs, raw.formula.knobs, stat)
      const cal = raw.linear_calibration
      assert.deepEqual(published.cal, cal ? [cal.a, cal.b] : null, stat)
    }
  }
})

const wesley = {
  sport: 'kbo',
  prop: 'Hits Allowed',
  name: 'Wesley Benjamin',
  team: 'Doosan',
  opponent: 'Samsung',
  projection: 5.15,
  line: 4.5,
  rating: 57.2,
  hit_rate_l5: 20,
  hit_rate_full: 50,
  cg_projection: 73,
  formula_applied: true,
  opp_ba: 0.277,
  opp_k_pct: 17.4,
  opp_factor: 1,
  form_factor: 1,
}

test('Wesley Benjamin: a high hits-allowed rating can sit next to a 20% last-5 hit rate', () => {
  const explained = explainProp(wesley)
  const text = explained.lines.join('\n')
  assert.equal(explained.side, 'Over')
  assert.match(text, /Leans Over/)
  assert.match(text, /57\.2/)
  assert.match(text, /projection \(5\.2\) is 0\.7 above/)
  assert.match(text, /Last 5 cleared the line 20% of the time/)
  assert.match(text, /does not set the rating/)
  assert.match(text, /longer record: 10% recent starts, 20% this season, and 70% all starts/)
  assert.equal(explained.lines.length, 3)
  assert.doesNotMatch(text, /2\.1558|0\.6238|CG score|Samsung|batting average|0\.277|17\.4|WHIP|feature vector|hit_rate|opp_mult|opp_factor|form_factor|knob/i)
})

test('hits allowed on the previous formula still uses the opponent and does not use the tuned line', () => {
  const text = textOf({ ...wesley, formula_applied: false, opp_h_per_ip: 1.12, league_avg_h_per_ip: 1.01, opp_factor: 1.04, form_factor: 0.96 })
  assert.match(text, /Samsung hits 1\.12 per inning/)
  assert.match(text, /raises it/)
  assert.match(text, /multiplies the projection by 0\.96/)
  assert.match(text, /50% recent starts/)
  assert.doesNotMatch(text, /2\.1558/)
})

test('a tuned strikeout rating names the opponent strikeout rate that actually moves it', () => {
  const text = textOf({
    sport: 'kbo',
    prop: 'Strikeouts',
    name: 'An Woo-jin',
    opponent: 'Hanwha',
    projection: 6.4,
    line: 5.5,
    rating: 58.2,
    hit_rate_l5: 60,
    hit_rate_full: 54,
    formula_applied: true,
    opp_factor: 1.06,
    opp_so_per_g: 8.4,
    league_avg_so_per_g: 7.6,
  })
  assert.match(text, /Hanwha strikes out 8\.4 times a game/)
  assert.match(text, /raises it/)
  assert.doesNotMatch(text, /batting average|WHIP|2\.1558/)
})

test('hitter hits+runs+RBI uses the tuned inputs and skips park, hand, and pitcher', () => {
  const text = textOf({
    sport: 'kbo',
    prop: 'Hits+Runs+RBIs',
    name: 'Kim Hitter',
    opponent: 'Doosan',
    projection: 2.4,
    line: 1.5,
    rating: 80,
    hit_rate_l5: 20,
    hit_rate_full: 55,
    formula_applied: true,
    opp_factor: 1.08,
    park_factor: 1.1,
    split_factor: 1.05,
    pitcher_factor: 1.04,
  })
  assert.match(text, /Most of the weight is the season/)
  assert.match(text, /Opponent pitchers raise it \(1\.08\)/)
  assert.match(text, /does not set the rating/)
  assert.doesNotMatch(text, /park|WHIP|handedness|0\.3884|1\.04|1\.05|1\.10/)
})

test('a low rating can sit next to a high last-5 hit rate', () => {
  const text = textOf({
    sport: 'kbo',
    prop: 'Hits Allowed',
    name: 'Cold Arm',
    projection: 3.8,
    line: 4.5,
    rating: 42.2,
    hit_rate_l5: 80,
    hit_rate_full: 60,
    formula_applied: true,
  })
  assert.match(text, /Leans Under/)
  assert.match(text, /Last 5 cleared the line 80% of the time/)
  assert.match(text, /does not set the rating/)
  assert.match(text, /below the line/)
})

test('NFL receiving yards explains the live windows and not defense', () => {
  const spec = resolveSpec({ sport: 'nfl', prop: 'Receiving Yards', formula_applied: true })
  assert.deepEqual(spec.weights, [0.25, 0.25, 0.5])
  assert.equal(spec.cap, 15)
  const text = textOf({
    sport: 'nfl',
    prop: 'Receiving Yards',
    name: 'Example WR',
    projection: 64.2,
    line: 55.5,
    rating: 57.8,
    scoreLabel: 'score',
    hit_rate_l5: 20,
    hit_rate_full: 40,
    fullHitLabel: 'last-10 hit rate',
    formula_applied: true,
    dvpRank: 4,
    dvpRatio: 1.2,
  })
  assert.match(text, /25%, 25%, and 50% on the last 3, last 9, and last 15/)
  assert.match(text, /does not set the score/)
  assert.doesNotMatch(text, /0\.7672|defense|DVP|snap|Variance/)
})

test('WNBA points use the tuned windows, and rebounds stay on the previous formula', () => {
  const points = resolveSpec({ sport: 'wnba', prop: 'Points', formula_applied: true })
  assert.deepEqual(points.windows, [7, 15, 30])
  assert.equal(points.dvp, 'half')
  assert.equal(points.minutes, 15)
  const rebounds = resolveSpec({ sport: 'wnba', prop: 'Rebounds' })
  assert.deepEqual(rebounds.windows, [3, 7, 15])
  assert.deepEqual(rebounds.weights, [0.5, 0.3, 0.2])
  assert.equal(rebounds.dvp, 'on')
  assert.equal(rebounds.minutes, 10)
  const text = textOf({
    sport: 'wnba',
    prop: 'Rebounds',
    name: 'Example F',
    projection: 8,
    line: 7.5,
    scoreLabel: 'score',
    hit_rate_l5: 40,
  })
  assert.match(text, /last 3, 7, and 15 games/)
  assert.doesNotMatch(text, /last 30|last 7, 15, and 30/)
})

test('board formula lines follow the live formula', () => {
  assert.match(boardFormulaLine('kbo', 'Hits Allowed'), /10%, 20%, and 70%/)
  assert.doesNotMatch(boardFormulaLine('kbo', 'Hits Allowed'), /2\.1558|WHIP|form/i)
  assert.match(boardFormulaLine('kbo', 'Hits+Runs+RBIs'), /opponent's pitchers/)
  assert.doesNotMatch(boardFormulaLine('kbo', 'Hits+Runs+RBIs'), /WHIP|park/i)
})
