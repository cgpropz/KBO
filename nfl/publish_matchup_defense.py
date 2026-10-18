#!/usr/bin/env python3
"""Publish nfl/matchup_defense.json to the nfl_matchup_defense snapshot row.

Only this one table. It does not touch nfl_projections, board status, board
freshness or any other snapshot. A missing file (stale nflverse, failed fetch)
publishes nothing, so the last good snapshot stays live.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

TABLE = 'nfl_matchup_defense'
SNAPSHOT = ROOT / 'matchup_defense.json'


def main():
    if not SNAPSHOT.exists():
        print(f'{SNAPSHOT.name} not written this run; leaving {TABLE} unchanged.')
        return 0
    import requests
    import publish_supabase as pub
    from nfl.matchup_defense import TEAM_COUNT, assert_no_ftn, output_keys

    if not pub.SERVICE_ROLE_KEY:
        print('✗ SUPABASE_SERVICE_ROLE_KEY is not set')
        return 1
    data = json.loads(SNAPSHOT.read_text())
    assert_no_ftn(output_keys(data), 'publish payload')
    if len(data.get('teams') or {}) != TEAM_COUNT:
        print(f'✗ expected {TEAM_COUNT} defenses, got {len(data.get("teams") or {})}; not publishing')
        return 1
    headers = {
        'apikey': pub.SERVICE_ROLE_KEY,
        'Authorization': f'Bearer {pub.SERVICE_ROLE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
    }
    published_at = datetime.now(timezone.utc).isoformat()
    session = requests.Session()
    err = pub._upsert_snapshot_row(session, TABLE, 1, data, headers, published_at)
    if err:
        print(f'✗ {err}')
        return 1
    print(f'✓ {TABLE} updated (season {data.get("season")}, through Week {data.get("throughWeek")})')
    pub.upload_last_good(session, TABLE, pub.snapshot_record(1, data, published_at), headers)
    return 0


if __name__ == '__main__':
    sys.exit(main())
