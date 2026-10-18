#!/usr/bin/env python3
"""
Lightweight PrizePicks odds refresh only.
Run every 30 minutes via GitHub Actions.
Fetches latest PrizePicks odds, recalculates line-sensitive projections, and
republishes those files together with matchup data and pitcher rankings so
the live cohort keeps one published_at.

Usage:
  python refresh_odds.py          # fetch and publish
  python refresh_odds.py --skip-supabase  # fetch only, don't publish
  python refresh_odds.py --dry-run        # preview without writing
"""
import subprocess
import sys
import os
import json
import time
from contextlib import contextmanager
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
PROJECT_PYTHON = os.path.join(BASE, "venv", "bin", "python")
PYTHON = PROJECT_PYTHON if os.path.exists(PROJECT_PYTHON) else sys.executable
PUBLIC_DATA = os.path.join(BASE, "kbo-props-ui", "public", "data")
LOCK_DIR = os.path.join(BASE, ".locks")
PIPELINE_LOCK = os.path.join(LOCK_DIR, "refresh_pipeline.lock")
PIPELINE_DIR = os.path.join(BASE, "pipeline")
if PIPELINE_DIR not in sys.path:
    sys.path.insert(0, PIPELINE_DIR)

from snapshot_consistency import (  # noqa: E402
    COHORT_FILENAMES,
    intraday_publish_block_reason,
    quarantine_lone_pitcher_mismatch,
    with_published_at,
)


def ensure_project_python():
    """Re-exec with project venv Python when available to avoid package drift."""
    if os.path.exists(PROJECT_PYTHON) and os.path.realpath(sys.executable) != os.path.realpath(PROJECT_PYTHON):
        os.execv(PROJECT_PYTHON, [PROJECT_PYTHON, __file__, *sys.argv[1:]])


def fetch_odds():
    """
    Fetch latest PrizePicks odds and regenerate line-sensitive snapshots.
    Generates: KBO-Odds/KBO_odds_2025.csv, pitcher/batter projections, and props.
    """
    print("\n▶  Fetching PrizePicks odds...")
    print("=" * 50)
    cmd = [PYTHON, os.path.join(BASE, "KBO-Odds", "KBO_ODDS_2025.py")]
    result = subprocess.run(cmd, cwd=BASE)
    
    if result.returncode != 0:
        print("✗ Failed to fetch odds (see the HTTP status and response snippet above)")
        return False
    
    print("✓ PrizePicks odds fetched")

    print("\n▶  Regenerating pitcher projections...")
    pitcher_cmd = [PYTHON, os.path.join(BASE, "generate_projections.py")]
    pitcher_result = subprocess.run(pitcher_cmd, cwd=BASE)
    if pitcher_result.returncode != 0:
        print("✗ Failed to regenerate pitcher projections")
        return False
    print("✓ strikeout_projections.json updated")

    print("\n▶  Regenerating batter projections...")
    batter_cmd = [PYTHON, os.path.join(BASE, "generate_batter_projections.py")]
    batter_result = subprocess.run(batter_cmd, cwd=BASE)
    if batter_result.returncode != 0:
        print("✗ Failed to regenerate batter projections")
        return False
    print("✓ batter_projections.json updated")

    # Rebuild only the derived prop-card snapshot so hit rates, recommendations,
    # and CG scores use the newly fetched line while source logs remain untouched.
    print("\n▶  Recalculating line-sensitive prop data...")
    props_cmd = [PYTHON, os.path.join(BASE, "generate_props.py")]
    props_result = subprocess.run(props_cmd, cwd=BASE)
    if props_result.returncode != 0:
        print("✗ Failed to rebuild line-sensitive prop data")
        return False
    print("✓ prizepicks_props.json projections and lines updated")

    return True


KBO_LAST_GOOD_TABLES = {
    "prizepicks_props",
    "strikeout_projections",
    "batter_projections",
}
_LAST_GOOD_ROW_KEYS = ("cards", "projections", "players", "rows", "matchups", "pairs", "records", "games")


def _board_has_rows(payload):
    """True when the published board has at least one row. Empty copies are not stored."""
    if isinstance(payload, list):
        return len(payload) > 0
    if not isinstance(payload, dict) or "snapshotChunks" in payload:
        return False
    present = [key for key in _LAST_GOOD_ROW_KEYS if isinstance(payload.get(key), list)]
    if present:
        return any(payload[key] for key in present)
    return False


