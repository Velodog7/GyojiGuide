# Tests

Two kinds, no framework, no dependencies beyond Node and (for the UI half)
Playwright. Every file is standalone: `node tests/backend/league.js` works on
its own, prints `N passed, M failed`, and exits non-zero on failure.

```
./tests/run.sh          # backend only — fast, offline, run before every deploy
./tests/run.sh ui       # the browser half
./tests/run.sh all
```

## backend/ — the real `.gs` in a Node vm

Each suite reads `sumo-fantasy.gs` off disk and runs it inside a `vm` context
with fake `SpreadsheetApp`, `PropertiesService`, `LockService`, `CacheService`,
`UrlFetchApp` and `ContentService`. The fake Sheet is a plain array of arrays,
so a suite can inspect exactly which rows were written.

This runs **the actual deployed source**, not a copy of its logic — which is the
whole point. Override the path with `GG_GS=/some/other/sumo-fantasy.gs`.

| Suite | Covers |
|---|---|
| `league.js` | league lifecycle end to end — create, join, draft, roster, trades |
| `keepers.js` | keeper limits and the basho roll-over |
| `archive.js` | the day-15 archive, honours capture, champion pass |
| `champions.js` | champion awarding and trophies |
| `clock.js` | the pick clock and server-side auto-draft |
| `draftlock.js` | the `unlock_` flush discipline and one-pick-per-turn |
| `teamlock.js` | `saveTeam` refused once a basho is under way |
| `presence.js` | draft-room presence and chat carried on `draftState` |
| `pinreset.js` | PIN reset request, approve, dismiss |
| `adminbasho.js` | the admin Basho panel payload |
| `bashoid.js` | `Meta.bashoId` vs the `BASHO_ID` constant |
| `titles.js` | the taiko radio title bag (reads `taiko-radio.js`, not the `.gs`) |

### What these can and cannot catch

They **cannot** reproduce Apps Script's write buffering — the fake Sheet commits
immediately, while the real one holds writes until the *execution* ends. That is
what caused the seven-picks-on-one-turn bug. `draftlock.js` works around it by
asserting the *structure* instead: that no raw `releaseLock` survives outside
`unlock_`, and that `unlock_` flushes before it releases. Flushing after the
release would fix nothing and look identical in review, so the test checks the
order explicitly.

They also can't see quota, cold starts, real sumo-api shapes, or anything about
the deployment. Those need the live checks in the deploy runbook.

## ui/ — the real pages in headless Chromium

Playwright loads the actual HTML from a local static server and stubs every
`script.google.com` call with `page.route()`, so a suite controls exactly what
the backend "returns" and can count the requests the page makes. Several assert
the *absence* of a request — that a tap selects without drafting, that filtering
never hits the network, that chat and presence add no poller of their own.

Suites: `draftui`, `draftcards`, `draftroom`, `redraftui`, `keeperui`,
`keepreload`, `setcards`, `teamlockui`, `bashopanel`, `bashoid`, `pinresetui`,
`firstrun`, `homegame`, `rikishimod`, `mockdraft3`, `chartcases`, `dmpoll`,
`smoke`.

`smoke.js` is the broad one — every page at 1280 and 390, checking for console
errors and horizontal overflow.

### Writing a new one

Copy the closest existing suite. The shape is always: `page.route()` the
backend, seed `localStorage['fantasy.acct']` via `addInitScript`, navigate,
click into the view, then assert on the DOM. Give each suite a header comment
saying what it is really testing — several of these exist to pin down a specific
past bug, and that is worth stating so nobody "simplifies" the assertion away.

**Confirm a regression test actually fails against the unfixed file** before
trusting it. `keepreload.js` was verified to fail 5/7 against the broken build;
`draftui.js` drafts on the first tap against the pre-fix one. A green test that
was never seen red is not evidence.
