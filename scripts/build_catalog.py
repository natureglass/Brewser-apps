#!/usr/bin/env python3
"""Scan apps/{featured,experimental,community} and rebuild catalogue.json + artifacts/.

For each app folder containing a manifest.json:
  - merge every manifest.json field into the catalogue entry as-is
  - write artifacts/<id>.json containing the file path breakdown + total size

Hidden files/dirs (anything starting with '.') are skipped.
Entries within a tier are sorted by id for stable diffs.
Stale artifacts (no matching app id this run) are removed.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

TIERS = ("featured", "experimental", "community")
ROOT = Path(__file__).resolve().parent.parent
APPS_DIR = ROOT / "apps"
ARTIFACTS_DIR = ROOT / "artifacts"
CATALOG_PATH = ROOT / "catalogue.json"
CATALOG_VERSION = 1


def scan_files(app_dir: Path) -> tuple[list[str], int]:
    files: list[str] = []
    total_bytes = 0
    for path in app_dir.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(app_dir)
        parts = rel.parts
        if any(p.startswith(".") for p in parts):
            continue
        files.append("/".join(parts))
        total_bytes += path.stat().st_size
    files.sort()
    return files, total_bytes


def load_manifest(manifest_path: Path) -> dict:
    with manifest_path.open("r", encoding="utf-8-sig") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{manifest_path}: manifest must be a JSON object")
    return data


def write_artifact(app_id: str, tier: str, files: list[str], size_bytes: int) -> Path:
    artifact_path = ARTIFACTS_DIR / f"{app_id}.json"
    payload = {
        "id": app_id,
        "tier": tier,
        "sizeBytes": size_bytes,
        "files": files,
    }
    with artifact_path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    return artifact_path


def build_tier(tier: str, written_artifacts: set[Path]) -> list[dict]:
    tier_dir = APPS_DIR / tier
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
        if not manifest_id:
            print(
                f"warn: apps/{tier}/{app_dir.name}: manifest missing 'id', skipped",
                file=sys.stderr,
            )
            continue
        if manifest_id != app_dir.name:
            print(
                f"warn: apps/{tier}/{app_dir.name}: manifest id '{manifest_id}' "
                f"does not match folder name",
                file=sys.stderr,
            )

        files, size_bytes = scan_files(app_dir)
        artifact_path = write_artifact(manifest_id, tier, files, size_bytes)
        written_artifacts.add(artifact_path.resolve())
        entries.append(entry)

    entries.sort(key=lambda e: e.get("id", ""))
    return entries


def prune_stale_artifacts(written: set[Path]) -> int:
    removed = 0
    for path in ARTIFACTS_DIR.glob("*.json"):
        if path.resolve() not in written:
            path.unlink()
            removed += 1
    return removed


def main() -> int:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    written_artifacts: set[Path] = set()
    catalog = {
        "version": CATALOG_VERSION,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    for tier in TIERS:
        catalog[tier] = build_tier(tier, written_artifacts)

    with CATALOG_PATH.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
        f.write("\n")

    removed = prune_stale_artifacts(written_artifacts)

    totals = ", ".join(f"{t}={len(catalog[t])}" for t in TIERS)
    print(
        f"wrote {CATALOG_PATH.relative_to(ROOT)} ({totals}); "
        f"{len(written_artifacts)} artifact(s), pruned {removed}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
