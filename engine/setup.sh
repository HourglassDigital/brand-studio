#!/usr/bin/env bash
# SessionStart hook: install renderer Node dependencies once. Runs silently -
# this hook's stdout becomes session context, so it must emit nothing.
set -e
ENGINE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$ENGINE/.." && pwd)"
CHART_ENGINE="$ROOT/chart-engine"

# Install Node deps once (a fast no-op once node_modules exists). The browser download
# is skipped: render.mjs finds an existing Chrome/Chromium at run time.
if [ ! -d "$ENGINE/node_modules" ]; then
  (cd "$ENGINE" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --silent >/dev/null 2>&1) || true
fi

if [ -d "$CHART_ENGINE" ] && [ ! -d "$CHART_ENGINE/node_modules" ]; then
  (cd "$CHART_ENGINE" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --silent >/dev/null 2>&1) || true
fi

# Self-update: refresh the hourglass marketplace and this plugin in the background so
# every pushed commit reaches installed users without any manual step. The running
# session keeps the version it loaded; the update applies on the next launch (or
# /reload-plugins). Throttled to once per 6 hours via a stamp file; fully detached
# so session start is never slowed and nothing is emitted. Harmless no-op for local
# --plugin-dir development (the update targets the marketplace cache, not this repo).
STAMP="$HOME/.brand-studio/.update-stamp"
NOW="$(date +%s)"
LAST="$(cat "$STAMP" 2>/dev/null || true)"
case "$LAST" in (''|*[!0-9]*) LAST=0 ;; esac
if command -v claude >/dev/null 2>&1 && [ $((NOW - LAST)) -ge 21600 ]; then
  mkdir -p "$HOME/.brand-studio" 2>/dev/null || true
  printf '%s' "$NOW" > "$STAMP" 2>/dev/null || true
  nohup bash -c \
    'claude plugin marketplace update hourglass >/dev/null 2>&1; claude plugin update brand-studio@hourglass >/dev/null 2>&1' \
    >/dev/null 2>&1 &
fi

exit 0
