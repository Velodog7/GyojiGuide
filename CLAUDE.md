# Sumo Slap Down — working notes for Claude

Fantasy sumo site at **sumoslapdown.com**. Static, no build step: plain HTML,
vanilla JS modules, SVG. No bundler, no npm, no framework.

The backend is still one file, `sumo-fantasy.gs`, written for Google Apps
Script. Since October 2026 it runs **unchanged on Supabase**: a Supabase Edge
Function (`supabase/functions/api`) runs it on an engine that emulates the
handful of Apps Script services it uses, over a Postgres "sheet store"
(`supabase/migrations`). Pushing to `main` deploys both. See *The Supabase
engine* below.

`README.md` says what each file is. `DEPLOY.md` is the human deploy guide.
This file is the stuff that is easy to get wrong.

---

## Layout

| | |
|---|---|
| Pages | `index.html` (home), `analysis.html`, `dohyo.html`, `fantasy.html`, `admin.html`, `banzuke.html` (legacy) |
| Shared modules | `gg-config.js` (the `/exec` URL, one place), `gg-account.js`, `gg-nav.js`, `gg-auth.js`, `gg-roster.js`, `gg-dossier.js`, `gg-banzuke.js`, `gg-mawashi.js` |
| Backend logic | `sumo-fantasy.gs`, one file, ~240 KB. The only place game rules live. |
| Backend runtime | `supabase/functions/api/`: `index.ts` (routes), `engine.js` (Apps Script on Postgres), `store.js`, and two generated files, `backend.js` (the .gs as a string) and `seed-sheets.js` |
| Database | `supabase/migrations/`: the sheet store and the hourly pg_cron job |
| Moving between backends | `apps-script/migrate.gs`: `cutover`, `revertToAppsScript`; the `__FORWARD_TO` switch in `sumo-fantasy.gs`; the routing in `gg-config.js` |
| Tools | `tools/build-backend.mjs`, `tools/learn-sheets.mjs` |
| Tests | `tests/`; see `tests/README.md` |

Everything uses relative paths and must sit in one flat directory when deployed.

**`gg-dossier.js` and `gg-rikishi.js` are different modules.** The first is the
73-row rikishi dossier (`GyojiGuide.RIKISHI`) used by analysis and fantasy; the
second is an older, unrelated module used only by the home page guessing game.
Writing one over the other has happened. After creating any new module, check
`git status` shows `??` and not `M`.

## Static-side conventions

- **No build.** Anything you add has to work opened straight from disk.
- Pages talk to the backend only through `gg-config.js`. Never hardcode a
  backend URL. It picks Apps Script or Supabase per page load (see *Two
  backends, one switch*); `fantasy.html` and `admin.html` keep an Apps Script
  fallback, which is always safe because that URL forwards while Supabase is
  live.
- `renderLeague` in `fantasy.html` copies a **hand-picked whitelist** of fields
  off `d.league`. Any new league field added server-side must be added there
  too, or it silently reads as `undefined` in the league panel. This has bitten
  once (`keepMk`/`keepJr`).
- Blank and `0` are different answers for league settings (`farmSize`,
  `keepMk`, `keepJr`). Test for blank, never for falsy, and never `|| 0`.

## Backend rules

These were learned on Apps Script and still hold: the .gs is the same code,
and the reference model in `tests/engine` is Apps Script as it behaved. The
engine makes the lock lessons below unbreakable rather than unnecessary.

### Always release locks through `unlock_`

Apps Script buffers spreadsheet writes and commits them when the **execution**
ends — which is *after* `finally { lock.releaseLock(); }` has run. So the next
request in line reads stale state and every guard built on "re-read inside the
lock" silently fails. This is what let one member draft seven wrestlers on one
turn, and it was live in trades, add/drops and keeper declarations too.

```js
function unlock_(lock){
  try { SpreadsheetApp.flush(); } catch (e) {}   // flush BEFORE release
  try { lock.releaseLock(); } catch (e) {}
}
```

Flush before release. Doing it after fixes nothing and looks identical in
review. `tests/backend/draftlock.js` asserts no raw `releaseLock` survives.

### …and don't trust a row you read before the lock

Flushing was not enough. On 10 Sept (Chanko Boogie) one expired clock was
auto-picked five times, two seconds apart, with `unlock_` already live. Each
waiting `draftState` poll had read the league row *before* waiting for the
lock, and its re-read *inside* the lock came back with those same stale values
(old cursor, old expired deadline) — while the pick log, read for the first
time inside the lock, was fresh.

