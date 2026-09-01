# Brewser apps catalogue build (envelope v2 — docs/catalogue-v2.md)
#
#   make            # build this repo's fragment + merge -> catalogue.json (base-only)
#   make fragment   # just this repo's index-fragment.json + artifacts/
#   make catalog    # fragment + merge into catalogue.json (LOCAL-ONLY: base apps
#                   #   only — CI does the full cross-repo merge incl. ext repos)
#   make check      # rebuild and diff against the previous catalogue.json
#   make help
#
# The catalogue is built in CI too — .github/workflows/catalogue.yml runs the
# fragment producer + the full merge (fetching every extended repo's fragment
# over its Pages host) on push to apps/**, curation.json or sources.json, on an
# ext_fragment_updated dispatch, and on a schedule. Run `make catalog` locally
# only when hand-editing base apps; the flat apps/<id>/ layout is authoritative.
#
# versions.json is NOT produced here — it lives in the brewser-apps-staging repo
# (served at my.brewser.io/versions.json), written by brewser-v8's `make release`.

PYTHON ?= python
SOURCE ?= base
FRAGMENT := scripts/build_fragment.py
MERGE := scripts/merge_catalog.py
CATALOG := catalogue.json
APPS_DIR := apps
ARTIFACTS_DIR := artifacts

.PHONY: all fragment catalog check help

all: catalog

fragment:
	@$(PYTHON) $(FRAGMENT) --source $(SOURCE)

catalog: fragment
	@$(PYTHON) $(MERGE) --local-only

check:
	@cp $(CATALOG) $(CATALOG).prev 2>/dev/null || true
	@$(PYTHON) $(FRAGMENT) --source $(SOURCE)
	@$(PYTHON) $(MERGE) --local-only
	@diff -u $(CATALOG).prev $(CATALOG) || true
	@rm -f $(CATALOG).prev

help:
	@echo "Targets:"
	@echo "  make fragment  Build $(APPS_DIR)/<id>/ -> index-fragment.json + $(ARTIFACTS_DIR)/<id>.json"
	@echo "  make catalog   fragment + merge into $(CATALOG) (local-only; CI merges ext repos too)"
	@echo "  make check     Rebuild and diff against the previous $(CATALOG)"
	@echo ""
	@echo "Overrides:"
	@echo "  PYTHON=py      Use the Windows 'py' launcher instead of 'python'"
	@echo "  SOURCE=ext1    Build this repo's fragment under a different source name"
