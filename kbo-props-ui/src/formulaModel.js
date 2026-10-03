/**
 * Which inputs the live projection actually uses.
 *
 * Knobs are copied from ml/params. A test fails if those files change and this
 * snapshot is not updated. Stats marked keep_current ignore the knobs in the
 * file and stay on the previous formula (the same rule as pipeline/live_formula.py).
 *
 * FORMULA_MODE must match pipeline/projection_formula.json. Rows that already
 * say formula_applied win over this default.
 */

export const FORMULA_MODE = 'tuned'

const PITCHER_WEIGHTS = {
  live: [0.5, 0.3, 0.2],
  balanced: [0.3, 0.3, 0.4],
  season_heavy: [0.2, 0.2, 0.6],
  recent_heavy: [0.7, 0.2, 0.1],
  long_run: [0.1, 0.2, 0.7],
}
const HRR_PA = {
  live: [0.5, 0.3, 0.2],
  balanced: [0.34, 0.33, 0.33],
  season_heavy: [0.2, 0.3, 0.5],
}
const HRR_RATE = {
  live: [0.3, 0.3, 0.4],
  season_lean: [0.2, 0.3, 0.5],
  season_heavy: [0.1, 0.2, 0.7],
}
const WNBA_WEIGHTS = {
  live: [0.5, 0.3, 0.2],
  balanced: [0.34, 0.33, 0.33],
  long_heavy: [0.2, 0.3, 0.5],
  short_heavy: [0.6, 0.3, 0.1],
  mid_heavy: [0.3, 0.5, 0.2],
}
const WNBA_WINDOWS = {
  live: [3, 7, 15],
  longer: [5, 10, 20],
  longest: [7, 15, 30],
}
const NFL_WEIGHTS = {
  live: [0.5, 0.25, 0.25],
  balanced: [0.34, 0.33, 0.33],
  long_heavy: [0.25, 0.25, 0.5],
  short_heavy: [0.6, 0.2, 0.2],
}
const NFL_WINDOWS = {
  live: [3, 9, 15],
  short: [3, 6, 10],
  long: [3, 8, 16],
}

// Previous formulas, from generate_projections.py / generate_batter_projections.py
// and wnba/backend/index.js / nfl/build_projection_data.py. Not the rejected knobs.
const PREVIOUS_PITCHER = {
  'Hits Allowed': {
    kind: 'pitcher',
    statLabel: 'hits allowed',
    rateLabel: 'hits per inning',
    rateWindow: 'the last 5 starts',
    countWindow: 'the last 3 starts',
    weights: PITCHER_WEIGHTS.live,
    shrink: 6,
    form: [0.9, 1.1],
    opponent: 'hits',
    timesThree: false,
    cal: null,
  },
  Strikeouts: {
    kind: 'pitcher',
    statLabel: 'strikeouts',
    rateLabel: 'strikeouts per inning',
    rateWindow: 'the last 5 starts',
    countWindow: 'the last 3 starts',
    weights: PITCHER_WEIGHTS.live,
    shrink: 6,
    form: [0.9, 1.1],
    opponent: 'strikeouts',
    timesThree: false,
    cal: null,
  },
  'Pitching Outs': {
    kind: 'pitcher',
    statLabel: 'pitching outs',
    rateLabel: null,
    rateWindow: null,
    countWindow: 'the last 3 starts',
    weights: PITCHER_WEIGHTS.live,
    shrink: 6,
    form: [0.9, 1.1],
    opponent: 'outs',
    timesThree: true,
    cal: null,
  },
}

