"""NHL board rows never carry a relative or placeholder headshot."""

import unittest

from nhl.build_board import headshot_url


class HeadshotUrlTests(unittest.TestCase):
    def test_real_prizepicks_headshot_is_kept(self):
        url = "https://static.prizepicks.com/images/players/NHL/Fake_Skater_NHL_player_abc123.webp"
        self.assertEqual(headshot_url(url), url)
        manual = "https://static.prizepicks.com/images/manual/Fake Skater.png"
        self.assertEqual(headshot_url(manual), manual)

    def test_relative_placeholder_is_dropped(self):
        self.assertEqual(headshot_url("/assets/player-placeholder-DgCsV9RE.svg"), "")

    def test_prizepicks_placeholder_file_is_dropped(self):
        self.assertEqual(headshot_url("https://static.prizepicks.com/images/players/placeholder.png"), "")

    def test_empty_and_non_https_are_dropped(self):
        for value in (None, "", "   ", "http://example.com/a.png", "assets/a.png", "https://"):
            self.assertEqual(headshot_url(value), "", value)


if __name__ == "__main__":
    unittest.main()