- Read the league for the first time **inside** the lock where you can
  (`makePick`, `pauseDraft`, `resumeDraft`, `rewindDraft` all do).
- Where you can't (`draftState` needs a pre-read to decide whether to lock),
  check the row against the pick log: `draftRowStale_(L, picks)`. Picks are
  numbered with no gaps, so the next index is max `pickIndex` + 1. If the row
  disagrees, write nothing — the next poll is a fresh execution.
- `tests/backend/draftctl.js` reproduces the stale read and must stay red
  against any build without the guard.

### Draft controls

Commissioner-only `pauseDraft` / `resumeDraft` / `rewindDraft` (undo = rewind
of one). Pause parks the ms left in Leagues col 22 `draftPaused` and blanks the
deadline; `settleDraft_` and `makePick` both refuse while it is set. A rewind
deletes picks `>= toPick` plus the roster rows they created, and always leaves
the draft **paused** with a full clock for whoever is back on it. A finished
draft can be reopened only before any trade, add/drop, keeper roll-over or
tournament. The supplemental re-draft logs every pick as index 0 with phase
`redraft` — the guard and the rewind both skip those rows.

While a draft is paused, the draft date + agreement (cols 13-14) double as the
**restart time**: `draftState` returns `restartAt` / `restartAgreed`, the
commissioner sets it with the ordinary `setDraftDate`, members sign off with
`agreeDraftDate`. Pause, rewind and resume all wipe cols 13-14 (`clearSchedule_`)
so a stale date can never show as a restart. Nothing auto-resumes — the
commissioner presses Resume. `resumeDraft` takes an optional `pickClock`; a
changed clock gives whoever is up a full new clock and applies to every pick after.

### Bump `BACKEND_VERSION` with every backend change

`?action=version` returns it. If it doesn't match what you just pushed, the
deploy didn't land. (Leave it alone for a deploy that changes no code, so the
string keeps meaning "this code".)

### `Meta` beats constants

`Meta.bashoId` drives the importer; `BASHO_ID` is only the fallback for a sheet
that has no key. *Start a new basho* derives and writes it from the label typed
in, so the two cannot disagree. Do not reintroduce a hand-edited id.

### A title that stands as called

Aki 2026 was crowned against the wrong banzuke, so correcting it moves titles
that were already announced. A league may keep the called result — but the
record must carry BOTH answers and show them:

- `standTitle_(basho, scope, leagueId, note, undo)` marks a Champions row
  (`standsAsCalled`, `note`); `adminStandTitle` is the admin door, and the
  Titles card on admin.html drives it.
- `recrownBasho_` leaves a marked row alone and writes the corrected winner
  into `correctedHandle` / `correctedScore` beside it. Every other scope is
  rewritten as usual. The dry run reports `stands` per scope and never hides
  what the fix says.
- `reigningChampion_` and `championsOf_` carry `stands` / `note` /
  `correctedHandle` / `correctedScore` through to the league banner
  (fantasy.html `renderLeagueChampion`) and the trophy case (gg-auth.js
  `titleCard`). **Never render a marked title without its note** — a bare
  asterisk is the thing this feature exists to avoid.
- Champions rows gained four columns; `migrateChampsV2` appends them in place.

### The draft room must survive a busy server

10 Sept the room crawled, then looked dead. What is in place now:

- **Snapshot.** The board part of `draftState` (everything but presence and
  `serverNow`) is cached for `DS_CACHE_S` seconds under `ds:<id>`, stamped
  with a generation `dsg:<id>`. **Any write that changes what the room shows
  must call `dsBust_(leagueId)`** — picks, settle, pause/resume/rewind,
  restart date/agreement, chat post/delete, draft board, join, startDraft. A
  new write path that forgets it shows stale data for up to 3 s. A snapshot
  is never served when a clock has expired or the tripwire has something to
  do; those take the full path.
- **No long lock waits on polls.** `draftState` uses `tryLock(1500)` and never
  `waitLock`; `draftload.js` asserts it.
- **Chat tail** comes from `recentMessagesOf_` (reads the bottom of the sheet),
  never `messagesOf` on a poll.
- **Tripwire.** `draftIntegrity_` flags a doubled pick number or a doubled
  wrestler; `draftState` then auto-pauses (`pauseRow_`), `settleDraft_` and
  `makePick` refuse, and the payload's `alert.fixFrom` is the pick to rewind to.
