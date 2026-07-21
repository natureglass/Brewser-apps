#!/usr/bin/env python3
"""Refresh versions.json from the upstream package.json files.

Reads the `version` field from:
  - D:/Workspace/brewser/package.json              -> "brewser"
  - D:/Workspace/brewser-runtime/package.json      -> "runtime"
  - D:/Workspace/nxjs-source/packages/runtime/package.json  -> "nx.js"

Versions are written verbatim; the key order is preserved to keep the
diff minimal across runs.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSIONS_PATH = ROOT / "versions.json"
WORKSPACE = ROOT.parent

SOURCES = (
    ("nx.js", WORKSPACE / "nxjs-source" / "packages" / "runtime" / "package.json"),
    ("runtime", WORKSPACE / "brewser-runtime" / "package.json"),
    ("brewser", WORKSPACE / "brewser" / "package.json"),
)


def read_version(pkg_path: Path) -> str:
    if not pkg_path.is_file():
        sys.exit(f"missing package.json: {pkg_path}")
    try:
        data = json.loads(pkg_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        sys.exit(f"failed to parse {pkg_path}: {exc}")
    version = data.get("version")
    if not isinstance(version, str) or not version:
        sys.exit(f"no usable 'version' field in {pkg_path}")
    return version


def main() -> None:
    versions = {key: read_version(path) for key, path in SOURCES}
    VERSIONS_PATH.write_text(
        json.dumps(versions, indent=4) + "\n",
        encoding="utf-8",
    )
    summary = ", ".join(f"{k}={v}" for k, v in versions.items())
    print(f"wrote {VERSIONS_PATH.name}: {summary}")


if __name__ == "__main__":
    main()
