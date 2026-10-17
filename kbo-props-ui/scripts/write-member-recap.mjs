// Writes api/_memberRecap.json: the latest graded slate per sport, counted
// from Board QA's grading files (memory/<sport>/MM/DD/YYYY/recap.json).
// Only standard PrizePicks lines count (no goblin/demon), and rows marked
// rank_eligible: false are skipped. Only counts and dates are written; no
// player rows, lines, or projections leave the paid snapshots.
//
// The file stays next to the API, not in public/ or dist. /api/data serves it
// to paid members. A build without the parent repo (the Vercel rebuild of
// kbo-props-ui alone) has no memory/ folder, so the uploaded file is kept.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SPORTS = ['kbo', 'wnba', 'nfl', 'nhl', 'nba']

function dirs(path) {
  try {
    return readdirSync(path, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
}

export function recapFiles(memoryRoot, sport) {
  const out = []
  const base = join(memoryRoot, sport)
  for (const mm of dirs(base)) {
    if (!/^\d{2}$/.test(mm)) continue
    for (const dd of dirs(join(base, mm))) {
      for (const yyyy of dirs(join(base, mm, dd))) {
        const file = join(base, mm, dd, yyyy, 'recap.json')
        if (existsSync(file)) out.push({ iso: `${yyyy}-${mm}-${dd}`, file })
      }
    }
  }
  return out.sort((a, b) => a.iso.localeCompare(b.iso))
}

export function standardRecord(recap) {
  const record = { hits: 0, misses: 0, pushes: 0 }
  for (const prop of Array.isArray(recap?.props) ? recap.props : []) {
    const type = String(prop?.odds_type ?? 'standard').toLowerCase()
    if (type !== 'standard') continue
    if (prop?.rank_eligible === false) continue
    if (prop.model_result === 'HIT') record.hits += 1
    else if (prop.model_result === 'MISS') record.misses += 1
    else if (prop.model_result === 'PUSH') record.pushes += 1
  }
  return record
}

export function buildMemberRecap(memoryRoot, now = new Date()) {
  const sports = {}
  for (const sport of SPORTS) {
    const files = recapFiles(memoryRoot, sport)
    for (let i = files.length - 1; i >= 0; i -= 1) {
      let recap
      try {
        recap = JSON.parse(readFileSync(files[i].file, 'utf8'))
      } catch {
        continue
      }
      const record = standardRecord(recap)
      if (record.hits + record.misses + record.pushes === 0) continue
      sports[sport] = { slate_date_iso: recap.slate_date_iso || files[i].iso, graded_at: recap.graded_at || null, ...record }
      break
    }
  }
  return { generated_at: now.toISOString(), source: 'memory/<sport>/MM/DD/YYYY/recap.json (standard lines)', sports }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const memoryRoot = resolve(uiRoot, '..', 'memory')
  const target = join(uiRoot, 'api', '_memberRecap.json')
  rmSync(join(uiRoot, 'public', 'member-recap.json'), { force: true })
  mkdirSync(join(uiRoot, 'api'), { recursive: true })
  if (!existsSync(memoryRoot)) {
    if (!existsSync(target)) writeFileSync(target, `${JSON.stringify({ generated_at: null, sports: {} }, null, 2)}\n`)
    console.log('member-recap: no memory/ folder here, keeping', target)
  } else {
    const recap = buildMemberRecap(memoryRoot)
    writeFileSync(target, `${JSON.stringify(recap, null, 2)}\n`)
    console.log('member-recap:', JSON.stringify(recap.sports))
  }
}
