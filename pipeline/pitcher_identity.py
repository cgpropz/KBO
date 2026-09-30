"""Join KBO starter pcodes onto the pitcher game-log roster.

The daily lineup file (Pitchers-Data/player_names.csv) already carries the
official KBO pcode for each probable starter. The log scraper used to ignore
that column unless the pitcher was hardcoded or mykbostats had already stored
a numeric kbo_player_id. New foreign pitchers (Owen White, pcode 56724) then
kept an empty id and their recent starts never reached the UI.
"""

from __future__ import annotations

import re

# Keys must match PLAYER_TEAMS in Pitchers-Data/NEWPITCHER_LOG25.py.
TEAM_KEYS = {
    "KIA": "KIA",
    "LG": "LG",
    "NC": "NC",
    "SSG": "SSG",
    "KT": "KT",
    "KIWOOM": "Kiwoom",
    "DOOSAN": "DOOSAN",
    "HANWHA": "HANWHA",
    "SAMSUNG": "SAMSUNG",
    "LOTTE": "LOTTE",
}


def roster_team_key(team: str) -> str:
    """Map a lineup team label onto the scraper's PLAYER_TEAMS key."""
    raw = (team or "").strip()
    if not raw:
        return ""
    mapped = TEAM_KEYS.get(raw.upper())
    if mapped:
        return mapped
    first = raw.split()[0].upper()
    return TEAM_KEYS.get(first, raw)


def merge_roster_entries(player_names, player_teams, name_aliases, entries) -> int:
    """Insert {pcode, name, team} rows into the in-memory scrape roster.

    `name_aliases` rewrites KBO English 'LAST First' forms (WHITE Owen ->
    Owen White) so saved logs join PrizePicks display names. Returns how many
    name or team-list slots were added.
    """
    added = 0
    for entry in entries:
        pcode = str(entry.get("pcode") or "").strip()
        name = str(entry.get("name") or "").strip()
        team = roster_team_key(entry.get("team") or "")
        if not pcode.isdigit() or not name:
            continue
        canonical = name_aliases.get(name, name)
        if pcode not in player_names:
            player_names[pcode] = canonical
            added += 1
        else:
            existing = player_names[pcode]
            if name != existing and name not in name_aliases:
                name_aliases[name] = existing
        if not team:
            continue
        bucket = player_teams.setdefault(team, [])
        if pcode not in bucket:
            bucket.append(pcode)
            added += 1
    return added


def slate_additions(slate_rows, roster_pcodes) -> list:
    """Starter rows whose lineup pcode is not yet on the scrape roster.

    The lineup pcode is authoritative. Callers should prefer these rows over
    a pitching-leaderboard guess, which drops pitchers under the IP cutoff.
    """
    additions = []
    seen = set()
    roster_pcodes = {str(p) for p in roster_pcodes}
    for row in slate_rows:
        pcode = str(row.get("Pcode") or row.get("pcode") or "").strip()
        name = str(row.get("Player") or row.get("name") or "").strip()
        team = str(row.get("Team") or row.get("team") or "").strip()
        if not pcode.isdigit() or not name or pcode in seen:
            continue
        seen.add(pcode)
        if pcode in roster_pcodes:
            continue
        additions.append({
            "pcode": pcode,
            "name": name,
            "team": roster_team_key(team),
            "source": "player_names.csv",
        })
    return additions


def insert_player_name(src: str, pcode: str, name: str) -> str:
    """Add one PLAYER_NAMES entry. No-op if the pcode is already present."""
    if re.search(rf"""["']{re.escape(pcode)}["']\s*:""", src):
        return src
    insertion = f'    "{pcode}": "{name}",\n}}'
    # PLAYER_NAMES is followed by a blank line, then PLAYER_TEAMS.
    new_src, n = re.subn(
        r"\n\}\s*\n+PLAYER_TEAMS",
        "\n" + insertion + "\n\nPLAYER_TEAMS",
        src,
        count=1,
    )
    return new_src if n else src


def insert_team_pcode(src: str, team_key: str, pcode: str) -> str:
    """Append a pcode to PLAYER_TEAMS[team_key]. No-op if already listed."""
    if not team_key or not str(pcode).isdigit():
        return src
    pattern = re.compile(
        r'("' + re.escape(team_key) + r'"\s*:\s*\[)([^\]]*?)(\])',
        re.S,
    )
    match = pattern.search(src)
    if not match:
        return src
    codes = match.group(2)
    if re.search(rf"""["']{re.escape(str(pcode))}["']""", codes):
        return src
    new_codes = codes.rstrip() + f", '{pcode}'"
    return src[:match.start()] + match.group(1) + new_codes + match.group(3) + src[match.end():]
