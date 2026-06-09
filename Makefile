# Brewser apps catalog build
#
#   make            # scan tiers and rewrite catalog.json
#   make catalog    # same
#   make check      # rebuild into a temp file and diff against catalog.json
#   make help

PYTHON ?= python
SCRIPT := scripts/build_catalog.py
CATALOG := catalog.json
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
	@echo "  make catalog   Scan $(TIERS) and rewrite $(CATALOG)"
	@echo "  make check     Rebuild and diff against the previous $(CATALOG)"
	@echo ""
	@echo "Overrides:"
	@echo "  PYTHON=py      Use the Windows 'py' launcher instead of 'python'"
