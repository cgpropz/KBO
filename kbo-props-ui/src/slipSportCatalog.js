// Prop names and team codes used to tell saved slips apart.
// The lists mirror the slip builder in slipSports.js (kboShort, BASKET_SHORT,
// NFL_SHORT, NHL_SHORT) plus the KBO stat names the day grader already maps.
// pipeline/saved_slip_sport.py reads this file. Keep the arrays valid JSON.

export const KNOWN_SPORTS = ["kbo", "nfl", "wnba", "nhl", "nba"]
export const GRADED_SPORTS = ["kbo", "nfl", "wnba", "nhl"]

export const KBO_TEAMS = ["Doosan", "Hanwha", "Kia", "Kiwoom", "KT", "LG", "Lotte", "NC", "Samsung", "SSG"]

export const KBO_PROPS = [
  "Strikeouts",
  "Hits Allowed",
  "Pitching Outs",
  "Hits+Runs+RBIs",
  "Total Bases",
  "Pitcher Strikeouts",
  "Hitter Fantasy Score",
  "K",
  "HA",
  "OUTS",
  "HRR",
  "TB"
]

export const FANTASY_PROPS = ["Fantasy Score", "FANT"]

export const BASKET_PROPS = [
  "Points",
  "Rebounds",
  "Assists",
  "3-PT Made",
  "Steals",
  "Blocks",
  "Blocked Shots",
  "Turnovers",
  "Pts+Rebs+Asts",
  "Pts+Rebs",
  "Pts+Asts",
  "Rebs+Asts",
  "Reb+Asts",
  "Blks+Stls",
  "Double-Double",
  "Triple-Double",
  "PTS",
  "REB",
  "AST",
  "3PM",
  "STL",
  "BLK",
  "TOV",
  "PRA",
  "PR",
  "PA",
  "RA",
  "BS",
  "DD",
  "TD"
]

export const NFL_PROPS = [
  "Pass Yards",
  "Pass Attempts",
  "Pass Completions",
  "Pass TDs",
  "Pass+Rush Yds",
  "Rush Yards",
  "Rush Attempts",
  "Rush+Rec Yds",
  "Receiving Yards",
  "Receptions",
  "Rec Targets",
  "PY",
  "PA",
  "PC",
  "PTD",
  "P+R",
  "RY",
  "RA",
  "R+R",
  "RecY",
  "REC",
  "TGT"
]

export const NHL_PROPS = [
  "Shots On Goal",
  "Points",
  "Power Play Points",
  "Goalie Saves",
  "SOG",
  "PTS",
  "PPP",
  "SV"
]

export const NFL_TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB",
  "HOU", "IND", "JAX", "JAC", "KC", "LA", "LAR", "LAC", "LV", "MIA", "MIN", "NE", "NO",
  "NYG", "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS", "WSH"
]

export const NHL_TEAMS = [
  "ANA", "BOS", "BUF", "CAR", "CBJ", "CGY", "CHI", "COL", "DAL", "DET", "EDM", "FLA",
  "LAK", "MIN", "MTL", "NJD", "NSH", "NYI", "NYR", "OTT", "PHI", "PIT", "SEA", "SJS",
  "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WPG", "WSH", "LA", "NJ", "SJ", "TB", "WAS",
  "MON", "VEG", "UTAH", "LAS"
]

export const WNBA_TEAMS = [
  "ATL", "CHI", "CON", "CONN", "DAL", "GS", "GSV", "IND", "LA", "LAS", "LV", "LVA",
  "MIN", "NY", "NYL", "PDX", "PHO", "PHX", "POR", "SEA", "TOR", "WAS", "WSH"
]

export const NBA_TEAMS = [
  "ATL", "BKN", "BOS", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GS", "GSW", "HOU",
  "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NO", "NOP", "NY", "NYK", "OKC",
  "ORL", "PHI", "PHX", "POR", "SA", "SAC", "SAS", "TOR", "UTA", "UTAH", "WSH", "WAS"
]
