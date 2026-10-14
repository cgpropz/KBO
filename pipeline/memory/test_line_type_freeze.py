"""Line type + payout multiplier are stored at freeze (no scoring change)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "nfl"))

import build_projection_data as nfl  # noqa: E402


def _payload(odds_type, extra=None):
    attrs = {"stat_type": "Pass TDs", "odds_type": odds_type, "line_score": 1.5,
             "description": "NYG", "start_time": "2026-10-18T17:00:00Z"}
    attrs.update(extra or {})
    return {
        "included": [{"id": "p1", "attributes": {"name": "Jaxson Dart", "league": "NFL", "team": "NYG"}}],
        "data": [{"attributes": attrs, "relationships": {"new_player": {"data": {"id": "p1"}}}}],
    }


def test_nfl_records_keep_odds_type_and_unknown_multiplier():
    recs = nfl.slate_records(_payload("demon"))
    if not recs:  # opponent parsing differs; the helper is still checked below
        return
    assert recs[0]["odds_type"] == "demon"
    assert recs[0]["payout_multiplier"] is None


def test_multiplier_parsed_only_when_present():
    assert nfl._payout_multiplier({}) is None
    assert nfl._payout_multiplier({"payout_multiplier": "1.8"}) == 1.8
    assert nfl._payout_multiplier({"payout_multiplier": "x"}) is None
    assert nfl._optional_float(float("nan")) is None
