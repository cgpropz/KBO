#!/usr/bin/env python3
"""Daily NHL AGS odds + game/team totals collector (research only).
Source: ESPN public JSON (odds provider 100 = DraftKings, as shown by ESPN).
Writes data/YYYY-MM-DD_ags.csv and data/YYYY-MM-DD_games.csv; skips if today's files exist (use --force).
athlete_cache.json only keeps complete lookups (name, position, team). A failed or partial
lookup is never cached; every run retries cache entries with an athlete_ placeholder name or
a blank position/team. --retry-cache runs only that retry pass (no odds pull)."""
import csv, json, os, sys, time, urllib.request, datetime as dt
from zoneinfo import ZoneInfo
ET = ZoneInfo("America/New_York"); BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data"); os.makedirs(DATA, exist_ok=True)
CACHE = os.path.join(BASE, "athlete_cache.json"); LOG = os.path.join(BASE, "collect.log")
SITE = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl"
CORE = "https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl"
PROVIDERS = {"100": "DraftKings"}
def log(m):
    with open(LOG, "a") as f: f.write(f"{dt.datetime.now(ET):%Y-%m-%d %H:%M:%S %Z} {m}\n")
def get(url):
    url = url.replace("http://", "https://", 1).replace("espn.pvt", "espn.com")
    for a in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "CGPropz-research/1.0"})
            return json.load(urllib.request.urlopen(req, timeout=30))
        except Exception as e:
            if a == 2: raise
            time.sleep(2)
def cache_entry_bad(c):
    """A cache entry that must be looked up again: placeholder name, or blank position/team."""
    return (not c or str(c.get("name") or "").startswith("athlete_") or not c.get("name")
            or not c.get("pos") or not c.get("team_id"))
def lookup_athlete(ref):
    """{name, pos, team_id} from the ESPN athlete endpoint, or None on any failure (never cached)."""
    try:
        ath = get(ref.replace("espn.pvt", "espn.com")); team = ath.get("team", {}).get("$ref", "")
        entry = {"name": ath.get("displayName"), "pos": ath.get("position", {}).get("abbreviation"),
                 "team_id": team.split("/teams/")[-1].split("?")[0] if team else ""}
    except Exception as e:
        log(f"athlete lookup failed {ref.split('?')[0]}: {e}"); return None
    return entry if entry.get("name") else None
def retry_cache(cache):
    """Re-look-up every bad entry. A success replaces it; a failure is dropped so it is tried again next run."""
    fixed = failed = 0
    for aid in [k for k, v in cache.items() if cache_entry_bad(v)]:
        entry = lookup_athlete(f"{CORE}/athletes/{aid}")
        if entry and not cache_entry_bad(entry):
            cache[aid] = entry; fixed += 1
        else:
            cache.pop(aid, None); failed += 1
            if entry: cache_put_pending[aid] = entry
    if fixed or failed: log(f"cache retry: {fixed} fixed, {failed} still failing")
    return fixed, failed
cache_put_pending = {}  # partial lookups (e.g. no team): used for this run's rows, not cached
def imp(am):
    am = float(am); return round(100/(am+100) if am > 0 else -am/(-am+100), 4)
