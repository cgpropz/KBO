import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeBoardStatus } from '../scripts/write-status.mjs'

const uiRoot = fileURLToPath(new URL('..', import.meta.url))
const NOW = new Date('2026-10-11T15:00:00Z')

function previousStatus() {
  return {
    boards: [
      { sport: 'kbo', board_updated_at: '2026-10-11T09:00:00-04:00', injuries_checked_at: null, prop_count: 4, stale: false },
      { sport: 'wnba', board_updated_at: '2026-10-11T08:00:00-04:00', injuries_checked_at: null, prop_count: 12, stale: false },
      { sport: 'nfl', board_updated_at: '2026-10-11T07:00:00-04:00', injuries_checked_at: null, prop_count: 40, stale: false },
      { sport: 'nba', board_updated_at: null, injuries_checked_at: null, prop_count: 0, stale: true },
      { sport: 'nhl', board_updated_at: '2026-10-11T06:00:00-04:00', injuries_checked_at: null, prop_count: 8, stale: false },
    ],
  }
}

function stageScript(dir) {
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'src'), { recursive: true })
  cpSync(join(uiRoot, 'scripts/write-status.mjs'), join(dir, 'scripts/write-status.mjs'))
  cpSync(join(uiRoot, 'src/boardFreshness.js'), join(dir, 'src/boardFreshness.js'))
}

test('a repo checkout updates the UI status file and keeps sports that were not rebuilt', () => {
  const root = mkdtempSync(join(tmpdir(), 'status-repo-'))
  try {
    const statusDir = join(root, 'kbo-props-ui/public')
    mkdirSync(join(statusDir, 'data'), { recursive: true })
    writeFileSync(join(root, 'kbo-props-ui/package.json'), '{"name":"kbo-props-ui"}\n')
    writeFileSync(join(statusDir, 'status.json'), JSON.stringify(previousStatus()))
    writeFileSync(join(statusDir, 'data/prizepicks_props.json'), JSON.stringify({
      published_at: '2026-10-11T13:44:00Z',
      cards: [{ props: [{}, {}, {}] }],
    }))
    const document = writeBoardStatus({ root, now: NOW })
    const written = JSON.parse(readFileSync(join(statusDir, 'status.json'), 'utf8'))
    assert.equal(written.boards[0].prop_count, 3)
    assert.equal(written.boards[0].board_updated_at, '2026-10-11T09:44:00-04:00')
    assert.equal(written.boards[2].sport, 'nfl')
    assert.equal(written.boards[2].prop_count, 40)
    assert.equal(document.boards[4].prop_count, 8)
    assert.equal(JSON.stringify(written).includes('props'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the UI package alone keeps the uploaded status file when snapshots are absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'status-ui-'))
  try {
    mkdirSync(join(root, 'public'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{"name":"kbo-props-ui"}\n')
    const prior = previousStatus()
    writeFileSync(join(root, 'public/status.json'), `${JSON.stringify(prior, null, 2)}\n`)
    const document = writeBoardStatus({ root, now: NOW })
    const written = JSON.parse(readFileSync(join(root, 'public/status.json'), 'utf8'))
    assert.equal(written.boards.find((board) => board.sport === 'nfl').prop_count, 40)
    assert.equal(written.boards.find((board) => board.sport === 'kbo').board_updated_at, prior.boards[0].board_updated_at)
    assert.equal(document.boards.find((board) => board.sport === 'nhl').prop_count, 8)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a missing public folder is created and the status file is written', () => {
  const root = mkdtempSync(join(tmpdir(), 'status-mkdir-'))
  try {
    writeFileSync(join(root, 'package.json'), '{"name":"kbo-props-ui"}\n')
    const document = writeBoardStatus({ root, now: NOW })
    const written = JSON.parse(readFileSync(join(root, 'public/status.json'), 'utf8'))
    assert.equal(written.boards.length, document.boards.length)
    assert.equal(written.boards.find((board) => board.sport === 'kbo').prop_count, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a status write that cannot create its folder warns and does not throw', () => {
  const root = mkdtempSync(join(tmpdir(), 'status-warn-'))
  const warnings = []
  const original = console.warn
  console.warn = (...args) => { warnings.push(args.join(' ')) }
  try {
    writeFileSync(join(root, 'package.json'), '{"name":"kbo-props-ui"}\n')
    writeFileSync(join(root, 'public'), 'not-a-directory\n')
    const document = writeBoardStatus({ root, now: NOW })
    assert.equal(document.boards.length, 5)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /\[status\] could not write/)
    assert.match(warnings[0], /public/)
  } finally {
    console.warn = original
    rmSync(root, { recursive: true, force: true })
  }
})

test('node scripts/write-status.mjs succeeds when the upload root is the UI package', () => {
  const root = mkdtempSync(join(tmpdir(), 'status-vercel-'))
  try {
    stageScript(root)
    mkdirSync(join(root, 'public/data'), { recursive: true })
    writeFileSync(join(root, 'public/status.json'), `${JSON.stringify(previousStatus(), null, 2)}\n`)
    writeFileSync(join(root, 'public/data/prizepicks_props.json'), JSON.stringify({
      published_at: '2026-10-11T13:44:00Z',
      cards: [{ props: [{}] }],
    }))
    const result = spawnSync(process.execPath, ['scripts/write-status.mjs'], {
      cwd: root,
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /\[status\] kbo:1/)
    const written = JSON.parse(readFileSync(join(root, 'public/status.json'), 'utf8'))
    assert.equal(written.boards[0].prop_count, 1)
    assert.equal(written.boards[2].prop_count, 40)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
