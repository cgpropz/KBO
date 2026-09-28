import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pipeline.snapshot_consistency import (
    ODDS_FETCH_STEP,
    PUBLISH_SKEW_LIMIT_MINUTES,
    age_timestamp,
    intraday_publish_block_reason,
    publish_gate_errors,
    skew_anchor,
    skew_minutes,
    strikeout_pair_mismatches,
)


NOW = datetime(2026, 9, 27, 19, 46, tzinfo=timezone.utc)


def _iso(when):
    return when.isoformat()


def _projection(name, team, opponent, generated_at):
    return {
        "generated_at": _iso(generated_at),
        "projections": [
            {"name": name, "team": team, "opponent": opponent},
        ],
    }


def _matchup(away, home, generated_at):
    return {
        "generated_at": _iso(generated_at),
        "matchups": [{"away": away, "home": home}],
    }


class WorkflowGuardTests(unittest.TestCase):
    def test_refresh_data_treats_only_the_odds_step_as_non_blocking(self):
        import refresh_data

        names = [step["name"] for step in refresh_data.STEPS]
        self.assertIn(ODDS_FETCH_STEP, names)

    def test_deploy_does_not_raise_the_skew_limit_or_regenerate_snapshots(self):
        root = Path(__file__).resolve().parent
        deploy = (root / ".github" / "workflows" / "deploy.yml").read_text()
        verifier = (root / "pipeline" / "verify_production_data.py").read_text()
        self.assertIn("--skip-snapshot-regen", deploy)
        self.assertNotIn("max-skew-minutes", deploy)
        self.assertIn("default=180.0", verifier)


class PublishGateTests(unittest.TestCase):
    def _times(self, minutes_apart=0):
        return {
            "strikeout_projections": NOW,
            "batter_projections": NOW + timedelta(minutes=minutes_apart),
            "matchup_data": NOW,
            "pitcher_rankings": NOW,
        }

    def test_odds_miss_still_publishes_when_the_rebuilt_set_agrees(self):
        errors = publish_gate_errors(
            failed=[ODDS_FETCH_STEP],
            has_last_good_lines=True,
            generated_times=self._times(),
            pair_mismatches=[],
        )
        self.assertEqual(errors, [])

    def test_odds_miss_without_cached_lines_does_not_publish(self):
        errors = publish_gate_errors(
            failed=[ODDS_FETCH_STEP],
            has_last_good_lines=False,
            generated_times=self._times(),
            pair_mismatches=[],
        )
        self.assertTrue(any("no last-good lines" in item for item in errors))

    def test_other_failures_block_the_whole_publish(self):
        errors = publish_gate_errors(
            failed=[ODDS_FETCH_STEP, "Daily Lineups"],
            has_last_good_lines=True,
            generated_times=self._times(),
            pair_mismatches=[],
        )
        self.assertEqual(len(errors), 1)
        self.assertIn("Daily Lineups", errors[0])
        self.assertNotIn(ODDS_FETCH_STEP, errors[0])

    def test_skew_above_the_existing_limit_keeps_the_last_good_set(self):
        errors = publish_gate_errors(
            failed=[],
            has_last_good_lines=True,
            generated_times=self._times(minutes_apart=PUBLISH_SKEW_LIMIT_MINUTES + 1),
            pair_mismatches=[],
        )
        self.assertTrue(any("keeping the last good published set" in item for item in errors))

    def test_skew_at_the_limit_still_publishes(self):
        errors = publish_gate_errors(
            failed=[],
            has_last_good_lines=True,
            generated_times=self._times(minutes_apart=PUBLISH_SKEW_LIMIT_MINUTES),
            pair_mismatches=[],
        )
        self.assertEqual(errors, [])

    def test_slate_mismatch_blocks_publish(self):
        errors = publish_gate_errors(
            failed=[ODDS_FETCH_STEP],
            has_last_good_lines=True,
            generated_times=self._times(),
            pair_mismatches=["Hwang Jun-Seo (Hanwha vs NC; expected one of ['Lotte'])"],
        )
        self.assertTrue(any("Hwang Jun-Seo" in item for item in errors))


