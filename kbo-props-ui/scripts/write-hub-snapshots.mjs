// stdin: one board snapshot JSON. stdout: the hub payload for that sport.
// publish_supabase.py runs this at refresh time and stores the result beside
// the full board. The full board file is not rewritten.
import { hubSnapshot } from '../src/hubPayload.js'

const sport = process.argv[2]
if (!sport) {
  console.error('usage: node scripts/write-hub-snapshots.mjs <kbo|nfl|nhl|wnba|nba>')
  process.exit(1)
}

const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')
process.stdout.write(JSON.stringify(hubSnapshot(sport, data)))
