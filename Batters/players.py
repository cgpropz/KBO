"""
KBO Batter Data Module
Contains player names, team mappings, and utility functions for KBO batters.
"""

# --- PLAYER NAMES (pcode -> name) ---
PLAYER_NAMES = {
    "62404": "Koo Ja-wook", "74540": "Kang Min-ho", "50458": "Kim Ji-chan", "52430": "Kim Young-woong",
    "62234": "Ryu Ji-hyuk", "52415": "Lee Jae-hyeon", "54400": "Lewin Díaz", "75125": "Park Byung-ho",
    "55208": "Jake Cave", "52025": "Henry Ramos", "79240": "Heo Kyoung-Min", "54295": "Jared Young",
    "79231": "Jung Soo-bin", "63123": "Kang Seung-ho", "78224": "Kim Jae-hwan", "76232": "Yang Eui-ji",
    "64153": "Yang Suk-Hwan", "55734": "Estevan Florial", "79608": "An Chi-Hong", "50707": "Choi In-ho",
    "79192": "Chae Eun-seong", "66715": "Kim In-Hwan", "66704": "Kim Tae-yean", "69737": "Roh Si-Hwan",
    "54730": "Yonathan Perlaza", "55703": "Luis Liberato", "72443": "Choi Hyoung-woo", "66606": "Choi Won-jun",
    "52605": "Kim Do-yeong", "78603": "Kim Sun-bin", "63260": "Lee Woo-sung", "62947": "Na Sung-bum",
    "64646": "Park Chan-ho", "52630": "Socrates Brito", "65357": "Song Sung-mun", "51302": "Lee Ju-hyoung",
    "52366": "Yasiel Puig", "54444": "Ruben Cardenas", "67304": "Kim Hye-Seong", "53327": "Ronnie Dawson",
    "78135": "Lee Hyung-jong", "50054": "Cheon Seong-ho", "78548": "Jang Sung-woo", "68050": "Kang Baek-ho",
    "64004": "Kim Min-hyuck", "67025": "Mel Rojas Jr.", "79402": "Sang-su Kim", "53123": "Austin Dean",
    "66108": "Hong Chang-ki", "76290": "Kim Hyun-soo", "69102": "Moon Bo-gyeong", "68119": "Moon Sung-Ju",
    "79365": "Park Dong-won", "62415": "Park Hae-min", "65207": "Shin Min-jae", "50500": "Hwang Seong-bin",
    "78513": "Jeon Jun-woo", "60523": "Jung Hoon", "61102": "Kang-nam Yoo", "51551": "Na Seung-yeup",
    "50150": "Son Ho-young", "54529": "Víctor Reyes", "52591": "Yoon Dong-hee", "69517": "Go Seung-min",
    "51907": "Kim Ju-won", "63963": "Kwon Hui-dong", "54944": "Matthew Davidson", "62907": "Park Min-woo",
    "79215": "Park Kun-woo", "77532": "Son Ah-seop", "75847": "Choi Jeong", "50854": "Choi Ji-Hoon",
    "53827": "Guillermo Heredia", "69813": "Ha Jae-hoon", "62895": "Han Yoo-seom", "62864": "Min-sik Kim",
    "54805": "Park Ji-hwan", "53764": "Moon Hyun-bin", "67449": "Kim Seong-yoon", "52001": "Ahn Hyun-min",
    "55392": "Eo Joon-seo", "64340": "Im Ji-yeol", "69636": "Oh Sun-woo"
}

# --- TEAM MAPPINGS ---
TEAM_ROSTERS = {
    "Samsung": ["62404", "74540", "50458", "52430", "62234", "52415", "54400", "75125", "67449"],
    "Doosan": ["55208", "52025", "79240", "54295", "79231", "63123", "78224", "76232", "64153"],
    "Hanwha": ["55734", "79608", "50707", "79192", "66715", "66704", "69737", "54730", "55703"],
    "Kia": ["55645", "72443", "66606", "52605", "78603", "63260", "62947", "64646", "52630", "69636"],
    "Kiwoom": ["65357", "51302", "52366", "54444", "67304", "53327", "78135", "55392", "64340"],
    "KT": ["50054", "78548", "68050", "64004", "67025", "79402", "52001"],
    "LG": ["53123", "66108", "76290", "69102", "68119", "79365", "62415", "65207"],
    "Lotte": ["50500", "78513", "60523", "61102", "51551", "50150", "54529", "52591", "69517"],
    "NC": ["51907", "63963", "54944", "62907", "79215", "77532"],
    "SSG": ["75847", "50854", "53827", "69813", "62895", "62864", "54805"]
}

# --- PLAYER TEAMS (pcode -> team) ---
PLAYER_TEAMS = {code: team for team, codes in TEAM_ROSTERS.items() for code in codes}

# --- SPECIAL TEAMS (uppercase formatting) ---
SPECIAL_TEAMS = {'NC', 'LG', 'SSG', 'KT'}


# --- UTILITY FUNCTIONS ---
def get_player_name(pcode: str) -> str:
    """Get player name by player code."""
    return PLAYER_NAMES.get(pcode, f"Unknown_{pcode}")


def get_player_team(pcode: str) -> str:
    """Get player's team by player code."""
    return PLAYER_TEAMS.get(pcode, "Unknown")


def get_team_roster(team: str) -> list:
    """Get all player codes for a team."""
    return TEAM_ROSTERS.get(team, [])


def get_all_player_codes() -> list:
    """Get all player codes."""
    return list(PLAYER_NAMES.keys())


def format_team_name(team: str) -> str:
    """Format team name with proper capitalization."""
    return team.upper() if team.upper() in SPECIAL_TEAMS else team.capitalize()


def get_player_info(pcode: str) -> dict:
    """Get full player info by player code."""
    return {
        "pcode": pcode,
        "name": get_player_name(pcode),
        "team": get_player_team(pcode)
    }
