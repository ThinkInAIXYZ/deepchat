#!/usr/bin/env bash
# Runs the mygo spike: the Go shell, the Node sidecar and the real renderer.
#
# This is the verification harness described in
# docs/features/mygo-rewrite/m0-report.md, not the product. The Electron app is
# still the product and runs with `pnpm run dev`.
#
# Usage: ./run.sh [seconds]
#   seconds  how long the window stays open (default 120)
#
# The profile directory defaults to a throwaway path so the run never touches
# your real DeepChat data. Point DEEPCHAT_PROFILE at one to reuse it.
#
# System notifications are left out: macOS only delivers them from a built
# .app with a bundle identifier, so `go run` reports them as unsupported.
set -euo pipefail

cd "$(dirname "$0")/../.."

SECONDS_OPEN="${1:-120}"
PROFILE="${DEEPCHAT_PROFILE:-$(mktemp -d /tmp/deepchat-mygo-XXXXXX)}"
export DEEPCHAT_USER_DATA="$PROFILE"
export PATH="/opt/homebrew/bin:$PATH"

echo "==> building the renderer and preload bridge"
# electron-vite clears out/, so the bridge has to be built after it.
pnpm exec electron-vite build >/dev/null
pnpm run preload:build >/dev/null

echo "==> building the sidecar"
pnpm run sidecar:build >/dev/null

echo "==> profile: $PROFILE"
echo "==> launching (window closes after ${SECONDS_OPEN}s)"
cd shell/spike
exec go run . \
  -seconds "$SECONDS_OPEN" \
  -renderer ../../out/renderer \
  -sidecar ../../out/sidecar/entry.mjs \
  -bridge ../../out/preload/bridge.js
