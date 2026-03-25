#!/usr/bin/env python3
"""
Validate a JSON file exported from Improver UX (Profile → Export backup).

GitHub / GitHub Pages only serves the static site (HTML, JS, CSS). Your budget
and debts are stored in the browser (localStorage) on each device. Python on
your machine cannot "push" that data to GitHub unless you write a separate
script with a GitHub token — and you should not commit live credentials or
password hashes. Use Export / Import in the app, or keep backup files somewhere
private (e.g. encrypted cloud folder), not in a public repo.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser(description="Validate an Improver UX .json backup.")
    p.add_argument("path", type=Path, help="Path to improver-ux-backup-*.json")
    args = p.parse_args()
    path: Path = args.path
    if not path.is_file():
        print(f"Not a file: {path}", file=sys.stderr)
        return 2
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as e:
        print(f"Invalid JSON: {e}", file=sys.stderr)
        return 2
    if data.get("improverUxBackup") != 1:
        print("Missing or wrong improverUxBackup version (expected 1).", file=sys.stderr)
        return 2
    planner = data.get("planner")
    if not isinstance(planner, dict):
        print("Missing planner object.", file=sys.stderr)
        return 2
    for key in ("income", "mustPayBills"):
        if key not in planner:
            print(f"planner.{key} missing (may still load if zero).", file=sys.stderr)
    print(f"OK — backup from {data.get('exportedAt', '?')}")
    print(f"   File: {path.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
