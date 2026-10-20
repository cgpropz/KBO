"""NBA ESPN injury tags (free NBA top 3 only). Offline: ESPN is stubbed."""
import copy
import unittest

from nba.availability import (
    apply_injury_tags,
    fetch_espn_injuries,
    parse_espn_injuries,
    risk_status,
    tag_players,
)


def espn(*items):
    entries = []
    for name, team, status, extra in items:
        athlete = {"displayName": name}
        if team is not None:
            athlete["team"] = {"abbreviation": team}
        athlete.update(extra.get("athlete", {}))
        entry = {"status": status, "athlete": athlete}
        if "fantasy" in extra:
            entry["details"] = {"fantasyStatus": {"abbreviation": extra["fantasy"]}}
        entries.append(entry)
    return {"injuries": [{"displayName": "Team", "injuries": entries}]}


class _Response:
    def __init__(self, payload, fail=False):
        self._payload = payload
        self._fail = fail

    def raise_for_status(self):
        if self._fail:
            raise RuntimeError("HTTP 500")

    def json(self):
        return self._payload


def stub(payload, fail=False):
    return lambda url, timeout=None: _Response(payload, fail)


def board():
    return [
        {"name": "Jayson Tatum", "team": "BOS", "athleteId": "4065648", "ppAllProps": [{"stat": "Points", "line": 25.5}]},
        {"name": "Luka Doncic", "team": "LAL", "athleteId": "3945274", "ppAllProps": []},
        {"name": "Healthy Guy", "team": "NY", "athleteId": "1", "ppAllProps": []},
        {"name": "Same Name", "team": "MIA", "athleteId": "", "ppAllProps": []},
        {"name": "Q Player", "team": "GS", "athleteId": "", "ppAllProps": []},
        {"name": "D Player", "team": "SA", "athleteId": "", "ppAllProps": []},
    ]


REPORT = espn(
    ("Jayson Tatum", "BOS", "Out", {"athlete": {"links": [{"href": "https://www.espn.com/nba/player/_/id/4065648/jayson-tatum"}]}}),
    ("Luka Doncic", "LAL", "Day-To-Day", {"fantasy": "GTD"}),
    ("Same Name", "BOS", "Out", {}),  # other team: must not match MIA
    ("Q Player", "GS", "Questionable", {}),
    ("D Player", "SA", "Doubtful", {}),
    ("No Team", None, "Out", {}),
    ("Probable Guy", "NY", "Probable", {}),
)


class StatusTests(unittest.TestCase):
    def test_risk_statuses(self):
        self.assertEqual(risk_status("Out"), "Out")
        self.assertEqual(risk_status("OFS"), "Out")
        self.assertEqual(risk_status("Doubtful"), "Doubtful")
        self.assertEqual(risk_status("Questionable"), "Questionable")
        self.assertEqual(risk_status("Day-To-Day"), "Day-To-Day")
        self.assertEqual(risk_status("GTD"), "GTD")
        self.assertEqual(risk_status("Suspension"), "Suspended")
        self.assertIsNone(risk_status("Probable"))
        self.assertIsNone(risk_status("Active"))
        self.assertIsNone(risk_status(None))

    def test_parse_keeps_worst_and_skips_teamless_names(self):
        by_id, by_name = parse_espn_injuries(REPORT)
        self.assertEqual(by_id, {"4065648": "Out"})
        self.assertEqual(by_name[("lukadoncic", "LAL")], "Day-To-Day")
        self.assertNotIn(("noteam", ""), by_name)
        self.assertNotIn(("probableguy", "NY"), by_name)

    def test_empty_payload_is_a_failure(self):
        with self.assertRaises(ValueError):
            parse_espn_injuries({"injuries": []})


class TagTests(unittest.TestCase):
    def test_tags_by_id_then_name_and_team(self):
        players = board()
        before = copy.deepcopy(players)
        tagged = apply_injury_tags([players], get=stub(REPORT))
        by = {p["name"]: p for p in players}
        self.assertEqual(by["Jayson Tatum"]["injuryStatus"], "Out")
        self.assertEqual(by["Luka Doncic"]["injuryStatus"], "Day-To-Day")
        self.assertEqual(by["Q Player"]["injuryStatus"], "Questionable")
        self.assertEqual(by["D Player"]["injuryStatus"], "Doubtful")
        self.assertIsNone(by["Healthy Guy"]["injuryStatus"])
        self.assertIsNone(by["Same Name"]["injuryStatus"])
        self.assertEqual(tagged, 4)
        for player in players:
            self.assertIs(player["injuryChecked"], True)
        # Tags only: no row removed, no prop or other field changed.
        self.assertEqual(len(players), len(before))
        for got, want in zip(players, before):
            stripped = {k: v for k, v in got.items() if k not in ("injuryStatus", "injuryChecked")}
            self.assertEqual(stripped, want)

    def test_failed_read_fails_closed(self):
        for get in (stub(REPORT, fail=True), stub({"injuries": []}), stub("not json")):
            players = board()
            self.assertEqual(apply_injury_tags([players], get=get), 0)
            for player in players:
                self.assertIs(player["injuryChecked"], False)
                self.assertIsNone(player["injuryStatus"])

    def test_one_read_tags_every_snapshot(self):
        calls = []

        def get(url, timeout=None):
            calls.append(url)
            return _Response(REPORT)

        report = fetch_espn_injuries(get)
        standard, goblin = board(), board()
        apply_injury_tags([standard], report=report)
        apply_injury_tags([goblin], report=report)
        self.assertEqual(len(calls), 1)
        self.assertEqual(standard[0]["injuryStatus"], goblin[0]["injuryStatus"])

    def test_tagging_never_raises(self):
        players = board() + [None, "junk"]
        self.assertEqual(tag_players(players, None), 0)


if __name__ == "__main__":
    unittest.main()
