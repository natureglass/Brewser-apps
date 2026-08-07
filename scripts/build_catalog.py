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
CURATION_PATH = ROOT / "curation.json"
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


def load_curation() -> "list[str]":
    """Read the operator-curation overlay (repo-root curation.json).

    Returns the lowercased list of featured package-ids. This file is produced
    by the WordPress plugin (Brewser_Sub_Curation) from the admin "Featured"
    checkboxes and pushed to the BASE repo root, which triggers this workflow.

    TOLERANT by design: an absent curation.json is a clean no-op, and a malformed
    one is warned + ignored rather than fail-loud — a bad editorial file must
    never blank the live catalogue.
    """
    if not CURATION_PATH.is_file():
        return []
    try:
        with CURATION_PATH.open("r", encoding="utf-8-sig") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        print(f"warn: curation.json unreadable ({exc}); featured overlay skipped", file=sys.stderr)
        return []
    featured = data.get("featured") if isinstance(data, dict) else None
    if not isinstance(featured, list):
        print("warn: curation.json has no 'featured' array; featured overlay skipped", file=sys.stderr)
        return []
    ids: "list[str]" = []
    for fid in featured:
        if isinstance(fid, str) and fid.strip():
            ids.append(fid.strip().lower())
    return ids


def apply_featured(entries: "list[dict]", featured_ids: "list[str]") -> int:
    """Stamp featured:true onto catalogue entries whose id is in the curation set.

    Matching is case-insensitive on the package-id. A featured id with no
    matching app folder is WARNED to stderr and skipped (a stale editorial id
    can't blank or fail the build). Returns the number of entries stamped.
    """
    if not featured_ids:
        return 0
    by_id = {str(e.get("id", "")).lower(): e for e in entries}
    stamped = 0
    for fid in featured_ids:
        entry = by_id.get(fid)
        if entry is None:
            print(f"warn: curation featured id '{fid}' has no app folder; skipped", file=sys.stderr)
            continue
        entry["featured"] = True
        stamped += 1
    return stamped


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
    apps = build_apps(written_artifacts)
    featured_count = apply_featured(apps, load_curation())
    catalog = {
        "version": CATALOG_VERSION,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "apps": apps,
    }

    with CATALOG_PATH.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
        f.write("\n")

    removed = prune_stale_artifacts(written_artifacts)

    print(
        f"wrote {CATALOG_PATH.relative_to(ROOT)} (apps={len(catalog['apps'])}, "
        f"featured={featured_count}); {len(written_artifacts)} artifact(s), pruned {removed}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
