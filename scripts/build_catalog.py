#!/usr/bin/env python3
"""Scan featured/, experimental/, community/ and rebuild catalog.json.

For each app folder containing a manifest.json:
  - merge every manifest.json field into the catalog entry as-is
  - append a `files` array of every file in the app folder (forward-slash,
    relative to the app folder, sorted)

Hidden files/dirs (anything starting with '.') are skipped.
Entries within a tier are sorted by id for stable diffs.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

TIERS = ("featured", "experimental", "community")
ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "catalog.json"
CATALOG_VERSION = 1


def scan_files(app_dir: Path) -> list[str]:
    files: list[str] = []
    for path in app_dir.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(app_dir)
        parts = rel.parts
        if any(p.startswith(".") for p in parts):
            continue
        files.append("/".join(parts))
    files.sort()
    return files


def load_manifest(manifest_path: Path) -> dict:
    with manifest_path.open("r", encoding="utf-8-sig") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{manifest_path}: manifest must be a JSON object")
    return data


def build_tier(tier: str) -> list[dict]:
    tier_dir = ROOT / tier
    if not tier_dir.is_dir():
        print(f"warn: tier dir missing: {tier_dir}", file=sys.stderr)
        return []

    entries: list[dict] = []
    for app_dir in sorted(tier_dir.iterdir()):
        if not app_dir.is_dir() or app_dir.name.startswith("."):
            continue
        manifest_path = app_dir / "manifest.json"
        if not manifest_path.is_file():
            print(f"warn: skipping {app_dir.name} (no manifest.json)", file=sys.stderr)
            continue

        entry = load_manifest(manifest_path)
        manifest_id = entry.get("id")
        if manifest_id and manifest_id != app_dir.name:
            print(
                f"warn: {tier}/{app_dir.name}: manifest id '{manifest_id}' "
                f"does not match folder name",
                file=sys.stderr,
            )
        entry["files"] = scan_files(app_dir)
        entries.append(entry)

    entries.sort(key=lambda e: e.get("id", ""))
    return entries


def main() -> int:
    catalog = {
        "version": CATALOG_VERSION,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    for tier in TIERS:
        catalog[tier] = build_tier(tier)

    with CATALOG_PATH.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
        f.write("\n")

    totals = ", ".join(f"{t}={len(catalog[t])}" for t in TIERS)
    print(f"wrote {CATALOG_PATH.relative_to(ROOT)} ({totals})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
