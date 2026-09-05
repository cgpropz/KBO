import json
import tempfile
import unittest
from pathlib import Path

import generate_projections as projections


class PersistentPitcherMapTests(unittest.TestCase):
    def test_direct_log_match_replaces_stale_persisted_alias(self):
        original_hand_path = projections.PITCHER_HAND_MAP_PATH
        original_pp_path = projections.PP_PITCHER_NAME_MAP_PATH

        with tempfile.TemporaryDirectory() as directory:
            temp_dir = Path(directory)
            hand_path = temp_dir / "hands.json"
            pp_path = temp_dir / "pp_map.json"
            pp_path.write_text(json.dumps({"map": {"Choi Min-jun": "Mitch White"}}))

            projections.PITCHER_HAND_MAP_PATH = str(hand_path)
            projections.PP_PITCHER_NAME_MAP_PATH = str(pp_path)
            odds = {
                "choi min-jun": {
                    "pp_name": "Choi Min-jun",
                    "team": "SSG",
                    "versus": "Doosan",
                }
            }

            try:
                projections.update_persistent_pitcher_maps(
                    [(odds, {}, {})],
                    [],
                    {"Choi Min Jun": [{"date": projections.datetime.now()}]},
                )
            finally:
                projections.PITCHER_HAND_MAP_PATH = original_hand_path
                projections.PP_PITCHER_NAME_MAP_PATH = original_pp_path

            result = json.loads(pp_path.read_text())["map"]["Choi Min-jun"]

        self.assertEqual(result, "Choi Min Jun")


if __name__ == "__main__":
    unittest.main()