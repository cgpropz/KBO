// Writes public/status.json from whatever board snapshots are on disk.
// Paid rows stay in those snapshots; this file only keeps the counts and clocks.
// A sport file that is missing keeps the previous entry, so a frontend build
// without the gitignored snapshots does not blank a status file the publish
// step already wrote.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOARD_SPORTS, buildBoardStatus } from '../src/boardFreshness.js'

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(uiRoot, '..')

export const BOARD_FILES = {
  kbo: 'kbo-props-ui/public/data/prizepicks_props.json',
  wnba: 'kbo-props-ui/public/data/wnba/projections_standard.json',
  nfl: 'nfl/projections.json',
  nba: 'kbo-props-ui/public/data/nba/projections_standard.json',
  nhl: 'nhl/projections.json',
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

export function statusFromRepo({ root = repoRoot, now = new Date() } = {}) {
  const statusPath = join(root, 'kbo-props-ui/public/status.json')
  const previousDoc = readJson(statusPath)
  const previous = previousDoc && Array.isArray(previousDoc.boards) ? previousDoc.boards : []
  const snapshots = {}
  for (const sport of BOARD_SPORTS) {
    const path = join(root, BOARD_FILES[sport])
    if (!existsSync(path)) continue
    const data = readJson(path)
    if (data === undefined) continue
    snapshots[sport] = { data }
  }
  return buildBoardStatus({ snapshots, previous, now })
}

export function writeBoardStatus({ root = repoRoot, now = new Date() } = {}) {
  const document = statusFromRepo({ root, now })
  const statusPath = join(root, 'kbo-props-ui/public/status.json')
  writeFileSync(statusPath, `${JSON.stringify(document, null, 2)}\n`)
  return document
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirect) {
  const document = writeBoardStatus()
  const brief = document.boards.map((board) => `${board.sport}:${board.prop_count}${board.stale ? ':stale' : ''}`).join(' ')
  console.log(`[status] ${brief}`)
}
