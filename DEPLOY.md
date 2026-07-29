# Gyoji Guide — Fantasy Sumo · deploy checklist

## Upload to GitHub (repo root, same folder as index.html)

**New / updated this round — required:**

| File | Why |
|---|---|
| `fantasy.html` | The fantasy page itself, with accounts + your Apps Script `API_URL` already wired in |
| `taiko-radio.js` | Shared music player the page includes (also used by index + dohyo) |

**Already in the repo — must still be present (fantasy.html links to them):**

| File / folder | Used for |
|---|---|
| `index.html` | "‹ Gyoji Guide" back link |
| `dohyo.html` | "Enter the Dohyō →" (carries your team over) |
| `taiko.html` | The "＋" create-a-loop button on the radio bar |
| `samples/` (all .mp3s) | The radio fetches its drum sounds from here |

Everything is relative-path, so it all just needs to sit in the same directory.
No build step, no dependencies.

## NOT uploaded to GitHub

- **`sumo-fantasy.gs`** — this lives in Google, not the repo. It's already
  deployed as your Apps Script web app; the page talks to it via the
  `/exec` URL baked into `fantasy.html`. (Optional: commit it to the repo
  as documentation/backup, but editing it there does nothing — changes
  must be pasted into script.google.com and re-deployed.)
- Your Google Sheet — stays in Drive; it's the database.

## After pushing

1. Open `https://gyojiguide.com/fantasy.html`.
2. The yellow "Device mode" banner should be **gone** (means the API is live).
3. Create an account, draft seven, hit **Save my team**.
4. Check the Sheet → **Users** tab: your row appears (PIN stored as a hash).
5. Open a private window → Sign in with the same handle + PIN → your team
   comes back down. Leaderboard tab lists everyone signed up.

## Next basho (Aki, September)

Results flow from the Sheet's **Results** tab: enter bouts day-by-day
(`day | division | east | west | winner | kimarite`), or add an hourly
trigger on `refreshResults` in Apps Script (pre-set to basho `202609`).
Until Results has rows, the page scores against the final Nagoya 2026
standings baked into it.

## If you re-deploy the Apps Script

A **new deployment** gets a **new `/exec` URL** → update `API_URL` at the
top of `fantasy.html` and re-push. (Using "Manage deployments → edit →
new version" keeps the same URL — prefer that.)
