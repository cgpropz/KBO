import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { shownCg } from '../src/slipBoardModel.js'
import {
  PRIZEPICKS_BOARD_URL,
  PRIZEPICKS_CLIPBOARD_FALLBACK,
  PRIZEPICKS_NOTE_FULL,
  PRIZEPICKS_NOTE_PHONE,
  PRIZEPICKS_OPEN_LABEL,
  PRIZEPICKS_OPEN_TOAST,
  buildPrizePicksUrl,
  cleanPrizePicksUrl,
  copySlipPicks,
  openPrizePicksBoard,
  openPrizePicksSlip,
  prizePicksCopyIsAllowed,
  prizePicksUiCopy,
  slipPicksText,
  standardProjectionIds,
} from '../src/prizepicksSlip.js'

const TRACKING_KEYS = [
  'ref',
  'referral',
  'affiliate',
  'affid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'pid',
  'af_force_deeplink',
  'af_xp',
  'deep_link_value',
  'shortlink',
  'source_caller',
  'invite_code',
  'wager_id',
  'click_id',
  'fbclid',
  'gclid',
  'projections',
  'projection_id',
  'projId',
]

function mcdavid(extra = {}) {
  return {
    name: 'Connor McDavid',
    prop: 'Shots On Goal',
    line: 3.5,
    projection: 4.2,
    side: 'MORE',
    odds_type: 'standard',
    projection_id: '15830428',
    ...extra,
  }
}

function assertCleanBoard(url) {
  const parsed = new URL(url)
  assert.equal(`${parsed.origin}${parsed.pathname}`, PRIZEPICKS_BOARD_URL)
  assert.equal(parsed.search, '')
  assert.equal(parsed.hash, '')
  assert.equal(url.includes('?'), false)
  assert.equal(url.includes('#'), false)
  for (const key of TRACKING_KEYS) assert.equal(parsed.searchParams.has(key), false, key)
  assert.equal(url.includes('15830428'), false)
  assert.equal(url.includes('goblin'), false)
  assert.equal(url.includes('demon'), false)
}

test('the board link never adds a referral, affiliate, or tracking parameter', () => {
  const picks = [
    mcdavid({ invite_code: 'PR-MTCTQN2', ref: 'cg', utm_source: 'share' }),
    {
      name: 'Jared McCann',
      prop: 'Points',
      line: 1.5,
      side: 'MORE',
      odds_type: 'goblin',
      projection_id: 'goblin-1',
    },
    {
      name: 'Demon Row',
      prop: 'Points',
      line: 2.5,
      side: 'LESS',
      odds_type: 'demon',
      projectionId: 'demon-9',
    },
    { name: 'Blank', prop: 'Hits', line: 1, side: 'MORE' },
  ]
  assert.deepEqual(standardProjectionIds(picks), ['15830428'])
  for (const list of [[], null, picks, [mcdavid({ projection_id: '3511719' })]]) {
    assertCleanBoard(buildPrizePicksUrl(list))
  }
  assert.equal(buildPrizePicksUrl(picks), PRIZEPICKS_BOARD_URL)
  assert.equal(
    cleanPrizePicksUrl('https://app.prizepicks.com/board?invite_code=PR-MTCTQN2&utm_source=cg&af_force_deeplink=true&pid=share_entry'),
    PRIZEPICKS_BOARD_URL,
  )
  assert.equal(cleanPrizePicksUrl('https://evil.example/board'), PRIZEPICKS_BOARD_URL)
  assert.equal(cleanPrizePicksUrl('https://app.prizepicks.com/login'), PRIZEPICKS_BOARD_URL)
})

test('copy text matches the slip formatter', async () => {
  const more = mcdavid()
  const less = mcdavid({ name: 'Alex Ovechkin', line: 4, side: 'LESS', projection_id: '' })
  const text = slipPicksText([more, less])
  assert.equal(text, [
    `Connor McDavid · Shots On Goal 3.5 · More · CG ${Number(shownCg(more)).toFixed(1)}`,
    `Alex Ovechkin · Shots On Goal 4 · Less · CG ${Number(shownCg(less)).toFixed(1)}`,
  ].join('\n'))
  let written = ''
  const copied = await copySlipPicks([more], async (value) => { written = value })
  assert.equal(copied.ok, true)
  assert.equal(copied.notice, 'Picks copied.')
  assert.equal(written, slipPicksText([more]))
})

test('Open PrizePicks copies, then opens, then toasts', async () => {
  const legs = [mcdavid()]
  const order = []
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const pending = openPrizePicksSlip(legs, {
    writeText: async (text) => {
      order.push('copy')
      assert.equal(text, slipPicksText(legs))
      await gate
      order.push('copy-done')
    },
    open: async (url) => {
      order.push('open')
      assertCleanBoard(url)
    },
    notify: (message) => {
      order.push('toast')
      assert.equal(message, PRIZEPICKS_OPEN_TOAST)
    },
  })
  await Promise.resolve()
  assert.deepEqual(order, ['copy'])
  release()
  const result = await pending
  assert.equal(result.copied, true)
  assert.equal(result.url, PRIZEPICKS_BOARD_URL)
  assert.deepEqual(order, ['copy', 'copy-done', 'open', 'toast'])
})

