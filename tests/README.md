# Tests

No framework, no dependencies beyond Node, plus Playwright for the UI half
and PGlite / Deno for the database and rehearsal suites. Every file is
standalone: `node tests/backend/league.js` works on its own, prints
`N passed, M failed`, and exits non-zero on failure.

```
./tests/run.sh          # backend + engine: fast, offline, run before every push
./tests/run.sh sql      # the engine over the real migrations (PGlite)
./tests/run.sh e2e      # a whole migration, rehearsed (Deno + PGlite)
./tests/run.sh ui       # the browser half
./tests/run.sh all      # everything but e2e
```

Getting the tools onto a Mac without Xcode's command line tools: Node and
Deno both ship standalone downloads (nodejs.org, the Deno GitHub releases)
that run from any folder; put them on `PATH`, or point `GG_DENO` at deno.
PGlite: `npm i --prefix tests/engine/.deps @electric-sql/pglite@0.5.8`
(git-ignored), or point `GG_PGLITE` at a folder holding it.

## engine/ — the same `.gs` on the Supabase engine

The backend now runs on `supabase/functions/api/engine.js`, which emulates
the Apps Script services over a Postgres sheet store. These suites are the
evidence that the move changed nothing.

| Suite | Covers |
|---|---|
| `differential.js` | every request run twice: through `lib/model.js` (a plain synchronous spreadsheet: Apps Script as it was) and through the engine over an in-memory store (replays, snapshots, commits). Responses must match byte for byte and rows cell for cell. Flows in `lib/flows.js`: accounts and admin, a classic league, a keepers league drafted to the end with pauses, rewinds, an expired clock, trades and keepers, the results importer; then ~640 seeded random requests across every action |
| `concurrency.js` | the races Sheets lost, run for real over a store that interleaves at random: eight picks on one turn, five pollers on one expired clock, duplicate sign-ups, bursts of DMs, sign-ups and team saves. Each race also runs with the read-set check disabled and **must go wrong there**, or the test proves nothing |
| `sheets.js` | Sheets behaviour the flows don't reach: an emptied last row reused by `appendRow`, padding, deletes, column inserts, the errors Sheets throws, Dates round-tripping in the script's zone, `formatDate`, Script Properties, maintenance, a store that never stops conflicting |
| `build.js` | `backend.js` was built from the current `sumo-fantasy.gs` |
| `routing.js` | `gg-config.js` picks the backend: Apps Script by default, Supabase once it says it is live, back again on a pause or revert; asks at most every five minutes, never from a dev box; survives blocked storage |
| `sql.js` | the differential flows again, with the real `gg_load` / `gg_commit` / `gg_import_*` in PGlite as the store; then the store's rules call by call, and that the publishable key's roles can read and run nothing |
| `e2e.mjs` | the whole move, both ways: a Sheet made by the backend itself, the real `index.ts` under Deno, stand-ins for PostgREST and the old admin check, the .gs (switch and all) as the deployed web app, and `apps-script/migrate.gs` (the file you paste) beside it. The rehearsal, compared endpoint by endpoint; `cutover` refusing when code is mismatched or undeployed and rolling itself back when forwarding fails; a real cutover; writes through both URLs; `revertToAppsScript` bringing every change back; a second cutover |

