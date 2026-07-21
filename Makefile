# Brewser apps catalogue build
#
#   make            # scan apps/<id>/ and rewrite catalogue.json + artifacts/,
#                   # then refresh versions.json from the upstream package.json files
#   make catalog    # catalogue + artifacts only
#   make versions   # refresh versions.json only
#   make check      # rebuild catalogue and diff against the previous catalogue.json
#   make help
#
# NOTE: the catalogue is now built in CI too — .github/workflows/catalogue.yml
# runs `make catalog`'s script on every push to apps/**. Run `make catalog`
# locally only when hand-editing apps; the flat apps/<id>/ layout is authoritative.

PYTHON ?= python
SCRIPT := scripts/build_catalog.py
VERSIONS_SCRIPT := scripts/collect_versions.py
CATALOG := catalogue.json
VERSIONS := versions.json
APPS_DIR := apps
ARTIFACTS_DIR := artifacts

.PHONY: all catalog versions check help

all: catalog versions

catalog:
	@$(PYTHON) $(SCRIPT)

versions:
	@$(PYTHON) $(VERSIONS_SCRIPT)

check:
	@cp $(CATALOG) $(CATALOG).prev 2>/dev/null || true
	@$(PYTHON) $(SCRIPT)
	@diff -u $(CATALOG).prev $(CATALOG) || true
	@rm -f $(CATALOG).prev

help:
	@echo "Targets:"
	@echo "  make catalog   Scan $(APPS_DIR)/<id>/ and rewrite $(CATALOG) + $(ARTIFACTS_DIR)/<id>.json"
	@echo "  make versions  Refresh $(VERSIONS) from the upstream brewser / brewser-runtime / nx.js package.json files"
	@echo "  make check     Rebuild and diff against the previous $(CATALOG)"
	@echo ""
	@echo "Overrides:"
	@echo "  PYTHON=py      Use the Windows 'py' launcher instead of 'python'"
