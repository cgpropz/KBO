"""NHL abbreviations. MoneyPuck, the NHL API, PrizePicks, and ESPN do not match."""
from __future__ import annotations

# Canonical abbrev is the one MoneyPuck uses in the 2025-26 files.
ALIASES = {
    "LA": "LAK",
    "NJ": "NJD",
    "SJ": "SJS",
    "TB": "TBL",
    "WAS": "WSH",
    "MON": "MTL",
    "VEG": "VGK",
    "UTAH": "UTA",
    "LAS": "VGK",
}

TEAM_NAMES = {
    "ANA": "Anaheim Ducks",
    "BOS": "Boston Bruins",
    "BUF": "Buffalo Sabres",
    "CAR": "Carolina Hurricanes",
    "CBJ": "Columbus Blue Jackets",
    "CGY": "Calgary Flames",
    "CHI": "Chicago Blackhawks",
    "COL": "Colorado Avalanche",
    "DAL": "Dallas Stars",
    "DET": "Detroit Red Wings",
    "EDM": "Edmonton Oilers",
    "FLA": "Florida Panthers",
    "LAK": "Los Angeles Kings",
    "MIN": "Minnesota Wild",
    "MTL": "Montreal Canadiens",
    "NJD": "New Jersey Devils",
    "NSH": "Nashville Predators",
    "NYI": "New York Islanders",
    "NYR": "New York Rangers",
    "OTT": "Ottawa Senators",
    "PHI": "Philadelphia Flyers",
    "PIT": "Pittsburgh Penguins",
    "SEA": "Seattle Kraken",
    "SJS": "San Jose Sharks",
    "STL": "St. Louis Blues",
    "TBL": "Tampa Bay Lightning",
    "TOR": "Toronto Maple Leafs",
    "UTA": "Utah Mammoth",
    "VAN": "Vancouver Canucks",
    "VGK": "Vegas Golden Knights",
    "WPG": "Winnipeg Jets",
    "WSH": "Washington Capitals",
}

# ESPN's logo slug is not always the NHL abbreviation.
ESPN_SLUG = {
    "LAK": "la",
    "NJD": "nj",
    "SJS": "sj",
    "TBL": "tb",
    "UTA": "utah",
    "MTL": "mtl",
    "NSH": "nsh",
    "CBJ": "cbj",
    "VGK": "vgk",
    "WSH": "wsh",
}


def team_abbr(value: str | None) -> str:
    text = str(value or "").strip().upper()
    if not text:
        return ""
    return ALIASES.get(text, text)


def team_name(abbr: str | None) -> str:
    key = team_abbr(abbr)
    return TEAM_NAMES.get(key, key)


def name_to_abbr(name: str | None) -> str:
    text = str(name or "").strip().lower()
    if not text:
        return ""
    for abbr, full in TEAM_NAMES.items():
        if full.lower() == text or full.lower().endswith(" " + text):
            return abbr
    return team_abbr(text)