The differential suites were checked against deliberately broken engines
(no copy-on-write, dropped cell patches, forgotten deletes, needs not
recorded, cache ignored, blank cells read as null, fetches never cached):
each one turns them red. What they can't see: real Postgres concurrency
(PGlite has one connection; `concurrency.js` covers the logic against the
memory store), Supabase's own gateway, and production data shapes. The live
comparison during the rehearsal covers those.

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
| `lineups.js` | the lineups that played: recorded once per basho while locked, read by the title, the basho record, the standings board and the re-draft order, so a lineup changed afterwards can't re-score it |
| `keepdeadline.js` | the keeper deadline: set, move and clear it (commissioner only, open window only); declarations refused after it; the hourly import closes the window only once the new basho is started and its banzuke reads, cutting nothing before then; undecided teams auto-keep by the finished basho's wins (`Meta.lastWins`) |
| `kphist.js` | the basho record (`KeeperHistory`): written at ranking, it survives the roll-over and agrees with the title minted beside it |
| `history.js` | the league history page's read (`leagueHistory`, which never creates a sheet), classic leagues in the basho record, and `fill`: back-filling a basho only where a title vouches for it (no title, a team saved since the title, or a winner that disagrees are all skipped) and never touching a row already there |
| `archive.js` | the day-15 archive, honours capture, champion pass |
| `champions.js` | champion awarding and trophies |
| `clock.js` | the pick clock and server-side auto-draft |
| `draftlock.js` | the `unlock_` flush discipline and one-pick-per-turn |
| `standscalled.js` | a title that stands as called: the mark, the re-crown that works around it, and both answers staying on the record |
| `recrown.js` | the tier map's order of trust (a stale posted map can't crown a basho) and the re-crown that puts a wrong crown right |
| `rerank.js` | undoing a ranking pass, so a pass built on bad input isn't permanent |
| `savename.js` | `saveName` writes the name and nothing else, so a rename works mid-basho |
| `whatsnew.js` | the one poll every open tab makes stays cheap, and answers sensibly signed out |
| `draftload.js` | the shared draftState snapshot (busted by every write, never served with work to do), short lock waits, chat tail read, and the tripwire that auto-pauses a draft on a broken pick log |
| `draftctl.js` | commissioner pause / resume / undo / rewind, and the stale-league-row guard (`draftRowStale_`) |
| `teamlock.js` | `saveTeam` refused once a basho is under way |
| `presence.js` | draft-room presence and chat carried on `draftState` |
| `pinreset.js` | PIN reset request, approve, dismiss |
| `adminbasho.js` | the admin Basho panel payload |
| `bashoid.js` | `Meta.bashoId` vs the `BASHO_ID` constant |
| `forward.js` | the `__FORWARD_TO` switch: with it set, GET and POST pass through to Supabase untouched; a request already forwarded (`gg_fwd`) is never sent on; the hourly importer stands down so the frozen Sheet stays frozen |
| `titles.js` | the taiko radio title bag (reads `taiko-radio.js`, not the `.gs`) |

### What these can and cannot catch

They **cannot** reproduce Apps Script's write buffering — the fake Sheet commits
immediately, while the real one holds writes until the *execution* ends. That is
what caused the seven-picks-on-one-turn bug. `draftlock.js` works around it by
asserting the *structure* instead: that no raw `releaseLock` survives outside
`unlock_`, and that `unlock_` flushes before it releases. Flushing after the
release would fix nothing and look identical in review, so the test checks the
order explicitly.

The flush was not the whole story, though. On 10 Sept the Chanko Boogie draft
still auto-picked one expired clock five times with `unlock_` live: the pick log
was read fresh, but the league row came back with the value read *before* the
poll waited for the lock. `draftctl.js` reproduces that by swapping `leagueRow`
for a stale snapshot, and fails against the pre-fix file. The fix is to treat
the pick log as the authority — `draftRowStale_` — and to read the league for
the first time inside the lock wherever that is possible.

They also can't see quota, cold starts, real sumo-api shapes, or anything about
the deployment. Those need the live checks in the deploy runbook.

## ui/ — the real pages in headless Chromium

Playwright loads the actual HTML from a local static server and stubs every
`script.google.com` call with `page.route()`, so a suite controls exactly what
the backend "returns" and can count the requests the page makes. Several assert
the *absence* of a request — that a tap selects without drafting, that filtering
never hits the network, that chat and presence add no poller of their own.

Suites: `draftui`, `draftcards`, `draftroom`, `draftctlui`, `draftsteady`, `standsnote`, `redraftui`, `keeperui`,
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
