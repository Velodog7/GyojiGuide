# Sumo Slapdown — site bundle

This zip contains every file we've built or edited. A few files that live
**only on your host** (they were never sent to this chat) are **not** in here —
they haven't changed, so just leave them in place on the server. They're listed
under "Not included" below.

---

## What's in this zip

**Pages**
- `index.html` — Analysis
- `dohyo.html` — Simulation
- `fantasy.html` — Fantasy
- `admin.html` — private admin dashboard (not linked in nav)

**Shared JS modules**
- `gg-config.js` — the `/exec` backend URL (single source of truth)
- `gg-account.js` — accounts, scoring engine, leagues, DM + directory API
- `gg-nav.js` — shared top nav + spinner CSS
- `gg-auth.js` — account control, account modal, Messages
- `gg-mawashi.js` — mawashi avatar designer
- `gg-roster.js` — live banzuke loader

**Backend / docs**
- `sumo-fantasy.gs` — Google Apps Script source (paste into script.google.com)
- `DEPLOY.md` — full deploy guide
- `spinner.html` — the reusable loading-spinner reference

**Current `/exec` URL** (already set in `gg-config.js` + `fantasy.html`):
`.../AKfycbzf6elYznU-a0uAF_AjseWOi6Me1UnL_cCCbaeFzfLVOjumqw65w_NFQk2IhvQHfTGMPw/exec`

---

## NOT included (keep the copies already on your host)

These are unchanged and were never uploaded to this chat, so grab them from
your existing deployment / repo:

- `banzuke.html` — the Welcome page
- `gg-banzuke.js` — the Welcome page's crowd illustration
- `taiko-radio.js` — background taiko radio player
- `SumoSlapdown-logowide.svg` — nav logo (every page)
- `SumoSlapdown-logoTall.svg` — Welcome-page centerpiece
- `keepers-draft-preview.html` — standalone snake-draft demo (optional)
- `samples/` — folder of `.mp3` taiko sounds for the radio

Upload the files from this zip **into the same folder** as those, overwriting
the old versions. All paths are relative, so everything just needs to sit
together.

---

## Deploy steps for this batch

1. **Backend:** open your Apps Script project, paste in `sumo-fantasy.gs`,
   **run `setup()` once** (adds new columns for custom scoring, draft dates,
   and direct messages — safe on existing data), then
   **Deploy → Manage deployments → Edit → New version**.
   > Editing "New version" keeps the same `/exec` URL. If you create a *new*
   > deployment instead, the URL changes and you'll have to update
   > `gg-config.js` + `fantasy.html` again.
2. **Web files:** upload everything else from this zip to your host, same folder.
3. **Hard-refresh** (Cmd/Ctrl+Shift+R) to clear cached old copies.

## Quick smoke test
- Nav shows the logo + WELCOME · ANALYSIS · SIMULATION · FANTASY, help (?), and account.
- Account modal → Messages (searchable user picker), Avatar, Log out.
- Fantasy → My Leagues → a league you commissioner: Scoring rules editor + (keepers) draft-date scheduler with member agreement.
- Admin page → Feedback tab (Reply) and Users tab (Message).
