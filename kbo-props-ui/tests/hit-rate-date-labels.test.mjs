import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dateRowBars } from '../src/chartLabels.js'
import { formatGameDate, gameDateLabelHtml, matchupOpponent, opponentAbbr } from '../src/gameDateLabel.js'

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

test('game dates render as M/DD with no year, whatever the feed shape', () => {
  assert.equal(formatGameDate('2026-10-20'), '10/20')
  assert.equal(formatGameDate('2026-09-05T23:30:00Z'), '9/05')
  assert.equal(formatGameDate('04/12/2026'), '4/12')
  assert.equal(formatGameDate('10/09'), '10/09')
  assert.equal(formatGameDate('9/7'), '9/07')
  assert.equal(formatGameDate('Oct 20, 2026'), '10/20')
  assert.equal(formatGameDate(''), '')
  assert.equal(formatGameDate(null), '')
})

test('a UTC stamp late in the day keeps its calendar date', () => {
  assert.equal(formatGameDate('2026-10-20T03:00:00Z'), '10/20')
})

test('opponent falls back to an abbreviation and reads matchups', () => {
  assert.equal(opponentAbbr('TOR'), 'TOR')
  assert.equal(opponentAbbr(''), '—')
  assert.equal(matchupOpponent('LVA @ CHI'), 'CHI')
  assert.equal(matchupOpponent('LVA vs. chi'), 'CHI')
  assert.equal(matchupOpponent('LVA'), '')
})

test('chart label markup puts the date first, then the logo or the abbreviation', () => {
  const withLogo = gameDateLabelHtml({ date: '2026-10-20', team: 'CHI', src: '/api/img?src=x&w=32' })
  assert.ok(withLogo.indexOf('hr-game-date') < withLogo.indexOf('hr-game-logo'))
  assert.match(withLogo, />10\/20</)
  assert.match(withLogo, /src="\/api\/img\?src=x&amp;w=32"/)
  const fallback = gameDateLabelHtml({ date: '2026-10-20', team: '<X>', src: '' })
  assert.match(fallback, /hr-game-abbr">&lt;X&gt;</)
  assert.doesNotMatch(fallback, /<img/)
})

test('every hit-rate log chart uses the shared date + logo label', () => {
  for (const file of ['KboPlayerPage.jsx', 'RecentGameLogChart.jsx', 'nfl/NflPlayerPage.jsx', 'nhl/NhlPlayerPage.jsx', 'wnba/WnbaPlayerPage.jsx', 'nba/NbaPlayerChart.jsx']) {
    assert.match(read(file), /<GameDateLogo\b/, file)
  }
  assert.match(read('wnba/components/L10HitRateChart.jsx'), /gameDateLabelHtml\(/)
})

test('one bar without a date does not hide the rest of the label row', () => {
  const rows = dateRowBars([
    { value: 13, date: '02/14/2026', team: 'LAL' },
    { value: 18, date: '', team: 'BOS' },
    { value: 11, date: '10/22/2026', team: 'PHI' },
  ])
  assert.equal(rows.length, 3)
  assert.equal(rows[0].date, '02/14/2026')
  assert.equal(rows[2].team, 'PHI')
  assert.equal(dateRowBars([{ value: 1, date: '' }, { value: 2, date: '  ' }]), null)
  assert.equal(dateRowBars([]), null)
  const row = read('MiniHitBars.jsx')
  assert.match(row, /dateRowBars/)
  assert.doesNotMatch(row, /every\(\(bar\) => bar\?\.date\)/)
  assert.doesNotMatch(row, /rows\.every\(\(bar\) => bar\.date\)/)
})

test('the label falls back to the abbreviation when a logo is missing or fails', () => {
  const source = read('GameDateLogo.jsx')
  assert.match(source, /onError=/)
  assert.match(source, /hr-game-abbr/)
  assert.ok(source.indexOf('hr-game-date') < source.indexOf('hr-game-logo'))
})

test('charts keep the oldest game on the left and the newest on the right', () => {
  assert.match(read('KboPlayerPage.jsx'), /\[\.\.\.\(selected\?\.rows \|\| \[\]\)\]\.reverse\(\)/)
  assert.match(read('RecentGameLogChart.jsx'), /\[\.\.\.validEntries\]\.reverse\(\)/)
  assert.match(read('nba/NbaPlayerChart.jsx'), /\.reverse\(\)/)
  assert.match(read('wnba/components/L10HitRateChart.jsx'), /\.slice\(0, activeWindow\.count \?\? games\.length\)\s*\.reverse\(\)/)
})
