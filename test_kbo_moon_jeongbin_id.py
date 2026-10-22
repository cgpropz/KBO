"""Regression: Moon Jeong-bin (LG IF) is KBO player 52121. 63408 loads a blank KBO profile."""
from pathlib import Path
import ast
import csv
import json
import re
import unittest

REPO = Path(__file__).resolve().parent
FILES = ("Batters-Data/batterlog.py", "Batters-Data/kbo_batter_hands.csv",
         "Batters-Data/mykbostats_hitter_map.json", "kbo-props-ui/public/data/player_photos.json")


def _literal(path, name):
    for node in ast.parse(path.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", None) == name:
            return ast.literal_eval(node.value)
    raise AssertionError(name)


class MoonJeongBinIdTests(unittest.TestCase):
    def test_old_id_is_gone(self):
        for rel in FILES:
            self.assertNotIn("63408", (REPO / rel).read_text(encoding="utf-8"), rel)

    def test_batterlog_maps_and_lists_52121(self):
        path = REPO / "Batters-Data" / "batterlog.py"
        self.assertEqual(_literal(path, "PLAYER_NAMES")["52121"], "Moon Jeong-bin")
        teams = re.findall(r'"(\w+)": \[[^\]]*"52121"', path.read_text(encoding="utf-8"))
        self.assertEqual(teams, ["LG"])  # PLAYER_TEAMS roster list

    def test_maps_agree(self):
        with (REPO / "Batters-Data" / "kbo_batter_hands.csv").open(newline="", encoding="utf-8") as fh:
            hands = {r["Player Name"]: r["pcode"] for r in csv.DictReader(fh)}
        self.assertEqual(hands["Moon Jeong-bin"], "52121")
        hitters = json.loads((REPO / "Batters-Data" / "mykbostats_hitter_map.json").read_text(encoding="utf-8"))
        moon = [h for h in hitters if h.get("name") == "Moon Jeong-bin"]
        self.assertTrue(moon and all(h.get("kbo_player_id") == "52121" for h in moon))
        photos = json.loads((REPO / "kbo-props-ui" / "public" / "data" / "player_photos.json").read_text(encoding="utf-8"))
        self.assertTrue(photos["Moon Jeong-bin"].endswith("/52121.jpg"))


if __name__ == "__main__":
    unittest.main()
