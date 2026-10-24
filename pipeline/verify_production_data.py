#!/usr/bin/env python3
"""Verify key production data endpoints after deploy.

Paid snapshots are served only by the server-gated /api/data endpoint. This
script checks them anonymously (so it sees the free preview, which keeps the
original payload shape and timestamps) and also asserts that the old static
/data/<paid>.json URLs no longer serve JSON (regression guard for the leak).

Supports Vercel protection bypass when configured:
  - env VERCEL_PROTECTION_BYPASS
  - or --bypass-secret
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import requests

_PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
if _PIPELINE_DIR not in sys.path:
	sys.path.insert(0, _PIPELINE_DIR)
from snapshot_consistency import age_timestamp, skew_anchor  # noqa: E402
from kbo_run_signal import NO_LINES_NOTE, no_lines_reason, read_signal  # noqa: E402

LOCAL_STATUS_PATH = os.path.join(os.path.dirname(_PIPELINE_DIR), "kbo-props-ui", "public", "status.json")


DEFAULT_BASE_URL = os.environ.get(
	"PRODUCTION_URL",
	"https://kbo-props-q55gx15ip-cgpropzs-projects.vercel.app",
).strip()

ENDPOINTS = {
	# Public, non-paid static file.
	"team_opponent_stats": "/data/team_opponent_stats_2026.json",
	# Paid datasets: server-gated API (anonymous request -> free preview).
	"pitcher_rankings": "/api/data?ds=pitcher_rankings",
	"strikeout_projections": "/api/data?ds=strikeout_projections",
	"batter_projections": "/api/data?ds=batter_projections",
	"matchup_data": "/api/data?ds=matchup_data",
	"prizepicks_props": "/api/data?ds=prizepicks_props",
}

# Static URLs that used to leak paid data. They must not return JSON anymore.
MUST_NOT_BE_PUBLIC = [
	"/data/prizepicks_props.json",
	"/data/strikeout_projections.json",
	"/data/batter_projections.json",
	"/data/matchup_data.json",
	"/data/graded_props_history.json",
	"/data/prop_results.json",
	"/data/wnba/projections_standard.json",
	"/data/nba/players.json",
	"/data/nba/teams.json",
	"/data/nba/dvp_pg.json",
	"/data/nba/dvp_sg.json",
	"/data/nba/dvp_sf.json",
	"/data/nba/dvp_pf.json",
	"/data/nba/dvp_c.json",
	"/data/nba/projections_standard.json",
	"/data/nba/projections_demon.json",
	"/data/nba/projections_goblin.json",
	"/data/nba/sharp_odds.json",
	"/data/nhl/projections.json",
	"/data/nhl/lineups.json",
	"/data/nhl/sharp_odds.json",
	"/data/nhl/dvp_f.json",
	"/data/nhl/dvp_d.json",
	"/data/nhl/dvp_g.json",
]

CORE_CORRELATED = [
	"strikeout_projections",
	"batter_projections",
	"pitcher_rankings",
	"matchup_data",
]


@dataclass
class FetchResult:
	ok: bool
	status: int
	content_type: str
	body: str
	json_data: Any
	error: str | None = None
	api_updated_at: str | None = None


def build_headers(bypass_secret: str | None) -> Dict[str, str]:
	headers: Dict[str, str] = {"Accept": "application/json"}
	if bypass_secret:
	  # Vercel deployment protection bypass for automation
	  headers["x-vercel-protection-bypass"] = bypass_secret
	  headers["x-vercel-set-bypass-cookie"] = "true"
	return headers


def fetch_json(url: str, headers: Dict[str, str], timeout: int = 20) -> FetchResult:
	try:
		resp = requests.get(url, headers=headers, timeout=timeout)
	except Exception as exc:
		return FetchResult(
			ok=False,
			status=0,
			content_type="",
			body="",
			json_data=None,
			error=f"request error: {exc}",
		)

	content_type = (resp.headers.get("content-type") or "").lower()
	text = resp.text

	if resp.status_code != 200:
		return FetchResult(
			ok=False,
			status=resp.status_code,
			content_type=content_type,
			body=text,
			json_data=None,
			error=f"http {resp.status_code}",
		)

	try:
		data = resp.json()
	except Exception:
		return FetchResult(
			ok=False,
			status=resp.status_code,
			content_type=content_type,
			body=text,
			json_data=None,
			error="response is not valid json",
		)

	return FetchResult(
		ok=True,
		status=resp.status_code,
		content_type=content_type,
		body=text,
		json_data=data,
	)


def unwrap_api_payload(result: FetchResult) -> FetchResult:
	"""/api/data wraps snapshots as {data, updatedAt, preview, lockedCount}."""
	body = result.json_data
	if result.ok and isinstance(body, dict) and "data" in body and "preview" in body:
		data = body.get("data")
		if isinstance(data, dict) and not infer_payload_timestamp(data) and body.get("updatedAt"):
			data = {**data, "updated_at": body.get("updatedAt")}
		result.json_data = data
		result.api_updated_at = body.get("updatedAt")
	return result


def check_not_public(url: str, headers: Dict[str, str]) -> str | None:
	"""Return an error message if a paid static URL still serves JSON."""
	try:
		resp = requests.get(url, headers=headers, timeout=20)
	except Exception:
		return None  # network errors are reported by the main endpoint checks
	if resp.status_code != 200:
		return None
	try:
		resp.json()
	except Exception:
		return None  # e.g. SPA HTML fallback, not data
	return f"paid snapshot is still publicly served as JSON: {url}"


def parse_iso_ts(value: Any) -> datetime | None:
	if not value:
		return None
	text = str(value).strip()
	if not text:
		return None
	if text.endswith("Z"):
		text = text[:-1] + "+00:00"
	try:
		dt = datetime.fromisoformat(text)
	except ValueError:
		return None
	if dt.tzinfo is None:
		dt = dt.replace(tzinfo=timezone.utc)
	return dt.astimezone(timezone.utc)


def infer_payload_timestamp(data: Any) -> datetime | None:
	if not isinstance(data, dict):
		return None
	for key in ("generated_at", "updated_at", "last_updated"):
		ts = parse_iso_ts(data.get(key))
		if ts is not None:
			return ts
	return None


def verify_team_stats(team_stats: Dict[str, Any]) -> List[str]:
	errors: List[str] = []
	required_teams = [
		"Doosan",
		"Hanwha",
		"KT",
		"Kia",
		"Kiwoom",
		"LG",
		"Lotte",
		"NC",
		"SSG",
		"Samsung",
	]

	for team in required_teams:
		if team not in team_stats:
			errors.append(f"missing team in team_opponent_stats_2026.json: {team}")
			continue
		row = team_stats[team]
		if "ba" not in row or "k_pct" not in row:
			errors.append(f"missing ba/k_pct fields for team: {team}")
			continue
		try:
			float(row["ba"])
			float(row["k_pct"])
		except Exception:
			errors.append(f"non-numeric ba or k_pct for team: {team}")

	return errors


def verify_rankings(rankings: List[Dict[str, Any]]) -> List[str]:
	errors: List[str] = []
	if not isinstance(rankings, list) or len(rankings) == 0:
		return ["pitcher_rankings.json is empty or not a list"]

	checked = 0
	for row in rankings:
		if not isinstance(row, dict):
			continue
		if row.get("opp_team") is None:
			errors.append(f"row missing opp_team: {row.get('name', '<unknown>')}")
			continue
		if row.get("opp_ba") is None or row.get("opp_k_pct") is None:
			errors.append(f"row missing opp_ba/opp_k_pct: {row.get('name', '<unknown>')}")
			continue
		checked += 1
		if checked >= 10:
			break

	return errors


def verify_projections_list(name: str, payload: Any, key: str) -> List[str]:
	errors: List[str] = []
	if not isinstance(payload, dict):
		return [f"{name} payload is not a json object"]
	rows = payload.get(key)
	if not isinstance(rows, list) or len(rows) == 0:
		errors.append(f"{name} missing non-empty '{key}' list")
	return errors


STATUS_SPORTS = ("kbo", "wnba", "nfl", "nba", "nhl")
STATUS_KEYS = {
	"sport",
	"board_updated_at",
	"injuries_checked_at",
	"prop_count",
	"stale",
}
NHL_REMOVED_REASONS = ("pp_pull", "superseded_dup", "manual_out", "news_out", "lineup_out")


def status_document_error(payload: Any) -> str | None:
	"""Public clocks only. Extra keys would mean prop rows leaked into status."""
	if not isinstance(payload, dict):
		return "status document is not an object"
	if set(payload) - {"boards"}:
		return "status document has fields other than boards"
	boards = payload.get("boards")
	if not isinstance(boards, list):
		return "status document is missing boards"
	sports = []
	for row in boards:
		if not isinstance(row, dict):
			return "status board row is not an object"
		extra = set(row) - STATUS_KEYS
		if extra - {"removed_reasons", "note"}:
			return "status board row has extra fields"
		if "note" in row and (row.get("sport") not in ("kbo", "wnba") or row.get("note") != NO_LINES_NOTE):
			return "only the kbo and wnba entries may carry the no_lines note"
		if "removed_reasons" in row:
			reasons = row.get("removed_reasons")
			if row.get("sport") != "nhl" or not isinstance(reasons, dict):
				return "removed_reasons belongs on the nhl counts"
			if set(reasons) != set(NHL_REMOVED_REASONS):
				return "removed_reasons is not the five counts"
			for value in reasons.values():
				if isinstance(value, bool) or not isinstance(value, int) or value < 0:
					return "removed_reasons counts are not integers"
		sports.append(row.get("sport"))
	if sports != list(STATUS_SPORTS):
		return "status boards are not the five sports"
	return None


def load_json_file(path: str) -> Any:
	try:
		with open(path, encoding="utf-8") as handle:
			return json.load(handle)
	except (OSError, ValueError, TypeError):
		return None


def kbo_no_lines_allowance(signal: Any, env: Dict[str, str], status_doc: Any, kbo_board: Any) -> str | None:
	"""None when empty KBO projections are expected in this run, else why not.

	Allowed only when this run's KBO odds step recorded 0 KBO props from
	PrizePicks (pipeline/kbo_run_signal.py), the KBO board has no cards, and
	the status.json this run wrote says prop_count 0 with the no_lines note
	and a stale clock.
	"""
	reason = no_lines_reason(signal, env)
	if reason is not None:
		return reason
	cards = kbo_board.get("cards") if isinstance(kbo_board, dict) else None
	if not isinstance(cards, list):
		return "KBO board was not read"
	if cards:
		return "the KBO board still has cards"
	boards = status_doc.get("boards") if isinstance(status_doc, dict) else None
	kbo = next((row for row in boards or [] if isinstance(row, dict) and row.get("sport") == "kbo"), None)
	if not kbo:
		return "status.json has no KBO entry"
	if kbo.get("prop_count") != 0 or kbo.get("note") != NO_LINES_NOTE or kbo.get("stale") is not True:
		return "status.json KBO entry is not prop_count 0, stale, with the no_lines note"
	return None


def anonymous_preview_error(payload: Any, limit: int = 3) -> str | None:
	"""Free and signed-out visitors must get the trimmed board, never the paid one."""
	if not isinstance(payload, dict):
		return "anonymous prizepicks response is not an object"
	if payload.get("preview") is not True:
		return "anonymous visitors received paid board data"
	data = payload.get("data")
	cards = data.get("cards") if isinstance(data, dict) else None
	if not isinstance(cards, list):
		return "anonymous prizepicks preview is missing cards"
	if len(cards) > limit:
		return "anonymous preview includes more than the free rows"
	return None


def verify_matchup_payload(payload: Any) -> List[str]:
	errors: List[str] = []
	if not isinstance(payload, dict):
		return ["matchup_data payload is not a json object"]
	rows = payload.get("matchups")
	if not isinstance(rows, list) or len(rows) == 0:
		errors.append("matchup_data missing non-empty 'matchups' list")
	return errors


def verify_site(base_url: str, headers: Dict[str, str]) -> int:
	"""Homepage, paid-file leak list, anonymous preview, and public clocks.

	Stale prop numbers are not a failure here. That check stays on the data job,
	so a site fix can ship while the boards keep the last good publish.
	"""
	print(f"Checking the live site at: {base_url}")
	failures: List[str] = []

	try:
		home = requests.get(base_url + "/", headers={**headers, "Accept": "text/html"}, timeout=20)
	except Exception as exc:
		failures.append(f"homepage request failed: {exc}")
		home = None
	if home is not None and home.status_code != 200:
		failures.append(f"homepage returned http {home.status_code}")
	elif home is not None and "html" not in (home.headers.get("content-type") or "").lower() and "<html" not in home.text[:500].lower():
		failures.append("homepage did not return a web page")

	for path in MUST_NOT_BE_PUBLIC:
		leak = check_not_public(f"{base_url}{path}", headers)
		if leak:
			failures.append(leak)

	preview = fetch_json(f"{base_url}/api/data?ds=prizepicks_props", headers)
	if not preview.ok:
		failures.append(f"anonymous board check failed: {preview.error}")
	else:
		preview_error = anonymous_preview_error(preview.json_data)
		if preview_error:
			failures.append(preview_error)

	status = fetch_json(f"{base_url}/status.json", headers)
	if not status.ok:
		failures.append(f"status.json check failed: {status.error}")
	else:
		status_error = status_document_error(status.json_data)
		if status_error:
			failures.append(status_error)

	if failures:
		print("\nSite check failures:")
		for msg in failures:
			print(f"- {msg}")
		return 1
	print("\nSite check passed. Paid files stay hidden, and old board numbers are left alone.")
	return 0


def main() -> int:
	parser = argparse.ArgumentParser(description="Verify production KBO data endpoints.")
	parser.add_argument(
		"--base-url",
		default=DEFAULT_BASE_URL,
		help="Deployed app base URL (or set PRODUCTION_URL env)",
	)
	parser.add_argument(
		"--bypass-secret",
		default=None,
		help="Optional Vercel protection bypass secret",
	)
	parser.add_argument(
		"--strict",
		action="store_true",
		help="Exit non-zero on any verification warning/failure",
	)
	parser.add_argument(
		"--site-only",
		action="store_true",
		help="Check the website is up and still hides paid data. Do not fail on stale numbers.",
	)
	parser.add_argument(
		"--status-path",
		default=LOCAL_STATUS_PATH,
		help="status.json written by this run (KBO no-lines check)",
	)
	parser.add_argument(
		"--max-age-hours",
		type=float,
		default=30.0,
		help="Warn/fail if newest snapshot is older than this many hours",
	)
	parser.add_argument(
		"--max-skew-minutes",
		type=float,
		default=180.0,
		help="Warn/fail if core files differ by more than this timestamp skew. Do not raise this to hide a split publish.",
	)
	args = parser.parse_args()

	base_url = args.base_url.rstrip("/")
	if not base_url:
		print("✗ Missing --base-url (or PRODUCTION_URL env)")
		return 1
	bypass_secret = args.bypass_secret
	if bypass_secret is None:
		bypass_secret = os.environ.get("VERCEL_PROTECTION_BYPASS")

	headers = build_headers(bypass_secret)

	if args.site_only:
		return verify_site(base_url, headers)

	print(f"Verifying production endpoints at: {base_url}")

	failures: List[str] = []
	warnings: List[str] = []
	protection_blocked = False
	results: Dict[str, FetchResult] = {}
	timestamps: Dict[str, datetime] = {}
	skew_timestamps: Dict[str, datetime] = {}

	for label, path in ENDPOINTS.items():
		url = f"{base_url}{path}"
		result = unwrap_api_payload(fetch_json(url, headers))
		results[label] = result

		blocked = result.status == 401 and "text/html" in result.content_type
		if blocked:
			protection_blocked = True

		if not result.ok:
			if blocked and not args.strict:
				warnings.append(f"{label} endpoint is protected: {url}")
			else:
				failures.append(f"{label} fetch failed: {result.error} ({url})")
			continue

		# Age stays on generated_at so a cohort stamp cannot hide a stale build.
		# Skew uses published_at when this file was part of a full cohort, and
		# falls back to generated_at otherwise. The 180 minute limit is unchanged.
		ts = age_timestamp(result.json_data, result.api_updated_at)
		if ts is None:
			ts = infer_payload_timestamp(result.json_data)
		if ts is not None:
			timestamps[label] = ts
		skew_ts = skew_anchor(result.json_data, result.api_updated_at)
		if skew_ts is not None:
			skew_timestamps[label] = skew_ts

	for path in MUST_NOT_BE_PUBLIC:
		leak = check_not_public(f"{base_url}{path}", headers)
		if leak:
			failures.append(leak)

	# Helpful guidance for Vercel protection/SSO failures.
	if protection_blocked:
		warnings.append(
			"Vercel protection appears enabled (401 HTML response). "
			"Set VERCEL_PROTECTION_BYPASS or pass --bypass-secret for automated checks, "
			"or allow /data/* publicly in Vercel."
		)

	team_result = results.get("team_opponent_stats")
	if team_result and team_result.ok:
		if not isinstance(team_result.json_data, dict):
			failures.append("team_opponent_stats_2026.json is not an object")
		else:
			failures.extend(verify_team_stats(team_result.json_data))

	rankings_result = results.get("pitcher_rankings")
	if rankings_result and rankings_result.ok:
		failures.extend(verify_rankings(rankings_result.json_data))

	# Empty KBO projections pass only when PrizePicks returned 0 KBO props in
	# this same run. Anything else is still a failure.
	empty_kbo: List[str] = []
	strikeout_result = results.get("strikeout_projections")
	if strikeout_result and strikeout_result.ok:
		empty_kbo.extend(
			verify_projections_list("strikeout_projections.json", strikeout_result.json_data, "projections")
		)

	batter_result = results.get("batter_projections")
	if batter_result and batter_result.ok:
		empty_kbo.extend(
			verify_projections_list("batter_projections.json", batter_result.json_data, "projections")
		)
	if empty_kbo:
		pp_board = results.get("prizepicks_props")
		why = kbo_no_lines_allowance(
			read_signal(os.environ),
			os.environ,
			load_json_file(args.status_path),
			pp_board.json_data if pp_board and pp_board.ok else None,
		)
		if why is None:
			print("KBO projections are empty: PrizePicks returned 0 KBO props in this run (status.json: no_lines).")
		else:
			failures.extend(f"{msg} ({why})" for msg in empty_kbo)

	matchup_result = results.get("matchup_data")
	if matchup_result and matchup_result.ok:
		failures.extend(verify_matchup_payload(matchup_result.json_data))

	pp_result = results.get("prizepicks_props")
	if pp_result and pp_result.ok:
		if not isinstance(pp_result.json_data, dict):
			failures.append("prizepicks_props.json payload is not a json object")
		elif not isinstance(pp_result.json_data.get("cards"), list):
			failures.append("prizepicks_props.json missing 'cards' list")

	now = datetime.now(timezone.utc)
	if timestamps:
		newest_ts = max(timestamps.values())
		max_age = timedelta(hours=args.max_age_hours)
		age = now - newest_ts
		if age > max_age:
			msg = (
				f"newest verified snapshot is stale: {age.total_seconds() / 3600:.1f}h old "
				f"(max {args.max_age_hours:.1f}h)"
			)
			if args.strict:
				failures.append(msg)
			else:
				warnings.append(msg)
	else:
		warnings.append("no snapshot timestamps found in payloads (generated_at/updated_at/last_updated)")

	core_ts = {name: skew_timestamps[name] for name in CORE_CORRELATED if name in skew_timestamps}
	if len(core_ts) >= 2:
		min_ts = min(core_ts.values())
		max_ts = max(core_ts.values())
		skew_minutes = (max_ts - min_ts).total_seconds() / 60.0
		if skew_minutes > args.max_skew_minutes:
			msg = (
				f"core snapshot timestamp skew too high: {skew_minutes:.1f}m "
				f"(max {args.max_skew_minutes:.1f}m)"
			)
			if args.strict:
				failures.append(msg)
			else:
				warnings.append(msg)
	elif len(core_ts) > 0:
		warnings.append("insufficient core timestamps for skew check (need at least 2)")

	if failures:
		print("\nVerification failures:")
		for msg in failures:
			print(f"- {msg}")
	else:
		print("\nVerification checks passed.")

	if warnings:
		print("\nWarnings:")
		for msg in warnings:
			print(f"- {msg}")

	if timestamps or skew_timestamps:
		print("\nSnapshot timestamps (UTC):")
		for label in sorted(set(timestamps) | set(skew_timestamps)):
			age = timestamps.get(label)
			skew = skew_timestamps.get(label)
			age_text = age.isoformat() if age else "missing"
			if skew is not None and age is not None and abs((skew - age).total_seconds()) > 1:
				print(f"- {label}: {skew.isoformat()} (generated {age_text}; skew uses publish cohort)")
			else:
				shown = skew or age
				print(f"- {label}: {shown.isoformat() if shown else 'missing'}")

	if failures:
		return 1
	if warnings and args.strict:
		return 1
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
