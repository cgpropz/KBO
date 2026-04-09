#!/usr/bin/env python3
"""Verify key production data endpoints after deploy.

Supports Vercel protection bypass when configured:
  - env VERCEL_PROTECTION_BYPASS
  - or --bypass-secret
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import requests


DEFAULT_BASE_URL = os.environ.get(
	"PRODUCTION_URL",
	"https://kbo-props-q55gx15ip-cgpropzs-projects.vercel.app",
).strip()

ENDPOINTS = {
	"team_opponent_stats": "/data/team_opponent_stats_2026.json",
	"pitcher_rankings": "/data/pitcher_rankings.json",
	"strikeout_projections": "/data/strikeout_projections.json",
	"batter_projections": "/data/batter_projections.json",
	"matchup_data": "/data/matchup_data.json",
	"prizepicks_props": "/data/prizepicks_props.json",
}

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


def verify_matchup_payload(payload: Any) -> List[str]:
	errors: List[str] = []
	if not isinstance(payload, dict):
		return ["matchup_data payload is not a json object"]
	rows = payload.get("matchups")
	if not isinstance(rows, list) or len(rows) == 0:
		errors.append("matchup_data missing non-empty 'matchups' list")
	return errors


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
		"--max-age-hours",
		type=float,
		default=30.0,
		help="Warn/fail if newest snapshot is older than this many hours",
	)
	parser.add_argument(
		"--max-skew-minutes",
		type=float,
		default=180.0,
		help="Warn/fail if core files differ by more than this timestamp skew",
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

	print(f"Verifying production endpoints at: {base_url}")

	failures: List[str] = []
	warnings: List[str] = []
	protection_blocked = False
	results: Dict[str, FetchResult] = {}
	timestamps: Dict[str, datetime] = {}

	for label, path in ENDPOINTS.items():
		url = f"{base_url}{path}"
		result = fetch_json(url, headers)
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

		ts = infer_payload_timestamp(result.json_data)
		if ts is not None:
			timestamps[label] = ts

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

	strikeout_result = results.get("strikeout_projections")
	if strikeout_result and strikeout_result.ok:
		failures.extend(
			verify_projections_list("strikeout_projections.json", strikeout_result.json_data, "projections")
		)

	batter_result = results.get("batter_projections")
	if batter_result and batter_result.ok:
		failures.extend(
			verify_projections_list("batter_projections.json", batter_result.json_data, "projections")
		)

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

	core_ts = {name: timestamps[name] for name in CORE_CORRELATED if name in timestamps}
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

	if timestamps:
		print("\nSnapshot timestamps (UTC):")
		for label in sorted(timestamps):
			print(f"- {label}: {timestamps[label].isoformat()}")

	if failures:
		return 1
	if warnings and args.strict:
		return 1
	return 0


if __name__ == "__main__":
	raise SystemExit(main())
