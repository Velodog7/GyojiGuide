# Taiko Beat Loop Constructor

A browser drum machine built from 60 taiko samples. Build a loop in `taiko.html`, then embed it on any other page in this repo with `player.html`.

## Files

```
taiko.html          The beat constructor (open this to make loops)
player.html         Embeddable looping player — reads a pattern from the URL
taiko-data.js       Sample list + the pattern encoder/decoder (shared by both pages)
samples/            The 60 .mp3 samples
example-embed.html  Shows how to drop a loop into your own page
```

## Important: it must be served over http

The pages load audio files from the `samples/` folder, and browsers block that when you
open the file directly (a `file://` URL). So you can't just double-click `taiko.html`.
Use one of these:

- **GitHub Pages** (easiest — see below), or
- **A local server:** from this folder run `python3 -m http.server` and open
  `http://localhost:8000/taiko.html`.

## Put it on GitHub

1. Create a new repository on github.com (e.g. `taiko-beats`).
2. Upload everything in this folder — keep `taiko.html`, `player.html`, `taiko-data.js`,
   and the `samples/` folder together at the repo root.
   (On github.com: **Add file → Upload files**, drag the whole contents in, commit.)
3. Turn on GitHub Pages: repo **Settings → Pages → Source: Deploy from a branch →
   `main` / `root` → Save**.
4. After a minute your constructor is live at
   `https://YOUR-USERNAME.github.io/taiko-beats/taiko.html`.
   (Note: the file is `taiko.html`, not `index.html`, so the repo's root URL won't
   auto-open it — go straight to `/taiko.html`.)

## Embedding a beat on another page

1. Open the constructor, build a loop, click **Embed…**.
2. Copy the `<iframe>` snippet it gives you and paste it into any other `.html` page
   in the same repo. It looks like:

   ```html
   <iframe src="player.html?p=XXXXXX" width="260" height="104" style="border:0"></iframe>
   ```

   The whole pattern is packed into that `p=` code — no database needed.
   If your page lives in a subfolder, adjust the path (e.g. `../player.html?p=...`).

3. Visitors click ▶ to play. (Browsers block sound that starts on its own, so a
   click is required.)

### Trigger it yourself

The player exposes a tiny API on its iframe window:

```js
const frame = document.querySelector('iframe');
frame.contentWindow.TaikoLoop.play();    // start
frame.contentWindow.TaikoLoop.stop();    // stop
frame.contentWindow.TaikoLoop.toggle();  // toggle
```

Add `&autoplay=1` to the player URL to attempt autoplay (most browsers still wait
for a first interaction on the page).
