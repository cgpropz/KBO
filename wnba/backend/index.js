const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const { promisify } = require('util');
const cheerio = require('cheerio');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5050;
const execFileAsync = promisify(execFile);

app.use(cors());
app.use(express.json());

// ── Root paths ────────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');

// ── PrizePicks stat key mapping ───────────────────────────────────────────────
const PP_STAT_MAP = {
  'Points': 'pts', 'Rebounds': 'reb', 'Assists': 'ast',
  '3-PT Made': 'fg3m', '3-PT Attempted': 'fg3a',
  'Steals': 'stl', 'Blocks': 'blk', 'Blocked Shots': 'blk',
  'FG Made': 'fgm', 'FG Attempted': 'fga',
  'Two Pointers Made': 'fg2m', 'Two Pointers Attempted': 'fg2a',
  'Free Throws Made': 'ftm', 'Free Throws Attempted': 'fta',
  'Turnovers': 'tov', 'Offensive Rebounds': 'oreb', 'Defensive Rebounds': 'dreb',
  'Fantasy Score': 'fantasy',
  'Pts+Asts': 'ptsAst', 'Pts+Rebs': 'ptsReb', 'Pts+Rebs+Asts': 'ptsRebAst',
  'Rebs+Asts': 'rebAst', 'Reb+Asts': 'rebAst',
  'Blks+Stls': 'blkStl',
  'Double-Double': 'doubleDouble', 'Triple-Double': 'tripleDouble',
};

// ── PrizePicks cache (5-min TTL) ──────────────────────────────────────────────
const ppCache = new Map();
const ppInFlight = new Map();
const PYTHON_BIN = process.env.PYTHON_BIN || path.join(ROOT, 'venv', 'bin', 'python');
const PP_SCRIPT = path.join(ROOT, 'wnba-pp-odds.py');
const PP_SNAPSHOT_DIR = path.join(ROOT, 'downloaded_files');

function ppSnapshotPath(oddsType) {
  return path.join(PP_SNAPSHOT_DIR, `prizepicks_${normalizeOddsType(oddsType)}.json`);
}

function loadPrizePicksSnapshot(oddsType) {
  try {
    const payload = JSON.parse(fs.readFileSync(ppSnapshotPath(oddsType), 'utf8'));
    if (!payload || typeof payload !== 'object' || !Object.keys(payload).length) return null;
    // Reject snapshots from a prior calendar date (ET) so stale files never persist across days.
    const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const firstPlayer = Object.values(payload)[0];
    const props = firstPlayer?.__allProps;
    if (Array.isArray(props) && props.length) {
      const snapshotDate = props[0]?.gameDate;
      if (snapshotDate && snapshotDate !== todayET) return null;
    }
    return payload;
  } catch {}
  return null;
}