def main():
    force = "--force" in sys.argv; now = dt.datetime.now(ET); day = now.date()
    ags_p = os.path.join(DATA, f"{day}_ags.csv"); gm_p = os.path.join(DATA, f"{day}_games.csv")
    cache_put_pending.clear()
    cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    if "--retry-cache" in sys.argv:  # cache backfill only, no odds pull
        fixed, failed = retry_cache(cache); json.dump(cache, open(CACHE, "w"))
        print(f"cache: {len(cache)} entries; {fixed} fixed, {failed} still failing"); return
    if os.path.exists(ags_p) and not force: log(f"skip: {ags_p} exists"); print("already collected today"); return
    retry_cache(cache)
    refreshed = set()
    snap = now.strftime("%Y-%m-%d %H:%M:%S ET")
    sb = get(f"{SITE}/scoreboard?dates={day:%Y%m%d}")
    ags, games = [], []
    for ev in sb.get("events", []):
        eid = ev["id"]; comp = ev["competitions"][0]
        if comp["status"]["type"]["state"] != "pre": continue
        teams = {c["homeAway"]: c["team"] for c in comp["competitors"]}
        tid = {c["team"]["id"]: c["team"]["abbreviation"] for c in comp["competitors"]}
        game = f'{teams["away"]["abbreviation"]}@{teams["home"]["abbreviation"]}'
        start = dt.datetime.fromisoformat(ev["date"].replace("Z", "+00:00")).astimezone(ET).strftime("%Y-%m-%d %H:%M ET")
        for pid, book in PROVIDERS.items():
            try: o = get(f"{CORE}/events/{eid}/competitions/{eid}/odds/{pid}")
            except Exception as e: log(f"{game} {book} main odds error {e}"); o = {}
            h, a = o.get("homeTeamOdds", {}), o.get("awayTeamOdds", {})
            base = dict(snapshot_et=snap, game_start_et=start, event_id=eid, game=game, book=book)
            games.append({**base, "market": "game_total", "team": "", "line": o.get("overUnder"),
                          "over_odds": o.get("overOdds"), "under_odds": o.get("underOdds")})
            games.append({**base, "market": "puckline_home", "team": teams["home"]["abbreviation"], "line": o.get("spread"),
                          "over_odds": h.get("spreadOdds"), "under_odds": ""})
            games.append({**base, "market": "moneyline", "team": f'{teams["away"]["abbreviation"]}/{teams["home"]["abbreviation"]}',
                          "line": "", "over_odds": a.get("moneyLine"), "under_odds": h.get("moneyLine")})
            try: pb = get(f"{CORE}/events/{eid}/competitions/{eid}/odds/{pid}/propBets?limit=1000")["items"]
            except Exception as e: log(f"{game} {book} props error {e}"); pb = []
            tt = {}
            for it in pb:
                name = it["type"]["name"]; am = it["odds"]["american"]["value"]
                if name == "Anytime Goalscorer":
                    ref = it["athlete"]["$ref"].split("?")[0]; aid = ref.rstrip("/").split("/")[-1]
                    if aid not in cache and aid not in cache_put_pending:
                        entry = lookup_athlete(ref)
                        if entry and not cache_entry_bad(entry): cache[aid] = entry
                        elif entry: cache_put_pending[aid] = entry
                    elif aid in cache and cache[aid].get("team_id") not in tid and aid not in refreshed:
                        # Cached team is not in this game (trade / stale ESPN team): look it up again once.
                        refreshed.add(aid); entry = lookup_athlete(ref)
                        if entry and not cache_entry_bad(entry): cache[aid] = entry
                    c = cache.get(aid) or cache_put_pending.get(aid) or {"name": f"athlete_{aid}", "pos": "", "team_id": ""}
                    ags.append({**base, "player": c["name"], "athlete_id": aid, "pos": c["pos"], "team": tid.get(c["team_id"], ""),
                                "american_odds": am, "implied_prob": imp(am), "open_odds": it["odds"]["american"].get("open"),
                                "book_updated_utc": it.get("lastUpdated")})
                elif name.startswith("Team Total Goals"):
                    r = it.get("team", {}).get("$ref", "") or it.get("athlete", {}).get("$ref", "")
                    key = (r, it["odds"]["total"].get("value")); tt.setdefault(key, []).append(am)
            for (r, line), odds in tt.items():
                t = r.split("/teams/")[-1].split("?")[0] if "/teams/" in r else ""
                games.append({**base, "market": "team_total_excl_ot", "team": tid.get(t, t or r), "line": line,
                              "over_odds": odds[0] if odds else "", "under_odds": odds[1] if len(odds) > 1 else ""})
    json.dump(cache, open(CACHE, "w"))
    for p, rows in ((ags_p, ags), (gm_p, games)):
        if not rows: continue
        with open(p, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    log(f"ok: {len(ags)} AGS rows, {len(games)} game/team rows, {len({r['event_id'] for r in games})} games")
    print(f"AGS rows: {len(ags)}; game/team rows: {len(games)}")
if __name__ == "__main__": main()
