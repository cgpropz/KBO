// Minutes input for the WNBA projection model.
//
// Playoff/Finals box scores (wnba_boxscores_postseason.csv) are counted in the
// minutes window: the last 10 games in date order, regular season and
// postseason together. Per-minute rates still come from regular-season games
// only (see /api/projections/v2 and /api/edge in index.js).

const MINUTES_WINDOW = 10;

// Canonicalise a game date (ISO or M/D/YYYY) to YYYY-MM-DD. The two gamelog
// CSVs store dates in different formats (the stats-API gamelog uses
// "2026-07-15T00:00:00", the scraped boxscores use "07/15/2026"). Reducing both
// to a canonical calendar date lets the same game from either source dedupe
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

// The games whose minutes feed the projection: newest first by game date,
// regular season and postseason interleaved, first `n` games.
function minutesWindowGames(playerGames, n = MINUTES_WINDOW) {
  return [...(playerGames || [])]
    .filter(g => g && Number.isFinite(Number(g.min)))
    .sort((a, b) => canonicalGameDate(b.date).localeCompare(canonicalGameDate(a.date)))
    .slice(0, n);
}

// Plain mean of minutes over that window (0 when the player has no games).
function projectionAvgMins(playerGames, n = MINUTES_WINDOW) {
  const window = minutesWindowGames(playerGames, n);
  if (!window.length) return 0;
  return window.reduce((s, g) => s + Number(g.min), 0) / window.length;
}

module.exports = { MINUTES_WINDOW, canonicalGameDate, minutesWindowGames, projectionAvgMins };
