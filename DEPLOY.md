# Sumo Slapdown — deploy guide

A static, no-build site: plain HTML + JS modules + two SVG logos, backed by a
Google Apps Script web app. Everything uses **relative paths**, so all the web
files just need to sit in the **same folder** on your host (GitHub Pages,
Netlify Drop, etc.). No bundler, no npm.

---

## 1. Web files — upload these to your host (same directory)

**Pages**
| File | Nav label |
|---|---|
| `index.html` | About (home) |
| `analysis.html` | Analysis |
| `dohyo.html` | Simulation |
| `fantasy.html` | Fantasy |

**Shared modules** (loaded by the pages)
| File | Role |
|---|---|
| `gg-config.js` | Holds the Apps Script `/exec` URL (the one place it lives) |
| `gg-account.js` | Shared account + login/register/logout + saveAvatar |
| `gg-nav.js` | The shared top nav, the larger logo, and the Help/feedback modal |
| `gg-auth.js` | The unified account control that sits in the nav on every page |
| `gg-mawashi.js` | The mawashi avatar designer (layers, textures, kanji) |
| `gg-roster.js` | Live banzuke loader (pulls the current ranking from sumo-api) |
| `gg-banzuke.js` | The Welcome page's Edo banzuke-e crowd illustration |
| `taiko-radio.js` | The background taiko radio player |

**Logo assets** (must sit alongside the HTML)
| File | Used by |
|---|---|
| `SumoSlapdown-logowide.svg` | The nav logo (every page) |
| `SumoSlapdown-logoTall.svg` | The centerpiece in the Welcome crowd |

**Optional standalone tool** (not in the nav; open it directly if you want it)
| File | What it is |
|---|---|
| `keepers-draft-preview.html` | A self-contained click-through of the Keepers snake draft (bots draft themselves; nothing is saved). Handy for demos. |

**Private admin dashboard** (deliberately not linked anywhere — see below)
| File | What it is |
|---|---|
| `admin.html` | Connectivity to sumo-api, pageview analytics, user moderation (warn/ban/delete), and a read-only feed of every message-board post across all leagues. Password-gated by the `ADMIN_KEY` Script Property (with a brute-force lockout on the backend). |

`admin.html` isn't added to `gg-nav.js`'s link list and isn't referenced from any other page, so a visitor won't stumble onto it from the site itself — but like every other file here it's still a public URL on a static host. That's obscurity, not real access control. Don't put anything in it you'd be upset to see leaked, and don't reuse `ADMIN_KEY` anywhere else.

---

## 2. Two things that must already exist on the host

These are **not** in this zip and the site expects them on your server:

- **`samples/` folder of `.mp3` drum sounds** — `taiko-radio.js` fetches its
  taiko hits from `samples/…​.mp3` at runtime. If that folder isn't present the
  rest of the site works fine; the radio just won't have audio. (These are the
  same sample files already on your current deployment.)
- **`taiko.html`** *(optional)* — if the radio's "＋" build-a-loop button links
  to it. Only needed if you were using that feature; the site works without it.

---

## 3. Backend — `sumo-fantasy.gs` (Google Apps Script)

`sumo-fantasy.gs` is **not** a web file — it's the source for your Apps Script
web app (accounts, leagues, drafts, and the Help/feedback inbox). It's included
here as backup/reference. To update the live backend:

1. Open your Apps Script project at **script.google.com**.
2. Paste in the contents of `sumo-fantasy.gs`.
3. **Set your `ADMIN_KEY` as a Script Property — do it in code, not by hand.**
   The key is no longer stored in `sumo-fantasy.gs` (the file only *reads* it),
   so the secret never lives in a file you zip or share. Setting it by typing
   into **Project Settings → Script Properties** works in theory, but in
   practice a stray trailing space — or setting it in the wrong one of your
   several sumo projects — will make the login reject the correct key. The
   reliable way is to set it programmatically: temporarily paste this into the
   project, **Run** it once, confirm the log, then delete it:
   ```js
   function setAdminKeyNow() {
     PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', 'YOUR-KEY-HERE');
     Logger.log('set; this project serves: ' + ScriptApp.getService().getUrl());
   }
   ```
   The logged "this project serves" URL **must** match the `/exec` URL in
   `gg-config.js` — if it doesn't, you set the key in the wrong project. This is
   the password `admin.html` asks for; if the property is unset the dashboard
   fails closed. Rotate the key the same way (change the value, run, delete) —
   no redeploy needed, setting a property is instant.
4. **Run `setup()` once.** This creates/updates the Sheets, including the
   **Feedback** sheet used by the Help modal (FAQ questions, suggestions, bug
   reports, user reports), the **PageViews** sheet the admin dashboard reads
   for analytics, two new columns (`status`, `warnMsg`) on the **Users**
   sheet for the admin dashboard's warn/ban moderation, and the
   **LeaderboardBoard** / **LeaderboardVotes** sheets behind the Fantasy
   page's Leaderboard-tab message board. (Editable handles and the account
   modal's trophy case/history/leagues panel added later reuse these same
   sheets — no new ones, but still redeploy per the next step so the new
   backend actions go live.)
5. **Deploy → Manage deployments → click the ✏️ pencil on your existing
   deployment → Version: New version → Deploy.** ⚠️ **Always update the
   existing deployment this way — do _not_ create a *new* deployment.** Editing
   the current one keeps the same `/exec` URL; creating a new one mints a fresh
   URL and forces you to update `gg-config.js`, `fantasy.html`, and `admin.html`
   every time (this is exactly what caused the repeated URL churn). If the URL
   ever does change, update it in those three files — see §4.
6. Set access to **Anyone**, or browser calls will be blocked.

### The `/exec` URL

The site currently points at:

```
https://script.google.com/macros/s/AKfycbyrhng3sZoNNpgDA2JApz2Z0xx01x9N1TwnGhqkMfbmXCR-q11NIqlB_i3krHPZ3yZ7GA/exec
```

This lives in **`gg-config.js`** (`GyojiGuide.API_URL`) — the single source of
truth every page reads. `fantasy.html` also keeps a matching fallback copy.
**If you ever create a new deployment (new URL), update it in `gg-config.js`**
(and the fallback in `fantasy.html`) and re-upload those two files.

---

## 4. After uploading — quick smoke test

1. Open the site. The nav shows **WELCOME · ANALYSIS · SIMULATION · FANTASY**,
   the logo, a **?** help button, and **Log in / Sign up** at top-right.
2. Sign up from the nav. Open another page — you're still signed in (state is
   shared across the whole site).
3. On **Fantasy**, draft a team and save it; sign in from a private window and
   confirm it comes back.
4. Click **?** → **Report a bug**, submit → check the Sheet's **Feedback** tab
   for the new row. (If it says it couldn't send, the backend URL/access or the
   `setup()` step needs attention.)

---

## Notes

- The site still uses the JS namespace `GyojiGuide` and the domain
  `gyojiguide.com` internally — these are code/infra identifiers, not visible
  branding, and were intentionally left as-is. If you move to a new domain,
  that's a separate swap.
- All wrestler photos and the favicon are inlined as base64 (that's why the
  HTML files are large) — nothing external to host for those.