- **Client.** One `draftState` request in flight at a time (timer ticks skip;
  explicit polls queue), 20 s timeout, backoff 4→8→16→30 s with a "Connection
  trouble" strip, and only the member on the clock polls at 1.2 s near a
  deadline. `setInterval` returns a number, so the period lives in
  `draftPollMs`, not on the timer.

### Keep writes off read paths

`draftState` is polled every ~4s during a live draft and `leagueDetail` on every
league open. `ensureSheet()` **creates** sheets — calling it from a read path
made the first request after a deploy hang while it inserted a sheet. Reads use
`...IfAny_()` helpers that return `null`.

## The Supabase engine

`engine.js` runs the .gs as the body of one function per request (a clean
slate each time, as an Apps Script execution was) and hands it stand-ins for
`SpreadsheetApp`, `PropertiesService`, `LockService`, `CacheService`,
`UrlFetchApp`, `ContentService`, `Utilities`, `Session`, `ScriptApp`, `Logger`.

- **Replays.** The .gs is synchronous and the database isn't. A run that
  reaches for a sheet or URL it doesn't have is noted, discarded, and run
  again once that is loaded. Nothing a discarded run wrote goes anywhere.
  `seed-sheets.js` tells a fresh instance what each action needs, so most
  requests settle in one run.
- **One commit per request** (`gg_commit`), all or nothing. A run that took
  the script lock sends the versions of the sheets it *looked at*; if any
  moved, the commit is refused and the request runs again on fresh data. So
  seven-picks-on-one-turn and five-auto-picks cannot happen whatever the .gs
  does. A sheet a run only *appended* to isn't checked, so DMs and chat
  don't queue behind each other.
- **Every load is one consistent snapshot.** Topping up sheet by sheet let
  a run see one sheet from before a write and another from after it.
- **The draft-room snapshot cache (`ds:*`, `dsg:*`) is never stored.** A
  miss is always a correct answer, and Postgres is fast enough without it.
- **Not emulated:** A1 notation, `getSheets()`, `computeDigest`, `newBlob`,
  triggers (now pg_cron, in a migration). If the .gs starts using one,
  extend `engine.js` and pin it with a probe in `tests/engine/sheets.js`.
- **Dates** are stored tagged (`{"$d": iso}`) and come back as Dates that
  print in the script's old time zone (`__GG_TZ`), like Apps Script.
- **Script Properties** live in `gg_props`. Keys starting `__` belong to the
  engine (`__CRON_KEY`, `__MAINTENANCE`, `__LIVE`, `__GG_TZ`) and are hidden
  from the .gs; the import never copies one across either way. To rotate
  `ADMIN_KEY`, use the SQL editor, and set the same value in Apps Script's
  Script Properties too (`migrate.gs` signs in with that copy):
  `update gg_props set value = '<new>' where key = 'ADMIN_KEY';`
- **Browsing the data:** Table Editor, schema `gg_admin`: `sheets` (counts)
  and `sheet_rows` (every row, by sheet). Not reachable through the API.
- **Editing rows by hand** (SQL editor, Table Editor): also run
  `update gg_sheets set version = version + 1 where name = '<sheet>';` so a
  request that read the sheet before your edit re-reads instead of
  committing over it.

## Testing

Run `./tests/run.sh` before every push that touches the backend. It runs the
backend suites (the real `.gs` in a Node vm over a fake Sheet) and the engine
suites (the same `.gs` through `engine.js`, held to a plain spreadsheet model
request by request, then raced). `./tests/run.sh sql` does the same against
the real migrations in PGlite, and `./tests/run.sh e2e` rehearses a whole
migration: `index.ts` under Deno, `migrate.gs` in front. `tests/README.md` has
what each can and cannot catch, and how to install Node, Deno and PGlite.

Aki 2026 is the site's **first ever tournament**, so most of the downstream code
has never executed against real data. The test harnesses are the only evidence
any of it works. Treat them as the deliverable, not scaffolding.

---

## Deploying the backend

Push to `main`. The Supabase GitHub integration applies new migrations, then
deploys the `api` function; Vercel deploys the pages. Before pushing:

1. Edit `sumo-fantasy.gs`, bump `BACKEND_VERSION`.
2. `node tools/build-backend.mjs` (refreshes `backend.js`; the `build` suite is
   red until you do). After adding or changing actions, also
   `node tools/learn-sheets.mjs`.
3. `./tests/run.sh` green. For engine or migration changes, `sql` and `e2e` too.

