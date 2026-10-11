"""NHL defense vs position. No network."""
import csv
import io
import tempfile
import unittest
import urllib.error
from pathlib import Path

from nhl.build_dvp import (
    HANDOFF_GAMES,
    build_snapshot,
    build_snapshots,
    goalie_shot_games,
    main as build_dvp_main,
    rank_teams,
    sample_label,
    skater_team_games,
    window_summary,
)
from nhl.fetch_history import download_jobs
from nhl.history import SKATER_FIELDS, load_skaters
from nhl.teams import TEAM_NAMES


def skater(season, game_id, date, opp, pos, sog, points, team="TOR"):
    return {
        "season": season,
        "game_id": game_id,
        "date": date,
        "team": team,
        "opp": opp,
        "pos": pos,
        "sog": sog,
        "points": points,
    }


def team_game(season, game_id, date, team, **stats):
    row = {
        "season": season,
        "game_id": game_id,
        "date": date,
        "team": team,
        "f_sog": 0.0,
        "f_pts": 0.0,
        "d_sog": 0.0,
        "d_pts": 0.0,
        "shots": 0.0,
    }
    row.update(stats)
    return row


class AggregationTests(unittest.TestCase):
    def test_blank_defense_group_stays_zero_and_counts(self):
        games = skater_team_games([
            skater("20262027", "1", "20261001", "OTT", "F", 10, 2),
            skater("20262027", "1", "20261001", "OTT", "F", 4, 1),
        ])
        self.assertEqual(len(games), 1)
        self.assertEqual(games[0]["team"], "OTT")
        self.assertEqual(games[0]["f_sog"], 14)
        self.assertEqual(games[0]["f_pts"], 3)
        self.assertEqual(games[0]["d_sog"], 0)
        self.assertEqual(games[0]["d_pts"], 0)

        both = [
            team_game("20262027", "1", "20261001", "OTT", d_sog=0, f_sog=14),
            team_game("20262027", "2", "20261003", "OTT", d_sog=4, f_sog=8),
        ]
        summary = window_summary(both, "d_sog", "blend", "20262027", "20252026", HANDOFF_GAMES)
        self.assertEqual(summary["gp"], 2)
        self.assertEqual(summary["value"], 2)

    def test_goalie_shots_sum_on_the_offense_and_skip_missing_games(self):
        games = goalie_shot_games([
            {"season": "20262027", "game_id": "9", "date": "20261001", "team": "MTL", "opp": "TOR", "sa": 20},
            {"season": "20262027", "game_id": "9", "date": "20261001", "team": "MTL", "opp": "TOR", "sa": 8},
        ])
        self.assertEqual(len(games), 1)
        self.assertEqual(games[0]["team"], "TOR")
        self.assertEqual(games[0]["shots"], 28)

    def test_csv_forward_only_game_counts_defense_as_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "2026" / "skaters"
            folder.mkdir(parents=True)
            path = folder / "TOR.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=list(SKATER_FIELDS))
                writer.writeheader()
                writer.writerow({
                    "playerId": "1",
                    "name": "Forward",
                    "gameId": "2026020001",
                    "playerTeam": "TOR",
                    "opposingTeam": "OTT",
                    "home_or_away": "HOME",
                    "gameDate": "20261001",
                    "position": "C",
                    "situation": "all",
                    "icetime": "600",
                    "I_F_shotsOnGoal": "4",
                    "I_F_goals": "1",
                    "I_F_primaryAssists": "0",
                    "I_F_secondaryAssists": "0",
                    "I_F_points": "1",
                    "I_F_xGoals": "0.4",
                })
            games = skater_team_games(load_skaters(Path(tmp), years=("2026",)))
        self.assertEqual(games[0]["f_sog"], 4)
        self.assertEqual(games[0]["d_sog"], 0)
        self.assertEqual(games[0]["d_pts"], 0)


