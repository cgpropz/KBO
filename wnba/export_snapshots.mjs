#!/usr/bin/env node
/*
 * WNBA snapshot exporter (bridge step).
 *
 * Pulls precomputed projections from the standalone WNBA Express backend and
 * writes them as static JSON snapshots into the KBO UI's public/data/wnba/
 * folder. These snapshots are what the merged frontend reads (with Supabase as
 * the authoritative source once published via publish_supabase).
 *
 * Usage:
 *   BACKEND_URL=http://127.0.0.1:5050 node wnba/export_snapshots.mjs
 *
 * NOTE: This is the interim bridge while the WNBA projection compute still lives
 * in the Express backend. The production plan ports that compute to a pure
 * Python generator so CI (GitHub Actions) can produce these snapshots without a
 * running Node server.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(__dirname, '..', 'kbo-props-ui', 'public', 'data', 'wnba')
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:5050'
const LINE_TYPES = ['standard', 'demon', 'goblin']

// EXPORT_ONLY=projections limits the export to just the prop-line projection
// snapshots (used by the every-30-minute PrizePicks line refresh). All other
// snapshots (players/teams/lineups/edge/dvp) are left untouched so their data
// stays exactly as the last full refresh produced it.
const EXPORT_ONLY = (process.env.EXPORT_ONLY || '').trim().toLowerCase()

// Single-blob datasets: each maps an output filename to a backend endpoint path.
const BLOB_SNAPSHOTS = [
  { file: 'players.json', path: '/api/players' },
  { file: 'teams.json', path: '/api/teams' },
  { file: 'lineups.json', path: '/api/lineups' },
  { file: 'edge.json', path: '/api/edge' },
  { file: 'dvp_guard.json', path: '/api/dvp/guard' },
  { file: 'dvp_forward.json', path: '/api/dvp/forward' },
  { file: 'dvp_center.json', path: '/api/dvp/center' },
]

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const failures = []

  for (const lineType of LINE_TYPES) {
    const url = `${BACKEND_URL}/api/projections/v2?lineType=${lineType}`
    try {
      const data = await fetchJson(url)
      if (!Array.isArray(data)) throw new Error('response is not an array')
      const file = resolve(OUT_DIR, `projections_${lineType}.json`)
      await writeFile(file, JSON.stringify(data), 'utf-8')
      console.log(`  \u2713 projections_${lineType}.json (${data.length} rows)`)
    } catch (err) {
      console.error(`  \u2717 ${lineType}: ${err.message}`)
      failures.push(lineType)
    }
  }

  for (const { file, path } of BLOB_SNAPSHOTS) {
    if (EXPORT_ONLY === 'projections') break
    try {
      const data = await fetchJson(`${BACKEND_URL}${path}`)
      await writeFile(resolve(OUT_DIR, file), JSON.stringify(data), 'utf-8')
      const size = Array.isArray(data) ? `${data.length} rows` : `${Object.keys(data).length} keys`
      console.log(`  \u2713 ${file} (${size})`)
    } catch (err) {
      console.error(`  \u2717 ${file}: ${err.message}`)
      failures.push(file)
    }
  }

  if (failures.length) {
    console.error(`\n\u26a0 WNBA snapshot export failed for: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('\n\u2705 WNBA snapshots exported.')
}

main()
