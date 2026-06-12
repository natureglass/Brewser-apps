# Brewser apps catalog build
#
#   make            # scan apps/<tier>/ and rewrite catalog.json + artifacts/
#   make catalog    # same
#   make check      # rebuild and diff against the previous catalog.json
#   make help

PYTHON ?= python
SCRIPT := scripts/build_catalog.py
CATALOG := catalog.json
APPS_DIR := apps
ARTIFACTS_DIR := artifacts
TIERS   := featured experimental community

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
	@echo "  make catalog   Scan $(APPS_DIR)/{$(TIERS)} and rewrite $(CATALOG) + $(ARTIFACTS_DIR)/<id>.json"
	@echo "  make check     Rebuild and diff against the previous $(CATALOG)"
	@echo ""
	@echo "Overrides:"
	@echo "  PYTHON=py      Use the Windows 'py' launcher instead of 'python'"
