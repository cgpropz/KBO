"""
generate_graded_history.py
Scan all prop cards from prizepicks_props.json, grade each historical game
against the current line + model recommendation, and output a comprehensive
graded history for the tracker UI.

For each card → each prop → each game in the game log:
  - Look up the actual stat value
  - Compare actual vs line → OVER / UNDER / PUSH
  - Compare vs model recommendation → HIT / MISS / PUSH

Reads:
  kbo-props-ui/public/data/prizepicks_props.json

Outputs:
  kbo-props-ui/public/data/graded_props_history.json
"""

import json
import os
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
UI_DATA = os.path.join(BASE, "kbo-props-ui", "public", "data")

# Map prop stat names → game log keys
STAT_KEY = {
    "Pitcher Strikeouts": "so",
    "Hits Allowed": "ha",
    "Pitching Outs": "outs",
    "Hits+Runs+RBIs": "hrr",
    "Total Bases": "tb",
}

STAT_SHORT = {
    "Pitcher Strikeouts": "K",
    "Hits Allowed": "HA",
    "Pitching Outs": "OUTS",
    "Hits+Runs+RBIs": "HRR",
    "Total Bases": "TB",
}


def normalize_date(date_str):
    """Normalize various date formats to YYYY-MM-DD."""
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return date_str


def classify_type(recommendation, rating):
    """Classify recommendation with granularity based on model rating."""
    if not recommendation or recommendation == "PUSH":
        return "PUSH"
    if rating is not None and rating >= 65:
        return recommendation  # Strong OVER or UNDER
    if recommendation == "OVER":
        return "SLIGHT OV"
    if recommendation == "UNDER":
        return "SLIGHT UN"
    return "PUSH"


def main():
    props_path = os.path.join(UI_DATA, "prizepicks_props.json")
    with open(props_path) as f:
        props_data = json.load(f)

    graded = []
    pending = []

    for card in props_data.get("cards", []):
        games = card.get("games", [])
        player = card["name"]
        team = card.get("team", "")
        role = card.get("type", "")
        venue = card.get("venue", "")
        card_opponent = card.get("opponent", "")

        for prop in card.get("props", []):
            stat_name = prop.get("stat", "")
            stat_key = STAT_KEY.get(stat_name)
            if not stat_key:
                continue

            line = prop["line"]
            rec = prop.get("recommendation")
            rating = prop.get("rating")
            projection = prop.get("projection")
            edge = prop.get("edge")
            hit_pct = prop.get("hit_rate_all", 0)
            prop_type = classify_type(rec, rating)

            # Always add to pending (today's props awaiting next game)
            pending.append({
                "player": player,
                "team": team,
                "opponent": card_opponent,
                "role": role,
                "stat": STAT_SHORT.get(stat_name, stat_name),
                "line": line,
                "type": prop_type,
                "hit_pct": hit_pct,
                "projection": projection,
                "edge": edge,
                "rating": rating,
                "venue": venue,
            })

            if not games:
                continue

            for game in games:
                actual = game.get(stat_key)
                if actual is None:
                    continue

                game_date = normalize_date(game.get("date", ""))
                opponent = game.get("opp", card_opponent)

                # Determine outcome
                if actual > line:
                    outcome = "OVER"
                elif actual < line:
                    outcome = "UNDER"
                else:
                    outcome = "PUSH"

                # Grade vs model recommendation
                if outcome == "PUSH":
                    result = "PUSH"
                elif not rec or rec == "PUSH":
                    # No model call — grade as outcome but flag as unrated
                    result = "PUSH"
                elif outcome == rec:
                    result = "HIT"
                else:
                    result = "MISS"

                graded.append({
                    "date": game_date,
                    "player": player,
                    "team": team,
                    "opponent": opponent,
                    "role": role,
                    "stat": STAT_SHORT.get(stat_name, stat_name),
                    "line": line,
                    "type": prop_type,
                    "hit_pct": hit_pct,
                    "projection": projection,
                    "edge": edge,
                    "rating": rating,
                    "actual": actual,
                    "result": result,
                    "venue": venue,
                })

    # Sort by date desc, then player
    graded.sort(key=lambda x: (x["date"], x["player"]), reverse=True)

    # ── Summary ───────────────────────────────────────────────────────
    resolved = [g for g in graded if g["result"] in ("HIT", "MISS")]
    hits = sum(1 for g in resolved if g["result"] == "HIT")
    misses = len(resolved) - hits
    pushes = sum(1 for g in graded if g["result"] == "PUSH")
    total_resolved = len(resolved)

    over_entries = [g for g in resolved if g["type"] in ("OVER", "SLIGHT OV")]
    under_entries = [g for g in resolved if g["type"] in ("UNDER", "SLIGHT UN")]
    over_hits = sum(1 for g in over_entries if g["result"] == "HIT")
    under_hits = sum(1 for g in under_entries if g["result"] == "HIT")

    edges = [g["edge"] for g in graded if g["edge"] is not None]

    # By stat
    by_stat = {}
    for g in resolved:
        s = g["stat"]
        if s not in by_stat:
            by_stat[s] = {"hits": 0, "misses": 0}
        if g["result"] == "HIT":
            by_stat[s]["hits"] += 1
        else:
            by_stat[s]["misses"] += 1
    for s in by_stat:
        t = by_stat[s]["hits"] + by_stat[s]["misses"]
        by_stat[s]["total"] = t
        by_stat[s]["hit_rate"] = round(by_stat[s]["hits"] / t * 100, 1) if t else 0

    # By role
    by_role = {}
    for g in resolved:
        r = g["role"]
        if r not in by_role:
            by_role[r] = {"hits": 0, "misses": 0}
        if g["result"] == "HIT":
            by_role[r]["hits"] += 1
        else:
            by_role[r]["misses"] += 1
    for r in by_role:
        t = by_role[r]["hits"] + by_role[r]["misses"]
        by_role[r]["total"] = t
        by_role[r]["hit_rate"] = round(by_role[r]["hits"] / t * 100, 1) if t else 0

    summary = {
        "total_graded": len(graded),
        "total_pending": len(pending),
        "hits": hits,
        "misses": misses,
        "pushes": pushes,
        "overall_hit_rate": round(hits / total_resolved * 100, 1) if total_resolved else 0,
        "over_hit_rate": round(over_hits / len(over_entries) * 100, 1) if over_entries else 0,
        "under_hit_rate": round(under_hits / len(under_entries) * 100, 1) if under_entries else 0,
        "over_volume": len(over_entries),
        "under_volume": len(under_entries),
        "avg_edge": round(sum(edges) / len(edges), 2) if edges else 0,
        "by_stat": by_stat,
        "by_role": by_role,
    }

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "graded": graded,
        "pending": pending,
        "summary": summary,
    }

    out_path = os.path.join(UI_DATA, "graded_props_history.json")
    with open(out_path, "w") as f:
        json.dump(output, f)

    print(f"Wrote {len(graded)} graded + {len(pending)} pending to {out_path}")
    print(f"  Hit Rate: {summary['overall_hit_rate']}%  "
          f"({hits} HIT / {misses} MISS / {pushes} PUSH)")
    print(f"  Over:  {summary['over_hit_rate']}% ({len(over_entries)} props)")
    print(f"  Under: {summary['under_hit_rate']}% ({len(under_entries)} props)")
    print(f"  Avg Edge: {summary['avg_edge']}")
    for s, d in sorted(by_stat.items()):
        print(f"  {s}: {d['hit_rate']}% ({d['hits']}/{d['total']})")


if __name__ == "__main__":
    main()
