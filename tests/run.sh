#!/usr/bin/env bash
# Run the Sumo Slap Down test suites.
#
#   ./tests/run.sh              backend + engine (fast, no browser, no network)
#   ./tests/run.sh sql          the engine over the real SQL, in PGlite
#   ./tests/run.sh e2e          the whole migration rehearsed: Deno + PGlite
#   ./tests/run.sh ui           UI too (needs playwright + a static server)
#   ./tests/run.sh all          everything but e2e
#
# Backend suites run the real sumo-fantasy.gs inside a Node vm over a fake
# Google Sheet. No network, nothing to deploy — they are the only cheap way
# to check the backend logic, so run them before every push.
#
# Engine suites run the same .gs through supabase/functions/api/engine.js,
# the layer that puts it on Postgres, and hold it to a plain spreadsheet
# model request by request; they also race it. `sql` swaps the in-memory
# store for the real migrations (needs PGlite, see tests/engine/sql.js).
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
  local dir="$1" skip="${2:-}"
  for f in "$ROOT/tests/$dir"/*.js; do
    [ -n "$skip" ] && [ "$(basename "$f" .js)" = "$skip" ] && continue
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
  echo
  echo "=== engine (the .gs on the Supabase engine, against the model) ==="
  run_dir engine sql
fi

if [ "$MODE" = "sql" ] || [ "$MODE" = "all" ]; then
  echo
  echo "=== sql (the engine over the real migrations, in PGlite) ==="
  printf '%-16s ' sql
  out="$(node "$ROOT/tests/engine/sql.js" 2>&1)"
  if [ $? -eq 0 ]; then echo "$out" | tail -1; else fails=$((fails+1)); echo "FAILED"; echo "$out" | grep -E "FAIL|Error" | head -8 | sed 's/^/      /'; fi
fi

if [ "$MODE" = "e2e" ]; then
  echo "=== e2e (index.ts under Deno, PGlite behind it, migrate.gs in front) ==="
  printf '%-16s ' e2e
  out="$(node "$ROOT/tests/engine/e2e.mjs" 2>&1)"
  if [ $? -eq 0 ]; then echo "$out" | tail -1; else fails=$((fails+1)); echo "FAILED"; echo "$out" | grep -E "FAIL|Error" | head -8 | sed 's/^/      /'; fi
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