const WNBA_PIECES = {
  Points: ['points'],
  Rebounds: ['rebounds'],
  Assists: ['assists'],
  '3-PT Made': ['threes made'],
  '3-PT Attempted': ['threes attempted'],
  'FG Made': ['field goals made'],
  'FG Attempted': ['field goals attempted'],
  'Two Pointers Made': ['two-pointers made'],
  'Two Pointers Attempted': ['two-pointers attempted'],
  'Free Throws Made': ['free throws made'],
  'Free Throws Attempted': ['free throws attempted'],
  Steals: ['steals'],
  Blocks: ['blocks'],
  'Blocked Shots': ['blocks'],
  Turnovers: ['turnovers'],
  'Offensive Rebounds': ['offensive rebounds'],
  'Defensive Rebounds': ['defensive rebounds'],
  'Blks+Stls': ['blocks', 'steals'],
  'Reb+Asts': ['rebounds', 'assists'],
  'Rebs+Asts': ['rebounds', 'assists'],
  'Pts+Rebs': ['points', 'rebounds'],
  'Pts+Asts': ['points', 'assists'],
  'Pts+Rebs+Asts': ['points', 'rebounds', 'assists'],
  'Fantasy Score': 'fantasy',
}

const PREVIOUS_WNBA = {
  windows: WNBA_WINDOWS.live,
  weights: WNBA_WEIGHTS.live,
  minutes: 10,
  dvp: 'on',
  cal: null,
}

const PREVIOUS_NFL = {
  windows: NFL_WINDOWS.live,
  weights: NFL_WEIGHTS.live,
  cap: 10,
  cal: null,
}

