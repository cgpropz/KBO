"""Rules for publishing one consistent KBO snapshot set.

The strict production check still fails when core files are more than 180
minutes apart. This module does not raise that limit. It decides whether a
pipeline run may publish at all, and which clock the skew check should read.

``published_at`` is a cohort marker written onto every dict snapshot in one
publish. Generation time (``generated_at``) stays the time the model output
was built, so a line refresh can share a cohort with an older matchup slate
without pretending the matchup was rebuilt.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping

ODDS_FETCH_STEP = "PrizePicks Odds Fetch"
# Same ceiling as pipeline/verify_production_data.py --max-skew-minutes.
PUBLISH_SKEW_LIMIT_MINUTES = 180.0
# Strikeout and batter projections are rebuilt together during an odds refresh.
# A wider gap means one file was preserved from an older run.
REGENERATED_PAIR_LIMIT_MINUTES = 60.0

COHORT_FILENAMES = (
    "strikeout_projections.json",
    "batter_projections.json",
    "matchup_data.json",
    "prizepicks_props.json",
)

TEAM_ALIASES = {
    "DOO": "Doosan",
    "DOOSAN": "Doosan",
    "HAN": "Hanwha",
    "HANWHA": "Hanwha",
    "KIA": "Kia",
    "KIW": "Kiwoom",
    "KIWOOM": "Kiwoom",
    "KT": "KT",
    "KTW": "KT",
    "LG": "LG",
    "LOT": "Lotte",
    "LOTTE": "Lotte",
    "NC": "NC",
    "NCD": "NC",
    "SAM": "Samsung",
    "SAMSUNG": "Samsung",
    "SSG": "SSG",
}


def parse_iso_ts(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def generated_timestamp(payload: Any) -> datetime | None:
    """Model-build time. Ignores the publish cohort marker on purpose."""
    if not isinstance(payload, dict):
        return None
    for key in ("generated_at", "updated_at", "last_updated"):
        parsed = parse_iso_ts(payload.get(key))
        if parsed is not None:
            return parsed
    return None


def age_timestamp(payload: Any, api_updated_at: Any = None) -> datetime | None:
    """Freshness clock. A cohort stamp must not make an old build look new."""
    generated = generated_timestamp(payload)
    if generated is not None:
        return generated
    return parse_iso_ts(api_updated_at)


def skew_anchor(payload: Any, api_updated_at: Any = None) -> datetime | None:
    """Clock used only to compare core files against each other.

    Dicts that carry ``published_at`` are compared on that shared cohort.
    Dicts without it fall back to generation time, so a partial publish that
    stamped only some files still shows the gap. Pitcher rankings are a list
    and have no generation field; their Supabase row time is the cohort signal.
    """
    if isinstance(payload, dict):
        stamped = parse_iso_ts(payload.get("published_at"))
        if stamped is not None:
            return stamped
        return generated_timestamp(payload)
    return parse_iso_ts(api_updated_at)


def skew_minutes(times: list[datetime]) -> float | None:
    if len(times) < 2:
        return None
    return (max(times) - min(times)).total_seconds() / 60.0


def blocking_failures(failed: list[str]) -> list[str]:
    """Failures that still forbid publishing the whole set.

    A PrizePicks odds miss is the one tolerated failure: the rest of the run
    can rebuild from the last good lines and publish those files together.
    """
    return [item for item in failed if item != ODDS_FETCH_STEP]


def canonical_team(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    return TEAM_ALIASES.get(text, TEAM_ALIASES.get(text.upper(), text))


def strikeout_pair_mismatches(strikeout_data: Any, matchup_data: Any) -> list[str]:
    """Team pairs in strikeout projections that the matchup slate does not have.

    Mirrors the local verifier. An empty projection list is not a pair mismatch
    (the caller reports that separately). An empty matchup slate does not invent
    mismatches either; there is no slate to compare against.
    """
    if not isinstance(strikeout_data, dict):
        return []
    projections = strikeout_data.get("projections", [])
    if not isinstance(projections, list) or not projections:
        return []

    matchup_pairs: set[tuple[str, str]] = set()
    opponents_by_team: dict[str, set[str]] = {}
    matchups = matchup_data.get("matchups", []) if isinstance(matchup_data, dict) else []
    for matchup in matchups:
        if not isinstance(matchup, dict):
            continue
        away = canonical_team(matchup.get("away"))
        home = canonical_team(matchup.get("home"))
        if not away or not home:
            continue
        matchup_pairs.add((away, home))
        matchup_pairs.add((home, away))
        opponents_by_team.setdefault(away, set()).add(home)
        opponents_by_team.setdefault(home, set()).add(away)

    mismatches = []
    for row in projections:
        if not isinstance(row, dict):
            continue
        team = canonical_team(row.get("team"))
        opponent = canonical_team(row.get("opponent"))
        if not team or not opponent:
            mismatches.append(f"{row.get('name', '<unknown>')} ({team or '?'} vs {opponent or '?'})")
            continue
        if matchup_pairs and (team, opponent) not in matchup_pairs:
            allowed = sorted(opponents_by_team.get(team, set()))
            mismatches.append(
                f"{row.get('name', '<unknown>')} ({team} vs {opponent}; expected one of {allowed or ['<none>']})"
            )
    return mismatches


def publish_gate_errors(
    *,
    failed: list[str],
    has_last_good_lines: bool,
    generated_times: Mapping[str, datetime | None],
    pair_mismatches: list[str],
) -> list[str]:
    """Reasons to skip the entire Supabase publish and leave the last good set.

    Any failure other than the odds fetch blocks the publish. An odds miss
    still publishes when last-good lines exist and the rebuilt core files
    agree with each other.
    """
    blocking = blocking_failures(failed)
    if blocking:
        return ["pipeline steps failed: " + ", ".join(blocking)]

    errors: list[str] = []
    if ODDS_FETCH_STEP in failed and not has_last_good_lines:
        errors.append("PrizePicks odds fetch failed and no last-good lines are on disk")

    required = ("strikeout_projections", "batter_projections", "matchup_data")
    present: list[datetime] = []
    for label in required:
        stamp = generated_times.get(label)
        if stamp is None:
            errors.append(f"{label} missing generated_at")
        else:
            present.append(stamp)

    rankings_stamp = generated_times.get("pitcher_rankings")
    compared = list(present)
    if rankings_stamp is not None:
        compared.append(rankings_stamp)
    skew = skew_minutes(compared)
    if skew is not None and skew > PUBLISH_SKEW_LIMIT_MINUTES:
        errors.append(
            f"core snapshot generated_at skew is {skew:.1f}m "
            f"(limit {PUBLISH_SKEW_LIMIT_MINUTES:.0f}m); keeping the last good published set"
        )

    if pair_mismatches:
        errors.append(
            "strikeout projections contain "
            f"{len(pair_mismatches)} matchup pairs not present in matchup_data: {pair_mismatches[:6]}"
        )
    return errors


def intraday_publish_block_reason(
    *,
    strikeout: Any,
    batter: Any,
    matchup: Any,
) -> str | None:
    """Block an odds-only publish that would split the live set.

    Matchup and rankings are not rebuilt here. They may be older than the new
    lines. The publish is allowed only when the two rebuilt projection files
    were generated together and the strikeout slate still matches matchup data.
    The caller then stamps one ``published_at`` on the whole cohort.
    """
    mismatches = strikeout_pair_mismatches(strikeout, matchup)
    if mismatches:
        return (
            "refusing to publish odds refresh; "
            f"{len(mismatches)} strikeout pairs are not in matchup_data: {mismatches[:4]}"
        )

    strikeout_at = generated_timestamp(strikeout)
    batter_at = generated_timestamp(batter)
    if strikeout_at is None or batter_at is None:
        return "refusing to publish odds refresh; strikeout or batter projections have no generated_at"

    skew = skew_minutes([strikeout_at, batter_at])
    if skew is not None and skew > REGENERATED_PAIR_LIMIT_MINUTES:
        return (
            "refusing to publish odds refresh; strikeout and batter projections "
            f"are {skew:.1f}m apart, so one file was not rebuilt with this fetch"
        )
    return None


def with_published_at(payload: Any, published_at: str) -> Any:
    if not isinstance(payload, dict):
        return payload
    stamped = dict(payload)
    stamped["published_at"] = published_at
    return stamped
