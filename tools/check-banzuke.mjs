#!/usr/bin/env node
/* Once a new banzuke is published, bring the site's bundled rosters onto it.

     node tools/check-banzuke.mjs 202611           # report only
     node tools/check-banzuke.mjs 202611 --write   # update the bundled tables

   Every page that ranks or scores already follows the live banzuke on its own
   (gg-roster.js on load; gg-account.js for scoring). What this keeps current
   is the BUNDLED copies: each page's offline fallback, and the home page's
   "Name that rikishi" game, which has no live sync and quizzes rank.

   With --write:
   - rank codes in every table follow the banzuke;
   - a man who has left it is marked off where the table knows `off`
     (fantasy RK, the banzuke art) and dropped where it doesn't (the game, the
     mock draft's roster, the scoring fallback);
   - a newcomer is added only where a card works without a portrait: fantasy
     RK and the mock draft, using the profile in tools/basho-notes/ when there
     is one. The game and the banzuke art take him once
     images/rikishi/<Name>.webp exists.
   gg-dossier.js is not touched: its rank fields describe the finished basho
   (tools/finish-basho.mjs moves them), and the live sync supplies the rest. */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const BASHO = args.find(a => /^\d{6}$/.test(a));
const WRITE = args.includes('--write');
if (!BASHO) { console.error('usage: node tools/check-banzuke.mjs <YYYYMM of the new banzuke> [--write]'); process.exit(2); }

