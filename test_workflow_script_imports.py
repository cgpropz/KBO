"""Every `python path/to/script.py` step in .github/workflows imports cleanly
the way the workflow runs it: the script's own directory is sys.path[0] and
the repo root is not on sys.path. pytest puts the repo root on sys.path, so
the module's own tests cannot catch a script that only imports as a package
(2026-10-20: `from nfl.book_policy import ...` broke `python nfl/sharp_odds.py`
in nfl-refresh and nfl-odds-live with "No module named 'nfl'")."""
from __future__ import annotations

import os
import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WORKFLOWS = ROOT / '.github' / 'workflows'
STEP_START = re.compile(r'^\s*- (name|uses|run|id|if|env|with|shell|working-directory|continue-on-error|timeout-minutes):')
SCRIPT = re.compile(r'\bpython3? +(?:-u +)?([A-Za-z0-9_./-]+\.py)\b')
WORKDIR = re.compile(r'^\s*working-directory:\s*["\']?([^"\'\s#]+)')

# Imports the module the way `python <script>` would (not as __main__, so the
# script's main() does not run), with no secrets in the environment.
CHECK = r'''
import importlib.util, os, sys
path = os.path.abspath(sys.argv[1])
root = os.path.abspath(sys.argv[2])
sys.path[:] = [os.path.dirname(path)] + [p for p in sys.path[1:] if p and os.path.abspath(p) != root]
spec = importlib.util.spec_from_file_location('_workflow_import_check', path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
'''


def workflow_scripts() -> dict[Path, set[str]]:
    """Script path -> workflows that run it, resolved against each step's working-directory."""
    found: dict[Path, set[str]] = {}
    for workflow in sorted(WORKFLOWS.glob('*.yml')):
        steps, current = [], []
        for line in workflow.read_text(encoding='utf-8').splitlines():
            if STEP_START.match(line) and line.lstrip().startswith('- '):
                steps.append(current)
                current = []
            current.append(line)
        steps.append(current)
        for step in steps:
            workdir = next((m.group(1) for m in map(WORKDIR.match, step) if m), '.')
            for line in step:
                if line.lstrip().startswith('#'):
                    continue
                for script in SCRIPT.findall(line):
                    path = (ROOT / workdir / script).resolve()
                    if not path.exists():
                        path = (ROOT / script).resolve()
                    found.setdefault(path, set()).add(workflow.name)
    return found


class WorkflowScriptImportTest(unittest.TestCase):
    def test_finds_the_refresh_scripts(self):
        scripts = workflow_scripts()
        self.assertIn(ROOT / 'nfl' / 'sharp_odds.py', scripts)
        self.assertIn(ROOT / 'nfl' / 'build_projection_data.py', scripts)
        self.assertIn(ROOT / 'wnba' / 'unabated_props_data.py', scripts)

    def test_every_workflow_script_imports_as_the_workflow_runs_it(self):
        env = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG', 'SYSTEMROOT') if key in os.environ}
        for path, workflows in sorted(workflow_scripts().items()):
            if 'tests' in path.relative_to(ROOT).parts:
                continue  # pytest files the workflow runs through pytest itself
            with self.subTest(script=str(path.relative_to(ROOT)), workflows=sorted(workflows)):
                self.assertTrue(path.exists(), f'{path} is run by {sorted(workflows)} but does not exist')
                result = subprocess.run(
                    [sys.executable, '-c', CHECK, str(path), str(ROOT)],
                    cwd=path.parent, env=env, capture_output=True, text=True, timeout=120,
                )
                tail = '\n'.join(result.stderr.strip().splitlines()[-3:])
                self.assertEqual(result.returncode, 0, f'{path.relative_to(ROOT)} fails to import as run by {sorted(workflows)}:\n{tail}')


if __name__ == '__main__':
    unittest.main()
