# Sumo Slapdown — deploy guide

A static, no-build site: plain HTML + JS modules + SVG logos, backed by a
Google Apps Script web app. Everything uses **relative paths**, so all the web
files just need to sit in the **same folder** on your host (GitHub Pages,
Netlify Drop, etc.). No bundler, no npm.

For what each file *is*, see [README.md](README.md). This guide is about
getting it live.

---

## 1. Web files — upload these to your host (same directory)

**Pages**

| File | Nav label |
|---|---|
| `index.html` | About (home) |
| `analysis.html` | Analysis |
| `dohyo.html` | Simulation |
| `fantasy.html` | Fantasy |
| `banzuke.html` | — (legacy home page, superseded by `index.html`; kept so old links resolve) |

**Shared modules** (loaded by the pages)

| File | Role |
|---|---|
| `gg-config.js` | Holds the Apps Script `/exec` URL (the one place it lives) |
| `gg-account.js` | Shared account + login/register/logout + saveAvatar |
| `gg-nav.js` | The shared top nav, the larger logo, and the Help/feedback modal |
| `gg-auth.js` | The unified account control that sits in the nav on every page |
| `gg-mawashi.js` | The mawashi avatar designer (layers, textures, kanji) |
| `gg-roster.js` | Live banzuke loader (pulls the current ranking from sumo-api) |
| `gg-banzuke.js` | The home page's Edo banzuke-e crowd illustration |
| `taiko-radio.js` | The background taiko radio player |
| `gg-ranking.js` | Long-term ranking ladder. **Not loaded by any page** — the live ladder is the mirrored copy in `sumo-fantasy.gs`. Ships as reference; harmless to omit. |

**Logo assets** (must sit alongside the HTML)

| File | Used by |
|---|---|
| `SumoSlapdown-logowide.svg` | The nav logo (every page) |
| `SumoSlapdown-logoTall.svg` | The centerpiece in the home page crowd |
| `SumoSlapdown-logoMedium.svg` | The Fantasy leaderboard header |

**Taiko beat constructor** (not in the nav; the radio's "＋" button links to it)

| File | What it is |
|---|---|
| `taiko.html` | The loop constructor |
| `player.html` | Embeddable looping player |
| `taiko-data.js` | Sample list + pattern encoder/decoder |
| `example-embed.html` | Worked example of embedding a loop |

**Other**

| File | What it is |
|---|---|
| `keepers-mock-draft.html` | Snake-draft practice room, opened from Fantasy → My Leagues on a keepers league. Also works standalone (generic bots) for demos. |
| `spinner.html` | Reference page for the shared loading spinner. Nothing links to it; upload optional. |
| `robots.txt`, `sitemap.xml` | SEO. `robots.txt` disallows `/admin.html`. |
| `images/rikishi/` | **Required.** The 70 rikishi photos the pages load by name. |
| `images/svg/`, `images/jpg/` | Source art only — not loaded at runtime, safe to skip when uploading. |

**Private admin dashboard** (deliberately not linked anywhere — see below)

| File | What it is |
|---|---|
| `admin.html` | Connectivity to sumo-api, pageview analytics, user moderation (warn/ban/delete), and a read-only feed of every message-board post across all leagues. Password-gated by the `ADMIN_KEY` Script Property (with a brute-force lockout on the backend). |

`admin.html` isn't added to `gg-nav.js`'s link list and isn't referenced from any other page, so a visitor won't stumble onto it from the site itself — but like every other file here it's still a public URL on a static host. That's obscurity, not real access control. Don't put anything in it you'd be upset to see leaked, and don't reuse `ADMIN_KEY` anywhere else.

---

## 2. The `samples/` folder

`taiko-radio.js` and the loop constructor fetch their taiko hits from
`samples/*.mp3` at runtime. The folder is in the repo — just make sure it comes
along with everything else. If it's missing the rest of the site works fine;
the radio just won't have audio.

---

## 3. Backend: Supabase (deploys when you push)

`sumo-fantasy.gs` is the backend (accounts, leagues, drafts, the
Help/feedback inbox). It is **not** a web file. Supabase runs it, unchanged,
inside the `api` Edge Function in `supabase/functions/api`, over the tables
in `supabase/migrations`.

**To change the backend:** edit `sumo-fantasy.gs` and bump `BACKEND_VERSION`,
run `node tools/build-backend.mjs` and `./tests/run.sh`, then push to `main`.
Supabase's GitHub integration (Project Settings → Integrations → GitHub,
*Deploy to production* on, working directory `.`) applies any new migration
and redeploys the function. Confirm with `?action=version`.

**`ADMIN_KEY`** came across from the old Script Properties and lives in the
`gg_props` table. To rotate it, run this in the Supabase SQL editor; it
takes effect on the next request:

```sql
update gg_props set value = 'YOUR-NEW-KEY' where key = 'ADMIN_KEY';
```

