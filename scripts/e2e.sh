#!/usr/bin/env bash
# Serve dist/ with vite preview on port 4231, run the Playwright smoke test against it,
# stop the server, and exit with the smoke test's status. Expects a fresh `bun run build`.
set -uo pipefail

PORT=4231
URL="http://localhost:${PORT}/"
cd "$(dirname "$0")/.."

if curl -sf "$URL" >/dev/null 2>&1; then
  echo "e2e: port ${PORT} is already serving; stop that server first" >&2
  exit 1
fi

# Run vite directly so $! is the server itself, not a wrapper that could orphan it.
./node_modules/.bin/vite preview --port "$PORT" --strictPort >.preview.log 2>&1 &
PREVIEW_PID=$!
echo "$PREVIEW_PID" >.preview.pid
cleanup() {
  kill "$PREVIEW_PID" 2>/dev/null
  wait "$PREVIEW_PID" 2>/dev/null
  rm -f .preview.pid .preview.log
}
trap cleanup EXIT

ready=0
for _ in $(seq 60); do
  if curl -sf "$URL" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$PREVIEW_PID" 2>/dev/null; then break; fi
  sleep 0.5
done
if [ "$ready" -ne 1 ]; then
  echo "e2e: preview did not start on ${URL}" >&2
  cat .preview.log >&2
  exit 1
fi

bun run scripts/e2e-smoke.ts "$URL"
status=$?
if [ "$status" -eq 0 ]; then
  bun run scripts/e2e-polish.ts "$URL"
  status=$?
fi
if [ "$status" -eq 0 ]; then
  bun run scripts/e2e-color-names.ts "$URL"
  status=$?
fi
exit "$status"
