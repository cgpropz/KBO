"""Shared confidence scoring for actionable KBO prop projections."""


def _clamp(value, lower, upper):
    return max(lower, min(upper, value))


def calculate_cg_projection(
    projection,
    line,
    edge,
    recommendation,
    hit_rate_l5=None,
    hit_rate_full=None,
    games_used=0,
):
    """Return a 1-100 decision score, or None when a prop is not actionable.

    This is a ranking score, not a predicted probability of winning. It combines
    directional model edge, directional historical performance, and sample support.
    A score of 50 is neutral; higher scores indicate stronger agreement among the
    available signals.
    """
    try:
        projection = float(projection)
        line = float(line)
        edge = float(edge)
    except (TypeError, ValueError):
        return None

    recommendation = str(recommendation or "").upper()
    if line <= 0 or recommendation not in ("OVER", "UNDER"):
        return None

    directional_edge = edge if recommendation == "OVER" else -edge
    if directional_edge <= 0:
        return None

    edge_strength = _clamp(directional_edge / line, 0.0, 0.15) / 0.15
    rates = []
    for rate in (hit_rate_l5, hit_rate_full):
        try:
            rate = float(rate)
        except (TypeError, ValueError):
            continue
        if recommendation == "UNDER":
            rate = 100.0 - rate
        rates.append(rate)

    historical_rate = sum(rates) / len(rates) if rates else 50.0
    historical_signal = _clamp((historical_rate - 50.0) / 50.0, -1.0, 1.0)
    try:
        sample_support = _clamp(float(games_used) / 20.0, 0.0, 1.0)
    except (TypeError, ValueError):
        sample_support = 0.0

    edge_points = edge_strength * 30.0
    history_points = historical_signal * 20.0 * (0.65 + 0.35 * sample_support)
    return round(_clamp(50.0 + edge_points + history_points, 1.0, 100.0))