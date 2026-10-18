import unittest

from pipeline.live_formula import attach_kbo_formula, cg_rating


class CgRatingBoundsTest(unittest.TestCase):
    def test_bounded(self):
        self.assertEqual(cg_rating(1.316, 0.5), 100.0)  # was 131.6
        self.assertEqual(cg_rating(1.8, 1.5), 60.0)
        self.assertEqual(cg_rating(-1, 1.5), 0.0)
        self.assertIsNone(cg_rating(1.0, 0))
        self.assertIsNone(cg_rating(None, 0.5))

    def test_formula_source_marks_current_formula_rows(self):
        row = attach_kbo_formula({'projection': 1.3, 'recommendation': 'OVER', 'line': 0.5}, None, 0.3)
        self.assertFalse(row['formula_applied'])
        self.assertEqual(row['formula_source'], 'current')


if __name__ == '__main__':
    unittest.main()
