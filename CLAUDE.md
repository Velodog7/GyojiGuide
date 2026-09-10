# Sumo Slap Down — working notes for Claude

Fantasy sumo site at **sumoslapdown.com**. Static, no build step: plain HTML,
vanilla JS modules, SVG. The backend is a single Google Apps Script web app
(`sumo-fantasy.gs`) over a Google Sheet. No bundler, no npm, no framework.

`README.md` says what each file is. `DEPLOY.md` is the human deploy guide.
This file is the stuff that is easy to get wrong.

---

## Layout

| | |
|---|---|
| Pages | `index.html` (home), `analysis.html`, `dohyo.html`, `fantasy.html`, `admin.html`, `banzuke.html` (legacy) |
| Shared modules | `gg-config.js` (the `/exec` URL, one place), `gg-account.js`, `gg-nav.js`, `gg-auth.js`, `gg-roster.js`, `gg-dossier.js`, `gg-banzuke.js`, `gg-mawashi.js` |
| Backend | `sumo-fantasy.gs` — one file, ~190 KB |
| Tests | `tests/` — see `tests/README.md` |

Everything uses relative paths and must sit in one flat directory when deployed.

**`gg-dossier.js` and `gg-rikishi.js` are different modules.** The first is the
73-row rikishi dossier (`GyojiGuide.RIKISHI`) used by analysis and fantasy; the
second is an older, unrelated module used only by the home page guessing game.
Writing one over the other has happened. After creating any new module, check
`git status` shows `??` and not `M`.

## Static-side conventions

- **No build.** Anything you add has to work opened straight from disk.
- Pages talk to the backend only through `gg-config.js`. Never hardcode `/exec`.
- `renderLeague` in `fantasy.html` copies a **hand-picked whitelist** of fields
  off `d.league`. Any new league field added server-side must be added there
  too, or it silently reads as `undefined` in the league panel. This has bitten
  once (`keepMk`/`keepJr`).
- Blank and `0` are different answers for league settings (`farmSize`,
  `keepMk`, `keepJr`). Test for blank, never for falsy, and never `|| 0`.

## Backend rules

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

### Bump `BACKEND_VERSION` with every backend change

`?action=version` returns it. If it doesn't match what you just wrote, the
deploy didn't land — you saved without creating a new version. (Leave it alone
for a deploy that changes no code, so the string keeps meaning "this code".)

### `Meta` beats constants

`Meta.bashoId` drives the importer; `BASHO_ID` is only the fallback for a sheet
that has no key. *Start a new basho* derives and writes it from the label typed
in, so the two cannot disagree. Do not reintroduce a hand-edited id.

### Keep writes off read paths

`draftState` is polled every ~4s during a live draft and `leagueDetail` on every
league open. `ensureSheet()` **creates** sheets — calling it from a read path
made the first request after a deploy hang while it inserted a sheet. Reads use
`...IfAny_()` helpers that return `null`.

## Testing

Run `./tests/run.sh` before any backend deploy. Backend suites run the real
`.gs` in a Node vm over a fake Sheet — fast, offline, and the only cheap check
that exists. `tests/README.md` covers what they can and cannot catch.

Aki 2026 is the site's **first ever tournament**, so most of the downstream code
has never executed against real data. The test harnesses are the only evidence
any of it works. Treat them as the deliverable, not scaffolding.

---

## Deploying the backend

The static site deploys by pushing. The backend does not — it lives in the Apps
Script editor and has to be pushed there by hand. Full procedure:

1. **Sean pushes first.** Deploy from what GitHub is serving, never from a local
   copy, so the deployed code and the repo can't diverge.
2. **Checksum before and after.** Fetch
   `raw.githubusercontent.com/Velodog7/GyojiGuide/main/sumo-fantasy.gs`, compute
   length + djb2, compare to the copy the tests ran against. Replace the Monaco
   model with `pushEditOperations`, then checksum the model. **Never retype the
   file.**
3. **Save** with the toolbar *Save project to Drive* button, then confirm the
   "Unsaved changes" indicator clears. `cmd+s` is unreliable.
4. **Deploy → Manage deployments → pencil → Version: New version.** Not *New
   deployment* — that mints a new `/exec` URL and every page would need
   `gg-config.js` updated.
5. **Read the Version field back before clicking Deploy.** It has silently
   offered a stale version once and put old code live for two minutes.
6. **Verify live**, all four:
   - `?action=version` matches `BACKEND_VERSION`
   - any new admin action + a wrong key → `"Not authorised."`
   - an invented action → `"unknown action"` (proves you're reading the router)
   - `?action=data` still returns sane `meta`, rows, users
7. The deployment ID must be unchanged:
   `AKfycbyrhng3sZoNNpgDA2JApz2Z0xx01x9N1TwnGhqkMfbmXCR-q11NIqlB_i3krHPZ3yZ7GA`

Apps Script project: `1NwBuWjSVoowPWGUk76z79RUt7T5BmyVU7t-oDK8WzrcVe2QH4FWCAE_C`

### The function dropdown lies — six for six

Every attempt to run a function from the editor toolbar has executed
**`defaultScoring`** instead: four attempts at `setup` on 8 Sept, two at
`refreshResults` on 9 Sept.

The toolbar label and the committed selection are **separate state**, and
everything observable tracks the label. On 9 Sept the toolbar read
`refreshResults` — confirmed by zooming on it — Run was pressed, and the
Executions page recorded `defaultScoring` at 0.744 s.

The mechanism: the function list is virtualised, so an option outside the
rendered window has a **zero-size bounding rect**. Clicking it by accessibility
ref clicks nothing, `scrollIntoView` doesn't materialise it, and the widget
keeps whatever was committed before. Typeahead + Enter updates the label only.
The Execution log panel prints "Execution completed" either way, so it is no
evidence at all.

**The Executions page is the only proof.** Check the top row names the function
you meant, and check the duration — `defaultScoring` returns an object and
finishes under a second, while a real `setup` took 8.8 s.

Better still, don't run anything from the editor. The hourly `refreshResults`
trigger runs against **Head**, so waiting for the next scheduled run is cheaper
than fighting the widget and tests the production path instead of a simulation
of it.

### Driving the editor from a browser tool

- Prefer `find` refs over coordinates. But a ref to a zero-rect element is
  useless (above), so check the rect when a click seems to do nothing.
- If a ref click does nothing, a plain `el.click()` via JS often works — that
  is how the Save button finally took.
- Screenshot space is **not** page space. `innerWidth` 2389 against a 1456-wide
  screenshot ≈ ×1.64. Compute rects in JS and divide; don't eyeball.
- Don't trigger native `alert`/`confirm` — they freeze the extension. Apps
  Script's own dialogs are ordinary DOM and are fine.

## Environment notes

- Repo lives on Sean's Mac at `~/Documents/GitHub/GyojiGuide`; remote is
  `github.com/Velodog7/GyojiGuide`, branch `main`.
- The device shell is **Linux**, so `sed -i` (GNU), not the macOS `sed -i ''`.
- `node --check` refuses a `.gs` extension. Copy to `.js` first.
- Basho calendar: six a year, on fixed months — Hatsu 01, Haru 03, Natsu 05,
  Nagoya 07, Aki 09, Kyushu 11. Basho ids are `YYYYMM`.
