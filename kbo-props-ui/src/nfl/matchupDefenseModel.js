// Opponent-adjusted defense vs position (nflverse play-by-play). Matchup
// context shown next to the existing DvP grade. Display only: it never feeds
// CG Score, projections or any ranking.
// Prop mapping mirrors nfl/matchup_defense.py splits_for_prop(); both are
// checked against tests/fixtures/nfl-matchup-prop-map.json.
import { dvpGrade } from './matchupGrade.js'

export const MATCHUP_CREDIT = 'Data: nflverse'
export const MATCHUP_CREDIT_URL = 'https://github.com/nflverse'
export const SMALL_SAMPLE_PLAYS = 30

const PASS_PROPS = new Set(['Pass Yards', 'Pass Attempts', 'Pass Completions', 'Pass TDs', 'Pass+Rush Yds'])
const RUN_PROPS = new Set(['Rush Yards', 'Rush Attempts'])
const RECEIVING_PROPS = new Set(['Receiving Yards', 'Receptions', 'Rec Targets'])
const POSITION_ALIASES = { FB: 'RB', HB: 'RB' }
const TEAM_ALIASES = { JAC: 'JAX', LAR: 'LA', WSH: 'WAS' }

export const SPLIT_LABELS = {
  pass: 'Pass D',
  run: 'Run D',
  WR: 'vs WR targets',
  TE: 'vs TE targets',
  RB: 'vs RB targets',
}

const SHORT_LABELS = { pass: 'Pass D', run: 'Run D', WR: 'WR tgts', TE: 'TE tgts', RB: 'RB tgts' }

function normPosition(position) {
  const pos = String(position || '').toUpperCase()
  return POSITION_ALIASES[pos] || pos
}

function targetSplit(position) {
  const pos = normPosition(position)
  return pos === 'WR' || pos === 'TE' || pos === 'RB' ? pos : 'WR'
}

export function splitsForProp(prop, position) {
  const name = String(prop || '')
  const pos = normPosition(position)
  if (PASS_PROPS.has(name)) return ['pass']
  if (RUN_PROPS.has(name)) return ['run']
  if (RECEIVING_PROPS.has(name)) return [targetSplit(pos)]
  if (name === 'Rush+Rec Yds') {
    if (pos === 'RB') return ['run', 'RB']
    if (pos === 'QB') return ['run']
    return [targetSplit(pos)]
  }
  return []
}

export function canonicalTeam(team) {
  const code = String(team || '').replace(/^@/, '').trim().toUpperCase()
  return TEAM_ALIASES[code] || code
}

function signed(value, digits = 2) {
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return `${num >= 0 ? '+' : ''}${num.toFixed(digits)}`
}

// One entry per mapped split for this prop's opponent, or [] when there is no
// data, no opponent, or the prop has no matchup split (kicking, TDs, fantasy).
export function matchupEntries(payload, { prop, position, opponent } = {}) {
  const teams = payload && typeof payload === 'object' ? payload.teams : null
  if (!teams) return []
  const team = teams[canonicalTeam(opponent)]
  if (!team) return []
  return splitsForProp(prop, position)
    .map((split) => {
      const row = team[split]
      const rank = Number(row?.rank)
      if (!row || !Number.isInteger(rank) || rank < 1) return null
      return {
        split,
        label: SPLIT_LABELS[split],
        shortLabel: SHORT_LABELS[split],
        rank,
        grade: dvpGrade(rank),
        epa: row.epa,
        success: row.success,
        plays: Number(row.plays) || 0,
        smallSample: !!row.smallSample,
      }
    })
    .filter(Boolean)
}

// Chip-level summary. The chip shows the first split's grade, but the
// small-sample flag is set when ANY split behind it is small (e.g. an RB's
// Rush+Rec Yds uses Run D and RB targets; thin RB targets must still flag).
export function matchupSummary(entries) {
  const list = Array.isArray(entries) ? entries : []
  if (!list.length) return null
  const small = list.filter((entry) => entry.smallSample)
  return {
    grade: list[0].grade,
    rank: list[0].rank,
    smallSample: small.length > 0,
    smallSplits: small.map((entry) => entry.shortLabel),
    marker: small.length ? '*' : '',
  }
}

// "through Week 5 (+ Thu Wk 6)" from the builder; falls back to the week number.
export function coverageLabel(payload) {
  const label = typeof payload?.weekLabel === 'string' ? payload.weekLabel.trim() : ''
  if (label) return label
  return payload?.throughWeek ? `through Week ${payload.throughWeek}` : ''
}

export function smallSampleNote(entries, minPlays = SMALL_SAMPLE_PLAYS) {
  const small = (Array.isArray(entries) ? entries : []).filter((entry) => entry.smallSample)
  if (!small.length) return ''
  const parts = small.map((entry) => `${entry.shortLabel} ${entry.plays} plays`).join(', ')
  return `* Small sample (under ${minPlays} plays: ${parts}). Grade is less reliable.`
}


export function matchupTooltip(entry, payload, { credit = true } = {}) {
  if (!entry) return ''
  const label = coverageLabel(payload)
  const through = label ? ` ${label[0].toUpperCase()}${label.slice(1)}.` : ''
  const sample = entry.smallSample ? ' Small sample*.' : ''
  const success = Number.isFinite(Number(entry.success)) ? `${Math.round(Number(entry.success) * 100)}%` : '—'
  return `Adjusted matchup, ${entry.label}: ${entry.rank}/32 (32 = easiest). `
    + `EPA/play allowed ${signed(entry.epa)}, success rate allowed ${success}, ${entry.plays} plays, opponent-adjusted.`
    + `${through}${sample} Context only; not part of CG Score.${credit ? ` ${MATCHUP_CREDIT}.` : ''}`
}
