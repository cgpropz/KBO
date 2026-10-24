"""Correlation pairs: pushes drop out, sample floors hold, opponents are limited."""
import csv
import json
from pathlib import Path

from pipeline.correlations import (
    MIN_SHARED,
    Appearance,
    LogBook,
    Prop,
    correlate,
    kbo_log_columns,
    kbo_logs_ready,
    load_kbo_logs,
)
from publish_supabase import TABLES, missing_table_message, tables_for_prefix

REPO = Path(__file__).resolve().parent


def _prop(player, stat, team, opponent, line, kind):
    return Prop(player, stat, team, opponent, line, kind)


def _book(entries):
    """entries: (player, stat, game, team, opponent, actual, started)"""
    book = LogBook()
    for player, stat, game, team, opponent, actual, started in entries:
        book.add(player, stat, game, Appearance(team, opponent, actual, started))
    return book


def test_kbo_logs_have_date_and_opponent_keys():
    batter = REPO / "Batters-Data" / "KBO_daily_batting_stats_combined.csv"
    pitcher = REPO / "Pitchers-Data" / "pitcher_logs.json"
    with batter.open(newline="", encoding="utf-8") as handle:
        batter_fields = csv.DictReader(handle).fieldnames
    rows = json.loads(pitcher.read_text(encoding="utf-8"))
    pitcher_fields = list(rows[0].keys())
    found = kbo_log_columns(batter_fields, pitcher_fields)
    assert found == {
        "batter_date": True,
        "batter_opponent": True,
        "pitcher_date": True,
        "pitcher_opponent": True,
    }
    assert kbo_logs_ready(batter_fields, pitcher_fields)
    book, _checked = load_kbo_logs(batter, pitcher)
    assert book.series, "KBO logs should produce at least one player series"


def test_push_is_excluded_and_agreement_uses_the_current_line():
    # 16 games both over, 4 both disagree, 3 pushes on the batter. Pushes leave.
    entries = []
    for index in range(16):
        entries.append(("A", "Hits+Runs+RBIs", f"g{index}", "LG", "KT", 2, False))
        entries.append(("B", "Total Bases", f"g{index}", "LG", "KT", 3, False))
    for index in range(16, 20):
        entries.append(("A", "Hits+Runs+RBIs", f"g{index}", "LG", "KT", 2, False))
        entries.append(("B", "Total Bases", f"g{index}", "LG", "KT", 0, False))
    for index in range(20, 23):
        entries.append(("A", "Hits+Runs+RBIs", f"g{index}", "LG", "KT", 1.5, False))
        entries.append(("B", "Total Bases", f"g{index}", "LG", "KT", 4, False))
    props = [
        _prop("A", "Hits+Runs+RBIs", "LG", "KT", 1.5, "batter"),
        _prop("B", "Total Bases", "LG", "KT", 1.5, "batter"),
    ]
    document = correlate("kbo", props, _book(entries))
    assert document["pairs"] == [{
        "player": "A",
        "stat": "Hits+Runs+RBIs",
        "partner": "B",
        "partnerStat": "Total Bases",
        "agreement": 0.8,
        "n": 20,
    }]


def test_sample_floor_and_middle_band_are_dropped():
    entries = []
    for index in range(14):
        entries.append(("A", "Points", f"g{index}", "LAL", "BOS", 20, False))
        entries.append(("B", "Rebounds", f"g{index}", "LAL", "BOS", 10, False))
    short = correlate("nba", [
        _prop("A", "Points", "LAL", "BOS", 15.5, "player"),
        _prop("B", "Rebounds", "LAL", "BOS", 5.5, "player"),
    ], _book(entries))
    assert short["pairs"] == []
    assert MIN_SHARED["nba"] == 15
    assert MIN_SHARED["wnba"] == 8

    # 10 of 16 agree is 62.5%, enough for WNBA and above 60%.
    entries = []
    for index in range(10):
        entries.append(("A", "Points", f"g{index}", "LA", "GS", 20, False))
        entries.append(("B", "Rebounds", f"g{index}", "LA", "GS", 10, False))
    for index in range(10, 16):
        entries.append(("A", "Points", f"g{index}", "LA", "GS", 20, False))
        entries.append(("B", "Rebounds", f"g{index}", "LA", "GS", 1, False))
    hot = correlate("wnba", [
        _prop("A", "Points", "LA", "GS", 15.5, "player"),
        _prop("B", "Rebounds", "LA", "GS", 5.5, "player"),
    ], _book(entries))
    assert hot["pairs"][0]["n"] == 16
    assert hot["pairs"][0]["agreement"] == 0.625

    # Exactly 60% is not "above 60%" and is not published.
    entries = []
    for index in range(9):
        entries.append(("A", "Points", f"g{index}", "LA", "GS", 20, False))
        entries.append(("B", "Rebounds", f"g{index}", "LA", "GS", 10, False))
    for index in range(9, 15):
        entries.append(("A", "Points", f"g{index}", "LA", "GS", 20, False))
        entries.append(("B", "Rebounds", f"g{index}", "LA", "GS", 1, False))
    even = correlate("wnba", [
        _prop("A", "Points", "LA", "GS", 15.5, "player"),
        _prop("B", "Rebounds", "LA", "GS", 5.5, "player"),
    ], _book(entries))
    assert even["pairs"] == []


