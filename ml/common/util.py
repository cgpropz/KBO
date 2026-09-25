"""Small stdlib-only helpers shared by the offline ML scripts (Phase 1).

Everything under ml/ is offline: it reads the repo (files + git history) and
writes only to an output directory (default ml/out/, gitignored). Nothing here
is imported by the live pipeline.
"""
from __future__ import annotations

import csv
import json
import re
import subprocess
import unicodedata
from datetime import date, datetime
from pathlib import Path
from typing import Iterable

ML_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ML_ROOT.parent
DEFAULT_OUT = ML_ROOT / "out"


def parse_date(value) -> date | None:
    """mm/dd/YYYY, YYYY-MM-DD, YYYY-MM-DDTHH:MM:SS (and escaped slashes) -> date."""
    raw = str(value or "").strip().replace("\\/", "/")
    if not raw:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw[:10], fmt).date()
        except ValueError:
            continue
    match = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", raw)
    if match:
        return date(int(match.group(3)), int(match.group(1)), int(match.group(2)))
    return None


def norm_name(name) -> str:
    """Accent-free, lowercase, hyphen-insensitive, token-order-insensitive key.

    'Choi Seung-yong' == 'Choi Seung Yong' == 'Seung Yong Choi'.
    """
    text = unicodedata.normalize("NFKD", str(name or ""))
    text = "".join(c for c in text if not unicodedata.combining(c)).lower().replace("-", " ")
    return " ".join(sorted(text.split()))


def to_float(value, default=None):
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def write_csv(path: Path, rows: list[dict], fieldnames: Iterable[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if fieldnames is None:
        fieldnames = []
        for row in rows:
            for key in row:
                if key not in fieldnames:
                    fieldnames.append(key)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(fieldnames), extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def read_csv(path: Path) -> list[dict]:
    with Path(path).open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True, default=str) + "\n", encoding="utf-8")


class GitRepo:
    """Read-only access to file history (git log / git show). Never writes."""

    def __init__(self, root: Path = REPO_ROOT, ref: str = "HEAD"):
        self.root = Path(root)
        self.ref = ref

    def _git(self, *args: str) -> str:
        return subprocess.run(
            ["git", "-C", str(self.root), *args], capture_output=True, text=True, check=True
        ).stdout

    def resolve(self) -> str:
        return self._git("rev-parse", self.ref).strip()

    def commits(self, path: str) -> list[tuple[int, str]]:
        """(committer unix time, sha) for every commit touching path, oldest first."""
        out = self._git("log", "--format=%H %ct", self.ref, "--", path)
        rows = []
        for line in reversed(out.splitlines()):
            if not line.strip():
                continue
            sha, ct = line.split()
            rows.append((int(ct), sha))
        # Stable sort on time only: commits made in the same second keep git's
        # parent-before-child order instead of being ordered by sha.
        rows.sort(key=lambda item: item[0])
        return rows

    def show_json(self, sha: str, path: str):
        try:
            return json.loads(self._git("show", f"{sha}:{path}"))
        except (subprocess.CalledProcessError, ValueError):
            return None

    def file_at_ref(self, path: str) -> str:
        """Contents of path at self.ref (so datasets are reproducible for a pinned ref)."""
        return self._git("show", f"{self.ref}:{path}")