function savePrizePicksSnapshot(oddsType, lines) {
  try {
    fs.mkdirSync(PP_SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(ppSnapshotPath(oddsType), JSON.stringify(lines));
  } catch {}
}

function normalizeOddsType(oddsType) {
  const value = String(oddsType || 'standard').toLowerCase();
  return ['standard', 'demon', 'goblin', 'all'].includes(value) ? value : 'standard';
}

function parseOpponentFromVersus(versusText) {
  const cleaned = String(versusText || '').trim();
  if (!cleaned) return null;
  const match = cleaned.toUpperCase().match(/([A-Z]{2,4})\s*$/);
  return match ? match[1] : null;
}

const EXCLUDED_PP_PROPS = new Set(['Points - 1st 3 Minutes']);
const BASE_PROJECTION_STATS = [
  'pts', 'reb', 'ast',
  'fgm', 'fga', 'fg2m', 'fg2a', 'fg3m', 'fg3a',
  'ftm', 'fta',
  'stl', 'blk', 'tov', 'oreb', 'dreb', 'fantasy',
];

function calcFantasyScore(stats) {
  const pts = stats?.pts ?? 0;
  const reb = stats?.reb ?? 0;
  const ast = stats?.ast ?? 0;
  const stl = stats?.stl ?? 0;
  const blk = stats?.blk ?? 0;
  const tov = stats?.tov ?? 0;
  return pts + (reb * 1.2) + (ast * 1.5) + (stl * 3) + (blk * 3) - tov;
}

function isDoubleDoubleGame(game) {
  const cats = [game?.pts ?? 0, game?.reb ?? 0, game?.ast ?? 0, game?.stl ?? 0, game?.blk ?? 0];
  return cats.filter(v => v >= 10).length >= 2;
}

function isTripleDoubleGame(game) {
  const cats = [game?.pts ?? 0, game?.reb ?? 0, game?.ast ?? 0, game?.stl ?? 0, game?.blk ?? 0];
  return cats.filter(v => v >= 10).length >= 3;
}

function statValueByLabel(game, label) {
  switch (label) {
    case 'Points': return game?.pts ?? 0;
    case 'Rebounds': return game?.reb ?? 0;
    case 'Assists': return game?.ast ?? 0;
    case 'FG Made': return game?.fgm ?? 0;
    case 'FG Attempted': return game?.fga ?? 0;
    case 'Two Pointers Made': return game?.fg2m ?? 0;
    case 'Two Pointers Attempted': return game?.fg2a ?? 0;
    case '3-PT Made': return game?.fg3m ?? 0;
    case '3-PT Attempted': return game?.fg3a ?? 0;
    case 'Free Throws Made': return game?.ftm ?? 0;
    case 'Free Throws Attempted': return game?.fta ?? 0;
    case 'Steals': return game?.stl ?? 0;
    case 'Blocks': return game?.blk ?? 0;
    case 'Blocked Shots': return game?.blk ?? 0;
    case 'Blks+Stls': return (game?.blk ?? 0) + (game?.stl ?? 0);
    case 'Turnovers': return game?.tov ?? 0;
    case 'Offensive Rebounds': return game?.oreb ?? 0;
    case 'Defensive Rebounds': return game?.dreb ?? 0;
    case 'Fantasy Score': return game?.fantasy ?? calcFantasyScore(game);
    case 'Reb+Asts':
    case 'Rebs+Asts': return (game?.reb ?? 0) + (game?.ast ?? 0);
    case 'Pts+Rebs': return (game?.pts ?? 0) + (game?.reb ?? 0);
    case 'Pts+Asts': return (game?.pts ?? 0) + (game?.ast ?? 0);
    case 'Pts+Rebs+Asts': return (game?.pts ?? 0) + (game?.reb ?? 0) + (game?.ast ?? 0);
    case 'Double-Double': return isDoubleDoubleGame(game) ? 1 : 0;
    case 'Triple-Double': return isTripleDoubleGame(game) ? 1 : 0;
    default: return null;
  }
}

function windowRate(games, predicate, n) {
  const slice = games.slice(0, n);
  if (!slice.length) return 0;
  const hits = slice.filter(predicate).length;
  return hits / slice.length;
}

function buildProjectionBundle(games, avgMins, dvpFactor) {
  const ppmData = {};
  for (const stat of BASE_PROJECTION_STATS) {
    ppmData[stat] = {
      L3: ppmWindow(games, stat, 3),
      L7: ppmWindow(games, stat, 7),
      L15: ppmWindow(games, stat, 15),
    };
  }

  const base = {};
  for (const stat of BASE_PROJECTION_STATS) {
    const { L3, L7, L15 } = ppmData[stat];
    base[stat] = parseFloat(((L3 * 0.5 + L7 * 0.3 + L15 * 0.2) * avgMins * dvpFactor).toFixed(2));
  }

  const combo = {
    rebAst: parseFloat((base.reb + base.ast).toFixed(2)),
    ptsReb: parseFloat((base.pts + base.reb).toFixed(2)),
    ptsAst: parseFloat((base.pts + base.ast).toFixed(2)),
    ptsRebAst: parseFloat((base.pts + base.reb + base.ast).toFixed(2)),
    blkStl: parseFloat((base.blk + base.stl).toFixed(2)),
  };

  const binary = {
    doubleDouble: parseFloat(((windowRate(games, isDoubleDoubleGame, 3) * 0.5) + (windowRate(games, isDoubleDoubleGame, 7) * 0.3) + (windowRate(games, isDoubleDoubleGame, 15) * 0.2)).toFixed(3)),
    tripleDouble: parseFloat(((windowRate(games, isTripleDoubleGame, 3) * 0.5) + (windowRate(games, isTripleDoubleGame, 7) * 0.3) + (windowRate(games, isTripleDoubleGame, 15) * 0.2)).toFixed(3)),
  };

  return { ppmData, base, combo, binary };
}

function projectionByStatLabel(label, bundle) {
  if (!bundle) return null;
  switch (label) {
    case 'Points': return bundle.base.pts;
    case 'Rebounds': return bundle.base.reb;
    case 'Assists': return bundle.base.ast;
    case 'FG Made': return bundle.base.fgm;
    case 'FG Attempted': return bundle.base.fga;
    case 'Two Pointers Made': return bundle.base.fg2m;
    case 'Two Pointers Attempted': return bundle.base.fg2a;
    case '3-PT Made': return bundle.base.fg3m;
    case '3-PT Attempted': return bundle.base.fg3a;
    case 'Free Throws Made': return bundle.base.ftm;
    case 'Free Throws Attempted': return bundle.base.fta;
    case 'Steals': return bundle.base.stl;
    case 'Blocks': return bundle.base.blk;
    case 'Blocked Shots': return bundle.base.blk;
    case 'Turnovers': return bundle.base.tov;
    case 'Offensive Rebounds': return bundle.base.oreb;
    case 'Defensive Rebounds': return bundle.base.dreb;
    case 'Blks+Stls': return bundle.combo.blkStl;
    case 'Fantasy Score': return bundle.base.fantasy;
    case 'Reb+Asts':
    case 'Rebs+Asts': return bundle.combo.rebAst;
    case 'Pts+Rebs': return bundle.combo.ptsReb;
    case 'Pts+Asts': return bundle.combo.ptsAst;
    case 'Pts+Rebs+Asts': return bundle.combo.ptsRebAst;
    case 'Double-Double': return bundle.binary.doubleDouble;
    case 'Triple-Double': return bundle.binary.tripleDouble;
    default: return null;
  }
}

function seasonAvgForLabel(games, label) {
  if (!games.length) return null;
  const values = games.map(g => statValueByLabel(g, label)).filter(v => v != null);
  if (!values.length) return null;
  return parseFloat((values.reduce((s, v) => s + v, 0) / values.length).toFixed(2));
}

function hitRateForLabel(games, label, line, n) {
  const slice = n != null ? games.slice(0, n) : games;
  if (!slice.length) return null;
  const hits = slice.filter(g => {
    const v = statValueByLabel(g, label);
    return v != null && v > line;
  }).length;
  return parseFloat(((hits / slice.length) * 100).toFixed(1));
}

function rowsToLines(rows) {
  const lines = {};
  (rows || []).forEach(row => {
    if (row.League !== 'WNBA' || !row.Name || !row.Stat) return;
    const line = parseFloat(row.Prizepicks);
    if (Number.isNaN(line)) return;
    const name = String(row.Name).replace(/\+/g, '').trim();
    if (!lines[name]) lines[name] = { __allProps: {} };

    const statLabel = String(row.Stat).trim();
    if (EXCLUDED_PP_PROPS.has(statLabel)) return;
    const versus = String(row.Versus || '').trim() || null;
    const gameDate = String(row.GameDate || '').trim() || null;
    lines[name].__allProps[statLabel] = {
      line,
      versus,
      opponent: parseOpponentFromVersus(versus),
      gameDate,
    };

    const statKey = PP_STAT_MAP[statLabel];
    if (statKey) {
      lines[name][statKey] = line;
    }
  });

  Object.values(lines).forEach(playerLines => {
    const allPropsMap = playerLines.__allProps || {};
    playerLines.__allProps = Object.entries(allPropsMap)
      .map(([stat, info]) => ({
        stat,
        line: info?.line ?? null,
        versus: info?.versus ?? null,
        opponent: info?.opponent ?? null,
        gameDate: info?.gameDate ?? null,
      }))
      .sort((a, b) => a.stat.localeCompare(b.stat));
  });

  return lines;
}

async function fetchPrizePicks(oddsType = 'standard') {
  const normalized = normalizeOddsType(oddsType);
  const now = Date.now();
  const cached = ppCache.get(normalized);
  if (cached && now - cached.ts < 5 * 60 * 1000) return cached.data;
  if (ppInFlight.has(normalized)) return ppInFlight.get(normalized);
  const snapshot = loadPrizePicksSnapshot(normalized);
  if (snapshot && Object.keys(snapshot).length) {
    ppCache.set(normalized, { data: snapshot, ts: now });
    return snapshot;
  }

  const scrapePromise = (async () => {
    try {
      const { stdout } = await execFileAsync(
        PYTHON_BIN,
        [PP_SCRIPT, '--json', '--odds-type', normalized],
        { maxBuffer: 10 * 1024 * 1024 }
      );
      const rows = stdout ? JSON.parse(stdout) : [];
      const lines = rowsToLines(rows);
      if (!Object.keys(lines).length) {
        // Keep serving previous data if scraper returns empty payload.
        if (cached?.data && Object.keys(cached.data).length) return cached.data;
        const snapshot = loadPrizePicksSnapshot(normalized);
        if (snapshot) {
          ppCache.set(normalized, { data: snapshot, ts: now });
          return snapshot;
        }
        // Brief cooldown to avoid hammering on repeated empty responses.
        ppCache.set(normalized, { data: {}, ts: now });
        return {};
      }
      ppCache.set(normalized, { data: lines, ts: now });
      savePrizePicksSnapshot(normalized, lines);
      return lines;
    } catch (err) {
      console.error('PrizePicks scrape failed:', err.message);
      // Fall back to stale in-memory cache.
      if (cached?.data && Object.keys(cached.data).length) return cached.data;
      // Fall back to persisted snapshot so restarts still have data.
      const snapshot = loadPrizePicksSnapshot(normalized);
      if (snapshot) {
        ppCache.set(normalized, { data: snapshot, ts: now });
        return snapshot;
      }
      // Avoid immediate re-scrape loops when rate limited.
      ppCache.set(normalized, { data: {}, ts: now });
      return {};
    } finally {
      ppInFlight.delete(normalized);
    }
  })();

  ppInFlight.set(normalized, scrapePromise);
  return scrapePromise;
}

// ── CSV reader (returns promise) ──────────────────────────────────────────────
function readCsv(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) return resolve([]);
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', d => results.push(d))
      .on('end', () => resolve(results))
      .on('error', err => reject(err));
  });
}

