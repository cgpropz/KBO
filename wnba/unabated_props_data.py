#!/usr/bin/env python3

"""Publish Unabated WNBA player-prop odds in the app's normalized JSON format."""

import argparse
import json
import uuid
from pathlib import Path

import requests

import sports_odds_data as sharp


UNABATED_PROPS_URL = "https://content.unabated.com/markets/b_playerprops.json"
WNBA_LEAGUE_ID = 7
SIDE_BY_KEY = {"si0": "over", "si1": "under"}
STAT_LABELS = {
    "Points": "Points", "Assists": "Assists", "Rebounds": "Rebounds",
    "Three Pointers Made": "3-PT Made", "Blocks": "Blocked Shots", "Steals": "Steals",
    "Steals Blocks": "Blks+Stls", "Points and Rebounds": "Pts+Rebs",
    "Points Rebounds Assists": "Pts+Rebs+Asts", "Points Assists": "Pts+Asts",
    "Rebounds Assists": "Rebs+Asts", "Player Turnovers": "Turnovers",
}
BET_TYPE_NAMES = {
    69: "Three Pointers Made", 70: "Assists", 71: "Blocks", 72: "Double-Double",
    73: "Points", 74: "Points Assists", 75: "Points and Rebounds",
    76: "Points Rebounds Assists", 77: "Rebounds", 78: "Rebounds Assists",
    81: "Steals", 82: "Steals Blocks", 83: "Triple-Double", 84: "Player Turnovers",
}


def fetch_props():
    response = requests.get(UNABATED_PROPS_URL, params={"uuid": str(uuid.uuid4())}, timeout=90)
    response.raise_for_status()
    return response.json()


def normalize_records(payload):
    people = payload.get("people") or {}
    teams = payload.get("teams") or {}
    sources = {source.get("id"): source for source in payload.get("marketSources") or [] if source.get("id") is not None}
    normalized = []

    for group in (payload.get("propsPeopleEvents") or {}).values():
        events = group if isinstance(group, list) else group.values()
        for event in events:
            player = people.get(str(event.get("personId"))) or people.get(event.get("personId")) or {}
            if player.get("leagueId") != WNBA_LEAGUE_ID:
                continue
            player_name = sharp.normalize_text(" ".join(filter(None, [player.get("preferredName") or player.get("firstName"), player.get("lastName")])))
            team = teams.get(str(event.get("teamId"))) or teams.get(event.get("teamId")) or {}
            if not player_name:
                continue

            for source_key, type_lines in (event.get("propsMarketSourcesLines") or {}).items():
                side = SIDE_BY_KEY.get(source_key.split(":", 1)[0])
                if not side:
                    continue
                for type_key, line_data in (type_lines or {}).items():
                    try:
                        bet_type_id = int(str(type_key).removeprefix("bt"))
                        source_id = int(line_data.get("marketSourceId"))
                        price = int(line_data.get("americanPrice"))
                    except (TypeError, ValueError):
                        continue

                    line = sharp.normalize_line(line_data.get("points"))
                    stat_name = BET_TYPE_NAMES.get(bet_type_id)
                    source = sources.get(source_id) or {}
                    if line is None or not stat_name or line_data.get("isBlurred") or line_data.get("statusId") != 1:
                        continue

                    stat_label = STAT_LABELS.get(stat_name, stat_name)
                    normalized.append({
                        "event_id": event.get("eventId"), "commence_time": event.get("eventStart"),
                        "home_team": None, "away_team": team.get("abbreviation"),
                        "bookmaker_key": sharp.normalize_player_key(source.get("name")),
                        "bookmaker_title": source.get("name"), "market_key": f"unabated_{bet_type_id}",
                        "stat_label": stat_label, "stat_key": sharp.normalize_stat_key(stat_label),
                        "player": player_name, "player_key": sharp.normalize_player_key(player_name),
                        "side": side, "line": line, "price": price,
                    })

    return sorted(normalized, key=lambda row: (row["player"], row["stat_key"], row["line"], row["side"], row["bookmaker_title"] or ""))


def run_pipeline(pp_snapshot_path, sportsbook_output_path, matched_output_path):
    records = normalize_records(fetch_props())
    if not records:
        raise RuntimeError("Unabated returned no active WNBA player-prop lines; refusing to publish empty sharp data.")

    slate_dates = {sharp.event_date_et(record.get("commence_time")) for record in records if sharp.event_date_et(record.get("commence_time"))}
    pp_records = sharp.load_prizepicks_records(pp_snapshot_path, allowed_dates=slate_dates)
    if not pp_records:
        pp_records = sharp.load_prizepicks_records(pp_snapshot_path)
    matched = sharp.build_line_matched_output(records, pp_records)
    event_count = len({record["event_id"] for record in records})

    sportsbook_output_path.write_text(json.dumps({"generated_at": sharp.now_iso_utc(), "provider": "unabated", "sport": "basketball_wnba", "event_count": event_count, "record_count": len(records), "records": records}, indent=2) + "\n", encoding="utf-8")
    matched_output_path.write_text(json.dumps({"generated_at": sharp.now_iso_utc(), "provider": "unabated", "sport": "basketball_wnba", "events_scanned": event_count, "sbook_slate_dates_et": sorted(slate_dates), "sportsbook_record_count": len(records), "prizepicks_prop_count": len(pp_records), "matched_prop_count": sum(1 for row in matched if row.get("matched_outcomes_count", 0) > 0), "records": matched}, indent=2) + "\n", encoding="utf-8")
    print(f"Unabated events scanned: {event_count}")
    print(f"Unabated sportsbook records: {len(records)}")
    print(f"PrizePicks props: {len(pp_records)}")
    print(f"Matched PP props: {sum(1 for row in matched if row.get('matched_outcomes_count', 0) > 0)}")


def main():
    parser = argparse.ArgumentParser(description="Refresh WNBA sharp odds from Unabated player props")
    parser.add_argument("--pp-snapshot", type=Path, default=Path("downloaded_files/prizepicks_standard.json"))
    parser.add_argument("--sportsbook-output", type=Path, default=Path("wnba_player_prop_odds.json"))
    parser.add_argument("--matched-output", type=Path, default=Path("wnba_pp_line_matched_odds.json"))
    args = parser.parse_args()
    run_pipeline(args.pp_snapshot, args.sportsbook_output, args.matched_output)


if __name__ == "__main__":
    main()