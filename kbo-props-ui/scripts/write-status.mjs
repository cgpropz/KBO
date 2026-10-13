// Writes public/status.json from whatever board snapshots are on disk.
// Paid rows stay in those snapshots; this file only keeps the counts and clocks.
// A sport file that is missing keeps the previous entry, so a frontend build
// without the gitignored snapshots does not blank a status file the publish
// step already wrote.
//
// Two layouts call this script. The release checkout is the repo, so snapshots
// live at repo-relative paths (nfl/ and nhl/ sit next to kbo-props-ui/). The
// Vercel upload is only the UI package: `vercel --prod` runs from kbo-props-ui,
// and the remote `npm run build` has no parent repo. Writing to
// ../kbo-props-ui/public/status.json from that upload throws ENOENT and fails
// the deploy. In that layout the status file is public/status.json, and the
// paid snapshots are absent (.vercelignore), so the previous clocks are kept.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BOARD_SPORTS, buildBoardStatus } from '../src/boardFreshness.js'

const uiPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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

export function defaultStatusRoot() {
  const parent = resolve(uiPackageRoot, '..')
  if (existsSync(join(parent, 'kbo-props-ui', 'package.json'))) return parent
  return uiPackageRoot
}

// A repo root contains kbo-props-ui/package.json. The Vercel project root is
// the UI package itself and does not.
export function resolveStatusCheckout(root) {
  if (existsSync(join(root, 'kbo-props-ui', 'package.json'))) {
    return {
      kind: 'repo',
      root,
      statusPath: join(root, 'kbo-props-ui/public/status.json'),
      snapshotPath(sport) {
        return join(root, BOARD_FILES[sport])
      },
    }
  }
  return {
    kind: 'ui',
    root,
    statusPath: join(root, 'public/status.json'),
    snapshotPath(sport) {
      const rel = BOARD_FILES[sport]
      if (!rel.startsWith('kbo-props-ui/')) return null
      return join(root, rel.slice('kbo-props-ui/'.length))
    },
  }
}

export function statusFromRepo({ root = defaultStatusRoot(), now = new Date() } = {}) {
  const checkout = resolveStatusCheckout(root)
  const previousDoc = readJson(checkout.statusPath)
  const previous = previousDoc && Array.isArray(previousDoc.boards) ? previousDoc.boards : []
  const snapshots = {}
  for (const sport of BOARD_SPORTS) {
    const path = checkout.snapshotPath(sport)
    if (!path || !existsSync(path)) continue
    const data = readJson(path)
    if (data === undefined) continue
    snapshots[sport] = { data }
  }
  return buildBoardStatus({ snapshots, previous, now })
}

export function writeBoardStatus({ root = defaultStatusRoot(), now = new Date() } = {}) {
  const document = statusFromRepo({ root, now })
  const { statusPath } = resolveStatusCheckout(root)
  // The path is already relative to the checkout (public/status.json in the UI
  // package, kbo-props-ui/public/status.json in the repo). Create the folder
  // and swallow a write error so a missing directory cannot fail `npm run build`.
  try {
    mkdirSync(dirname(statusPath), { recursive: true })
    writeFileSync(statusPath, `${JSON.stringify(document, null, 2)}\n`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[status] could not write ${statusPath}: ${message}`)
  }
  return document
}

const isDirect = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirect) {
  const document = writeBoardStatus()
  const brief = document.boards.map((board) => `${board.sport}:${board.prop_count}${board.stale ? ':stale' : ''}`).join(' ')
  console.log(`[status] ${brief}`)
}