export const PUBLISHED_PARAMS = {
  "kbo": {
    "Fantasy Score": {
      "recommendation": "candidate",
      "is_current": true,
      "knobs": {
        "source": "published"
      },
      "cal": [
        3.6225,
        0.5
      ]
    },
    "Hits Allowed": {
      "recommendation": "candidate",
      "is_current": false,
      "knobs": {
        "dedupe": "fixed",
        "form": "off",
        "shrink_games": 10.0,
        "weights": "long_run",
        "opp_mult": 0.0
      },
      "cal": [
        2.1558,
        0.6238
      ]
    },
    "Hits+Runs+RBIs": {
      "recommendation": "candidate",
      "is_current": false,
      "knobs": {
        "pa_weights": "season_heavy",
        "rate_weights": "season_heavy",
        "opp": "corrected",
        "park": false,
        "split": false,
        "pitcher": false
      },
      "cal": [
        0.3884,
        0.6561
      ]
    },
    "Pitching Outs": {
      "recommendation": "candidate",
      "is_current": false,
      "knobs": {
        "dedupe": "fixed",
        "form": "off",
        "shrink_games": 3.0,
        "weights": "season_heavy",
        "opp_mult": 1.0
      },
      "cal": [
        5.1833,
        0.7065
      ]
    },
    "Strikeouts": {
      "recommendation": "candidate",
      "is_current": false,
      "knobs": {
        "dedupe": "fixed",
        "form": "off",
        "shrink_games": 10.0,
        "weights": "long_run",
        "opp_mult": 1.5
      },
      "cal": null
    },
    "Total Bases": {
      "recommendation": "keep_current",
      "is_current": true,
      "knobs": {
        "source": "published"
      },
      "cal": [
        0.02,
        0.5
      ]
    }
  },
  "wnba": {
    "3-PT Attempted": {
      "recommendation": "keep_current",
      "is_current": false,
      "knobs": {
        "window_weights": "long_heavy",
        "windows": "longest",
        "minutes_window": 10,
        "dvp": "off"
      },
      "cal": null
    },
    "3-PT Made": {
      "recommendation": "keep_current",
      "is_current": false,
      "knobs": {
        "window_weights": "long_heavy",
        "windows": "longest",
        "minutes_window": 5,
        "dvp": "half"
      },
      "cal": null
    },
    "Assists": {
      "recommendation": "candidate",
      "is_current": false,
      "knobs": {
        "window_weights": "long_heavy",
        "windows": "longest",
        "minutes_window": 5,
        "dvp": "on"
      },
      "cal": null
    },
    "Blks+Stls": {
      "recommendation": "keep_current",
      "is_current": true,
      "knobs": {
        "window_weights": "live",
        "windows": "live",
        "minutes_window": 10,
        "dvp": "on"
      },
      "cal": null
    },
    "Blocked Shots": {
      "recommendation": "keep_current",
      "is_current": true,
      "knobs": {
        "window_weights": "live",
        "windows": "live",
        "minutes_window": 10,
        "dvp": "on"
      },
      "cal": null
    },
    "Defensive Rebounds": {
      "recommendation": "keep_current",
      "is_current": false,
      "knobs": {
        "window_weights": "long_heavy",
        "windows": "longest",
        "minutes_window": 5,
        "dvp": "on"
      },
      "cal": [
        1.0361,
        0.7959
      ]
    },
    "Fantasy Score": {
      "recommendation": "candidate",
      "is_current": false,
      "knobs": {
        "window_weights": "long_heavy",
        "windows": "longest",
        "minutes_window": 15,
        "dvp": "on"
      },
      "cal": null
    },
    "FG Attempted": {
      "recommendation": "candidate",
      "is_current": false,
      "knobs": {
        "window_weights": "long_heavy",
        "windows": "longest",
        "minutes_window": 10,
        "dvp": "off"
      },
      "cal": null
    },
    "FG Made": {
      "recommendation": "keep_current",
      "is_current": false,
      "knobs": {
        "window_weights": "balanced",
        "windows": "longest",
        "minutes_window": 15,
        "dvp": "half"
      },
      "cal": null
    },
    "Free Throws Attempted": {
      "recommendation": "keep_current",
      "is_current": false,
      "knobs": {
        "window_weights": "long_heavy",
        "windows": "longest",
        "minutes_window": 15,
        "dvp": "on"
      },
      "cal": [
        0.475,
        0.8173
      ]
    },
    "Free Throws Made": {
      "recommendation": "keep_current",
      "is_current": false,
      "knobs": {
        "window_weights": "long_heavy",
        "windows": "longest",
        "minutes_window": 15,
        "dvp": "on"
      },
      "cal": [
        0.4483,
        0.7778
      ]
    },
    "Offensive Rebounds": {
      "recommendation": "keep_current",
      "is_current": false,
      "knobs": {
        "window_weights": "long_heavy",
        "windows": "longest",
        "minutes_window": 15,
        "dvp": "half"
      },
      "cal": [
        -0.5121,
        1.1241
      ]
    },
    "Points": {
      "recommendation": "candidate",
      "is_current": false,
      "knobs": {
        "window_weights": "balanced",
        "windows": "longest",
        "minutes_window": 15,
        "dvp": "half"
      },
      "cal": null
    },
    "Pts+Asts": {
      "recommendation": "candidate",
      "is_current": false,
      "knobs": {
        "window_weights": "long_heavy",
        "windows": "longer",
        "minutes_window": 15,
        "dvp": "half"
      },
      "cal": null
    },
    "Pts+Rebs": {
      "recommendation": "candidate",
      "is_current": false,
      "knobs": {
        "window_weights": "long_heavy",
        "windows": "longer",
        "minutes_window": 15,
        "dvp": "half"
      },
      "cal": null
    },
    "Pts+Rebs+Asts": {
      "recommendation": "keep_current",
      "is_current": false,
      "knobs": {
        "window_weights": "balanced",
        "windows": "longer",
        "minutes_window": 15,
        "dvp": "half"
      },
      "cal": null
    },
    "Rebounds": {
      "recommendation": "keep_current",
      "is_current": false,
      "knobs": {
        "window_weights": "long_heavy",
        "windows": "longest",
        "minutes_window": 5,
        "dvp": "off"
      },
      "cal": null
    },
    "Rebs+Asts": {
      "recommendation": "candidate",
      "is_current": false,
      "knobs": {
        "window_weights": "long_heavy",
        "windows": "longest",
        "minutes_window": 15,
        "dvp": "half"
      },
      "cal": null
    },
    "Steals": {
      "recommendation": "keep_current",
      "is_current": true,
      "knobs": {
        "window_weights": "live",
        "windows": "live",
        "minutes_window": 10,
        "dvp": "on"
      },
      "cal": null
    },
    "Turnovers": {
      "recommendation": "keep_current",
      "is_current": true,
      "knobs": {
        "window_weights": "live",
        "windows": "live",
        "minutes_window": 10,
        "dvp": "on"
      },
      "cal": null
    },
    "Two Pointers Attempted": {
      "recommendation": "keep_current",
      "is_current": false,
      "knobs": {
        "window_weights": "long_heavy",
        "windows": "longest",
        "minutes_window": 15,
        "dvp": "on"
      },
      "cal": [
        0.0314,
        0.9459
      ]
    },
    "Two Pointers Made": {
      "recommendation": "keep_current",
      "is_current": false,
      "knobs": {
        "window_weights": "long_heavy",
        "windows": "longest",
        "minutes_window": 15,
        "dvp": "on"
      },
      "cal": [
        -0.447,
        1.0348
      ]
    }
  },
  "nfl": {
    "Pass Attempts": {
      "recommendation": "keep_current",
      "is_current": true,
      "knobs": {
        "weights": "live",
        "windows": "live",
        "recent_cap": 10
      },
      "cal": [
        15.0653,
        0.5
      ]
    },
    "Pass Completions": {
      "recommendation": "keep_current",
      "is_current": true,
      "knobs": {
        "weights": "live",
        "windows": "live",
        "recent_cap": 10
      },
      "cal": [
        8.7755,
        0.5611
      ]
    },
    "Pass+Rush Yds": {
      "recommendation": "candidate",
      "is_current": true,
      "knobs": {
        "weights": "live",
        "windows": "live",
        "recent_cap": 10
      },
      "cal": [
        109.1814,
        0.5424
      ]
    },
    "Pass Yards": {
      "recommendation": "candidate",
      "is_current": true,
      "knobs": {
        "weights": "live",
        "windows": "live",
        "recent_cap": 10
      },
      "cal": [
        99.4568,
        0.547
      ]
    },
    "Rec Targets": {
      "recommendation": "candidate",
      "is_current": true,
      "knobs": {
        "weights": "live",
        "windows": "live",
        "recent_cap": 10
      },
      "cal": [
        0.3888,
        0.8481
      ]
    },
    "Receiving Yards": {
      "recommendation": "candidate",
      "is_current": false,
      "knobs": {
        "weights": "long_heavy",
        "windows": "live",
        "recent_cap": 15
      },
      "cal": [
        0.7672,
        0.8528
      ]
    },
    "Receptions": {
      "recommendation": "candidate",
      "is_current": true,
      "knobs": {
        "weights": "live",
        "windows": "live",
        "recent_cap": 10
      },
      "cal": [
        0.3103,
        0.8215
      ]
    },
    "Rush Attempts": {
      "recommendation": "keep_current",
      "is_current": true,
      "knobs": {
        "weights": "live",
        "windows": "live",
        "recent_cap": 10
      },
      "cal": [
        0.1503,
        0.9357
      ]
    },
    "Rush+Rec Yds": {
      "recommendation": "candidate",
      "is_current": true,
      "knobs": {
        "weights": "live",
        "windows": "live",
        "recent_cap": 10
      },
      "cal": [
        3.8716,
        0.8667
      ]
    },
    "Rush Yards": {
      "recommendation": "candidate",
      "is_current": true,
      "knobs": {
        "weights": "live",
        "windows": "live",
        "recent_cap": 10
      },
      "cal": [
        5.858,
        0.7909
      ]
    }
  }
}

