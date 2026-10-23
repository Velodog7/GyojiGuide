#!/usr/bin/env node
/* Roll the bundled rikishi data forward once a basho is over.

     node tools/finish-basho.mjs 202609            # dry run: says what would change
     node tools/finish-basho.mjs 202609 --write    # writes gg-dossier.js and analysis.html

   The live banzuke sync keeps RANKS current on every page by itself. What it
   can't do is move the bundled record along: gg-dossier.js's rows describe the
   last FINISHED basho (live record, three past records, award tag, Elo), and
   analysis.html keeps that basho's honours and the ranks of the ones before
   it. Until they move, the analysis page labels one basho's results with
   another's name, and once the next banzuke is published (no records yet) it
   falls back to stale ones. This does the move:

   - gg-dossier.js, every row: live = the finished basho's record (with aw and
     lk), rec shifted one slot, rank fields and chg = that basho's rank and the
     move into it, cw/cl += its bouts, age, and Elo from sumostats.com (only
     values whose page names the same rikishi; the rest are left alone).
   - analysis.html: FINISHED_BASHO_ID, BASHO_END, FINISHED_AW, AWARDS, the rank
     slots (AGO2_RANK, AGO3_RANK), HL and FIN_HL, and the #bashoRecap paragraph.
   - Words: tools/basho-notes/<id>.json holds what a person writes each basho
     (form, injury notes, highlights, the recap, newcomers' profiles). Nothing
     here invents prose; a wrestler without a note keeps his old one.

   Records, ranks and honours come from sumo-api.com. Responses are cached in
   tools/.cache/ (git-ignored) so a re-run is quick and gentle on both sites. */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'tools', '.cache');
const API = 'https://sumo-api.com/api';
const DIVS = ['Makuuchi', 'Juryo', 'Makushita', 'Sandanme', 'Jonidan', 'Jonokuchi'];
const LOW = { Makushita: 'Ms', Sandanme: 'Sd', Jonidan: 'Jd', Jonokuchi: 'Jk' };
const TIER = { Yokozuna: 'Y', Ozeki: 'O', Sekiwake: 'S', Komusubi: 'K', Maegashira: 'M', Juryo: 'J',
               Makushita: 'Ms', Sandanme: 'Sd', Jonidan: 'Jd', Jonokuchi: 'Jk' };
const PRIZE = { 'Kanto-sho': 'Kantō-shō', 'Shukun-sho': 'Shukun-shō', 'Gino-sho': 'Ginō-shō' };
const MON = { '01': 'Hatsu', '03': 'Haru', '05': 'Natsu', '07': 'Nagoya', '09': 'Aki', '11': 'Kyūshū' };

const args = process.argv.slice(2);
const BASHO = args.find(a => /^\d{6}$/.test(a));
const WRITE = args.includes('--write');
if (!BASHO) { console.error('usage: node tools/finish-basho.mjs <YYYYMM of the basho just finished> [--write]'); process.exit(2); }
const step = (id, n) => { let y = +id.slice(0, 4), i = ['01','03','05','07','09','11'].indexOf(id.slice(4)) + n;
  while (i < 0) { i += 6; y--; } while (i > 5) { i -= 6; y++; } return '' + y + ['01','03','05','07','09','11'][i]; };
const PREV = step(BASHO, -1);
const label = id => MON[id.slice(4)] + ' ' + id.slice(0, 4);

/* ---------------------------------------------------------------- fetching */
mkdirSync(CACHE, { recursive: true });
async function cached(name, fn) {
  const f = join(CACHE, name);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const v = await fn(); writeFileSync(f, JSON.stringify(v)); return v;
}
async function get(url, asText) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'sumoslapdown.com basho roll-over' } });
          if (r.ok) return asText ? await r.text() : await r.json(); } catch (e) {}
    await new Promise(r => setTimeout(r, 900 * (i + 1)));
  }
  throw new Error('could not fetch ' + url);
}
const banzuke = (id, div) => cached(`banzuke-${id}-${div}.json`, () => get(`${API}/basho/${id}/banzuke/${div}`));
const bashoInfo = id => cached(`basho-${id}.json`, () => get(`${API}/basho/${id}`));

