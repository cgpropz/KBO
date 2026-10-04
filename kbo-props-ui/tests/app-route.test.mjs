import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildAppPath,
  defaultBoardView,
  hubPath,
  isBoardView,
  parseAppRoute,
} from '../src/appRoute.js'

test('NFL and WNBA lineups routes survive a round trip', () => {
  for (const path of ['/nfl/lineups', '/wnba/lineups']) {
    const route = parseAppRoute(path)
    assert.equal(route.screen, 'home')
    assert.equal(buildAppPath(route.sport, route.view), path)
  }
  assert.deepEqual(parseAppRoute('/nfl/lineups'), { screen: 'home', sport: 'nfl', view: 'lineups' })
  assert.deepEqual(parseAppRoute('/wnba/lineups'), { screen: 'home', sport: 'wnba', view: 'lineups' })
})

test('KBO has no lineups view and the bare sport path opens the default board', () => {
  assert.equal(isBoardView('kbo', 'lineups'), false)
  assert.equal(parseAppRoute('/kbo/lineups').screen, 'hub')
  assert.deepEqual(parseAppRoute('/nfl'), { screen: 'home', sport: 'nfl', view: 'dashboard' })
  assert.deepEqual(parseAppRoute('/wnba'), { screen: 'home', sport: 'wnba', view: 'dashboard' })
  assert.deepEqual(parseAppRoute('/kbo'), { screen: 'home', sport: 'kbo', view: 'board' })
  assert.equal(defaultBoardView('kbo'), 'board')
  assert.equal(buildAppPath('nfl', 'dashboard'), '/nfl')
  assert.equal(buildAppPath('kbo', 'pricing'), '/kbo/pricing')
})

test('the hub and unknown paths stay on the marketing page', () => {
  assert.deepEqual(parseAppRoute('/'), { screen: 'hub', sport: null, view: null })
  assert.deepEqual(parseAppRoute(''), { screen: 'hub', sport: null, view: null })
  assert.equal(parseAppRoute('/login').screen, 'hub')
  assert.equal(parseAppRoute('/nfl/lineups/extra').screen, 'hub')
  assert.equal(hubPath(), '/')
})

test('a GitHub Pages base prefix is stripped and written back', () => {
  assert.deepEqual(parseAppRoute('/KBO/nfl/lineups', '/KBO/'), {
    screen: 'home',
    sport: 'nfl',
    view: 'lineups',
  })
  assert.equal(buildAppPath('nfl', 'lineups', '/KBO/'), '/KBO/nfl/lineups')
  assert.equal(hubPath('/KBO/'), '/KBO/')
  assert.equal(parseAppRoute('/KBO/', '/KBO/').screen, 'hub')
})
