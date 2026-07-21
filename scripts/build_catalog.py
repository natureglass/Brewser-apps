#!/usr/bin/env python3
"""Scan apps/<package-id>/ (flat) and rebuild catalogue.json + artifacts/.

Flat layout: every app lives at apps/<package-id>/ with a manifest.json — the
same folder the WordPress plugin promotes an approved app into. The legacy tier
folders (apps/featured|experimental|community/) have no manifest.json directly
under them, so they are skipped automatically; remove them by hand once you've
migrated their apps up to apps/<id>/.

For each app folder containing a manifest.json:
  - merge every manifest.json field into the catalogue entry as-is
  - add sizeBytes (sum of all non-hidden files under the folder)
  - write artifacts/<id>.json with the file path breakdown + total size

catalogue.json shape (flat — no tier groups):
  {
    "version": 1,
    "generated": "<iso8601Z>",
    "apps": [ { ...manifest fields..., "sizeBytes": N }, ... ]   # sorted by id
  }

Hidden files/dirs (anything starting with '.') are skipped. Stale artifacts (no
matching app id this run) are removed.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APPS_DIR = ROOT / "apps"
ARTIFACTS_DIR = ROOT / "artifacts"
CATALOG_PATH = ROOT / "catalogue.json"
CATALOG_VERSION = 1


def scan_files(app_dir: Path) -> "tuple[list[str], int]":
    files: "list[str]" = []
    total_bytes = 0
    for path in app_dir.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(app_dir)
        if any(p.startswith(".") for p in rel.parts):
            continue
        files.append("/".join(rel.parts))
        total_bytes += path.stat().st_size
    files.sort()
    return files, total_bytes


def load_manifest(manifest_path: Path) -> dict:
    with manifest_path.open("r", encoding="utf-8-sig") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{manifest_path}: manifest must be a JSON object")
    return data


def write_artifact(app_id: str, files: "list[str]", size_bytes: int) -> Path:
    artifact_path = ARTIFACTS_DIR / f"{app_id}.json"
    payload = {
        "id": app_id,
        "sizeBytes": size_bytes,
        "files": files,
    }
    with artifact_path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")
    return artifact_path


def build_apps(written_artifacts: "set[Path]") -> "list[dict]":
    if not APPS_DIR.is_dir():
        print(f"error: apps dir missing: {APPS_DIR}", file=sys.stderr)
        return []

    entries: "list[dict]" = []
    for app_dir in sorted(APPS_DIR.iterdir()):
        if not app_dir.is_dir() or app_dir.name.startswith("."):
            continue
        manifest_path = app_dir / "manifest.json"
        if not manifest_path.is_file():
            # No manifest directly here → a legacy tier folder or a non-app
            # directory. Flat layout ignores it.
            continue

        entry = load_manifest(manifest_path)
        manifest_id = entry.get("id")
        if not manifest_id:
            print(f"warn: apps/{app_dir.name}: manifest missing 'id', skipped", file=sys.stderr)
            continue
        if manifest_id != app_dir.name:
            print(
                f"warn: apps/{app_dir.name}: manifest id '{manifest_id}' "
                f"does not match folder name",
                file=sys.stderr,
            )

        files, size_bytes = scan_files(app_dir)
        artifact_path = write_artifact(manifest_id, files, size_bytes)
        written_artifacts.add(artifact_path.resolve())
        entry["sizeBytes"] = size_bytes
        entries.append(entry)

    entries.sort(key=lambda e: e.get("id", ""))
    return entries


def prune_stale_artifacts(written: "set[Path]") -> int:
    removed = 0
    if not ARTIFACTS_DIR.is_dir():
        return 0
    for path in ARTIFACTS_DIR.glob("*.json"):
        if path.resolve() not in written:
            path.unlink()
            removed += 1
    return removed


def main() -> int:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    written_artifacts: "set[Path]" = set()
    catalog = {
        "version": CATALOG_VERSION,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "apps": build_apps(written_artifacts),
    }

    with CATALOG_PATH.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
        f.write("\n")

    removed = prune_stale_artifacts(written_artifacts)

    print(
        f"wrote {CATALOG_PATH.relative_to(ROOT)} (apps={len(catalog['apps'])}); "
        f"{len(written_artifacts)} artifact(s), pruned {removed}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