def _post_last_good(table, payload, updated_at):
    """POST the full board to the private bucket. Raises on setup errors."""
    import requests
    import publish_supabase

    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or publish_supabase.SUPABASE_URL
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("VITE_SUPABASE_SERVICE_ROLE_KEY")
        or ""
    )
    if not url or not key:
        raise RuntimeError("missing Supabase credentials")
    publish_supabase.SUPABASE_URL = url
    session = requests.Session()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    publish_supabase.upload_last_good(
        session,
        table,
        {"data": payload, "updated_at": updated_at},
        headers,
    )


def _upload_kbo_last_good(table, payload, updated_at):
    """Copy a published KBO line board into the private board-last-good bucket.

    Failure only warns. The table publish already succeeded, and a dry run
    never reaches this helper.
    """
    if table not in KBO_LAST_GOOD_TABLES:
        return False
    if not _board_has_rows(payload):
        print(f"  ! {table} last-good skipped: empty board")
        return False
    try:
        _post_last_good(table, payload, updated_at)
        return True
    except Exception as exc:
        print(f"  ! {table} last-good copy failed: {type(exc).__name__}")
        return False


def _upload_vercel_copy(table, payload, updated_at):
    """Copy a published board into private Blob. Failure only warns."""
    try:
        from board_copy import upload_board_copy

        upload_board_copy(table, {"data": payload, "updated_at": updated_at})
    except Exception as exc:
        print(f"  ! {table} vercel copy failed: {type(exc).__name__}")


def _publish_snapshot(client, filename, table, dry_run=False, optional=False, published_at=None):
    """Publish one JSON snapshot file to a Supabase table."""
    file_path = os.path.join(PUBLIC_DATA, filename)

    if not os.path.exists(file_path):
        if optional:
            print(f"  ! {filename} not found; skipping optional snapshot")
            return True
        print(f"⚠ {filename} not found at {file_path}")
        return False

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            payload = json.load(f)

        if filename == "prizepicks_props.json":
            from pipeline.kbo_board_cutoff import prepare_prizepicks_board
            updated, note = prepare_prizepicks_board(payload)
            if note:
                print(f"  ℹ {note}")
            if updated is not payload and not dry_run:
                with open(file_path, "w", encoding="utf-8") as handle:
                    json.dump(updated, handle, ensure_ascii=False, indent=2)
                    handle.write("\n")
            payload = updated

        if dry_run:
            print(f"🔍 [DRY RUN] Would publish {filename} → {table} ({len(json.dumps(payload))} bytes)")
            return True

        print(f"\n📡 Publishing {filename} to Supabase table '{table}'...")
        client.table(table).upsert({"id": 1, "data": payload}).execute()
        print(f"  ✓ {table} table updated")
        stamp = published_at
        if isinstance(payload, dict):
            stamp = published_at or payload.get("published_at") or payload.get("generated_at")
        _upload_kbo_last_good(table, payload, stamp)
        _upload_vercel_copy(table, payload, stamp)
        return True
    except Exception as exc:
        if optional:
            print(f"  ! {table} skipped: {exc}")
            return True
        print(f"  ✗ Failed to publish {filename} to {table}: {exc}")
        return False


def _record_kbo_board_status(payload, published_at):
    """Rewrite public/status.json for the KBO board. Never includes prop rows."""
    try:
        from pipeline.board_status import apply_published, record_from_payload
        apply_published({"kbo": record_from_payload("kbo", payload, published_at)})
        print("  ✓ public/status.json (kbo)")
    except Exception as exc:
        print(f"  ! status.json: {exc}")


def _load_public_json(filename):
    path = os.path.join(PUBLIC_DATA, filename)
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError, TypeError):
        return None


def _stamp_cohort(published_at):
    for filename in COHORT_FILENAMES:
        path = os.path.join(PUBLIC_DATA, filename)
        payload = _load_public_json(filename)
        stamped = with_published_at(payload, published_at)
        if not isinstance(stamped, dict):
            continue
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(stamped, handle, ensure_ascii=False, indent=2)
            handle.write("\n")


