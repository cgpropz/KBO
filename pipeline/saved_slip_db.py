"""Supabase client for saved-slip scripts. Never print the URL or the key."""
from __future__ import annotations

import os


def _clean(value) -> str:
    return str(value or "").strip().strip('"').strip("'").replace("\\n", "\n")


def supabase_client():
    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL", "")
    key = _clean(os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))
    if not url or not key:
        raise SystemExit("Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY")
    try:
        from supabase import create_client
    except ImportError as exc:
        raise SystemExit("Install supabase-py: pip install supabase") from exc
    return create_client(url, key)


def missing_sport_column(exc: BaseException) -> bool:
    text = str(exc).lower()
    if "sport" not in text:
        return False
    return any(token in text for token in ("column", "schema", "42703", "pgrst204"))
