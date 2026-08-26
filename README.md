# Sumo Slap Down

Fantasy sumo hub — analyze rikishi, mock draft a team, simulate upcoming basho,
and run private fantasy sumo leagues. Live at **https://sumoslapdown.com**.

A static, no-build site: plain HTML + vanilla JS modules, backed by a Google
Apps Script web app (a Google Sheet is the database). No bundler, no npm, no
framework. Every path is relative, so all the web files just need to sit in the
same folder on whatever static host you use.

> Deploying or updating the backend? See **[DEPLOY.md](DEPLOY.md)** — it covers
> the Apps Script side, the `ADMIN_KEY`, and the smoke test.

---

## Pages

| File | Nav label | What it is |
|---|---|---|
| `index.html` | About | Home. Welcome / Learn / Resources tabs, plus the Edo-style banzuke crowd illustration. |
| `analysis.html` | Analysis | Per-rikishi stats and matchup analysis. |
| `dohyo.html` | Simulation | Basho simulator. |
| `fantasy.html` | Fantasy | Drafting, leagues, leaderboard, message board. |
| `admin.html` | — | Private admin dashboard. Not linked from anywhere; password-gated by `ADMIN_KEY`. See DEPLOY.md. |
| `banzuke.html` | — | Legacy home page, superseded by `index.html`. Still served so old links resolve; `gg-nav.js` treats it as an alias for About. |
| `keepers-mock-draft.html` | — | Snake-draft practice room, opened from Fantasy → My Leagues on a keepers league. Works standalone too (generic bots) if opened directly. |

## Shared modules

Loaded by the four main pages, in this order:

| File | Role |
|---|---|
| `gg-config.js` | The Apps Script `/exec` URL + `apiGet`/`apiGetQ`/`apiPost` helpers. The one place the endpoint lives. |
| `gg-account.js` | Accounts, scoring engine, leagues, DM + directory API. |
| `gg-nav.js` | Shared top nav, the Help/feedback modal, and the site-wide spinner CSS. |
| `gg-auth.js` | The account control in the nav, the account modal, and Messages. |
| `gg-mawashi.js` | Mawashi avatar designer (layers, textures, kanji). |
| `gg-roster.js` | Live banzuke loader — pulls the current ranking from sumo-api. |
| `gg-banzuke.js` | The home page's banzuke crowd illustration. |
| `taiko-radio.js` | Background taiko radio player. Reads `samples/`. |

`gg-ranking.js` also lives here — the long-term JSA-style ranking ladder — but
**no page currently loads it**. The ladder that actually runs is the mirrored
copy inside `sumo-fantasy.gs`, server-side. Wire it in or delete it; don't
assume it's live.

## Assets

| File | Used by |
|---|---|
| `SumoSlapdown-logowide.svg` | The nav logo, every page |
| `SumoSlapdown-logoTall.svg` | The centerpiece in the home page's crowd |
| `SumoSlapdown-logoMedium.svg` | The Fantasy leaderboard header |
| `samples/` | 60 taiko `.mp3` hits for the radio and the loop constructor |
| `images/rikishi/` | The 70 rikishi cutouts, transparent WebP, 420px tall, one file per shikona |
| `images/svg/`, `images/jpg/` | Source art: Illustrator SVGs (each wrapping a full-res PNG) and background-intact JPGs |

`images/rikishi/` is the set the site actually loads — `dohyo.html`,
`fantasy.html` and `keepers-mock-draft.html` all reference the same files, so a
photo is downloaded once and cached across the whole site. **Filenames must
match the shikona keys** in each page's photo table exactly; that string is the
lookup. The files were generated from `images/svg/` by extracting the embedded
PNG, trimming to the alpha bounding box and resizing to 420px tall — the tight
crop matters, because each rikishi's `ar`/`h`/face-position metadata is
expressed as fractions of a tightly-cropped frame.

The favicon and the simulator's scenery (dohyo, roof, gyoji, yobidashi, and the
two `SHIKO` dohyo-iri poses) are still base64-inlined in `dohyo.html`. They're
page-specific and not duplicated anywhere, so there's little to gain by pulling
them out.

## Backend

`sumo-fantasy.gs` is the Google Apps Script source (accounts, leagues, drafts,
the ranking ladder, the feedback inbox). It isn't served as a web file — it's
kept here as the source of truth and pasted into script.google.com. See
DEPLOY.md.

---

## Running it locally

The pages fetch `samples/*.mp3` and talk to the backend, and browsers block
both from a `file://` URL — so don't just double-click the HTML. From this
folder:

```sh
python3 -m http.server
```

Then open http://localhost:8000/ .

---

## The taiko beat constructor

A separate little browser drum machine built from the same 60 taiko samples,
used by the radio's "＋" button. Not part of the main nav.

| File | Role |
|---|---|
| `taiko.html` | The constructor — open it to build a loop |
| `player.html` | Embeddable looping player; reads a pattern from the URL |
| `taiko-data.js` | Sample list + pattern encoder/decoder, shared by both |
| `example-embed.html` | Worked example of dropping a loop into a page |

Build a loop in `taiko.html`, hit **Embed…**, and paste the snippet anywhere:

```html
<iframe src="player.html?p=XXXXXX" width="260" height="104" style="border:0"></iframe>
```

The whole pattern is packed into that `p=` code — no database needed. Visitors
click ▶ to play (browsers block sound that starts on its own).

The player exposes a small API on its iframe window:

```js
const frame = document.querySelector('iframe');
frame.contentWindow.TaikoLoop.play();
frame.contentWindow.TaikoLoop.stop();
frame.contentWindow.TaikoLoop.toggle();
```

Adding `&autoplay=1` attempts autoplay, though most browsers still wait for a
first interaction on the page.

---

## Notes

- The JS namespace is `GyojiGuide` and some internals still say `gyojiguide.com`
  — code identifiers from an earlier name, deliberately left alone. Not visible
  branding.
- `spinner.html` is a reference page for the shared loading spinner, kept for
  copy-paste. Nothing links to it.
