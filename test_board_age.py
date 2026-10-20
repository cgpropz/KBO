"""pipeline/board_age.py: public board clock age for the NBA freeze. No network."""
from datetime import datetime, timedelta, timezone

from pipeline.board_age import board_age, wait_for_fresh

NOW = datetime(2026, 10, 20, 18, 15, tzinfo=timezone.utc)


def _status(updated):
    return {"boards": [
        {"sport": "wnba", "board_updated_at": "2026-10-20T05:19:39-04:00"},
        {"sport": "nba", "board_updated_at": updated},
    ]}


def test_fresh_and_stale_at_the_sixty_minute_limit():
    fresh = board_age("nba", now=NOW, fetch=lambda: _status("2026-10-20T13:15:00-04:00"))
    assert fresh["stale"] == "false" and fresh["age_min"] == 60.0
    stale = board_age("nba", now=NOW, fetch=lambda: _status("2026-10-20T13:14:00-04:00"))
    assert stale["stale"] == "true" and stale["age_min"] == 61.0


def test_unreadable_clock_is_unknown_not_stale():
    def boom():
        raise OSError("down")
    for fetch in (boom, lambda: None, lambda: {"boards": []}):
        result = board_age("nba", now=NOW, fetch=fetch)
        assert result["stale"] == "unknown"
        assert result["age_min"] is None


def test_wait_stops_when_the_clock_moves():
    t = [NOW]
    reads = iter(["2026-10-20T09:10:22-04:00", "2026-10-20T09:10:22-04:00", "2026-10-20T14:16:00-04:00"])

    def sleep(seconds):
        t[0] = t[0] + timedelta(seconds=seconds)

    result = wait_for_fresh("nba", 60, 480, interval=30, fetch=lambda: _status(next(reads)),
                            clock=lambda: t[0], sleep=sleep)
    assert result["stale"] == "false"
    assert t[0] - NOW == timedelta(seconds=60)


def test_wait_gives_up_after_wait_seconds():
    t = [NOW]

    def sleep(seconds):
        t[0] = t[0] + timedelta(seconds=seconds)

    result = wait_for_fresh("nba", 60, 120, interval=30, fetch=lambda: _status("2026-10-20T09:10:22-04:00"),
                            clock=lambda: t[0], sleep=sleep)
    assert result["stale"] == "true"
    assert t[0] - NOW == timedelta(seconds=120)
