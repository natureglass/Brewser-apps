# Brewser apps catalogue build
#
#   make            # scan apps/<id>/ and rewrite catalogue.json + artifacts/
#   make catalog    # catalogue + artifacts only
#   make check      # rebuild catalogue and diff against the previous catalogue.json
#   make help
#
# NOTE: the catalogue is now built in CI too — .github/workflows/catalogue.yml
# runs `make catalog`'s script on every push to apps/**. Run `make catalog`
# locally only when hand-editing apps; the flat apps/<id>/ layout is authoritative.
#
# versions.json is NO LONGER produced here — it moved to the brewser-apps-staging
# repo (served at my.brewser.io/versions.json) and is written solely by
# brewser-v8's `make release` (a mirror of romfs/configs/current.json). The old
# scripts/collect_versions.py generator was retired along with this target.

PYTHON ?= python
SCRIPT := scripts/build_catalog.py
CATALOG := catalogue.json
APPS_DIR := apps
ARTIFACTS_DIR := artifacts

.PHONY: all catalog check help

all: catalog

catalog:
	@$(PYTHON) $(SCRIPT)

check:
	@cp $(CATALOG) $(CATALOG).prev 2>/dev/null || true
	@$(PYTHON) $(SCRIPT)
	@diff -u $(CATALOG).prev $(CATALOG) || true
	@rm -f $(CATALOG).prev

help:
	@echo "Targets:"
	@echo "  make catalog   Scan $(APPS_DIR)/<id>/ and rewrite $(CATALOG) + $(ARTIFACTS_DIR)/<id>.json"
	@echo "  make check     Rebuild and diff against the previous $(CATALOG)"
	@echo ""
	@echo "Overrides:"
	@echo "  PYTHON=py      Use the Windows 'py' launcher instead of 'python'"