def publish_to_supabase(skip=False, dry_run=False):
    """
    Publish one consistent snapshot cohort to Supabase.

    Line refreshes rebuild strikeout projections, batter projections, and
    props. Matchup data and pitcher rankings are not rebuilt here (that would
    re-scrape the slate every 30 minutes). They are republished in the same
    cohort, with one published_at, only when the rebuilt projections still
    match the matchup slate. Otherwise nothing is published and the live site
    keeps the last good set.
    """
    if skip:
        print("⏭  Skipping Supabase publish (--skip-supabase)")
        return True

    strikeout = _load_public_json("strikeout_projections.json")
    batter = _load_public_json("batter_projections.json")
    matchup = _load_public_json("matchup_data.json")
    cleaned, warning, _fatal = quarantine_lone_pitcher_mismatch(strikeout, matchup)
    if warning and isinstance(cleaned, dict):
        print(f"⚠ {warning}")
        strikeout = cleaned
        if not dry_run:
            path = os.path.join(PUBLIC_DATA, "strikeout_projections.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(cleaned, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
    reason = intraday_publish_block_reason(strikeout=strikeout, batter=batter, matchup=matchup)
    if reason:
        print(f"⚠ {reason}")
        print("   Leaving the last good published set in place.")
        return False
    
    supabase_url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    service_role_key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("VITE_SUPABASE_SERVICE_ROLE_KEY")
    )
    
    if not supabase_url or not service_role_key:
        if dry_run:
            print("ℹ️  Supabase env vars not set; dry-run will skip publish")
            return True
        print("ℹ️  Supabase env vars not set; skipping publish")
        print("   Set: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
        return False
    
    try:
        from supabase import create_client
    except ImportError:
        print("ℹ️  supabase package not installed; skipping publish")
        print("   Run: pip install supabase")
        return False
    
    try:
        published_at = datetime.now(timezone.utc).isoformat()
        if not dry_run:
            _stamp_cohort(published_at)
        client = create_client(supabase_url, service_role_key)
        # Rankings and matchup go first. If a later line-file upload fails,
        # the slate files have moved together and the line files stay on the
        # previous cohort, so the skew check still fails closed.
        targets = [
            ("pitcher_rankings.json", "pitcher_rankings"),
            ("matchup_data.json", "matchup_data"),
            ("strikeout_projections.json", "strikeout_projections"),
            ("batter_projections.json", "batter_projections"),
            ("prizepicks_props.json", "prizepicks_props"),
        ]

        print(f"📡 Publishing odds cohort {published_at} ({len(targets)} snapshots)")
        ok = True
        prizepicks_published = False
        for filename, table in targets:
            published = _publish_snapshot(
                client, filename, table, dry_run=dry_run, published_at=published_at,
            )
            ok = published and ok
            if filename == "prizepicks_props.json" and published:
                prizepicks_published = True
        _publish_snapshot(
            client, "correlations_kbo.json", "correlations_kbo",
            dry_run=dry_run, optional=True, published_at=published_at,
        )
        if prizepicks_published and not dry_run:
            _record_kbo_board_status(_load_public_json("prizepicks_props.json"), published_at)
        return ok
    
    except Exception as exc:
        print(f"  ✗ Failed to publish: {exc}")
        return False


@contextmanager
def pipeline_lock(lock_path, stale_seconds=3 * 60 * 60):
    """Acquire lock to keep odds refresh isolated from full data refresh writes."""
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)

    while True:
        try:
            fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(f"pid={os.getpid()}\n")
                f.write(f"created_at={datetime.utcnow().isoformat()}Z\n")
            break
        except FileExistsError:
            try:
                age = time.time() - os.path.getmtime(lock_path)
            except OSError:
                age = None

            if age is not None and age > stale_seconds:
                print(f"⚠ Removing stale lock: {lock_path} (age={int(age)}s)")
                try:
                    os.remove(lock_path)
                    continue
                except OSError:
                    pass

            raise RuntimeError(
                "Another refresh job is running. "
                "Skipping odds refresh to avoid overlapping writes."
            )

    try:
        yield
    finally:
        try:
            os.remove(lock_path)
        except OSError:
            pass


def build_kbo_correlations():
    script = os.path.join(BASE, "pipeline", "build_correlations.py")
    try:
        result = subprocess.run([PYTHON, script, "--sport", "kbo"], cwd=BASE)
    except Exception as exc:
        print(f"⚠ KBO correlations failed — continuing ({exc})")
        return
    if result.returncode != 0:
        print("⚠ KBO correlations failed — continuing")


def main():
    ensure_project_python()

    skip_flags = set(sys.argv[1:])
    skip_supabase = "--skip-supabase" in skip_flags
    dry_run = "--dry-run" in skip_flags
    
    if dry_run:
        print("🔍 DRY RUN MODE — no data will be written")
    
    try:
        lock = pipeline_lock(PIPELINE_LOCK)
    except RuntimeError as exc:
        print(f"⏭ {exc}")
        sys.exit(0)

    with lock:
        # Step 1: Fetch odds
        if not fetch_odds():
            sys.exit(1)

        # Lines changed, so the slip pairs have to be rescored. A miss here
        # must not block the odds publish.
        build_kbo_correlations()

        # Step 2: Publish to Supabase
        if not publish_to_supabase(skip=skip_supabase, dry_run=dry_run):
            if not skip_supabase:
                sys.exit(1)

        print("\n" + "=" * 50)
        print("✅ PrizePicks odds refresh complete!")


if __name__ == "__main__":
    main()
