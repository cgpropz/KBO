// Last-resort public NFL preview when Supabase is unreachable. The committed
// file is empty. Preview and production deploys overwrite it with the free
// top 3 only. Paid requests never receive it.
import baked from './_landingPreview.json' with { type: 'json' };
import { gameAlreadyStarted, gameMarketHasPrices } from './_dataAccess.js';

const MAX_ROWS = 3;

export function acceptLandingFallback(ds, body, authorization = '') {
  if (String(authorization || '').trim()) return null;
  if (!body || body.preview !== true) return null;
  if (ds === 'nfl_projections') {
    if (!Array.isArray(body.data) || body.data.length > MAX_ROWS) return null;
    return {
      ...body,
      data: body.data.filter((row) => !gameAlreadyStarted(row)),
    };
  }
  if (ds === 'nfl_game_markets') {
    const games = body.data?.games;
    if (!Array.isArray(games) || games.length > MAX_ROWS) return null;
    if (games.some((game) => game?.total && Object.hasOwn(game.total, 'edge'))) return null;
    if (games.some(gameMarketHasPrices)) return null;
    return body;
  }
  if (ds === 'nhl_projections') {
    if (!Array.isArray(body.data) || body.data.length > MAX_ROWS) return null;
    return {
      ...body,
      data: body.data.filter((row) => !gameAlreadyStarted(row)),
    };
  }
  return null;
}

export function landingFallbackBody(ds, authorization = '') {
  const body = baked && typeof baked === 'object' ? baked[ds] : null;
  if (!body) return null;
  return acceptLandingFallback(ds, body, authorization);
}