/* "Maegashira 3 West" -> { tier:'M', num:3, side:'W', div:'Makuuchi' } */
function parseRank(rank, div) {
  const m = String(rank || '').match(/^(\w+)\s*(\d+)?\s*(East|West)?/);
  const tier = m ? (TIER[m[1]] || m[1]) : '?';
  return { tier, num: m && m[2] ? +m[2] : 0, side: m && m[3] ? m[3][0] : '', div };
}
const sanyaku = t => ['Y', 'O', 'S', 'K'].includes(t);
const rkOf = p => sanyaku(p.tier) ? p.tier : p.tier + (p.num || '');
const bucketOf = p => sanyaku(p.tier) ? 'sanyaku' : p.tier === 'J' ? 'juryo' : p.tier !== 'M' ? 'juryo'
  : p.num <= 4 ? 'm1_4' : p.num <= 8 ? 'm5_8' : p.num <= 12 ? 'm9_12' : 'm13_16';
const WORD = { Y: 'Yokozuna', O: 'Ozeki', S: 'Sekiwake', K: 'Komusubi', M: 'Maegashira', J: 'Juryo',
               Ms: 'Makushita', Sd: 'Sandanme', Jd: 'Jonidan', Jk: 'Jonokuchi' };
const rankWord = p => sanyaku(p.tier) ? WORD[p.tier] : WORD[p.tier] + ' ' + p.num;

/* ------------------------------------------------------- reading the files */
const DOSSIER = join(ROOT, 'gg-dossier.js'), ANALYSIS = join(ROOT, 'analysis.html');
let dossier = readFileSync(DOSSIER, 'utf8'), analysis = readFileSync(ANALYSIS, 'utf8');
const NOTES_FILE = join(ROOT, 'tools', 'basho-notes', BASHO + '.json');
const notes = existsSync(NOTES_FILE) ? JSON.parse(readFileSync(NOTES_FILE, 'utf8')) : {};

const finished = (analysis.match(/const FINISHED_BASHO_ID="(\d{6})"/) || [])[1];
if (finished === BASHO) { console.log(`analysis.html already treats ${label(BASHO)} as finished; nothing to do.`); process.exit(0); }
if (finished !== PREV) { console.error(`analysis.html is on ${finished}, not ${PREV}: roll forward one basho at a time.`); process.exit(1); }

/* The dossier's rows are object literals, one per wrestler; split them at the
   top level so untouched fields keep their exact text and layout. */
function splitTop(body) {                       // body: text between the row's braces
  const out = []; let depth = 0, str = false, start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (str) { if (c === '\\') i++; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(body.slice(start, i)); start = i + 1; }
  }
  out.push(body.slice(start));
  return out.map(raw => { const k = raw.indexOf(':'); return { raw, key: raw.slice(0, k).trim(), lead: raw.slice(0, k).match(/^\s*/)[0] }; });
}
class Row {
  constructor(text) { this.parts = splitTop(text.slice(1, text.lastIndexOf('}'))); }
  get(k) { const p = this.parts.find(p => p.key === k); return p ? p.raw.slice(p.raw.indexOf(':') + 1) : undefined; }
  set(k, v, after) {
    const p = this.parts.find(p => p.key === k);
    if (p) { p.raw = p.lead + k + ':' + v; return; }
    const at = after ? this.parts.findIndex(p => p.key === after) : -1;
    this.parts.splice(at >= 0 ? at + 1 : this.parts.length, 0, { key: k, lead: '', raw: k + ':' + v });
  }
  del(k) { this.parts = this.parts.filter(p => p.key !== k); }
  text() { return '{' + this.parts.map(p => p.raw).join(',') + '}'; }
}
const q = s => JSON.stringify(s);                // a JS string literal
const evalJs = src => vm.runInNewContext('(' + src + ')', { X: null });

