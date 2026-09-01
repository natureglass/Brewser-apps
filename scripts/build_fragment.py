#!/usr/bin/env python3
"""Emit THIS repo's catalogue fragment (index-fragment.json) + artifacts/.

Part of the catalogue-v2 production pipeline (docs/catalogue-v2.md, "Production
pipeline"). Every file-holding repo — the base catalogue repo AND every extended
storage repo — runs this over its own flat apps/<id>/ tree and publishes:

  index-fragment.json  — the slim per-app projection for this source. The base
                         repo's merge_catalog.py fetches each repo's fragment and
                         concatenates them into one catalogue.json.
  artifacts/<id>.json  — per-app file list + byte sizes, downloaded by the Switch
                         runtime from THIS repo's own Pages host.

The fragment's `source` name (base|ext1|ext2) is passed with --source and must
match a key in the base repo's sources.json. Files and artifacts are both served
from this repo's GitHub Pages host, so one source root resolves everything.

Projection (catalogue-v2.md "Entry shape") — browse/decide fields, PLUS the full
HTML `description`: the runtime app-detail modal renders it, and for a NOT-installed
app the catalogue entry is its only source (browser-toolbar.ts reads
listing.description; the normalizer keeps it as a known v2 field). Deliberately
DROPPED (read from the installed manifest.json instead): allowed_origins, exitGame,
fullscreen, buttonMapping, updatedAt, linked_idea_ids. `summary` prefers the
manifest's human Short description and falls back to deriving one from `description`
with the pinned R2 algorithm.

Serialization is PINNED and must be byte-identical across every producer:
UTF-8 no BOM, indent=2, ensure_ascii=False, sort_keys=True, LF, single trailing
newline. (matches regen_fixtures.py::dump_pinned)

Idempotent: a file whose content is unchanged — ignoring the `generated`
timestamp — is left untouched, so a no-op run leaves a clean git tree and never
churns a commit (important for the base merge's scheduled safety-net).
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APPS_DIR = ROOT / "apps"
ARTIFACTS_DIR = ROOT / "artifacts"
FRAGMENT_PATH = ROOT / "index-fragment.json"

# GitHub hard-rejects a single file over 100 MiB at push time — surface it here,
# at intake, rather than as a confusing CI push error later.
MAX_SINGLE_FILE_BYTES = 100 * 1024 * 1024

# Source-name grammar, mirrored from catalogue.schema.v2.json (propertyNames).
SOURCE_RE = re.compile(r"^[a-z][a-z0-9]{0,15}$")

# Catalogue entry projection (catalogue-v2.md R1): browse/decide fields only.
SLIM_REQUIRED = [
    "id", "name", "version", "entry", "logo", "categories", "compatibility",
    "permissions", "developer", "license",
]
SLIM_OPTIONAL = ["genre", "features", "tags"]


def now_z() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def summarize(desc: str) -> str:
    """R2 summary algorithm — deterministic, character-counted (catalogue-v2.md
    "summary"; must agree with regen_fixtures.py::summarize).

    strip tags -> decode entities -> collapse whitespace -> keep if <=400 -> else
    cut at the last space at-or-before char 400 (hard-cut at 399 when no space,
    so the appended ellipsis keeps the result <=400), rstrip, append U+2026.
    """
    s = re.sub(r"<[^>]*>", "", desc)
    s = html.unescape(s)
    s = re.sub(r"\s+", " ", s).strip()
    if len(s) <= 400:
        return s
    cut = s[:400]
    idx = cut.rfind(" ")
    base = cut[:idx] if idx != -1 else cut[:399]
    return base.rstrip() + "…"


def serialize_pinned(obj) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def write_if_changed(path: Path, obj, *, ignore: "tuple[str, ...]" = ()) -> bool:
    """Write obj (pinned) only if its content differs from the file on disk.

    When `ignore` names top-level keys (e.g. "generated"), a difference confined
    to those keys is NOT a change: the existing file — and its old timestamp — is
    kept. Returns True iff the file was (re)written.
    """
    new_text = serialize_pinned(obj)
    if path.is_file():
        old_text = path.read_text(encoding="utf-8")
        if ignore:
            try:
                a = json.loads(old_text)
                b = json.loads(new_text)
                for k in ignore:
                    a.pop(k, None)
                    b.pop(k, None)
                if a == b:
                    return False
            except json.JSONDecodeError:
                pass  # unreadable existing file -> rewrite
        elif old_text == new_text:
            return False
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(new_text)
    return True


def load_manifest(manifest_path: Path) -> dict:
    with manifest_path.open("r", encoding="utf-8-sig") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{manifest_path}: manifest must be a JSON object")
    return data


def scan_files(app_dir: Path) -> "tuple[list[str], int, int]":
    """(sorted relative file list, total bytes, largest single file) over
    non-hidden files — the same walk rules the artifacts + sizeBytes rely on."""
    files: "list[str]" = []
    total = 0
    biggest = 0
    for path in app_dir.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(app_dir)
        if any(part.startswith(".") for part in rel.parts):
            continue
        n = path.stat().st_size
        files.append("/".join(rel.parts))
        total += n
        if n > biggest:
            biggest = n
    files.sort()
    return files, total, biggest


def slim_entry(m: dict, app_id: str, size_bytes: int, max_file_bytes: int) -> dict:
    out: dict = {}
    for k in SLIM_REQUIRED:
        if k not in m:
            sys.exit(f"error: apps/{app_id}: manifest missing required field '{k}'")
        out[k] = m[k]
    for k in SLIM_OPTIONAL:
        if k in m:
            out[k] = m[k]
    desc = m.get("description")
    if not isinstance(desc, str):
        desc = ""
    # summary (card blurb): prefer the human Short description; else derive from
    # the HTML description (cards must never go blank).
    s = m.get("summary")
    if isinstance(s, str) and s.strip():
        out["summary"] = s
    elif desc:
        out["summary"] = summarize(desc)
    else:
        sys.exit(f"error: apps/{app_id}: no 'summary' and no 'description' to derive one from")
    # description (full HTML): carried through — the app-detail modal renders it,
    # and for a NOT-installed app the catalogue entry is the only source
    # (browser-toolbar.ts: listing.description). Known v2 field (normalizer
    # ENTRY_FIELDS_V2).
    out["description"] = desc
    # publishedAt (C1): set-once, manifest-carried. A missing date is a hard
    # error — a v2 entry without it is dropped by the runtime normalizer.
    if not isinstance(m.get("publishedAt"), str) or not m["publishedAt"]:
        sys.exit(f"error: apps/{app_id}: manifest missing 'publishedAt' (required by catalogue v2)")
    out["publishedAt"] = m["publishedAt"]
    out["sizeBytes"] = size_bytes
    out["maxFileBytes"] = max_file_bytes  # producer datum; stripped by the merge
    return out


def build(written_artifacts: "set[Path]") -> "list[dict]":
    """Walk apps/, write each artifacts/<id>.json, return the fragment entries."""
    if not APPS_DIR.is_dir():
        # A freshly-provisioned extended repo with no apps yet -> empty fragment.
        return []

    entries: "list[dict]" = []
    for app_dir in sorted(APPS_DIR.iterdir()):
        if not app_dir.is_dir() or app_dir.name.startswith("."):
            continue
        manifest_path = app_dir / "manifest.json"
        if not manifest_path.is_file():
            # No manifest here -> a legacy tier folder or a non-app dir. Skip.
            continue

        m = load_manifest(manifest_path)
        manifest_id = m.get("id")
        if not manifest_id:
            sys.exit(f"error: apps/{app_dir.name}: manifest missing 'id'")
        if manifest_id != app_dir.name:
            sys.exit(
                f"error: apps/{app_dir.name}: manifest id '{manifest_id}' "
                f"does not match the folder name"
            )

        files, size_bytes, max_file_bytes = scan_files(app_dir)
        if max_file_bytes > MAX_SINGLE_FILE_BYTES:
            sys.exit(
                f"error: apps/{manifest_id}: a {max_file_bytes}-byte file exceeds "
                f"GitHub's 100 MiB per-file push limit"
            )

        artifact_path = ARTIFACTS_DIR / f"{manifest_id}.json"
        write_if_changed(artifact_path, {"id": manifest_id, "sizeBytes": size_bytes, "files": files})
        written_artifacts.add(artifact_path.resolve())

        entries.append(slim_entry(m, manifest_id, size_bytes, max_file_bytes))

    entries.sort(key=lambda e: e["id"])
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
    ap = argparse.ArgumentParser(description="Build this repo's catalogue fragment + artifacts/.")
    ap.add_argument(
        "--source", required=True,
        help="source name for this repo (base|ext1|ext2); must be a key in the base repo's sources.json",
    )
    args = ap.parse_args()
    if not SOURCE_RE.match(args.source):
        sys.exit(f"error: --source '{args.source}' is not a valid source name (^[a-z][a-z0-9]{{0,15}}$)")

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    written: "set[Path]" = set()
    entries = build(written)
    pruned = prune_stale_artifacts(written)

    fragment = {"apps": entries, "generated": now_z(), "source": args.source}
    changed = write_if_changed(FRAGMENT_PATH, fragment, ignore=("generated",))

    print(
        f"fragment source={args.source} apps={len(entries)} "
        f"artifacts={len(written)} pruned={pruned} "
        f"index-fragment.json={'updated' if changed else 'unchanged'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
