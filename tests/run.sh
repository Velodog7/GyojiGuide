#!/usr/bin/env bash
# Run the Sumo Slap Down test suites.
#
#   ./tests/run.sh              backend only (fast, no browser, no network)
#   ./tests/run.sh ui           UI too (needs playwright + a static server)
#   ./tests/run.sh all          both
#
# Backend suites run the real sumo-fantasy.gs inside a Node vm over a fake
# Google Sheet. No network, no Apps Script, nothing to deploy — they are the
# only cheap way to check the backend, so run them before every deploy.
#
# UI suites drive the real pages in headless Chromium with every Apps Script
# call stubbed by page.route(). They need the repo served over HTTP because
# the pages load sibling modules; file:// will not do.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-backend}"
PORT="${GG_PORT:-8902}"
fails=0

run_dir () {
  local dir="$1"
  for f in "$ROOT/tests/$dir"/*.js; do
    printf '%-16s ' "$(basename "$f" .js)"
    out="$(node "$f" 2>&1)"
    if [ $? -eq 0 ]; then
      echo "$out" | tail -1
    else
      fails=$((fails+1))
      echo "FAILED"
      echo "$out" | grep -E "FAIL|Error" | head -8 | sed 's/^/      /'
    fi
  done
}

if [ "$MODE" = "backend" ] || [ "$MODE" = "all" ]; then
  echo "=== backend (node vm over the real .gs) ==="
  run_dir backend
fi

if [ "$MODE" = "ui" ] || [ "$MODE" = "all" ]; then
  echo
  echo "=== ui (headless chromium against 127.0.0.1:$PORT) ==="
  if ! curl -sf -o /dev/null "http://127.0.0.1:$PORT/fantasy.html"; then
    echo "starting a static server on $PORT..."
    (cd "$ROOT" && python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) &
    SERVER=$!
    trap 'kill $SERVER 2>/dev/null' EXIT
    sleep 2
  fi
  run_dir ui
fi

echo
if [ "$fails" -eq 0 ]; then echo "all suites green"; else echo "$fails suite(s) failed"; fi
exit "$fails"