class PairMismatchTests(unittest.TestCase):
    def test_same_slate_has_no_mismatches(self):
        strikeout = _projection("Natsuki Toda", "NC", "Hanwha", NOW)
        matchup = _matchup("NC", "Hanwha", NOW)
        self.assertEqual(strikeout_pair_mismatches(strikeout, matchup), [])

    def test_stale_matchup_slate_is_reported(self):
        strikeout = _projection("Hwang Jun-Seo", "HAN", "NC", NOW)
        matchup = _matchup("Hanwha", "Lotte", NOW)
        mismatches = strikeout_pair_mismatches(strikeout, matchup)
        self.assertEqual(len(mismatches), 1)
        self.assertIn("Hwang Jun-Seo", mismatches[0])
        self.assertIn("Lotte", mismatches[0])


class IntradayGateTests(unittest.TestCase):
    def test_allows_republish_when_rebuilt_files_match_the_slate(self):
        strikeout = _projection("Natsuki Toda", "NC", "Hanwha", NOW)
        batter = {"generated_at": _iso(NOW + timedelta(minutes=2)), "projections": []}
        matchup = _matchup("Hanwha", "NC", NOW - timedelta(hours=7))
        self.assertIsNone(intraday_publish_block_reason(strikeout=strikeout, batter=batter, matchup=matchup))

    def test_blocks_when_batter_file_was_preserved_from_an_older_run(self):
        strikeout = _projection("Natsuki Toda", "NC", "Hanwha", NOW)
        batter = {"generated_at": _iso(NOW - timedelta(hours=12)), "projections": []}
        matchup = _matchup("Hanwha", "NC", NOW - timedelta(hours=12))
        reason = intraday_publish_block_reason(strikeout=strikeout, batter=batter, matchup=matchup)
        self.assertIn("not rebuilt", reason)

    def test_blocks_slate_mismatch_without_publishing(self):
        strikeout = _projection("Hwang Jun-Seo", "Hanwha", "NC", NOW)
        batter = {"generated_at": _iso(NOW), "projections": []}
        matchup = _matchup("Hanwha", "Lotte", NOW)
        reason = intraday_publish_block_reason(strikeout=strikeout, batter=batter, matchup=matchup)
        self.assertIn("not in matchup_data", reason)


class SkewAnchorTests(unittest.TestCase):
    def test_cohort_stamp_is_the_skew_clock_and_not_the_age_clock(self):
        generated = NOW - timedelta(minutes=401)
        published = NOW
        payload = {"generated_at": _iso(generated), "published_at": _iso(published), "projections": []}
        self.assertEqual(age_timestamp(payload), generated)
        self.assertEqual(skew_anchor(payload), published)

    def test_missing_cohort_stamp_falls_back_to_generated_at(self):
        generated = NOW - timedelta(minutes=401)
        payload = {"generated_at": _iso(generated)}
        self.assertEqual(skew_anchor(payload), generated)

    def test_rankings_list_uses_the_publish_row_time(self):
        row_time = _iso(NOW)
        self.assertEqual(skew_anchor([{"name": "Kim"}], api_updated_at=row_time), NOW)
        self.assertIsNone(age_timestamp([{"name": "Kim"}], api_updated_at=None))

    def test_partial_cohort_still_shows_a_real_gap(self):
        old = NOW - timedelta(minutes=401)
        fresh = {"generated_at": _iso(NOW), "published_at": _iso(NOW)}
        stale = {"generated_at": _iso(old)}
        gap = skew_minutes([skew_anchor(fresh), skew_anchor(stale)])
        self.assertGreater(gap, PUBLISH_SKEW_LIMIT_MINUTES)

    def test_shared_cohort_is_inside_the_limit_even_if_builds_differ(self):
        old_matchup = {
            "generated_at": _iso(NOW - timedelta(minutes=401)),
            "published_at": _iso(NOW),
        }
        fresh_projections = {
            "generated_at": _iso(NOW),
            "published_at": _iso(NOW),
        }
        gap = skew_minutes([
            skew_anchor(old_matchup),
            skew_anchor(fresh_projections),
            skew_anchor([{"rk": 1}], api_updated_at=_iso(NOW)),
        ])
        self.assertLess(gap, 1)


if __name__ == "__main__":
    unittest.main()
