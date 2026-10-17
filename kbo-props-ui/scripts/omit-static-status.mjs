// The live /status.json is served by /api/data so a data refresh can update
// the clocks without shipping a new site. A copy left in dist would win over
// that route and freeze the clocks until the next site deploy.
import { rmSync } from 'node:fs'

rmSync(new URL('../dist/status.json', import.meta.url), { force: true })
rmSync(new URL('../dist/member-recap.json', import.meta.url), { force: true })