Then verify live against
`https://ulzbcqnvltbioajvgvrr.supabase.co/functions/v1/api`:
- `?action=version` matches `BACKEND_VERSION`
- `?action=__health`: `ok`, `live: true`, `maintenance: false`
- an invented action returns `"unknown action"`; a new admin action with a
  wrong key returns `"Not authorised."`
- `?action=data` returns a sane `meta`, rows and users

A migration that fails stops the function deploying too: keep migrations
re-runnable (`if not exists`, `create or replace`) and test them in PGlite.

## Two backends, one switch (October 2026)

The same `sumo-fantasy.gs` is deployed in both places, and the site can
move between them either way, losing nothing. Status lives in the vault note.

- **The switch** is the Script Property `__FORWARD_TO` on the Apps Script
  side (`forwardTarget_` in the .gs). Set, the Apps Script web app passes
  every request through to Supabase untouched (`gg_fwd=1` marks it, and a
  marked request is never forwarded again), and the hourly trigger stands
  down: the Sheet is frozen. On Supabase the engine hides `__` properties,
  so the switch can never fire there. **Keep that Apps Script trigger**: it
  costs nothing while forwarding, and after a revert it imports again.
- **Which one is live** is Supabase's `__LIVE` (and `__MAINTENANCE`), shown
  by `?action=__health`. `gg-config.js` asks that in the background (at most
  every 5 minutes, never from localhost) and the next page load follows it.
- **`apps-script/migrate.gs`**, a second file in the Apps Script project, moves
  the site. Each function is one Run in the editor and checks before acting:
  - `cutover`: refuses unless the editor's code, the deployed web app and
    Supabase all run the same `BACKEND_VERSION`. Then it copies the Sheet,
    pauses writes, sets the switch, confirms the deployed app really
    forwards, copies again, compares per-sheet checksums and ~25 answers old
    against new, and only then goes live. Any failure puts everything back.
  - `revertToAppsScript`: pauses Supabase, copies every sheet and Script
    Property back into the Sheet (including everything written since the
    cutover), then clears the switch.
  - `resumeSupabase`: undoes a revert that stopped part-way, but refuses
    once one has finished; use `cutover` then, which carries the Sheet's
    newer data across.
  - `exportToSupabase`: a copy without switching; refuses while Supabase is
    live, since it would overwrite newer data.
- **Deploying the .gs to Apps Script** is only needed when a change should
  also reach that side (the switch itself did). `cutover` and the revert check
  the deployed version, so a missed deploy stops them before they touch
  anything. Paste the file, save, then Deploy → Manage deployments → pencil →
  New version.

`tests/backend/forward.js` pins the switch; `tests/engine/e2e.mjs` runs the
real `migrate.gs` through a cutover, a revert and a second cutover.

### Driving the Apps Script editor

Hard-won, from deploying to it with a browser tool:
- Never retype the file: replace the Monaco model with `pushEditOperations`
  and checksum it. Save with the toolbar button; `cmd+s` is unreliable.
- **Deploy → Manage deployments → pencil → New version**, never *New
  deployment* (that mints a new `/exec` URL). Read the Version field back
  before clicking Deploy. The deployment ID must stay
  `AKfycbyrhng3sZoNNpgDA2JApz2Z0xx01x9N1TwnGhqkMfbmXCR-q11NIqlB_i3krHPZ3yZ7GA`.
  Project: `1NwBuWjSVoowPWGUk76z79RUt7T5BmyVU7t-oDK8WzrcVe2QH4FWCAE_C`.
- The function dropdown can't be trusted from a browser tool (it ran
  `defaultScoring` six times out of six). The **Executions** page is the only
  proof of what ran. A person clicking it directly is fine.

## Environment notes

- Repo lives on Sean's Mac at `~/Documents/GitHub/GyojiGuide`; remote is
  `github.com/Velodog7/GyojiGuide`, branch `main`.
- Sessions have run in a Linux shell (GNU `sed -i`) and on Sean's Mac (BSD,
  `sed -i ''`). Check `uname` before scripting edits.
- The Mac has no Xcode command line tools: `git` and `python3` pop up an
  installer instead of running (so `./tests/run.sh ui`, which starts a
  `python3` server, does too). Node and Deno run fine from their official
  standalone downloads.
- `node --check` refuses a `.gs` extension. Copy to `.js` first.
- Basho calendar: six a year, on fixed months — Hatsu 01, Haru 03, Natsu 05,
  Nagoya 07, Aki 09, Kyushu 11. Basho ids are `YYYYMM`.