const rStart = dossier.indexOf('const R=[');
const rEnd = dossier.indexOf('\n];', rStart);
const rowRe = /^\{n:"([^"]+)"/gm;
const rows = [];                                  // {name, start, end}
{ const body = dossier.slice(rStart, rEnd); let m; const starts = [];
  while ((m = rowRe.exec(body))) starts.push([m[1], rStart + m.index]);
  starts.forEach(([name, s], i) => {
    const e = i + 1 < starts.length ? starts[i + 1][1] : rEnd + 1;
    const seg = dossier.slice(s, e); const close = seg.lastIndexOf('}');
    rows.push({ name, start: s, end: s + close + 1 });
  });
}
const names = rows.map(r => r.name);
const newcomerNames = (notes.newcomers || []).map(t => (t.match(/^\{n:"([^"]+)"/) || [])[1]).filter(Boolean);

/* ------------------------------------------------------------ the numbers */
const want = new Set(names.concat(newcomerNames));
async function rankTable(id) {
  const out = {}, all = {};
  for (const div of DIVS) {
    const d = await banzuke(id, div);
    for (const e of [].concat(d.east || [], d.west || [])) {
      all[e.rikishiID] = { ...e, div };
      if (want.has(e.shikonaEn)) out[e.shikonaEn] = { ...e, div };
    }
  }
  return { byName: out, byId: all };
}
const [FIN, PRV, info] = await Promise.all([rankTable(BASHO), rankTable(PREV), bashoInfo(BASHO)]);

const yusho = {}; (info.yusho || []).forEach(y => { yusho[y.shikonaEn] = y.type; });
const prizes = {}; (info.specialPrizes || []).forEach(p => (prizes[p.shikonaEn] ||= []).push(PRIZE[p.type] || p.type));
// kinboshi: a maegashira's win over a yokozuna, not by default
const kin = {};
for (const e of Object.values(FIN.byId)) {
  if (!/^Maegashira/.test(e.rank)) continue;
  for (const b of e.record || []) {
    const opp = FIN.byId[b.opponentID];
    if (b.result === 'win' && opp && /^Yokozuna/.test(opp.rank) && b.kimarite !== 'fusen') kin[e.shikonaEn] = (kin[e.shikonaEn] || 0) + 1;
  }
}
// jun-yusho: the best Makuuchi record behind the winner's
const mk = Object.values(FIN.byId).filter(e => e.div === 'Makuuchi');
const champ = mk.find(e => yusho[e.shikonaEn] === 'Makuuchi');
const runnerWins = Math.max(...mk.filter(e => e !== champ).map(e => e.wins));
const jun = new Set(mk.filter(e => e !== champ && e.wins === runnerWins).map(e => e.shikonaEn));

/* Elo from sumostats.com. Its ids come off its own banzuke page; a value is
   only taken when the page it came from names the same rikishi, because the
   SumoDB ids sumo-api hands out don't always line up with sumostats'. */
const elo = await cached(`elo-${BASHO}.json`, async () => {
  const page = await get('https://sumostats.com/banzuke', true);
  const ids = {}; for (const m of page.matchAll(/href="\/rikishi\/(\d+)">([A-Za-z]+)<\/a>/g)) ids[m[2]] ||= +m[1];
  const out = {};
  for (const n of want) {
    if (!ids[n]) continue;
    const t = (await get('https://sumostats.com/rikishi/' + ids[n], true)).replace(/\\"/g, '"');
    const m = t.match(/"id":(\d+),"shikona":"([^"]+)","rank":"[^"]*","currentElo":([\d.]+)/);
    if (m && m[2] === n) out[n] = Math.round(+m[3]);
    await new Promise(r => setTimeout(r, 700));
  }
  return out;
});

/* the next basho's opening day, for ages */
const sched = readFileSync(join(ROOT, 'gg-basho.js'), 'utf8');
const nextStart = (sched.match(new RegExp(`name:"${MON[step(BASHO, 1).slice(4)].replace('ū', 'u').replace('ū', 'u')}[^"]*${step(BASHO, 1).slice(0, 4)}"[^}]*start:"([^"]+)"`)) || [])[1]
  || step(BASHO, 1).slice(0, 4) + '-' + step(BASHO, 1).slice(4) + '-08';
const ageOn = (dob, on) => { const a = new Date(dob), b = new Date(on); let y = b.getFullYear() - a.getFullYear();
  if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) y--; return y; };

/* ---------------------------------------------------------- the dossier */
const summary = { rows: 0, elo: 0, notes: 0, missing: [] };
const oldPrev = {}, oldLive = {};
let out = '', cursor = 0;
for (const row of rows) {
  const r = new Row(dossier.slice(row.start, row.end));
  const n = row.name, e = FIN.byName[n], p = PRV.byName[n];
  oldLive[n] = evalJs(r.get('live') || 'null');
  const chgOld = r.get('chg') ? evalJs(r.get('chg')) : null;
  oldPrev[n] = r.get('pr') ? evalJs(r.get('pr')) : (chgOld && chgOld.t && chgOld.t.includes('→') ? chgOld.t.split('→')[0] : '');
  if (!e) { summary.missing.push(n); out += dossier.slice(cursor, row.end); cursor = row.end; continue; }

  const fr = parseRank(e.rank, e.div), pr = p ? parseRank(p.rank, p.div) : null;
  const low = LOW[e.div];
  const live = (low ? low + ' ' : '') + e.wins + '-' + e.losses + (e.absences ? '-' + e.absences : '');
  const rec = evalJs(r.get('rec') || '[]');
  r.set('rec', JSON.stringify([oldLive[n]].concat(rec).slice(0, 3)));
  r.set('live', q(live));
  const aw = yusho[n] === 'Makuuchi' ? 'yusho' : jun.has(n) ? 'jun' : prizes[n] ? 'sansho' : null;
  if (aw) r.set('aw', q(aw), 'live'); else r.del('aw');
  if (e.wins + e.losses === 0) r.set('lk', '1', 'live'); else r.del('lk');
  if (!low) {
    r.set('rank', q(rankWord(fr))); r.set('rk', q(rkOf(fr))); r.set('side', q(fr.side));
    r.set('num', String(fr.num)); r.set('tier', q(bucketOf(fr))); r.set('d', q(fr.tier === 'J' ? 'juryo' : 'makuuchi'));
  } else {                                        // below the salaried ranks: say so in rk, keep d for the filters
    r.set('rk', q(rkOf(fr))); r.set('side', q(fr.side)); r.set('num', String(fr.num));
  }
  r.del('fr'); r.del('pr'); r.del('gone');
  if (pr) {
    const d = p.rankValue < e.rankValue ? 'down' : p.rankValue > e.rankValue ? 'up' : 'same';
    r.set('chg', `{d:${q(d)},t:${q(rkOf(pr) + '→' + rkOf(fr))}}`);
  }
  if (r.get('cw') !== undefined) r.set('cw', String(+r.get('cw') + e.wins));
  if (r.get('cl') !== undefined) r.set('cl', String(+r.get('cl') + e.losses));
  const dob = r.get('dob') ? evalJs(r.get('dob')) : null;
  if (dob) r.set('age', String(ageOn(dob, nextStart)));
  if (elo[n]) { r.set('elo', String(elo[n])); summary.elo++; }
  for (const k of ['form', 'inj', 'lv', 'note', 'grade', 'high']) {
    const v = notes[k] && notes[k][n];
    if (v === undefined) continue;
    if (v === null) r.del(k); else r.set(k, q(v));
    summary.notes++;
  }
  // "append": a sentence added to a note that otherwise still holds
  for (const [k, by] of Object.entries(notes.append || {})) {
    if (!by[n]) continue;
    const was = r.get(k) && r.get(k) !== 'X' ? evalJs(r.get(k)) : '';
    r.set(k, q((was ? was.replace(/\s+$/, '') + ' ' : '') + by[n]));
    summary.notes++;
  }
  out += dossier.slice(cursor, row.start) + r.text(); cursor = row.end; summary.rows++;
}
out += dossier.slice(cursor);
// newcomers with a profile written ahead of the banzuke that lists them
let added = 0;
for (const t of notes.newcomers || []) {
  const n = (t.match(/^\{n:"([^"]+)"/) || [])[1];
  if (!n || names.includes(n)) continue;
  const end = out.indexOf('\n];', out.indexOf('const R=['));
  const before = out.slice(0, end).replace(/\s+$/, '');
  out = before + (before.endsWith(',') ? '\n' : ',\n') + t + ',' + out.slice(end); added++;
}
dossier = out;

/* ---------------------------------------------------------- analysis.html */
function block(name) {                            // `const NAME=` ... `;` at the closing brace
  const s = analysis.indexOf(`const ${name}=`); if (s < 0) throw new Error('no ' + name);
  let i = analysis.indexOf('=', s) + 1, depth = 0, str = false;
  for (; i < analysis.length; i++) {
    const c = analysis[i];
    if (str) { if (c === '\\') i++; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) break;
  }
  return { start: s, end: i + 1, value: evalJs(analysis.slice(analysis.indexOf('=', s) + 1, i + 1)) };
}
function replaceBlock(name, text) { const b = block(name); analysis = analysis.slice(0, b.start) + `const ${name}=` + text + analysis.slice(b.end); }
const lit = v => v === null || v === undefined ? 'null' : typeof v === 'object' && !Array.isArray(v)
  ? '{' + Object.entries(v).map(([k, x]) => k + ':' + lit(x)).join(',') + '}'
  : Array.isArray(v) ? '[' + v.map(lit).join(',') + ']' : JSON.stringify(v);
const lines = obj => '{\n' + Object.entries(obj).map(([k, v]) => JSON.stringify(k) + ':' + lit(v)).join(',\n') + '\n}';

const oldFinAw = block('FINISHED_AW').value, oldAwards = block('AWARDS').value;
const oldAgo2 = block('AGO2_RANK').value, oldHL = block('HL').value;
const finAw = {};
for (const n of names.concat(newcomerNames)) {
  const a = {};
  if (yusho[n] === 'Makuuchi') a.y = 1; else if (yusho[n] === 'Juryo') a.ju = 1; else if (yusho[n]) a.ld = yusho[n];
  if (jun.has(n)) a.jy = 1;
  if (kin[n]) a.k = kin[n];
  if (prizes[n]) a.p = prizes[n];
  if (Object.keys(a).length) finAw[n] = a;
}
const awards = {};
for (const n of new Set(Object.keys(oldFinAw).concat(Object.keys(oldAwards)))) {
  const v = [oldFinAw[n] || null].concat((oldAwards[n] || []).slice(0, 2));
  while (v.length < 3) v.push(null);
  if (v.some(Boolean)) awards[n] = v;
}
for (const [n, v] of Object.entries(notes.awardsHistory || {})) awards[n] = v;   // newcomers' earlier honours
const ago2 = {};
for (const n of names) if (oldPrev[n]) ago2[n] = oldPrev[n];
Object.assign(ago2, (notes.ranks || {}).ago2 || {});
const ago3 = Object.assign({}, oldAgo2, (notes.ranks || {}).ago3 || {});
const hl = {};
for (const n of new Set(Object.keys(oldHL).concat(Object.keys(notes.hlPrev || {})))) {
  const v = [(notes.hlPrev || {})[n] || null].concat((oldHL[n] || []).slice(0, 2));
  if (v.some(Boolean)) hl[n] = v;
}
replaceBlock('FINISHED_AW', lines(finAw));
replaceBlock('AWARDS', lines(awards));
replaceBlock('AGO2_RANK', JSON.stringify(ago2));
replaceBlock('AGO3_RANK', JSON.stringify(ago3));
replaceBlock('HL', lines(hl));
replaceBlock('FIN_HL', lines(notes.finHl || {}));
analysis = analysis.replace(/const FINISHED_BASHO_ID="\d{6}"/, `const FINISHED_BASHO_ID="${BASHO}"`);
analysis = analysis.replace(/const BASHO_END="[\d-]+"/, `const BASHO_END="${String(info.endDate || '').slice(0, 10)}"`);
if (notes.recap) analysis = analysis.replace(/(<p class="src" id="bashoRecap">)[\s\S]*?(<\/p>)/, (m, a, b) => a + notes.recap + b);

/* ------------------------------------------------------------- report */
console.log(`${label(PREV)} -> ${label(BASHO)} finished; ages as of ${nextStart.slice(0, 10)}`);
console.log(`  dossier: ${summary.rows} rows moved, ${summary.elo} Elo values from sumostats, ${summary.notes} notes applied, ${added} newcomer${added === 1 ? '' : 's'} added`);
if (summary.missing.length) console.log('  not on the ' + label(BASHO) + ' banzuke at any level (left as they were): ' + summary.missing.join(', '));
console.log(`  honours: yusho ${Object.entries(yusho).map(([n, t]) => t + ' ' + n).join(', ')}`);
console.log(`           jun-yusho ${[...jun].join(', ') || '-'}; prizes ${Object.entries(prizes).map(([n, p]) => n + ' ' + p.join('+')).join(', ') || '-'}; kinboshi ${Object.entries(kin).map(([n, k]) => n + (k > 1 ? ' x' + k : '')).join(', ') || '-'}`);
const noForm = names.filter(n => FIN.byName[n] && !(notes.form || {})[n]);
if (noForm.length) console.log(`  no new form note for ${noForm.length}: ${noForm.join(', ')}`);
if (WRITE) { writeFileSync(DOSSIER, dossier); writeFileSync(ANALYSIS, analysis); console.log('written.'); }
else console.log('dry run: nothing written (add --write).');
