import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptLandingFallback, landingFallbackBody } from '../api/_landingFallback.js';
import { landingPreviewBody } from '../scripts/bake-landing-preview.mjs';

const future = '2099-01-01T17:00:00.000Z';
const past = '2000-01-01T17:00:00.000Z';

test('the committed landing bake is empty', () => {
  assert.equal(landingFallbackBody('nfl_projections'), null);
  assert.equal(landingFallbackBody('nfl_game_markets'), null);
  assert.equal(landingFallbackBody('prizepicks_props'), null);
  assert.equal(landingFallbackBody('nhl_projections'), null);
});

test('a signed-in request does not receive the baked preview', () => {
  const body = { preview: true, data: [{ player: 'A', start_time: future }], lockedCount: 1 };
  assert.equal(acceptLandingFallback('nfl_projections', body, 'Bearer token'), null);
});

test('the baked NFL preview drops started games and refuses total edges', () => {
  const props = acceptLandingFallback('nfl_projections', {
    preview: true,
    data: [
      { player: 'Later', start_time: future },
      { player: 'Started', start_time: past },
    ],
    lockedCount: 4,
  });
  assert.deepEqual(props.data.map((row) => row.player), ['Later']);

  assert.equal(acceptLandingFallback('nfl_projections', {
    preview: true,
    data: [1, 2, 3, 4],
  }), null);

  assert.equal(acceptLandingFallback('nfl_game_markets', {
    preview: true,
    data: { games: [{ id: 'g', total: { edge: 1, line: 44 } }] },
  }), null);

  const markets = acceptLandingFallback('nfl_game_markets', {
    preview: true,
    data: { games: [{ id: 'g', spread: { edge: 2 }, total: { line: 44 } }] },
  });
  assert.equal(markets.data.games[0].id, 'g');
  assert.equal(Object.hasOwn(markets.data.games[0].total, 'edge'), false);

  const nhl = acceptLandingFallback('nhl_projections', {
    preview: true,
    data: [{ player: 'Evgeni Malkin', imageUrl: 'https://static.prizepicks.com/images/players/NHL/Evgeni_Malkin__NHL_player_abc.webp' }],
    lockedCount: 2,
  });
  assert.equal(nhl.data[0].player, 'Evgeni Malkin');
  assert.equal(acceptLandingFallback('nhl_projections', {
    preview: true,
    data: [{ player: 'A' }, { player: 'B' }, { player: 'C' }, { player: 'D' }],
  }), null);
  assert.equal(acceptLandingFallback('nhl_projections', nhl, 'Bearer token'), null);
});

test('the bake keeps the free top 3 and strips total edges', () => {
  const now = '2026-10-16T12:00:00.000Z';
  const props = landingPreviewBody('nfl_projections', {
    updated_at: now,
    data: [
      { player: 'Started', line: 10, projection: 30, prop: 'Receptions', start_time: '2000-01-01T00:00:00.000Z' },
      { player: 'A', line: 10, projection: 20, prop: 'Receptions', start_time: '2099-01-01T00:00:00.000Z' },
      { player: 'B', line: 10, projection: 18, prop: 'Receptions', start_time: '2099-01-01T00:00:00.000Z' },
      { player: 'C', line: 10, projection: 16, prop: 'Receptions', start_time: '2099-01-01T00:00:00.000Z' },
      { player: 'D', line: 10, projection: 14, prop: 'Receptions', start_time: '2099-01-01T00:00:00.000Z' },
    ],
  });
  assert.equal(props.preview, true);
  assert.deepEqual(props.data.map((row) => row.player), ['A', 'B', 'C']);
  assert.equal(props.data.some((row) => row.player === 'Started'), false);
  assert.equal(props.updatedAt, now);

  const markets = landingPreviewBody('nfl_game_markets', {
    updated_at: now,
    data: {
      provider: 'unabated',
      games: [
        { id: 'spread', spread: { edge: 4 }, total: { edge: 9, line: 40 }, moneyline: { edge: 0 } },
        { id: 'next', spread: { edge: 1 }, total: { edge: 1, line: 41 }, moneyline: { edge: 0 } },
      ],
    },
  });
  assert.equal(markets.data.games.some((game) => Object.hasOwn(game.total, 'edge')), false);
  assert.equal(markets.data.games[0].spread.edge, 4);
});
