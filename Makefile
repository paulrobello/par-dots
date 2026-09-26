.PHONY: install dev build test lint fmt typecheck checkall preview
install: ; bun install
dev: ; bun run dev
build: ; bun run build
preview: ; bun run preview
test: ; bun run test
lint: ; bun run lint
fmt: ; bun run fmt
typecheck: ; bun run typecheck
checkall: fmt lint typecheck test build
