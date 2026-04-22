#!/usr/bin/env python3
"""
Lightweight PrizePicks odds refresh only.
Run every ~10 minutes via cron or GitHub Actions.
Fetches latest PrizePicks odds and publishes to Supabase.

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
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
PROJECT_PYTHON = os.path.join(BASE, "venv", "bin", "python")
PYTHON = PROJECT_PYTHON if os.path.exists(PROJECT_PYTHON) else sys.executable
PUBLIC_DATA = os.path.join(BASE, "kbo-props-ui", "public", "data")
LOCK_DIR = os.path.join(BASE, ".locks")
PIPELINE_LOCK = os.path.join(LOCK_DIR, "refresh_pipeline.lock")


def ensure_project_python():
    """Re-exec with project venv Python when available to avoid package drift."""
    if os.path.exists(PROJECT_PYTHON) and os.path.realpath(sys.executable) != os.path.realpath(PROJECT_PYTHON):
        os.execv(PROJECT_PYTHON, [PROJECT_PYTHON, __file__, *sys.argv[1:]])


def fetch_odds():
    """
    Fetch latest PrizePicks odds using KBO_ODDS_2025.py, then regenerate props.
    Generates: KBO-Odds/KBO_odds_2025.csv + prizepicks_props.json
    """
    print("\n▶  Fetching PrizePicks odds...")
    print("=" * 50)
    cmd = [PYTHON, os.path.join(BASE, "KBO-Odds", "KBO_ODDS_2025.py")]
    result = subprocess.run(cmd, cwd=BASE)
    
    if result.returncode != 0:
        print("✗ Failed to fetch odds")
        return False
    
    print("✓ PrizePicks odds fetched")

    # Intraday job should stay lightweight: only update lines + odds_type.
    print("\n▶  Updating lines (lines-only mode)...")
    props_cmd = [PYTHON, os.path.join(BASE, "generate_props.py"), "--lines-only"]
    props_result = subprocess.run(props_cmd, cwd=BASE)
    if props_result.returncode != 0:
        print("✗ Failed to update lines — keeping previous file")
    else:
        print("✓ prizepicks_props.json lines updated")

    return True


def _publish_snapshot(client, filename, table, dry_run=False):
    """Publish one JSON snapshot file to a Supabase table."""
    file_path = os.path.join(PUBLIC_DATA, filename)

    if not os.path.exists(file_path):
        print(f"⚠ {filename} not found at {file_path}")
        return False

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            payload = json.load(f)

        if dry_run:
            print(f"🔍 [DRY RUN] Would publish {filename} → {table} ({len(json.dumps(payload))} bytes)")
            return True

        print(f"\n📡 Publishing {filename} to Supabase table '{table}'...")
        client.table(table).upsert({"id": 1, "data": payload}).execute()
        print(f"  ✓ {table} table updated")
        return True
    except Exception as exc:
        print(f"  ✗ Failed to publish {filename} to {table}: {exc}")
        return False


def publish_to_supabase(skip=False, dry_run=False):
    """
    Publish prizepicks_props.json snapshot to Supabase.
    Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.
    """
    if skip:
        print("⏭  Skipping Supabase publish (--skip-supabase)")
        return True
    
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
        client = create_client(supabase_url, service_role_key)
        targets = [
            ("prizepicks_props.json", "prizepicks_props"),
        ]

        ok = True
        for filename, table in targets:
            ok = _publish_snapshot(client, filename, table, dry_run=dry_run) and ok
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

        # Step 2: Publish to Supabase
        if not publish_to_supabase(skip=skip_supabase, dry_run=dry_run):
            if not skip_supabase:
                sys.exit(1)

        print("\n" + "=" * 50)
        print("✅ PrizePicks odds refresh complete!")


if __name__ == "__main__":
    main()
