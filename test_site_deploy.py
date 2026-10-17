import unittest

from pipeline.verify_production_data import anonymous_preview_error, status_document_error


SPORTS = ("kbo", "wnba", "nfl", "nba", "nhl")


def _clocks():
    return {
        "boards": [
            {
                "sport": sport,
                "board_updated_at": None,
                "injuries_checked_at": None,
                "prop_count": 0,
                "stale": True,
            }
            for sport in SPORTS
        ]
    }


class SiteDeployCheckTests(unittest.TestCase):
    def test_anonymous_preview_rejects_a_full_board(self):
        self.assertIsNotNone(anonymous_preview_error({"preview": False, "data": {"cards": []}}))
        self.assertIsNotNone(anonymous_preview_error({"preview": True, "data": {"cards": [{}, {}, {}, {}]}}))
        self.assertIsNone(anonymous_preview_error({"preview": True, "data": {"cards": [{}, {}, {}]}}))

    def test_status_document_rejects_prop_rows(self):
        self.assertIsNone(status_document_error(_clocks()))
        leaked = _clocks()
        leaked["cards"] = [{"name": "Paid Player"}]
        self.assertIsNotNone(status_document_error(leaked))
        row = _clocks()
        row["boards"][2]["props"] = [{"player": "Paid Player"}]
        self.assertIsNotNone(status_document_error(row))
        counted = _clocks()
        counted["boards"][4]["removed_reasons"] = {
            "pp_pull": 1,
            "superseded_dup": 0,
            "manual_out": 0,
            "news_out": 0,
            "lineup_out": 0,
        }
        self.assertIsNone(status_document_error(counted))
        counted["boards"][2]["removed_reasons"] = counted["boards"][4]["removed_reasons"]
        self.assertIsNotNone(status_document_error(counted))
