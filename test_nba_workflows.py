"""NBA schedule isolation and the static paid-data deny list. No network."""
import unittest
from pathlib import Path

from pipeline.verify_production_data import MUST_NOT_BE_PUBLIC


ROOT = Path(__file__).resolve().parent
REFRESH = (ROOT / ".github" / "workflows" / "nba-refresh.yml").read_text(encoding="utf-8")
PROPS = (ROOT / ".github" / "workflows" / "nba-props-refresh.yml").read_text(encoding="utf-8")

NBA_STATIC_PATHS = (
    "/data/nba/players.json",
    "/data/nba/teams.json",
    "/data/nba/dvp_pg.json",
    "/data/nba/dvp_sg.json",
    "/data/nba/dvp_sf.json",
    "/data/nba/dvp_pf.json",
    "/data/nba/dvp_c.json",
    "/data/nba/projections_standard.json",
    "/data/nba/projections_demon.json",
    "/data/nba/projections_goblin.json",
)


class DenyListTests(unittest.TestCase):
    def test_nba_paid_snapshots_stay_off_the_public_static_site(self):
        for path in NBA_STATIC_PATHS:
            self.assertIn(path, MUST_NOT_BE_PUBLIC)
        self.assertIn("/data/wnba/projections_standard.json", MUST_NOT_BE_PUBLIC)
        self.assertIn("/data/prizepicks_props.json", MUST_NOT_BE_PUBLIC)
        self.assertIn("/data/strikeout_projections.json", MUST_NOT_BE_PUBLIC)
        self.assertIn("/data/batter_projections.json", MUST_NOT_BE_PUBLIC)
        self.assertIn("/data/matchup_data.json", MUST_NOT_BE_PUBLIC)
        self.assertIn("/data/graded_props_history.json", MUST_NOT_BE_PUBLIC)
        self.assertIn("/data/prop_results.json", MUST_NOT_BE_PUBLIC)


def executable(text: str) -> str:
    """Workflow text with YAML comments removed, so a prohibition can be stated."""
    return "\n".join(line.split("#", 1)[0] for line in text.splitlines())


class WorkflowTests(unittest.TestCase):
    def test_refresh_and_props_share_a_lock_and_stay_off_other_sports(self):
        for text in (REFRESH, PROPS):
            self.assertIn("group: nba-refresh-pipeline", text)
            self.assertIn("cancel-in-progress: false", text)
            steps = executable(text)
            self.assertNotIn("apply_live_formula", steps)
            self.assertNotIn("projection_formula.json", steps)
            self.assertNotIn("unabated", steps.lower())
            self.assertNotIn("wnba/backend", steps)
            self.assertNotIn("nba_public", steps)

    def test_props_job_publishes_only_projection_tables_and_does_not_commit(self):
        self.assertIn('cron: "22,52 * * * *"', PROPS)
        self.assertIn('PUBLISH_ONLY_PREFIX: "nba/projections"', PROPS)
        self.assertIn("steps.lines.outputs.has_lines == 'true'", PROPS)
        self.assertNotIn("git commit", PROPS)
        self.assertNotIn("git push", PROPS)
        self.assertNotIn('PUBLISH_ONLY_PREFIX: "nba/"\n', PROPS)

    def test_full_refresh_commits_source_files_and_not_paid_snapshots(self):
        self.assertIn("workflow_dispatch:", REFRESH)
        self.assertIn('PUBLISH_ONLY_PREFIX: "nba/"', REFRESH)
        add_block = REFRESH.split("git add", 1)[1].split("if [ -f nba/nba_boxscores_2026_27.csv ]", 1)[0]
        self.assertNotIn("public/data", add_block)
        self.assertIn("nba/nba_boxscores_2025_26.csv", add_block)
        self.assertIn("nba/nbaPGdvp.csv", add_block)
        self.assertIn("notify-failure.sh", REFRESH)


if __name__ == "__main__":
    unittest.main()