def test_kbo_pitcher_pairs_only_with_opposing_batters_on_starts():
    entries = []
    for index in range(16):
        entries.append(("Starter", "Strikeouts", f"g{index}", "Kia", "LG", 6, True))
        entries.append(("Batter", "Hits+Runs+RBIs", f"g{index}", "LG", "Kia", 2, False))
        entries.append(("Mate", "Total Bases", f"g{index}", "Kia", "LG", 2, False))
        # Relief appearance against the same batter does not count.
        entries.append(("Starter", "Strikeouts", f"r{index}", "Kia", "LG", 1, False))
        entries.append(("Batter", "Hits+Runs+RBIs", f"r{index}", "LG", "Kia", 0, False))
    props = [
        _prop("Starter", "Strikeouts", "Kia", "LG", 5.5, "pitcher"),
        _prop("Batter", "Hits+Runs+RBIs", "LG", "Kia", 1.5, "batter"),
        _prop("Mate", "Total Bases", "Kia", "LG", 1.5, "batter"),
    ]
    document = correlate("kbo", props, _book(entries))
    keys = {(row["player"], row["stat"], row["partner"], row["partnerStat"]) for row in document["pairs"]}
    assert ("Batter", "Hits+Runs+RBIs", "Starter", "Strikeouts") in keys
    assert ("Mate", "Total Bases", "Starter", "Strikeouts") in keys
    starter_batter = next(row for row in document["pairs"] if row["partner"] == "Starter" and row["player"] == "Batter")
    assert starter_batter["n"] == 16
    assert starter_batter["agreement"] == 1.0


def test_games_on_opposite_clubs_do_not_count_as_teammates():
    entries = []
    for index in range(20):
        club = "LG" if index < 16 else "KT"
        other = "KT" if club == "LG" else "LG"
        entries.append(("A", "Points", f"g{index}", club, other, 20, False))
        entries.append(("B", "Rebounds", f"g{index}", "LG", "KT", 10, False))
    document = correlate("nba", [
        _prop("A", "Points", "LG", "KT", 15.5, "player"),
        _prop("B", "Rebounds", "LG", "KT", 5.5, "player"),
    ], _book(entries))
    assert document["pairs"][0]["n"] == 16


def test_nfl_qb_correlates_with_opposing_receivers_not_kickers():
    entries = []
    for index in range(10):
        entries.append(("QB", "Pass Yards", f"g{index}", "KC", "BUF", 280, False))
        entries.append(("WR", "Receiving Yards", f"g{index}", "BUF", "KC", 80, False))
        entries.append(("K", "Rush Yards", f"g{index}", "BUF", "KC", 0, False))
    # The kicker prop is not an offensive skill prop, so it is not an opponent pair.
    props = [
        _prop("QB", "Pass Yards", "KC", "BUF", 250.5, "qb"),
        _prop("WR", "Receiving Yards", "BUF", "KC", 60.5, "offense"),
        _prop("K", "Rush Yards", "BUF", "KC", 0.5, "other"),
    ]
    document = correlate("nfl", props, _book(entries))
    assert len(document["pairs"]) == 1
    assert document["pairs"][0]["player"] == "QB"
    assert document["pairs"][0]["partner"] == "WR"
    assert document["pairs"][0]["n"] == 10
    assert MIN_SHARED["nfl"] == 8


def test_publish_prefix_includes_the_sport_correlation_file():
    assert TABLES["correlations_kbo.json"] == "correlations_kbo"
    assert TABLES["correlations_nba.json"] == "nba_correlations"
    assert TABLES["correlations_nhl.json"] == "nhl_correlations"
    wnba = tables_for_prefix("wnba/")
    assert "correlations_wnba.json" in wnba
    assert "correlations_kbo.json" not in wnba
    props_only = tables_for_prefix("wnba/projections")
    assert "wnba/projections_standard.json" in props_only
    assert "correlations_wnba.json" in props_only
    full = tables_for_prefix("")
    assert "correlations_kbo.json" in full
    assert "correlations_nba.json" not in full
    assert "correlations_nhl.json" not in full
    assert "correlations_nba.json" in tables_for_prefix("nba/")
    assert "correlations_nhl.json" in tables_for_prefix("nhl/")
    repair = tables_for_prefix("correlations")
    assert set(repair) == {
        "correlations_kbo.json",
        "correlations_wnba.json",
        "correlations_nfl.json",
        "correlations_nba.json",
        "correlations_nhl.json",
    }
    assert repair["correlations_nba.json"] == "nba_correlations"
    assert "nba/projections_standard.json" not in repair
    assert "nhl/projections.json" not in repair
    message = missing_table_message("nba_correlations")
    assert "sql/correlations.sql" in message
    assert "PUBLISH_ONLY_PREFIX=correlations" in message
