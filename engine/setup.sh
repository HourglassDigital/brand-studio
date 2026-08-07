#!/usr/bin/env bash
# SessionStart hook: install the engine's Node dependency once. Runs silently -
# this hook's stdout becomes session context, so it must emit nothing.
set -e
ENGINE="$(cd "$(dirname "$0")" && pwd)"

# Install Node deps once (a fast no-op once node_modules exists). The browser download
# is skipped: render.mjs finds an existing Chrome/Chromium at run time.
if [ ! -d "$ENGINE/node_modules" ]; then
  (cd "$ENGINE" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --silent >/dev/null 2>&1) || true
fi

exit 0