function usesTuned(row, params) {
  if (!params || params.recommendation !== 'candidate') return false
  if (typeof row?.formula_applied === 'boolean') return row.formula_applied
  if (row?.formula_mode === 'current') return false
  if (row?.formula_mode === 'tuned') return true
  return FORMULA_MODE === 'tuned'
}

function formClamp(name) {
  if (name === 'off' || name == null) return null
  if (name === 'narrow') return [0.95, 1.05]
  return [0.9, 1.1]
}

function pitcherSpec(stat, params, tuned) {
  const previous = PREVIOUS_PITCHER[stat]
  if (!previous) return null
  if (!tuned) return { ...previous, longWindow: 'all starts' }
  const knobs = params.knobs || {}
  const opponent = Number(knobs.opp_mult) === 0 ? null : previous.opponent
  return {
    ...previous,
    weights: PITCHER_WEIGHTS[knobs.weights] || previous.weights,
    shrink: Number(knobs.shrink_games) || previous.shrink,
    form: formClamp(knobs.form),
    opponent,
    cal: params.cal,
    longWindow: 'all starts',
  }
}

function hrrSpec(params, tuned) {
  if (!tuned) {
    return {
      kind: 'hrr',
      paWeights: HRR_PA.live,
      rateWeights: HRR_RATE.live,
      opponent: 'published',
      park: true,
      split: true,
      pitcher: true,
      cal: null,
    }
  }
  const knobs = params.knobs || {}
  return {
    kind: 'hrr',
    paWeights: HRR_PA[knobs.pa_weights] || HRR_PA.live,
    rateWeights: HRR_RATE[knobs.rate_weights] || HRR_RATE.live,
    opponent: knobs.opp === 'off' ? null : (knobs.opp || 'published'),
    park: Boolean(knobs.park),
    split: Boolean(knobs.split),
    pitcher: Boolean(knobs.pitcher),
    cal: params.cal,
  }
}