const TIER = { Yokozuna: 'Y', Ozeki: 'O', Sekiwake: 'S', Komusubi: 'K', Maegashira: 'M', Juryo: 'J' };
async function division(div) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(`https://sumo-api.com/api/basho/${BASHO}/banzuke/${div}`); if (r.ok) return await r.json(); } catch (e) {}
    await new Promise(r => setTimeout(r, 900 * (i + 1)));
  }
  throw new Error('could not fetch the ' + div + ' banzuke');
}
const live = {};                                   // name -> {code, tier, num, side, div, kanji, from}
for (const div of ['Makuuchi', 'Juryo']) {
  const d = await division(div);
  for (const e of [].concat(d.east || [], d.west || [])) {
    const m = String(e.rank || '').match(/^(\w+)\s*(\d+)?\s*(East|West)/);
    if (!m || !TIER[m[1]]) continue;
    const tier = TIER[m[1]], num = +(m[2] || 0), side = m[3][0].toLowerCase();
    const sanyaku = 'YOSK'.includes(tier);
    live[e.shikonaEn] = { tier, num: sanyaku ? 0 : num, side, code: tier + (sanyaku ? '' : num) + side,
      div: tier === 'J' ? 'juryo' : 'makuuchi', kanji: String(e.shikonaJp || '').replace(/[\s　(（].*$/, '') };
  }
}
if (Object.keys(live).length < 60) { console.error(`only ${Object.keys(live).length} sekitori on the ${BASHO} banzuke: not published yet?`); process.exit(1); }

// newcomers' hand-written profiles, for kanji and origin
const profiles = {};
const notesDir = join(ROOT, 'tools', 'basho-notes');
for (const f of existsSync(notesDir) ? readdirSync(notesDir) : []) {
  if (!f.endsWith('.json')) continue;
  for (const t of JSON.parse(readFileSync(join(notesDir, f), 'utf8')).newcomers || []) {
    const row = vm.runInNewContext('(' + t + ')', { X: null });
    profiles[row.n] = row;
  }
}
const hasArt = n => existsSync(join(ROOT, 'images', 'rikishi', n + '.webp'));

/* a table is `NAME = <JSON>;` inside a file */
function table(file, name) {
  const path = join(ROOT, file), text = readFileSync(path, 'utf8');
  const m = text.match(new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*`));
  if (!m) throw new Error(`${name} not found in ${file}`);
  const start = m.index + m[0].length;
  let i = start, depth = 0, str = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (str) { if (c === '\\') i++; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) break;
  }
  return { file, path, name, value: JSON.parse(text.slice(start, i + 1)),
           put(v) { const t = readFileSync(path, 'utf8'); writeFileSync(path, t.slice(0, start) + JSON.stringify(v) + t.slice(i + 1)); } };
}
const report = [];
function note(t, changed, gone, added, extra) {
  report.push(`${(t.file + ' ' + t.name).padEnd(36)} ${String(changed).padStart(3)} rank${changed === 1 ? '' : 's'} moved` +
    (gone.length ? ` · off the banzuke: ${gone.join(', ')}` : '') + (added.length ? ` · new: ${added.join(', ')}` : '') + (extra ? ' · ' + extra : ''));
}
const fromOf = n => (profiles[n] && profiles[n].from) || '';
const kanjiOf = n => (profiles[n] && profiles[n].kanji) || live[n].kanji;

/* fantasy.html RK: {code, kanji, from, src, off} */
{ const t = table('fantasy.html', 'RK'), v = t.value; let ch = 0; const gone = [], add = [];
  for (const [n, r] of Object.entries(v)) {
    const w = live[n];
    if (w) { if (r.code !== w.code) { r.code = w.code; ch++; } if (r.off) { delete r.off; add.push(n + ' (back)'); } }
    else if (!r.off) { r.off = true; gone.push(n); }
  }
  for (const n of Object.keys(live)) if (!v[n]) { v[n] = { code: live[n].code, kanji: kanjiOf(n), from: fromOf(n), src: hasArt(n) ? `images/rikishi/${n}.webp` : '' }; add.push(n + (hasArt(n) ? '' : ' (no portrait yet)')); }
  note(t, ch, gone, add); if (WRITE) t.put(v); }

/* gg-banzuke.js RIK: {k, c, src, n, off}; newcomers only with a portrait */
{ const t = table('gg-banzuke.js', 'RIK'), v = t.value; let ch = 0; const gone = [], add = [], wait = [];
  for (const [n, r] of Object.entries(v)) {
    const w = live[n];
    if (w) { if (r.c !== w.code) { r.c = w.code; ch++; } if (w.num && r.n != null && r.n !== w.num) r.n = w.num; if (r.off) delete r.off; }
    else if (!r.off) { r.off = true; gone.push(n); }
  }
  for (const n of Object.keys(live)) if (!v[n]) { if (hasArt(n)) { v[n] = { k: kanjiOf(n), c: live[n].code, src: `images/rikishi/${n}.webp` }; add.push(n); } else wait.push(n); }
  note(t, ch, gone, add, wait.length ? 'waiting on a portrait: ' + wait.join(', ') : ''); if (WRITE) t.put(v); }

/* gg-rikishi.js ALL (the home page game): {k, c, d, h, p, j}; it shows a portrait, so newcomers need art */
{ const t = table('gg-rikishi.js', 'ALL'), v = t.value; let ch = 0; const gone = [], add = [], wait = [];
  for (const [n, r] of Object.entries(v)) {
    const w = live[n];
    if (w) { if (r.c !== w.code) { r.c = w.code; ch++; } r.d = w.div; }
    else { delete v[n]; gone.push(n); }
  }
  for (const n of Object.keys(live)) if (!v[n]) {
    const p = profiles[n];
    if (hasArt(n) && p) { v[n] = { k: kanjiOf(n), c: live[n].code, d: live[n].div, h: p.stable, p: p.country === 'Japan' ? p.pref : p.country, j: p.country === 'Japan' }; add.push(n); }
    else wait.push(n);
  }
  note(t, ch, gone, add, wait.length ? 'waiting on a portrait and profile: ' + wait.join(', ') : ''); if (WRITE) t.put(v); }

/* keepers-mock-draft.html: PHOTOS {name: [code, kanji, from, src]} and ROSTER_RAW in banzuke order */
{ const t = table('keepers-mock-draft.html', 'PHOTOS'), v = t.value; let ch = 0; const add = [];
  for (const [n, r] of Object.entries(v)) if (live[n] && r[0] !== live[n].code) { r[0] = live[n].code; ch++; }
  for (const n of Object.keys(live)) if (!v[n]) { v[n] = [live[n].code, kanjiOf(n), fromOf(n), hasArt(n) ? `images/rikishi/${n}.webp` : '']; add.push(n); }
  note(t, ch, [], add); if (WRITE) t.put(v); }
{ const t = table('keepers-mock-draft.html', 'ROSTER_RAW');
  const base = { Y: 6000, O: 5000, S: 4000, K: 3000, M: 2000, J: 1000 };     // deriveFromRank()'s seed
  const before = new Map(t.value.map(r => [r[0], r[1]]));
  const rows = Object.entries(live).map(([n, w]) => [n, w.code, kanjiOf(n), base[w.tier] - w.num * 10 - (w.side === 'w' ? 5 : 0), w.div])
    .sort((a, b) => b[3] - a[3]);
  const gone = [...before.keys()].filter(n => !live[n]), add = rows.filter(r => !before.has(r[0])).map(r => r[0]);
  note(t, rows.filter(r => before.has(r[0]) && before.get(r[0]) !== r[1]).length, gone, add); if (WRITE) t.put(rows); }

/* dohyo.html ROSTER (the simulator): {d, code, elo, stable, sig}; newcomers need a curated Elo and style first */
{ const t = table('dohyo.html', 'ROSTER'), v = t.value; let ch = 0; const gone = [], wait = [];
  for (const [n, r] of Object.entries(v)) { const w = live[n]; if (w) { if (r.code !== w.code) { r.code = w.code; ch++; } r.d = w.div; } else gone.push(n); }
  for (const n of Object.keys(live)) if (!v[n]) wait.push(n);
  note(t, ch, gone, [], wait.length ? 'not in the simulator yet: ' + wait.join(', ') : ''); if (WRITE) t.put(v); }

/* gg-account.js RANKS: the scoring fallback, {name: tier} */
{ const t = table('gg-account.js', 'RANKS'), v = t.value, next = {};
  for (const [n, w] of Object.entries(live)) next[n] = w.tier;
  const ch = Object.keys(next).filter(n => v[n] && v[n] !== next[n]).length;
  note(t, ch, Object.keys(v).filter(n => !next[n]), Object.keys(next).filter(n => !v[n])); if (WRITE) t.put(next); }

console.log(`${BASHO} banzuke: ${Object.keys(live).length} sekitori\n` + report.map(r => '  ' + r).join('\n'));
console.log(WRITE ? 'written.' : 'report only (add --write to update the tables).');