test('a clipboard failure still opens PrizePicks and shows a fallback', async () => {
  const legs = [mcdavid()]
  const order = []
  let rejectWrite
  const gate = new Promise((_, reject) => { rejectWrite = reject })
  const pending = openPrizePicksSlip(legs, {
    writeText: () => {
      order.push('copy')
      return gate
    },
    open: async (url) => {
      order.push('open')
      assertCleanBoard(url)
    },
    notify: (message) => {
      order.push('toast')
      assert.equal(message, `${PRIZEPICKS_CLIPBOARD_FALLBACK}\n${slipPicksText(legs)}`)
      assert.equal(message.includes(PRIZEPICKS_OPEN_TOAST), false)
    },
  })
  await Promise.resolve()
  assert.deepEqual(order, ['copy'])
  rejectWrite(new Error('denied'))
  const result = await pending
  assert.equal(result.copied, false)
  assert.deepEqual(order, ['copy', 'open', 'toast'])
})

test('navigation stays on the board URL and does not open a popup', () => {
  const calls = []
  const opened = openPrizePicksBoard(
    'https://app.prizepicks.com/board?projections=3511719-o-21.5&wager_id=action#pick',
    {
      assign: (url) => calls.push(url),
      open: () => { throw new Error('popup') },
    },
  )
  assert.deepEqual(calls, [PRIZEPICKS_BOARD_URL])
  assert.equal(opened, PRIZEPICKS_BOARD_URL)
  const src = readFileSync(new URL('../src/prizepicksSlip.js', import.meta.url), 'utf8')
  assert.equal(src.includes('window.open'), false)
  assert.equal(src.includes('<iframe'), false)
  assert.equal(src.includes('localStorage'), false)
})

test('the button label, both disclaimers, and forbidden words stay fixed', () => {
  assert.equal(PRIZEPICKS_OPEN_LABEL, 'Open PrizePicks ↗')
  assert.equal(PRIZEPICKS_OPEN_TOAST, 'Picks copied. Paste or rebuild them in PrizePicks.')
  assert.equal(
    PRIZEPICKS_NOTE_FULL,
    'Opens the PrizePicks site or app and copies your picks as text. CGPropz is not affiliated with, endorsed by, or sponsored by PrizePicks. PrizePicks is a trademark of its owner. Lines and payouts can change: check your picks and the payout shown in PrizePicks before submitting. Lineups need players from at least 2 different teams. PrizePicks availability and minimum age (18+, 19+ or 21+) depend on your state. CGPropz is for 21+. Gambling problem? Call 1-800-GAMBLER.',
  )
  assert.equal(
    PRIZEPICKS_NOTE_PHONE,
    'Not affiliated with or endorsed by PrizePicks (a trademark of its owner). Check picks & payout in the app before submitting. Availability and age (18+/19+/21+) vary by state.',
  )
  for (const line of prizePicksUiCopy()) {
    assert.equal(prizePicksCopyIsAllowed(line), true, line)
    assert.equal(/\b(official|partner|powered by|sync|connect)\b/i.test(line), false, line)
  }
  const src = readFileSync(new URL('../src/SlipBoard.jsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/SlipBoard.css', import.meta.url), 'utf8')
  const phone = readFileSync(new URL('../src/mobile.css', import.meta.url), 'utf8')
  assert.match(src, /data-testid="open-prizepicks"/)
  assert.match(src, /onClick=\{onOpenPrizePicks\}/)
  assert.match(src, /PRIZEPICKS_OPEN_LABEL/)
  assert.match(src, /PRIZEPICKS_NOTE_FULL/)
  assert.match(src, /PRIZEPICKS_NOTE_PHONE/)
  assert.match(src, /openPrizePicksSlip/)
  assert.match(src, /copySlipPicks/)
  assert.equal(/['"`][^'"`\n]*PrizePicks/.test(src), false)
  assert.equal(src.includes('window.open'), false)
  assert.equal(src.includes('<iframe'), false)
  assert.match(css, /\.b2-pp-note-phone \{ display: none; \}/)
  const phoneMarker = '@media (--phone-board) {'
  const phoneQuery = phone.indexOf(phoneMarker)
  const nextQuery = phone.indexOf('@media', phoneQuery + phoneMarker.length)
  const phoneBlock = phone.slice(phoneQuery, nextQuery)
  assert.match(phoneBlock, /body \.b2-pp-note-full \{ display: none !important; \}/)
  assert.match(phoneBlock, /body \.b2-pp-note-phone \{ display: block !important; \}/)
  assert.equal(/\b(official|partner|powered by|sync|connect)\b/i.test(src), false)
})