**The hourly results import** is a pg_cron job (`gg-refresh-results`) that
calls the function. Check it under Integrations → Cron in the dashboard.

**Free plan caution:** Supabase pauses a free project after 7 days with no
activity, and it stays down until someone un-pauses it in the dashboard.
Daily visitors keep it awake. Pro ($25/mo) never pauses.

### The API URLs

```
https://ulzbcqnvltbioajvgvrr.supabase.co/functions/v1/api                  Supabase
https://script.google.com/macros/s/AKfycbyrhng3sZoNNpgDA2JApz2Z0xx01x9N1TwnGhqkMfbmXCR-q11NIqlB_i3krHPZ3yZ7GA/exec   Apps Script
```

Both live in **`gg-config.js`**, which picks one per page load: Apps Script
until Supabase says it is live, then Supabase. While Supabase is live the
Apps Script URL forwards to it, so the fallback copies in `fantasy.html` and
`admin.html` (Apps Script) are always safe.

### Moving between them

`apps-script/migrate.gs` is a second file in the Apps Script project. Pick
a function in the editor's toolbar and press **Run**:

- **`cutover`** moves the site to Supabase (about two minutes; changes pause
  briefly). It checks first, verifies the copy cell by cell, and puts
  everything back by itself if anything fails.
- **`revertToAppsScript`** moves it back, copying everything from Supabase
  into the Sheet first, so nothing written since the cutover is lost.

Both need the current `sumo-fantasy.gs` saved **and deployed** in Apps Script
(Deploy → Manage deployments → pencil → Version: New version → Deploy). The
details are in CLAUDE.md under *Two backends, one switch*.

---

## 4. After uploading — quick smoke test

1. Open the site. The nav shows **ABOUT · ANALYSIS · SIMULATION · FANTASY**,
   the logo, a **?** help button, and **Log in / Sign up** at top-right.
2. Sign up from the nav. Open another page — you're still signed in (state is
   shared across the whole site).
3. Account modal → **Messages** (searchable user picker), **Avatar**, **Log out**.
4. On **Fantasy**, draft a team and save it; sign in from a private window and
   confirm it comes back.
5. **Fantasy → My Leagues** on a league you commissioner: the scoring-rules
   editor and (on keepers leagues) the draft-date scheduler with member
   agreement.
6. Click **?** → **Report a bug**, submit → the Admin page's Feedback tab shows
   the new row (or, in the Supabase Table Editor, schema `gg_admin`,
   `sheet_rows` filtered to sheet `Feedback`). If it says it couldn't send,
   check `?action=__health` and the URL in `gg-config.js`.
7. **Admin page** → Feedback tab (Reply) and Users tab (Message).
8. **Admin page → Users → Broadcast a message**: open it and confirm the
   recipient count appears. That count is a live `dryRun` call, so if it stays
   blank the backend is out of date: check `?action=version` against
   `BACKEND_VERSION` and that the last push deployed (the broadcast needs the
   `adminBroadcast` action).
9. **Champions.** Titles are crowned once per basho, by the same
   **Admin page → Apply ranking for this basho** button that promotes and
   demotes everyone. After running it, the message should read
   "…and crowned N champions", and the store gains a **Champions** sheet.
   Then check all three surfaces: the account modal's **Trophy case** (a gold
   Emperor's Cup card for the public title, a bronze gunbai card per private
   league), the **leaderboard** (a small cup beside the reigning champion's
   name), and a **league page** (a "Reigning champion" pill under the name).
   If the button reports a `championError`, the ranking still went through —
   the trophies didn't. Nothing is lost: fix the cause, clear the
   `rankedBasho` row in **Meta**, and run it again. In the SQL editor:
   ```sql
   delete from gg_rows where sheet = 'Meta' and cells->>0 = 'rankedBasho';
   update gg_sheets set version = version + 1 where name = 'Meta';
   ```

Hard-refresh (Cmd/Ctrl+Shift+R) after uploading to clear cached old copies.

---

## Notes

- The site still uses the JS namespace `GyojiGuide` and the domain
  `gyojiguide.com` internally — these are code/infra identifiers, not visible
  branding, and were intentionally left as-is. If you move to a new domain,
  that's a separate swap.
- Rikishi photos load from `images/rikishi/` — 70 transparent WebP files, one
  per shikona, shared by `dohyo.html`, `fantasy.html` and
  `keepers-mock-draft.html`. **Upload that folder with the HTML**, or every
  wrestler renders blank. The favicon and the simulator's scenery are still
  base64-inlined in `dohyo.html`; nothing external to host for those.
- `robots.txt` and `sitemap.xml` both declare `sumoslapdown.com`. If you serve
  this from GitHub Pages on that custom domain, the repo also needs a `CNAME`
  file containing `sumoslapdown.com`.