// ── Load static mappings ──────────────────────────────────────────────────────
function loadJson(relPath) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8')); }
  catch { return {}; }
}

let playerPositions = loadJson('mappings/player_positions.json');
let teamMappings    = loadJson('mappings/team_mappings.json');
let teamLogos       = loadJson('mappings/team_logos.json');
let playerImages    = loadJson('mappings/player_images.json');

const TEAM_ALIASES = Object.entries(teamMappings).reduce((acc, [abbr, info]) => {
  acc[abbr.toUpperCase()] = abbr;
  if (info?.fullName) acc[String(info.fullName).toUpperCase()] = abbr;
  return acc;
}, {});

Object.assign(TEAM_ALIASES, {
  'TORONTO TEMPO': 'TOR',
  TOR: 'TOR',
  'PORTLAND FIRE': 'PDX',
  PDX: 'PDX',
  POR: 'PDX',
  'WASHINGTON MYSTICS': 'WAS',
  WAS: 'WAS',
  WSH: 'WAS',
});

function normalizeTeamAbbr(teamValue) {
  const raw = String(teamValue || '').trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  return TEAM_ALIASES[upper] || upper;
}

function buildAvatarDataUrl(name, color = '#FF6900') {
  const initials = String(name || '')
    .split(' ')
    .map(part => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.95" />
          <stop offset="100%" stop-color="#111111" stop-opacity="1" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="64" fill="url(#g)" />
      <circle cx="64" cy="64" r="54" fill="rgba(255,255,255,0.06)" />
      <text x="64" y="74" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="40" font-weight="700" fill="#ffffff">${initials}</text>
    </svg>
  `.trim()
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

// ── Normalise a gamelog row to a common shape ─────────────────────────────────
function normalizeRow(row, src) {
  if (src === 'gamelog') {
    const pts = parseFloat(row.PTS) || 0;
    const reb = parseFloat(row.REB) || 0;
    const ast = parseFloat(row.AST) || 0;
    const stl = parseFloat(row.STL) || 0;
    const blk = parseFloat(row.BLK) || 0;
    const tov = parseFloat(row.TOV) || 0;
    const oreb = parseFloat(row.OREB) || 0;
    const dreb = parseFloat(row.DREB) || 0;
    const fgm = parseFloat(row.FGM) || 0;
    const fga = parseFloat(row.FGA) || 0;
    const fg3m = parseFloat(row.FG3M) || 0;
    const fg3a = parseFloat(row.FG3A) || 0;
    const ftm = parseFloat(row.FTM) || 0;
    const fta = parseFloat(row.FTA) || 0;
    const fantasy = parseFloat(row.WNBA_FANTASY_PTS || row.NBA_FANTASY_PTS) || calcFantasyScore({ pts, reb, ast, stl, blk, tov });
    return {
      player:  (row.PLAYER_NAME        || '').trim(),
      date:     row.GAME_DATE          || '',
      team:     row.TEAM_ABBREVIATION  || '',
      matchup:  row.MATCHUP            || '',
      min:  parseFloat(row.MIN)        || 0,
      pts,
      reb,
      ast,
      fgm,
      fga,
      fg3m,
      fg3a,
      fg2m: Math.max(fgm - fg3m, 0),
      fg2a: Math.max(fga - fg3a, 0),
      ftm,
      fta,
      stl,
      blk,
      tov,
      oreb,
      dreb,
      fantasy,
    };
  }
  const pts = parseFloat(row.PTS) || 0;
  const reb = parseFloat(row.REB) || 0;
  const ast = parseFloat(row.AST) || 0;
  const stl = parseFloat(row.STL) || 0;
  const blk = parseFloat(row.BLK) || 0;
  const tov = parseFloat(row.TOV) || 0;
  const oreb = parseFloat(row.OREB) || 0;
  const dreb = parseFloat(row.DREB) || 0;
  const fgm = parseFloat(row.FGM) || 0;
  const fga = parseFloat(row.FGA) || 0;
  const fg3m = parseFloat(row['3PM']) || 0;
  const fg3a = parseFloat(row['3PA']) || 0;
  const ftm = parseFloat(row.FTM) || 0;
  const fta = parseFloat(row.FTA) || 0;
  const fantasy = parseFloat(row.WNBA_FANTASY_PTS || row.NBA_FANTASY_PTS) || calcFantasyScore({ pts, reb, ast, stl, blk, tov });
  return {
    player:  (row.Player              || '').trim(),
    date:     row['Game Date']        || '',
    team:     row.Team                || '',
    matchup:  row['Match Up']         || '',
    min:  parseFloat(row.MIN)         || 0,
    pts,
    reb,
    ast,
    fgm,
    fga,
    fg3m,
    fg3a,
    fg2m: Math.max(fgm - fg3m, 0),
    fg2a: Math.max(fga - fg3a, 0),
    ftm,
    fta,
    stl,
    blk,
    tov,
    oreb,
    dreb,
    fantasy,
  };
}

// ── Canonicalise a game date (ISO or M/D/YYYY) to YYYY-MM-DD ──────────────────
// The two gamelog CSVs store dates in different formats (the stats-API gamelog
// uses "2026-07-15T00:00:00", the scraped boxscores use "07/15/2026"). Reducing
// both to a canonical calendar date lets the same game from either source dedupe
// against each other and sort correctly.
function canonicalGameDate(value) {
  const raw = String(value || '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString().slice(0, 10);
}

// ── Merge + dedupe both gamelog CSVs, sorted newest-first ────────────────────
async function getAllGamelogs() {
  const [bs, gl] = await Promise.all([
    readCsv(path.join(ROOT, 'wnba_boxscores_2025_2026.csv')),
    readCsv(path.join(ROOT, 'WNBA_Gamelog_Data.csv')),
  ]);

  const rows = [
    ...bs.map(r => normalizeRow(r, 'boxscore')),
    ...gl.map(r => normalizeRow(r, 'gamelog')),
  ].filter(r => r.player && r.date);

  const seen = new Set();
  const deduped = rows.filter(r => {
    // The WNBA API boxscore data is listed first and wins when a legacy
    // gamelog row represents the same player game in a different date format.
    const key = `${r.player.toLowerCase()}|${canonicalGameDate(r.date)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => canonicalGameDate(b.date).localeCompare(canonicalGameDate(a.date)));
  return deduped;
}

// ── Per-minute rate over last N games ────────────────────────────────────────
function ppmWindow(games, stat, n) {
  const slice = games.slice(0, n);
  if (!slice.length) return 0;
  const totalMin  = slice.reduce((s, g) => s + g.min, 0);
  const totalStat = slice.reduce((s, g) => s + (g[stat] ?? 0), 0);
  return totalMin > 0 ? totalStat / totalMin : 0;
}

// ── Build DVP lookup for a position ──────────────────────────────────────────
const DVP_FILES = {
  Guard:   path.join(ROOT, 'wnbaGUARDdvp.csv'),
  Forward: path.join(ROOT, 'wnbaFORWARDdvp.csv'),
  Center:  path.join(ROOT, 'wnbaCENTERdvp.csv'),
};

// DVP is a matchup nudge, not a full-stat multiplier. The raw OPP PTS values in the
// position DVP files are volume-based and very noisy (e.g. a team can show 27.4 vs a
// 14.3 league average), which would otherwise nearly double a player's projection.
// Clamp the factor to a realistic matchup band so one noisy row can't blow up the math.
const DVP_FACTOR_MIN = 0.85;
const DVP_FACTOR_MAX = 1.15;

function clampDvpFactor(factor) {
  if (!Number.isFinite(factor) || factor <= 0) return 1;
  return Math.min(DVP_FACTOR_MAX, Math.max(DVP_FACTOR_MIN, factor));
}

async function buildDvpMap(position) {
  const rows = await readCsv(DVP_FILES[position] || '');
  const oppPts = rows.map(r => parseFloat(r['OPP PTS'] || 0)).filter(v => v > 0);
  const avg = oppPts.length ? oppPts.reduce((s, v) => s + v, 0) / oppPts.length : 1;
  const map = {};
  rows.forEach(r => {
    const team = normalizeTeamAbbr(r.TEAM || r.Team);
    if (!team) return;
    const raw = avg > 0 ? parseFloat(r['OPP PTS'] || 0) / avg : 1;
    map[team] = clampDvpFactor(raw);
  });
  return { map, avg, rows };
}

// ═════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═════════════════════════════════════════════════════════════════════════════

app.get('/', (_, res) => res.json({ api: 'WNBA Projections v2', status: 'ok' }));

// GET /api/players — merged bio + positions + images + team info
app.get('/api/players', async (req, res) => {
  try {
    const bio = await readCsv(path.join(ROOT, 'wnba_bio_2025.csv'));
    const players = bio.map(p => {
      const name = (p.Player || p.player || '').trim();
      const team = (p.Team   || p.team   || '').trim();
      const teamColor = teamMappings[team]?.color || '#FF6900';
      return {
        name,
        team,
        teamFull:  teamMappings[team]?.fullName || team,
        teamColor,
        teamLogo:  teamLogos[team]   || null,
        position:  playerPositions[name] || 'N/A',
        image:     playerImages[name]    || buildAvatarDataUrl(name, teamColor),
        age:    p.Age     || '',
        height: p.Height  || '',
        weight: p.Weight  || '',
        college: p.College || '',
        country: p.Country || '',
        gp:  p.GP  || '',
        pts: p.PTS || '',
        reb: p.REB || '',
        ast: p.AST || '',
        usg: p['USG%'] || '',
        ts:  p['TS%']  || '',
        netRtg: p.NetRtg || '',
      };
    });
    res.json(players);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/teams
app.get('/api/teams', (_, res) => {
  const teams = Object.entries(teamMappings).map(([abbr, info]) => ({
    abbr, ...info, logo: teamLogos[abbr] || null,
  }));
  res.json(teams);
});

// GET /api/gamelogs/:playerName — all games newest-first
app.get('/api/gamelogs/:playerName', async (req, res) => {
  try {
    const name  = decodeURIComponent(req.params.playerName).trim().toLowerCase();
    const all   = await getAllGamelogs();
    res.json(all.filter(g => g.player.toLowerCase() === name));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/players/:playerName/ppm — L3/L7/L15 PPM windows
app.get('/api/players/:playerName/ppm', async (req, res) => {
  try {
    const name  = decodeURIComponent(req.params.playerName).trim().toLowerCase();
    const all   = await getAllGamelogs();
    const games = all.filter(g => g.player.toLowerCase() === name);

    const STATS = ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk', 'tov', 'oreb', 'dreb', 'fantasy'];
    const ppm = {};
    for (const stat of STATS) {
      ppm[stat] = {
        L3:  parseFloat(ppmWindow(games, stat,  3).toFixed(6)),
        L7:  parseFloat(ppmWindow(games, stat,  7).toFixed(6)),
        L15: parseFloat(ppmWindow(games, stat, 15).toFixed(6)),
      };
    }

    const last10  = games.slice(0, 10);
    const avgMins = last10.length
      ? last10.reduce((s, g) => s + g.min, 0) / last10.length : 0;

    res.json({
      player:      req.params.playerName,
      games:       games.length,
      avgMins:     parseFloat(avgMins.toFixed(2)),
      ppm,
      recentGames: games.slice(0, 15),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/dvp/:position — DVP data (guard | forward | center)
app.get('/api/dvp/:position', async (req, res) => {
  try {
    const pos = req.params.position.charAt(0).toUpperCase() +
                req.params.position.slice(1).toLowerCase();
    if (!DVP_FILES[pos]) {
      return res.status(400).json({ error: 'Invalid position. Use guard, forward, or center.' });
    }
    const { map, avg, rows } = await buildDvpMap(pos);
    const teams = rows.map(r => {
      const team = normalizeTeamAbbr(r.TEAM || r.Team);
      return {
        team,
        teamFull: (r.TEAM || r.Team || '').trim(),
        gp:        r.GP || '',
        oppPts:    parseFloat(r['OPP PTS'] || 0),
        oppReb:    parseFloat(r['OPP REB'] || 0),
        oppAst:    parseFloat(r['OPP AST'] || 0),
        dvpFactor: parseFloat((map[team] || 1).toFixed(4)),
      };
    }).sort((a, b) => b.dvpFactor - a.dvpFactor);

    res.json({ position: pos, leagueAvgOppPts: parseFloat(avg.toFixed(2)), teams });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/projections/v2 — weighted formula projections
app.get('/api/projections/v2', async (req, res) => {
  try {
    const lineType = normalizeOddsType(req.query.lineType);
    const ppLinesPromise = fetchPrizePicks(lineType);
    const ppStandardPromise = lineType === 'standard' ? ppLinesPromise : fetchPrizePicks('standard');
    const [bio, all, gDvp, fDvp, cDvp, ppLines, ppStandardLines, spreads] = await Promise.all([
      readCsv(path.join(ROOT, 'wnba_bio_2025.csv')),
      getAllGamelogs(),
      buildDvpMap('Guard'),
      buildDvpMap('Forward'),
      buildDvpMap('Center'),
      ppLinesPromise,
      ppStandardPromise,
      fetchSpreads(),
    ]);

    const dvpMaps = { Guard: gDvp.map, Forward: fDvp.map, Center: cDvp.map };
    const STATS = BASE_PROJECTION_STATS;

    const projections = bio.map(p => {
      const name     = (p.Player || p.player || '').trim();
      const team     = (p.Team   || p.team   || '').trim();
      const position = playerPositions[name] || 'Guard';
      const ppPlayer = ppLines[name] || {};
      const ppStandardPlayer = ppStandardLines[name] || {};
      const dvpOpponent = normalizeTeamAbbr(
        (ppPlayer.__allProps || []).find(prop => prop?.opponent)?.opponent
      );
      const games    = all.filter(g => g.player.toLowerCase() === name.toLowerCase());
      const playerProps = (ppPlayer.__allProps || []).filter(prop => !EXCLUDED_PP_PROPS.has(prop?.stat));
      const standardProps = (ppStandardPlayer.__allProps || []).filter(prop => !EXCLUDED_PP_PROPS.has(prop?.stat));
      const standardLineForStat = statLabel => (
        standardProps.find(prop => prop?.stat === statLabel)?.line ?? null
      );

      if (!games.length) {
        return {
          name, team,
          teamFull:  teamMappings[team]?.fullName || team,
          teamColor: teamMappings[team]?.color    || '#FF6900',
          position,  image: playerImages[name] || null,
          dvpOpponent,
          spread: spreads[team] ?? null,
          gp: 0, avgMins: 0, dvpFactor: 1,
          projPts: 0, projReb: 0, projAst: 0, projFg3m: 0,
          l3ppm: {}, l7ppm: {}, l15ppm: {},
          recentGames: [],
          ppAllProps: playerProps.map(prop => ({
            ...prop,
            standardLine: standardLineForStat(prop.stat),
            projection: null,
            rating: null,
          })),
        };
      }

      const last10    = games.slice(0, 10);
      const avgMins   = last10.reduce((s, g) => s + g.min, 0) / last10.length;
      const dvpFactor = dvpOpponent ? (dvpMaps[position]?.[dvpOpponent] ?? 1) : 1;

      const bundle = buildProjectionBundle(games, avgMins, dvpFactor);
      const rateForLabel = label => {
        const line = standardLineForStat(label);
        const proj = projectionByStatLabel(label, bundle);
        if (!line || line === 0 || proj == null) return null;
        return parseFloat(((proj / line) * 50).toFixed(1));
      };

      return {
        name, team,
        teamFull:  teamMappings[team]?.fullName || team,
        teamColor: teamMappings[team]?.color    || '#FF6900',
        position,  image: playerImages[name] || null,
        gp:        games.length,
        avgMins:   parseFloat(avgMins.toFixed(1)),
        dvpOpponent,
        spread: spreads[team] ?? null,
        dvpFactor: parseFloat(dvpFactor.toFixed(3)),
        projPts:   bundle.base.pts,
        projReb:   bundle.base.reb,
        projAst:   bundle.base.ast,
        projFg3m:  bundle.base.fg3m,
        projStl:   bundle.base.stl,
        projBlk:   bundle.base.blk,
        projTov:   bundle.base.tov,
        projOreb:  bundle.base.oreb,
        projDreb:  bundle.base.dreb,
        projFantasy: bundle.base.fantasy,
        projRebAst: bundle.combo.rebAst,
        projPtsReb: bundle.combo.ptsReb,
        projPtsAst: bundle.combo.ptsAst,
        projPtsRebAst: bundle.combo.ptsRebAst,
        projDoubleDouble: bundle.binary.doubleDouble,
        projTripleDouble: bundle.binary.tripleDouble,
        l3ppm:  Object.fromEntries(STATS.map(stat => [stat, +bundle.ppmData[stat].L3.toFixed(4)])),
        l7ppm:  Object.fromEntries(STATS.map(stat => [stat, +bundle.ppmData[stat].L7.toFixed(4)])),
        l15ppm: Object.fromEntries(STATS.map(stat => [stat, +bundle.ppmData[stat].L15.toFixed(4)])),
        recentGames: last10.map(game => ({
          date: game.date,
          matchup: game.matchup,
          pts: game.pts,
          reb: game.reb,
          ast: game.ast,
          fgm: game.fgm,
          fga: game.fga,
          fg2m: game.fg2m,
          fg2a: game.fg2a,
          fg3m: game.fg3m,
          fg3a: game.fg3a,
          ftm: game.ftm,
          fta: game.fta,
          stl: game.stl,
          blk: game.blk,
          blkStl: (game.blk ?? 0) + (game.stl ?? 0),
          tov: game.tov,
          oreb: game.oreb,
          dreb: game.dreb,
          fantasy: game.fantasy,
        })),
        ppLines: {
          pts:  ppPlayer.pts  ?? null,
          reb:  ppPlayer.reb  ?? null,
          ast:  ppPlayer.ast  ?? null,
          fgm: ppPlayer.fgm ?? null,
          fga: ppPlayer.fga ?? null,
          fg2m: ppPlayer.fg2m ?? null,
          fg2a: ppPlayer.fg2a ?? null,
          fg3m: ppPlayer.fg3m ?? null,
          fg3a: ppPlayer.fg3a ?? null,
          ftm: ppPlayer.ftm ?? null,
          fta: ppPlayer.fta ?? null,
          stl:  ppPlayer.stl ?? null,
          blk:  ppPlayer.blk ?? null,
          blkStl: ppPlayer.blkStl ?? null,
          tov:  ppPlayer.tov ?? null,
          oreb: ppPlayer.oreb ?? null,
          dreb: ppPlayer.dreb ?? null,
          fantasy: ppPlayer.fantasy ?? null,
          rebAst: ppPlayer.rebAst ?? null,
          ptsReb: ppPlayer.ptsReb ?? null,
          ptsAst: ppPlayer.ptsAst ?? null,
          ptsRebAst: ppPlayer.ptsRebAst ?? null,
          doubleDouble: ppPlayer.doubleDouble ?? null,
          tripleDouble: ppPlayer.tripleDouble ?? null,
        },
        ppLinesStandard: {
          pts:  ppStandardPlayer.pts  ?? null,
          reb:  ppStandardPlayer.reb  ?? null,
          ast:  ppStandardPlayer.ast  ?? null,
          fgm: ppStandardPlayer.fgm ?? null,
          fga: ppStandardPlayer.fga ?? null,
          fg2m: ppStandardPlayer.fg2m ?? null,
          fg2a: ppStandardPlayer.fg2a ?? null,
          fg3m: ppStandardPlayer.fg3m ?? null,
          fg3a: ppStandardPlayer.fg3a ?? null,
          ftm: ppStandardPlayer.ftm ?? null,
          fta: ppStandardPlayer.fta ?? null,
          stl:  ppStandardPlayer.stl ?? null,
          blk:  ppStandardPlayer.blk ?? null,
          blkStl: ppStandardPlayer.blkStl ?? null,
          tov:  ppStandardPlayer.tov ?? null,
          oreb: ppStandardPlayer.oreb ?? null,
          dreb: ppStandardPlayer.dreb ?? null,
          fantasy: ppStandardPlayer.fantasy ?? null,
          rebAst: ppStandardPlayer.rebAst ?? null,
          ptsReb: ppStandardPlayer.ptsReb ?? null,
          ptsAst: ppStandardPlayer.ptsAst ?? null,
          ptsRebAst: ppStandardPlayer.ptsRebAst ?? null,
          doubleDouble: ppStandardPlayer.doubleDouble ?? null,
          tripleDouble: ppStandardPlayer.tripleDouble ?? null,
        },
        ppAllProps: playerProps.map(prop => {
          const projection = projectionByStatLabel(prop.stat, bundle);
          const line = prop?.line ?? null;
          const rating = (line != null && line > 0 && projection != null)
            ? parseFloat(((projection / line) * 50).toFixed(1))
            : null;
          return {
          ...prop,
          standardLine: standardLineForStat(prop.stat),
            projection,
            rating,
          };
        }),
        ppRating: {
          pts:  rateForLabel('Points'),
          reb:  rateForLabel('Rebounds'),
          ast:  rateForLabel('Assists'),
          fg3m: rateForLabel('3-PT Made'),
          stl:  rateForLabel('Steals'),
          blk:  rateForLabel('Blocks'),
          tov:  rateForLabel('Turnovers'),
          oreb: rateForLabel('Offensive Rebounds'),
          dreb: rateForLabel('Defensive Rebounds'),
          fantasy: rateForLabel('Fantasy Score'),
          rebAst: rateForLabel('Rebs+Asts'),
          ptsReb: rateForLabel('Pts+Rebs'),
          ptsAst: rateForLabel('Pts+Asts'),
          ptsRebAst: rateForLabel('Pts+Rebs+Asts'),
          doubleDouble: rateForLabel('Double-Double'),
          tripleDouble: rateForLabel('Triple-Double'),
        },
      };
    });

    projections.sort((a, b) => b.projPts - a.projPts);
    res.json(projections);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Odds API – WNBA spreads ─────────────────────────────────────────────────
const ODDS_API_KEY = 'b3573496127b5228b9c5f4d34cb06e2a';
const oddsCache = { spreads: null, ts: 0 };

const WNBA_TEAM_NAME_MAP = {
  'Atlanta Dream': 'ATL', 'Chicago Sky': 'CHI', 'Connecticut Sun': 'CON',
  'Dallas Wings': 'DAL', 'Golden State Valkyries': 'GSV', 'Indiana Fever': 'IND',
  'Las Vegas Aces': 'LVA', 'Los Angeles Sparks': 'LAS', 'Minnesota Lynx': 'MIN',
  'New York Liberty': 'NYL', 'Phoenix Mercury': 'PHX', 'Portland Fire': 'PDX',
  'Seattle Storm': 'SEA', 'Toronto Tempo': 'TOR', 'Washington Mystics': 'WAS',
};

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function fetchSpreads() {
  const now = Date.now();
  if (oddsCache.spreads && now - oddsCache.ts < 10 * 60 * 1000) return oddsCache.spreads;
  try {
    const url = `https://api.the-odds-api.com/v4/sports/basketball_wnba/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads&oddsFormat=american`;
    const games = await httpsGet(url);
    const spreadMap = {};
    for (const game of (Array.isArray(games) ? games : [])) {
      const bookmaker = game.bookmakers?.[0];
      if (!bookmaker) continue;
      const market = bookmaker.markets?.find(m => m.key === 'spreads');
      if (!market) continue;
      for (const outcome of (market.outcomes || [])) {
        const abbr = WNBA_TEAM_NAME_MAP[outcome.name] || normalizeTeamAbbr(outcome.name);
        if (abbr) spreadMap[abbr] = outcome.point;
      }
    }
    oddsCache.spreads = spreadMap;
    oddsCache.ts = now;
    return spreadMap;
  } catch (err) {
    console.error('Odds API spreads failed:', err.message);
    return oddsCache.spreads || {};
  }
}

// ── Hit-rate helpers ─────────────────────────────────────────────────────────
const PP_STAT_TO_KEY = {
  'Points': 'pts', 'Rebounds': 'reb', 'Assists': 'ast',
  '3-PT Made': 'fg3m', 'Steals': 'stl', 'Blocks': 'blk',
  'Turnovers': 'tov', 'Offensive Rebounds': 'oreb', 'Defensive Rebounds': 'dreb',
  'Fantasy Score': 'fantasy',
};

function hitRate(games, statKey, line, n) {
  const slice = n != null ? games.slice(0, n) : games;
  if (!slice.length) return null;
  const hits = slice.filter(g => (g[statKey] ?? 0) > line).length;
  return parseFloat(((hits / slice.length) * 100).toFixed(1));
}

function seasonAvg(games, statKey) {
  if (!games.length) return null;
  return parseFloat((games.reduce((s, g) => s + (g[statKey] ?? 0), 0) / games.length).toFixed(2));
}

// GET /api/edge — all active PP lines flattened, with hit rates + ratings
app.get('/api/edge', async (req, res) => {
  try {
    const [bio, all, gDvp, fDvp, cDvp, ppStandard, spreads] = await Promise.all([
      readCsv(path.join(ROOT, 'wnba_bio_2025.csv')),
      getAllGamelogs(),
      buildDvpMap('Guard'),
      buildDvpMap('Forward'),
      buildDvpMap('Center'),
      fetchPrizePicks('standard'),
      fetchSpreads(),
    ]);

    const dvpMaps  = { Guard: gDvp.map, Forward: fDvp.map, Center: cDvp.map };
    const bioByName = {};
    bio.forEach(p => { bioByName[(p.Player || '').trim().toLowerCase()] = p; });

    const rows = [];

    for (const [rawName, ppPlayer] of Object.entries(ppStandard)) {
      const props = ppPlayer.__allProps || [];
      if (!props.length) continue;
      const name     = rawName;
      const nameLow  = name.toLowerCase();
      const bioRow   = bioByName[nameLow] || {};
      const team     = normalizeTeamAbbr(bioRow.Team || bioRow.team || '') || '';
      const position = playerPositions[name] || 'Guard';
      const teamColor= teamMappings[team]?.color || '#FF6900';
      const teamFull = teamMappings[team]?.fullName || team;
      const image    = playerImages[name] || null;
      const games    = all.filter(g => g.player.toLowerCase() === nameLow);

      const last10    = games.slice(0, 10);
      const avgMins   = last10.length ? last10.reduce((s, g) => s + g.min, 0) / last10.length : 0;

      for (const prop of props) {
        const { stat: statLabel, line, opponent, gameDate } = prop;
        if (EXCLUDED_PP_PROPS.has(statLabel)) continue;
        if (line == null) continue;

        // projection (weighted PPM × mins × DVP)
        const dvpOpponent = normalizeTeamAbbr(opponent);
        const dvpFactor   = dvpOpponent ? (dvpMaps[position]?.[dvpOpponent] ?? 1) : 1;
        const bundle = buildProjectionBundle(games, avgMins, dvpFactor);
        const proj   = projectionByStatLabel(statLabel, bundle);
        if (proj == null) continue;
        const rating = line > 0 ? parseFloat(((proj / line) * 50).toFixed(1)) : null;

        rows.push({
          name, team, teamFull, teamColor, image, position,
          opponent: dvpOpponent || opponent || '',
          gameDate: gameDate || null,
          stat: statLabel,
          line,
          spread: spreads[team] ?? null,
          avgMins: parseFloat(avgMins.toFixed(1)),
          seasonAvg: seasonAvgForLabel(games, statLabel),
          l5:   hitRateForLabel(games, statLabel, line, 5),
          l10:  hitRateForLabel(games, statLabel, line, 10),
          l15:  hitRateForLabel(games, statLabel, line, 15),
          full: hitRateForLabel(games, statLabel, line, null),
          projection: proj,
          rating,
          value: rating == null ? null : rating > 50 ? 'OVER' : rating < 50 ? 'UNDER' : 'EVEN',
        });
      }
    }

    // Sort by rating descending (nulls last)
    rows.sort((a, b) => {
      if (a.rating == null && b.rating == null) return 0;
      if (a.rating == null) return 1;
      if (b.rating == null) return -1;
      return b.rating - a.rating;
    });

    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/prizepicks — live WNBA lines from PrizePicks
app.get('/api/prizepicks', async (req, res) => {
  try {
    const lines = await fetchPrizePicks(req.query.type);
    res.json(lines);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/projections — legacy endpoint
app.get('/api/projections', async (req, res) => {
  try {
    const results = await readCsv(path.join(ROOT, 'wnba_calculated_projections.csv'));
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/bio
app.get('/api/bio', async (req, res) => {
  try {
    res.json(await readCsv(path.join(ROOT, 'wnba_bio_2025.csv')));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Lineups scraper (rotowire) ────────────────────────────────────────────────
const lineupsCache = { data: null, ts: 0 };
const LINEUPS_TTL = 10 * 60 * 1000; // 10 minutes

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
      },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHtml(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Lineups fetch timeout')); });
  });
}

function parseRotowireLineups(html) {
  const $ = cheerio.load(html);
  const games = [];

  // Anchor on the parent .lineup container (which holds .lineup__meta + .lineup__box)
  // Skip the "is-tools" variant used for promo sections
  $('.lineup').not('.is-tools').each((_, container) => {
    const $c  = $(container);
    const $box = $c.find('.lineup__box').first();
    if (!$box.length) return;

    // Game time — sibling of .lineup__box inside .lineup__meta
    const gameTime = $c.find('.lineup__meta .lineup__time').first()
      .text().replace(/\s+/g, ' ').trim();

    // Team abbr lives inside .lineup__box; team name lives in .lineup__matchup (sibling)
    function parseTeamMeta(sideClass) {
      const abbr = $box.find(`.lineup__team.${sideClass} .lineup__abbr`).text().trim();
      const name = $c.find(`.lineup__matchup .lineup__mteam.${sideClass}`).text().trim();
      const canonical = normalizeTeamAbbr(abbr) || abbr;
      return { abbr: canonical, rawAbbr: abbr, name };
    }

    const visitor = parseTeamMeta('is-visit');
    const home    = parseTeamMeta('is-home');
    if (!visitor.abbr && !home.abbr) return;

    // Parse one team's list, splitting at .lineup__title.is-middle divider
    function parseList(sideClass) {
      const $list = $box.find(`.lineup__list.${sideClass}`);
      const starters = [];
      const inactive = [];
      let passedDivider = false;

      $list.children().each((_, el) => {
        const $el = $(el);
        const cls = ($el.attr('class') || '');

        if (cls.includes('lineup__title') && cls.includes('is-middle')) {
          passedDivider = true;
          return;
        }
        if (!cls.includes('lineup__player')) return;

        const name = $el.find('a').attr('title') || $el.find('a').text().trim();
        if (!name) return;

        const pos     = $el.find('.lineup__pos').text().trim();
        const injText = $el.find('.lineup__inj').text().trim().toUpperCase();
        let status = 'expected';
        if      (injText === 'OUT')                      status = 'out';
        else if (injText === 'GTD')                      status = 'gtd';
        else if (injText === 'QUES' || injText === 'Q') status = 'questionable';
        else if (cls.includes('is-pct-play-0'))          status = 'out';
        else if (cls.includes('is-pct-play-50'))         status = 'gtd';
        else if (cls.includes('is-pct-play-75'))         status = 'questionable';

        (passedDivider ? inactive : starters).push({ name, pos, status });
      });

      return { starters, inactive };
    }

    const vis = parseList('is-visit');
    const hom = parseList('is-home');

    games.push({
      gameTime,
      visitor: { ...visitor, players: vis.starters, inactive: vis.inactive },
      home:    { ...home,    players: hom.starters, inactive: hom.inactive },
    });
  });

  return games;
}

// GET /api/lineups
app.get('/api/lineups', async (req, res) => {
  const now = Date.now();
  if (lineupsCache.data && now - lineupsCache.ts < LINEUPS_TTL) {
    return res.json(lineupsCache.data);
  }
  try {
    const html  = await fetchHtml('https://www.rotowire.com/wnba/lineups.php');
    const games = parseRotowireLineups(html);
    lineupsCache.data = games;
    lineupsCache.ts   = now;
    res.json(games);
  } catch (err) {
    console.error('Lineups scrape failed:', err.message);
    // Return stale cache if available
    if (lineupsCache.data) return res.json(lineupsCache.data);
    res.status(502).json({ error: 'Failed to fetch lineups: ' + err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\nWNBA Projections API v2 on port ${PORT}`);
  console.log('  /api/players  /api/teams  /api/projections/v2');
  console.log('  /api/gamelogs/:name  /api/players/:name/ppm  /api/dvp/:pos\n');
});