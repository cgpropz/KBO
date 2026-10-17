// Copy paid user_profiles.tier values onto auth app_metadata.tier.
// Paid means the tier unlocks a sport. free and discord are skipped.
// Run only between midnight and 6 AM America/New_York, after Code Green
// approves. Never prints the key or a token.
//   node scripts/backfill-tier-claim.mjs
//   node scripts/backfill-tier-claim.mjs --dry-run

import { backfillTierClaims, withinTierBackfillWindow } from '../api/_tierClaim.js';

if (!withinTierBackfillWindow()) {
  console.error('backfill runs only between midnight and 6 AM America/New_York');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

try {
  const summary = await backfillTierClaims({ url, key, dryRun });
  console.log(JSON.stringify(summary));
  if (summary.failed > 0) process.exitCode = 1;
} catch (err) {
  console.error(err?.message || 'backfill failed');
  process.exit(1);
}
