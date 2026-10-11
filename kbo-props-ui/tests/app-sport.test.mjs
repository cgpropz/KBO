import assert from 'node:assert/strict'
import test from 'node:test'
import { appBoardPath, sportFromSearch } from '../src/appSport.js'

test('the app reads a sport query and ignores anything else', () => {
  assert.equal(sportFromSearch('?sport=kbo'), 'kbo')
  assert.equal(sportFromSearch('?sport=nhl&x=1'), 'nhl')
  assert.equal(sportFromSearch('?sport=mlb'), null)
  assert.equal(sportFromSearch(''), null)
  assert.equal(appBoardPath('wnba'), '/?sport=wnba')
})
