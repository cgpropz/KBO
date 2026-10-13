import json
import generate_matchups as gm


def test_official_pairs_read_from_meta(tmp_path, monkeypatch):
    folder = tmp_path / "Pitchers-Data"
    folder.mkdir()
    (folder / "player_names_meta.json").write_text(json.dumps({
        "game_date": "20261014",
        "games": [{"away": "Doosan", "home": "LG", "game_sc": "1"}],
    }))
    monkeypatch.setattr(gm, "BASE", str(tmp_path))
    assert gm._official_game_pairs() == {("Doosan", "LG")}


def test_official_pairs_empty_without_meta(tmp_path, monkeypatch):
    monkeypatch.setattr(gm, "BASE", str(tmp_path))
    assert gm._official_game_pairs() == set()
