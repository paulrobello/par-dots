.PHONY: install library dev build test coverage lint fmt typecheck checkall checkall-ci preview e2e clean
install: ; bun install
library: ; test -f public/library/manifest.json || bun run scripts/build-library.ts
dev: library ; bun run dev
build: ; bun run build
preview: ; bun run preview
test: ; bun run test
coverage: ; bun run coverage
lint: ; bun run lint
fmt: ; bun run fmt
typecheck: ; bun run typecheck
checkall: lint typecheck test build
# CI-parity gate: everything the deploy workflow's check job runs (lint, typecheck, test,
# build, e2e). Needs Chromium once: bunx playwright install chromium.
checkall-ci: checkall e2e
# Browser smoke test against a fresh build; kept out of checkall because it needs Chromium.
e2e: build ; ./scripts/e2e.sh
clean: ; rm -rf dist public/library coverage
