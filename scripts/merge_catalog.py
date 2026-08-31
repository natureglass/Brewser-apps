#!/usr/bin/env python3
"""Base-CI merge: assemble play.brewser.io/catalogue.json (envelope v2) from the
per-repo fragments (catalogue-v2.md, "Production pipeline"; reference merge:
brewser/tests/tools/regen_fixtures.py::merge).

Reads sources.json (the source-name -> repo-root-URL table this repo owns), takes
the LOCAL fragment for this repo's own source straight off disk, fetches every
OTHER source's index-fragment.json over its Pages root, overlays featured/revoked
from curation.json, and writes ONE v2 catalogue.json.

  sources.json shape:
    { "defaultSource": "base",
      "local": "base",
      "sources": { "base": "https://play.brewser.io",
                   "ext1": "https://play1.brewser.io" } }

  - "local"        : the source whose fragment lives in THIS repo (./index-fragment.json).
                     Every other source is fetched remotely. Defaults to defaultSource.
  - "defaultSource": entries from this source omit `source` in the catalogue.
  - "sources"      : becomes the catalogue's `sources` table verbatim. Add a repo
                     by adding one line here (once its Pages serves a fragment).

FAIL-LOUD (never emit a partial catalogue — a silently-missing app is
indistinguishable from a delisting): a configured remote fragment that is
unfetchable or unparseable, the same id present in two fragments, or a featured
id with no fragment entry each abort with a non-zero exit. Revoked ids are exempt
from the presence check (their files may have been deleted).

Serialization is PINNED, identical to build_fragment.py. Idempotent: catalogue.json
is left untouched when its content — ignoring `generated` — is unchanged, so the
scheduled safety-net run never churns a commit.

  --local-only : merge just the local fragment, skipping all remote fetches
                 (offline/local `make catalog`; CI always does the full merge).
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCES_PATH = ROOT / "sources.json"
FRAGMENT_PATH = ROOT / "index-fragment.json"
CURATION_PATH = ROOT / "curation.json"
CATALOG_PATH = ROOT / "catalogue.json"

CATALOG_VERSION = 2
FETCH_TIMEOUT_SECONDS = 30


def now_z() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def serialize_pinned(obj) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def write_if_changed(path: Path, obj, *, ignore: "tuple[str, ...]" = ()) -> bool:
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
                pass
        elif old_text == new_text:
            return False
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(new_text)
    return True


def load_sources_config() -> "tuple[str, str, dict]":
    if not SOURCES_PATH.is_file():
        sys.exit(f"error: {SOURCES_PATH.name} missing — the base repo must declare its source table")
    cfg = json.loads(SOURCES_PATH.read_text(encoding="utf-8-sig"))
    sources = cfg.get("sources")
    if not isinstance(sources, dict) or not sources:
        sys.exit("error: sources.json 'sources' must be a non-empty object")
    for name, url in sources.items():
        if not isinstance(url, str) or not url.startswith("https://"):
            sys.exit(f"error: sources.json source '{name}' is not an https URL")
    default_source = cfg.get("defaultSource")
    if default_source not in sources:
        sys.exit("error: sources.json 'defaultSource' must be a key of 'sources'")
    local = cfg.get("local", default_source)
    if local not in sources:
        sys.exit("error: sources.json 'local' must be a key of 'sources'")
    # Freeze source-URL trailing slashes the way the runtime normalizer does.
    sources = {k: v.rstrip("/") for k, v in sources.items()}
    return default_source, local, sources


def load_local_fragment(expected_source: str) -> dict:
    if not FRAGMENT_PATH.is_file():
        sys.exit(f"error: {FRAGMENT_PATH.name} missing — run build_fragment.py --source {expected_source} first")
    frag = json.loads(FRAGMENT_PATH.read_text(encoding="utf-8-sig"))
    _validate_fragment(frag, expected_source, "local index-fragment.json")
    return frag


def fetch_remote_fragment(source: str, root_url: str, cache_bust: str) -> dict:
    # Cache-bust + no-cache so a scheduled merge always sees the freshest fragment
    # a moment after the source repo's Pages redeploy, not a stale CDN copy.
    url = f"{root_url}/index-fragment.json?cb={cache_bust}"
    req = urllib.request.Request(url, headers={
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "User-Agent": "brewser-merge-catalog",
    })
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_SECONDS) as resp:
            raw = resp.read().decode("utf-8")
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        # Fail loud: a configured source we cannot read must stop the build, not
        # silently shrink the catalogue.
        sys.exit(f"error: source '{source}': cannot fetch {url} ({exc})")
    try:
        frag = json.loads(raw)
    except json.JSONDecodeError as exc:
        sys.exit(f"error: source '{source}': {url} is not valid JSON ({exc})")
    _validate_fragment(frag, source, url)
    return frag


def _validate_fragment(frag, source: str, where: str) -> None:
    if not isinstance(frag, dict) or not isinstance(frag.get("apps"), list):
        sys.exit(f"error: {where}: malformed fragment (need an object with an 'apps' array)")
    if frag.get("source") != source:
        sys.exit(f"error: {where}: fragment 'source' is {frag.get('source')!r}, expected {source!r}")


def load_curation() -> dict:
    """Tolerant: absent curation.json is a clean no-op; a malformed one warns and
    is ignored — a bad editorial file must never blank the live catalogue."""
    if not CURATION_PATH.is_file():
        return {"featured": [], "revoked": []}
    try:
        data = json.loads(CURATION_PATH.read_text(encoding="utf-8-sig"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"warn: curation.json unreadable ({exc}); featured/revoked overlay skipped", file=sys.stderr)
        data = {}
    featured = data.get("featured") if isinstance(data, dict) else None
    revoked = data.get("revoked") if isinstance(data, dict) else None
    return {
        "featured": [x for x in featured if isinstance(x, str)] if isinstance(featured, list) else [],
        "revoked": [x for x in revoked if isinstance(x, str)] if isinstance(revoked, list) else [],
    }


def merge(fragments: "list[dict]", curation: dict, generated: str,
          sources: dict, default_source: str) -> dict:
    """Reference-faithful base-CI merge (regen_fixtures.py::merge)."""
    seen: "dict[str, str]" = {}
    apps: "list[dict]" = []
    for frag in fragments:
        src = frag["source"]
        if src not in sources:
            sys.exit(f"merge error: fragment names unknown source {src!r}")
        for a in frag["apps"]:
            aid = a["id"]
            if aid in seen:
                sys.exit(f"merge error: {aid} present in fragments {seen[aid]!r} and {src!r}")
            seen[aid] = src
            e = {k: v for k, v in a.items() if k != "maxFileBytes"}
            if src != default_source:
                e["source"] = src
            if aid in curation["featured"]:
                e["featured"] = True
            apps.append(e)
    for fid in curation["featured"]:
        if fid not in seen:
            sys.exit(f"merge error: featured id {fid} has no fragment entry")
    # revoked ids are exempt from the presence check (files may be deleted).
    apps.sort(key=lambda e: e["id"])
    return {
        "version": CATALOG_VERSION,
        "generated": generated,
        "sources": sources,
        "defaultSource": default_source,
        "revoked": curation["revoked"],
        "apps": apps,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Merge repo fragments into catalogue.json (envelope v2).")
    ap.add_argument("--local-only", action="store_true",
                    help="merge only the local fragment, skipping remote fetches (offline/dev)")
    args = ap.parse_args()

    default_source, local, sources = load_sources_config()

    fragments = [load_local_fragment(local)]
    if not args.local_only:
        cache_bust = now_z()
        for name in sorted(sources):
            if name == local:
                continue
            fragments.append(fetch_remote_fragment(name, sources[name], cache_bust))

    curation = load_curation()
    catalogue = merge(fragments, curation, now_z(), sources, default_source)
    changed = write_if_changed(CATALOG_PATH, catalogue, ignore=("generated",))

    print(
        f"catalogue apps={len(catalogue['apps'])} sources={len(sources)} "
        f"featured={sum(1 for a in catalogue['apps'] if a.get('featured'))} "
        f"revoked={len(catalogue['revoked'])} "
        f"catalogue.json={'updated' if changed else 'unchanged'}"
        f"{' (local-only)' if args.local_only else ''}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