class WindowTests(unittest.TestCase):
    def test_blend_weights_this_season_by_games_over_20(self):
        rows = [
            team_game("20252026", "a", "20260401", "OTT", f_sog=10),
            team_game("20252026", "b", "20260403", "OTT", f_sog=10),
        ]
        rows.extend(team_game("20262027", str(index), f"2026100{index}", "OTT", f_sog=20) for index in range(1, 5))
        summary = window_summary(rows, "f_sog", "blend", "20262027", "20252026", HANDOFF_GAMES)
        self.assertEqual(summary["gp"], 4)
        self.assertEqual(summary["priorGames"], 2)
        self.assertAlmostEqual(summary["weight"], 0.2)
        self.assertAlmostEqual(summary["value"], 12.0)
        self.assertEqual(sample_label("blend", summary), "4 this season · 2 last season")

    def test_twenty_games_uses_this_season_only(self):
        rows = [team_game("20252026", "old", "20260401", "OTT", f_sog=100)]
        rows.extend(team_game("20262027", str(index), f"20261{index:03d}", "OTT", f_sog=5) for index in range(20))
        summary = window_summary(rows, "f_sog", "blend", "20262027", "20252026", HANDOFF_GAMES)
        self.assertEqual(summary["weight"], 1)
        self.assertEqual(summary["value"], 5)
        self.assertEqual(summary["gp"], 20)
        self.assertEqual(sample_label("blend", summary), "20 gp")

    def test_no_current_games_uses_last_season(self):
        rows = [team_game("20252026", "old", "20260401", "OTT", f_sog=10)]
        summary = window_summary(rows, "f_sog", "blend", "20262027", "20252026", HANDOFF_GAMES)
        self.assertEqual(summary["gp"], 0)
        self.assertEqual(summary["weight"], 0)
        self.assertEqual(summary["value"], 10)
        self.assertEqual(sample_label("blend", summary), "last season · 1 gp")

    def test_last_10_is_the_most_recent_games_and_ignores_2024(self):
        rows = [team_game("20242025", "old", "20241001", "OTT", f_sog=100)]
        rows.extend(team_game("20252026", str(index), f"20260{index:03d}", "OTT", f_sog=index) for index in range(1, 13))
        summary = window_summary(rows, "f_sog", "l10", "20262027", "20252026", HANDOFF_GAMES)
        self.assertEqual(summary["gp"], 10)
        self.assertAlmostEqual(summary["value"], 7.5)
        self.assertEqual(sample_label("l10", summary), "10 gp")

    def test_older_season_does_not_enter_the_blend(self):
        rows = [
            team_game("20242025", "old", "20241001", "OTT", f_sog=100),
            team_game("20252026", "prior", "20260401", "OTT", f_sog=10),
            team_game("20262027", "now", "20261001", "OTT", f_sog=20),
        ]
        summary = window_summary(rows, "f_sog", "blend", "20262027", "20252026", HANDOFF_GAMES)
        self.assertAlmostEqual(summary["weight"], 0.05)
        self.assertAlmostEqual(summary["value"], 10.5)


class RankTests(unittest.TestCase):
    def test_rank_1_is_the_lowest_value_and_ties_break_by_team(self):
        ranked = rank_teams([
            {"team": "BOS", "value": 2},
            {"team": "ANA", "value": 2},
            {"team": "TOR", "value": 1},
        ])
        by_team = {row["team"]: row["rank"] for row in ranked}
        self.assertEqual(by_team, {"TOR": 1, "ANA": 2, "BOS": 3})
        self.assertEqual([row["team"] for row in ranked], ["BOS", "ANA", "TOR"])

    def test_snapshot_lists_the_easiest_matchup_first(self):
        games = []
        for index, team in enumerate(sorted(TEAM_NAMES)):
            games.append(team_game("20262027", f"{team}-1", "20261001", team, f_sog=index, f_pts=index))
        snapshot = build_snapshot(games, "F", "Forwards", (
            ("sog", "f_sog", "Shots", "Shots on goal allowed to forwards, per game"),
        ))
        teams = snapshot["windows"]["blend"]["stats"]["sog"]["teams"]
        self.assertEqual(len(teams), 32)
        self.assertEqual(teams[0]["rank"], 32)
        self.assertEqual(teams[-1]["rank"], 1)
        self.assertLess(teams[-1]["value"], teams[0]["value"])
        self.assertEqual(snapshot["rankNote"], "Rank 1 is the toughest matchup. Rank 32 is the easiest.")

    def test_empty_root_does_not_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SystemExit):
                build_snapshots(Path(tmp))
            self.assertEqual(list(Path(tmp).glob("dvp_*.json")), [])