function fantasySpec(params, tuned) {
  return {
    kind: 'fantasy',
    paWeights: HRR_PA.live,
    rateWeights: HRR_RATE.live,
    park: true,
    split: true,
    pitcher: true,
    opponent: 'published',
    cal: tuned ? params.cal : null,
  }
}

function totalBasesSpec() {
  return {
    kind: 'tb',
    park: true,
    split: true,
    pitcher: true,
    opponent: 'tb',
    cal: null,
  }
}

function wnbaSpec(stat, params, tuned) {
  const pieces = WNBA_PIECES[stat]
  if (!pieces) return null
  const base = tuned
    ? {
      windows: WNBA_WINDOWS[params.knobs.windows] || PREVIOUS_WNBA.windows,
      weights: WNBA_WEIGHTS[params.knobs.window_weights] || PREVIOUS_WNBA.weights,
      minutes: Number(params.knobs.minutes_window) || PREVIOUS_WNBA.minutes,
      dvp: params.knobs.dvp || 'off',
      cal: params.cal,
    }
    : { ...PREVIOUS_WNBA }
  return { kind: 'wnba', pieces, ...base }
}

function nflSpec(params, tuned) {
  if (!tuned) return { kind: 'nfl', ...PREVIOUS_NFL }
  if (params.is_current) return { kind: 'nfl', ...PREVIOUS_NFL, cal: params.cal }
  const knobs = params.knobs || {}
  return {
    kind: 'nfl',
    windows: NFL_WINDOWS[knobs.windows] || PREVIOUS_NFL.windows,
    weights: NFL_WEIGHTS[knobs.weights] || PREVIOUS_NFL.weights,
    cap: Number(knobs.recent_cap) || PREVIOUS_NFL.cap,
    cal: params.cal,
  }
}

export function sportOf(row) {
  if (row?.sport) return String(row.sport).toLowerCase()
  const prop = row?.prop || row?.stat
  if (prop && PUBLISHED_PARAMS.kbo[prop]) return 'kbo'
  if (prop && PUBLISHED_PARAMS.nfl[prop]) return 'nfl'
  if (prop && PUBLISHED_PARAMS.wnba[prop]) return 'wnba'
  return null
}

export function resolveSpec(row) {
  const sport = sportOf(row)
  const prop = row?.prop || row?.stat
  const params = sport && prop ? PUBLISHED_PARAMS[sport]?.[prop] : null
  if (!params) return null
  const tuned = usesTuned(row, params)
  if (sport === 'kbo' && PREVIOUS_PITCHER[prop]) return pitcherSpec(prop, params, tuned)
  if (sport === 'kbo' && prop === 'Hits+Runs+RBIs') return hrrSpec(params, tuned)
  if (sport === 'kbo' && prop === 'Fantasy Score') return fantasySpec(params, tuned)
  if (sport === 'kbo' && prop === 'Total Bases') return totalBasesSpec()
  if (sport === 'wnba') return wnbaSpec(prop, params, tuned)
  if (sport === 'nfl') return nflSpec(params, tuned)
  return null
}
