import unittest

from utils.cg_projection import calculate_cg_projection


class CgProjectionTests(unittest.TestCase):
    def test_strong_edge_and_history_scores_above_neutral(self):
        score = calculate_cg_projection(6.0, 5.0, 1.0, "OVER", 80, 70, 20)
        self.assertGreater(score, 75)

    def test_under_uses_directional_under_history(self):
        score = calculate_cg_projection(4.0, 5.0, -1.0, "UNDER", 20, 30, 20)
        self.assertGreater(score, 75)

    def test_thin_sample_reduces_history_influence(self):
        thin = calculate_cg_projection(5.5, 5.0, 0.5, "OVER", 100, 100, 1)
        supported = calculate_cg_projection(5.5, 5.0, 0.5, "OVER", 100, 100, 20)
        self.assertLess(thin, supported)

    def test_push_and_missing_line_are_not_actionable(self):
        self.assertIsNone(calculate_cg_projection(5.0, 5.0, 0.0, "PUSH", 100, 100, 20))
        self.assertIsNone(calculate_cg_projection(5.0, None, None, "OVER", 100, 100, 20))


if __name__ == "__main__":
    unittest.main()