class WiringTests(unittest.TestCase):
    def test_builder_does_not_touch_projection_math(self):
        source = Path("nhl/build_dvp.py").read_text(encoding="utf-8")
        for name in ("project_shots", "project_points", "project_saves", "project_power_play_points"):
            self.assertNotIn(name, source)

    def test_dvp_cannot_block_the_board_publish_or_slate_freeze(self):
        text = Path(".github/workflows/nhl-refresh.yml").read_text(encoding="utf-8")
        board_at = text.index("python -m nhl.build_board")
        dvp_at = text.index("python -m nhl.build_dvp")
        publish_at = text.index("python publish_supabase.py")
        freeze_at = text.index("freeze_slate.py --sport nhl")
        self.assertLess(board_at, dvp_at)
        self.assertLess(dvp_at, publish_at)
        self.assertLess(publish_at, freeze_at)
        step = text[text.rindex("- name: Build NHL defense vs position"):dvp_at]
        self.assertIn("continue-on-error: true", step)

    def test_download_lands_where_the_reader_looks(self):
        jobs = download_jobs(["TOR.csv"], "/tmp/moneypuck")
        relative = {Path(dest).relative_to("/tmp/moneypuck").as_posix() for _, dest in jobs}
        self.assertEqual(relative, {
            "2025/skaters/TOR.csv",
            "2025/goalies/TOR.csv",
            "2026/skaters/TOR.csv",
            "2026/goalies/TOR.csv",
        })

    def test_rate_limit_is_retried_and_a_missing_file_is_not(self):
        import nhl.fetch_history as fetch

        calls = {"n": 0}

        def limited(url):
            calls["n"] += 1
            if calls["n"] < 3:
                raise urllib.error.HTTPError(url, 429, "slow", None, io.BytesIO(b""))
            return b"playerId,name\n1,A\n"

        original = fetch._read
        fetch._read = limited
        try:
            body = fetch._download("https://moneypuck.example/TOR.csv", sleep=lambda _delay: None)
        finally:
            fetch._read = original
        self.assertEqual(body, b"playerId,name\n1,A\n")
        self.assertEqual(calls["n"], 3)

        calls["n"] = 0

        def missing(url):
            calls["n"] += 1
            raise urllib.error.HTTPError(url, 404, "gone", None, io.BytesIO(b""))

        fetch._read = missing
        try:
            body = fetch._download("https://moneypuck.example/TOR.csv", sleep=lambda _delay: None)
        finally:
            fetch._read = original
        self.assertIsNone(body)
        self.assertEqual(calls["n"], 1)

    def test_skater_only_download_still_builds_and_a_short_one_keeps_the_last_file(self):
        # GitHub was saving about 32 files: the 2025 skater CSVs, and none of the
        # goalie CSVs. That used to exit 1 and skip the board.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "moneypuck"
            folder = root / "2025" / "skaters"
            folder.mkdir(parents=True)
            teams = sorted(TEAM_NAMES)
            for index, team in enumerate(teams):
                opp = teams[(index + 1) % len(teams)]
                path = folder / f"{team}.csv"
                with path.open("w", newline="", encoding="utf-8") as handle:
                    writer = csv.DictWriter(handle, fieldnames=list(SKATER_FIELDS))
                    writer.writeheader()
                    writer.writerow({
                        "playerId": str(index),
                        "name": "Skater",
                        "gameId": f"202502{index:04d}",
                        "playerTeam": team,
                        "opposingTeam": opp,
                        "home_or_away": "HOME",
                        "gameDate": "20260401",
                        "position": "C",
                        "situation": "all",
                        "icetime": "600",
                        "I_F_shotsOnGoal": str(index + 1),
                        "I_F_goals": "0",
                        "I_F_primaryAssists": "0",
                        "I_F_secondaryAssists": "0",
                        "I_F_points": "1",
                        "I_F_xGoals": "0.2",
                    })
            snapshots = build_snapshots(root)
            goalies = snapshots["dvp_g.json"]["windows"]["blend"]["stats"]["shots"]["teams"]
            self.assertEqual(len(goalies), 32)
            by_team = {row["team"]: row["value"] for row in goalies}
            self.assertEqual(by_team["BOS"], 2.0)

            out = Path(tmp) / "out"
            out.mkdir()
            kept = out / "dvp_f.json"
            kept.write_text('{"kept": true}\n')
            (folder / f"{teams[0]}.csv").unlink()
            code = build_dvp_main(["--root", str(root), "--out", str(out)])
            self.assertEqual(code, 0)
            self.assertEqual(kept.read_text(), '{"kept": true}\n')
            self.assertFalse((out / "dvp_g.json").exists())

    def test_publish_registers_optional_dvp_tables(self):
        text = Path("publish_supabase.py").read_text(encoding="utf-8")
        for filename, table in (
            ("nhl/dvp_f.json", "nhl_dvp_f"),
            ("nhl/dvp_d.json", "nhl_dvp_d"),
            ("nhl/dvp_g.json", "nhl_dvp_g"),
        ):
            self.assertIn(f'"{filename}": "{table}"', text)
            self.assertIn(f'"{table}"', text)
        optional = text.split("OPTIONAL_TABLES", 1)[1].split("}", 1)[0]
        for table in ("nhl_dvp_f", "nhl_dvp_d", "nhl_dvp_g"):
            self.assertIn(table, optional)

    def test_sql_locks_the_three_tables(self):
        sql = Path("sql/nhl_dvp.sql").read_text(encoding="utf-8")
        schema = Path("sql/nhl_schema.sql").read_text(encoding="utf-8")
        for table in ("nhl_dvp_f", "nhl_dvp_d", "nhl_dvp_g"):
            for text in (sql, schema):
                self.assertIn(f"public.{table}", text)
                self.assertIn(f"alter table public.{table} enable row level security", text)
                self.assertIn(f"revoke all on public.{table} from anon, authenticated", text)

    def test_generated_json_is_gitignored(self):
        text = Path(".gitignore").read_text(encoding="utf-8")
        for name in ("nhl/dvp_f.json", "nhl/dvp_d.json", "nhl/dvp_g.json"):
            self.assertIn(name, text)


if __name__ == "__main__":
    unittest.main()
