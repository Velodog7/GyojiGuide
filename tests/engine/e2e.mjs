/* The whole move, both ways, rehearsed on one machine.

   1. Builds an "old Sheet": a realistic world made by the backend itself
      (accounts, DMs, the board, feedback with real Date cells, a classic
      league, a keepers league drafted to the end, results).
   2. Starts the real Edge Function (index.ts, under Deno) against stand-ins
      for PostgREST (over PGlite and the real migrations) and the old
      Apps Script's admin-key check.
   3. Plays the Apps Script project: sumo-fantasy.gs (the reference model,
      which really runs the .gs, switch and all) as the deployed web app, and
      apps-script/migrate.gs, the very file you paste, alongside it.
   Then: the rehearsal copy and an endpoint-by-endpoint comparison; cutover's
   refusals and its self-rollback; a real cutover; life on Supabase through
   both URLs; revertToAppsScript bringing every change back; cutover again.

   Needs Deno and PGlite:   GG_DENO=/path/to/deno GG_PGLITE=/dir/with/node_modules node tests/engine/e2e.mjs */
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, '..', '..');
const { createHarness, cannedSumoApi, MAK, JUR } = require('./lib/harness.js');

const DENO = process.env.GG_DENO || 'deno';
const PG_PORT = 8911, LEGACY_PORT = 8912, FN_PORT = 8000;
const SECRET = 'sb_secret_rehearsal';
const ADMIN = 'test';
const FN = 'http://127.0.0.1:' + FN_PORT;
const EXEC = 'https://script.google.com/macros/s/AKfycbyrhng3sZoNNpgDA2JApz2Z0xx01x9N1TwnGhqkMfbmXCR-q11NIqlB_i3krHPZ3yZ7GA/exec';
const VERSION = (fs.readFileSync(path.join(ROOT, 'sumo-fantasy.gs'), 'utf8').match(/var BACKEND_VERSION = '([^']*)'/) || [])[1];

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n         ' + (e && e.message)); fail++; }
}
const kids = [];
function start(cmd, args, env, ready) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe'] });
    kids.push(p);
    let out = '';
    const onData = (d) => { out += d; if (ready.test(out)) resolve(p); };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('exit', (c) => reject(new Error(cmd + ' exited ' + c + ': ' + out.slice(-800))));
    setTimeout(() => reject(new Error(cmd + ' never became ready: ' + out.slice(-800))), 60000);
  });
}
const stopAll = () => { for (const k of kids) { try { k.kill(); } catch (e) {} } };
process.on('exit', stopAll);

async function http(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'text/plain;charset=utf-8' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) {}
  return { status: r.status, headers: r.headers, text, json };
}
const qs = (p) => '?' + Object.entries(p).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
const health = async () => (await http('GET', FN + qs({ action: '__health' }))).json;

/* synchronous HTTP for Apps Script's UrlFetchApp (the servers live in other processes) */
function curl(url, p) {
  p = p || {};
  const args = ['-sS', '-w', '\n%{http_code}'];
  if (String(p.method || 'get').toLowerCase() === 'post') args.push('-X', 'POST', '-H', 'Content-Type: ' + (p.contentType || 'text/plain'), '--data-binary', '@-');
  args.push(url);
  const out = execFileSync('curl', args, { input: p.payload || '', maxBuffer: 64 * 1024 * 1024 }).toString();
  const i = out.lastIndexOf('\n');
  return { status: Number(out.slice(i + 1)), text: out.slice(0, i) };
}

(async () => {
  console.log('\n— the old world —');
  // the model is the Apps Script project; when it forwards, its UrlFetchApp reaches the local function
  const H = await createHarness({ tz: 'America/Los_Angeles', start: Date.now() - 3600 * 1000,
    fetch: (url, p) => (url.startsWith(FN) ? curl(url, p) : cannedSumoApi(url)) });
  const users = [['sean', 'h1', 'Sean'], ['mika', 'h2', 'Mika'], ['dave', 'h3', 'Dave'], ['taro', 'h4', 'Taro'], ['yumi', 'h5', 'Yumi']];
  const AUTH = Object.fromEntries(users.map(u => [u[0], u[1]]));
  await H.fn('setup');
  for (const [h, a, n] of users) await H.post({ action: 'register', handle: h, auth: a, name: n });
  await H.post({ action: 'save', handle: 'sean', auth: 'h1', team: { sanyaku: 'Onosato', m1: 'Ura', juryo: 'Shishi' } });
  await H.post({ action: 'save', handle: 'mika', auth: 'h2', team: { sanyaku: 'Hoshoryu', m1: 'Abi', juryo: 'Tanji' } });
  await H.post({ action: 'saveAvatar', handle: 'dave', auth: 'h3', avatar: JSON.stringify({ v: 2, belt: '#2a5aa0' }) });
  await H.post({ action: 'dmSend', handle: 'sean', auth: 'h1', to: 'mika', body: 'hello — こんにちは' });
  await H.post({ action: 'dmSend', handle: 'mika', auth: 'h2', to: 'sean', body: 'hi' });
  await H.post({ action: 'postBoardMessage', handle: 'sean', auth: 'h1', body: 'Who takes Onosato?' });
  await H.post({ action: 'feedback', kind: 'bug', message: 'the button is blue', handle: 'taro', page: 'fantasy.html' });
  await H.post({ action: 'feedback', kind: 'suggestion', message: 'more taiko' });
  for (let i = 0; i < 6; i++) await H.post({ action: 'logPageview', page: 'p' + (i % 3), visitorId: 'v' + i, tz: 'Asia/Tokyo' });
  await H.post({ action: 'requestPinReset', handle: 'yumi' });
  const cl = (await H.post({ action: 'createLeague', handle: 'mika', auth: 'h2', name: 'Classic', mode: 'classic' })).json;
  for (const h of ['sean', 'taro']) await H.post({ action: 'joinLeague', handle: h, auth: AUTH[h], code: cl.inviteCode });
  await H.post({ action: 'postMessage', handle: 'taro', auth: 'h4', id: cl.id, body: 'good luck' });
  const kp = (await H.post({ action: 'createLeague', handle: 'sean', auth: 'h1', name: 'Chanko Boogie', mode: 'keepers', rosterSize: 3, benchSize: 0, farmSize: 1 })).json;
  for (const h of ['mika', 'dave']) await H.post({ action: 'joinLeague', handle: h, auth: AUTH[h], code: kp.inviteCode });
  await H.post({ action: 'startDraft', handle: 'sean', auth: 'h1', id: kp.id, pickClock: 3600, pool: { makuuchi: MAK, juryo: JUR } });
  for (let guard = 0; guard < 100; guard++) {
    const st = (await H.get({ action: 'draftState', id: kp.id, who: 'sean' })).json;
    if (!st.league || st.league.draftStatus !== 'active') break;
    const taken = new Set(st.pickedNames.map(s => s.toLowerCase()));
    const pick = (st.turn.phase === 'juryo' ? JUR : MAK).find(n => !taken.has(n.toLowerCase()));
    await H.post({ action: 'makePick', handle: st.turn.handle, auth: AUTH[st.turn.handle], id: kp.id, rikishi: pick });
  }
  await H.fn('refreshResults');
  await H.post({ action: 'adminWarnUser', adminKey: ADMIN, handle: 'taro', message: 'be nice' });
  await H.compareState('seed');
  assert.deepStrictEqual(H.failures, [], 'seeding through the harness already disagreed');
  const rowCount = () => Object.keys(H.model.store).reduce((n, s) => n + H.model.store[s].getLastRow(), 0);
  const seededRows = rowCount();
  console.log('  ok   ' + Object.keys(H.model.store).length + ' sheets, ' + seededRows + ' rows, made by the backend itself');

  console.log('\n— Supabase, locally —');
  await start(process.execPath, [path.join(HERE, 'e2e', 'server.mjs')],
    { PG_PORT: String(PG_PORT), LEGACY_PORT: String(LEGACY_PORT), GG_SECRET: SECRET, GG_LEGACY_ADMIN_KEY: ADMIN }, /ready/);
  await start(DENO, ['run', '--no-lock', '--allow-net', '--allow-env', path.join(ROOT, 'supabase', 'functions', 'api', 'index.ts')], {
    SUPABASE_URL: 'http://127.0.0.1:' + PG_PORT, SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }),
    GG_LEGACY_EXEC: 'http://127.0.0.1:' + LEGACY_PORT + '/exec',
    DENO_DIR: process.env.DENO_DIR || path.join(process.env.TMPDIR || '/tmp', 'gg-deno-cache')
  }, /Listening on/);

  await t('the function answers before any data exists: version, health, CORS, a wrong import key', async () => {
    const v = await http('GET', FN + qs({ action: 'version' }));
    assert.strictEqual(v.json.version, VERSION);
    assert.strictEqual(v.headers.get('access-control-allow-origin'), '*');
    const h = await health();
    assert.deepStrictEqual([h.ok, h.live, h.maintenance, h.importedAt, h.backend], [true, false, false, '', VERSION]);
    assert.strictEqual((await fetch(FN, { method: 'OPTIONS' })).status, 204);
    assert.deepStrictEqual((await http('POST', FN, { action: '__import', key: 'guess', step: 'begin' })).json, { ok: false, error: 'Not authorised.' });
  });

  /* ---- the Apps Script project: the model as the deployed web app, migrate.gs beside it ---- */
  const deployed = { stale: false, ignoresSwitch: false };   // ways a deployment can be wrong
  function webApp(url, p) {
    const u = new URL(url);
    const parameter = Object.fromEntries(u.searchParams);
    if (deployed.stale && parameter.action === 'version') return { status: 200, text: '{"ok":true,"version":"2026-10-19-stands"}' };
    if (deployed.ignoresSwitch) parameter.gg_fwd = '1';      // old code: never forwards
    const e = { parameter, queryString: u.search.slice(1), postData: p && p.payload ? { contents: p.payload } : undefined };
    const isPost = String((p && p.method) || 'get').toLowerCase() === 'post';
    return { status: 200, text: H.model.run(isPost ? 'doPost' : 'doGet', [e], 1) };
  }
  const logs = [];
  function sheetApi(name) {
    const s = H.model.store[name];
    return {
      getName: () => name, getLastRow: () => s.getLastRow(), getLastColumn: () => s.getLastColumn(),
      getMaxRows: () => Math.max(1000, s.rows.length), getMaxColumns: () => Math.max(26, s.getLastColumn()),
      insertRowsAfter() {}, insertColumnsAfter() {},
      clearContents() { s.rows.length = 0; },
      getRange: (r, c, nr, nc) => {
        const rg = s.getRange(r, c, nr, nc);
        return { getValues: () => rg.getValues(), setValues: (v) => rg.setValues(v),
          getFormulas: () => Array.from({ length: nr }, () => Array.from({ length: nc }, () => '')) };
      }
    };
  }
  const props = H.model.props;           // one Script Properties for the whole project, as in Apps Script
  const propStore = {
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); return propStore; },
    deleteProperty: (k) => { delete props[k]; return propStore; },
    getProperties: () => Object.assign({}, props)
  };
  const fetchOne = (url, p) => {
    const r = url.startsWith(EXEC) ? webApp(url, p) : url.startsWith(FN) ? curl(url, p) : cannedSumoApi(url);
    return { getContentText: () => r.text, getResponseCode: () => r.status };
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheets: () => Object.keys(H.model.store).map(sheetApi),
      getSheetByName: (n) => (H.model.store[n] ? sheetApi(n) : null),
      insertSheet: (n) => { H.model.ss.insertSheet(n); return sheetApi(n); },
      getSpreadsheetTimeZone: () => 'America/Los_Angeles' }) },
    PropertiesService: { getScriptProperties: () => propStore },
    UrlFetchApp: { fetch: fetchOne, fetchAll: (reqs) => reqs.map(rq => fetchOne(rq.url, rq)) },
    ScriptApp: { getProjectTriggers: () => [{ getHandlerFunction: () => 'refreshResults', getEventType: () => 'CLOCK' }] },
    Session: { getScriptTimeZone: () => 'America/Los_Angeles' },
    Utilities: { sleep() {}, DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest(), b => (b > 127 ? b - 256 : b)) },
    Logger: { log: (m) => logs.push(String(m)) },
    // what sumo-fantasy.gs puts in the shared global scope
    BACKEND_VERSION: VERSION,
    forwardTarget_: () => '',
    doGet: (e) => ({ getContent: () => H.model.run('doGet', [e], 1) }),
    Date, JSON, Math, Object, Array, String, Number, Error, isNaN
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script', 'migrate.gs'), 'utf8'), ctx, { filename: 'migrate.gs' });
  assert.ok(/supabase\.co\/functions\/v1\/api$/.test(ctx.GG_SUPABASE_API) && ctx.GG_EXEC_URL === EXEC, 'migrate.gs names its targets');
  ctx.GG_SUPABASE_API = FN;              // the real file points at production; the rehearsal never reaches it
  const run = (fn) => { logs.length = 0; return ctx[fn](); };
  // the old web app; local:true reads the Sheet itself even while the switch is on
  const oldGet = (p, local) => {
    const q = local ? Object.assign({}, p, { gg_fwd: '1' }) : Object.assign({}, p);
    return H.model.run('doGet', [{ parameter: q, queryString: qs(q).slice(1) }], 1);
  };
  const oldPost = (b) => JSON.parse(H.model.run('doPost', [{ parameter: {}, postData: { contents: JSON.stringify(b) } }], 1));

  console.log('\n— the rehearsal —');
  await t('exportToSupabase copies every sheet and row; the first import vouches for its key with the old backend', async () => {
    const res = run('exportToSupabase');
    assert.strictEqual(res.rows, seededRows);
    const h = await health();
    assert.deepStrictEqual([h.live, h.tz, h.imported.triggers], [false, 'America/Los_Angeles', ['refreshResults (CLOCK)']]);
  });
  const GETS = [{ action: 'data' }, { action: 'list' }, { action: 'results' }, { action: 'version' }, { action: 'invite', code: kp.inviteCode },
    { action: 'league', id: kp.id, handle: 'sean' }, { action: 'league', id: kp.id, handle: 'mika' }, { action: 'league', id: cl.id, handle: 'taro' },
    { action: 'keeperState', id: kp.id, handle: 'dave' }, { action: 'trades', id: kp.id, handle: 'sean' }];
  for (const [h] of users) for (const action of ['leagues', 'history', 'accountSummary', 'board', 'dmThreads', 'dmDirectory', 'dmUnread']) GETS.push({ action, handle: h });
  async function sameEverywhere(label) {
    const bad = [];
    for (const p of GETS) {
      const a = oldGet(p, true), b = (await http('GET', FN + qs(p))).text;
      if (a !== b) bad.push(JSON.stringify(p) + '\n           Apps Script: ' + a.slice(0, 150) + '\n           Supabase:    ' + b.slice(0, 150));
    }
    assert.ok(!bad.length, label + ': ' + bad.length + ' of ' + GETS.length + ' differ, e.g. ' + bad.slice(0, 2).join('\n         '));
  }
  await t('every read endpoint answers exactly as the old backend does (' + GETS.length + ' requests)', () => sameEverywhere('after the rehearsal'));

  console.log('\n— cutover refuses, or rolls itself back, when something is off —');
  const untouched = async () => {
    const h = await health();
    assert.deepStrictEqual([h.live, h.maintenance, '__FORWARD_TO' in props], [false, false, false], 'nothing changed');
  };
  await t('the editor still has the old code: refuses before touching anything', async () => {
    ctx.forwardTarget_ = undefined;
    assert.throws(() => run('cutover'), /still has the old sumo-fantasy\.gs/);
    ctx.forwardTarget_ = () => '';
    await untouched();
  });
  await t('Supabase runs different code from this project: refuses', async () => {
    ctx.BACKEND_VERSION = 'something-else';
    assert.throws(() => run('cutover'), /Supabase runs backend .* but this project has something-else/);
    ctx.BACKEND_VERSION = VERSION;
    await untouched();
  });
  await t('saved but never deployed: refuses', async () => {
    deployed.stale = true;
    assert.throws(() => run('cutover'), /deployed web app runs 2026-10-19-stands/);
    deployed.stale = false;
    await untouched();
  });
  await t('the deployed web app won’t forward: stops and puts everything back', async () => {
    deployed.ignoresSwitch = true;
    assert.throws(() => run('cutover'), /Cutover stopped and put everything back.*did not start forwarding/);
    deployed.ignoresSwitch = false;
    await untouched();
    assert.strictEqual(oldPost({ action: 'login', handle: 'mika', auth: 'h2' }).ok, true, 'Apps Script still serves');
  });

  console.log('\n— cutover —');
  const beforeCut = Object.keys(H.model.store).map(n => n + ':' + JSON.stringify(H.model.store[n].rows)).join('\n');
  await t('cutover: copies, freezes, verifies every cell and a sample of answers, goes live', async () => {
    oldPost({ action: 'dmSend', handle: 'yumi', auth: 'h5', to: 'sean', body: 'just before the move' });
    run('cutover');
    assert.ok(logs.some(l => /sheets identical, \d+ sample answers identical/.test(l)), logs.join(' | '));
    const h = await health();
    assert.deepStrictEqual([h.live, h.maintenance, h.imported.final], [true, false, true]);
    assert.strictEqual(props.__FORWARD_TO, FN);
    assert.ok((await http('GET', FN + qs({ action: 'dmThreads', handle: 'sean' }))).text.includes('just before the move'));
  });
  await t('the old URL now forwards: its answers come from Supabase, its writes land there, the Sheet stays frozen', async () => {
    const frozen = Object.keys(H.model.store).map(n => n + ':' + JSON.stringify(H.model.store[n].rows)).join('\n');
    assert.strictEqual(JSON.parse(oldGet({ action: '__health' })).engine, 'supabase');
    assert.strictEqual(oldPost({ action: 'dmSend', handle: 'dave', auth: 'h3', to: 'sean', body: 'via the old URL' }).ok, true);
    // (team saves are refused here: the seeded basho is under way, as on Apps Script)
    assert.strictEqual((await http('POST', FN, { action: 'saveName', handle: 'yumi', auth: 'h5', name: 'Yumi on Supabase' })).json.ok, true);
    assert.strictEqual((await http('POST', FN, { action: 'postMessage', handle: 'mika', auth: 'h2', id: cl.id, body: 'on Supabase now' })).json.ok, true);
    H.model.run('refreshResults', [], 1);                         // the old hourly trigger fires
    assert.ok((await http('GET', FN + qs({ action: 'dmThreads', handle: 'sean' }))).text.includes('via the old URL'));
    assert.strictEqual(Object.keys(H.model.store).map(n => n + ':' + JSON.stringify(H.model.store[n].rows)).join('\n'), frozen, 'nothing touched the Sheet');
    assert.notStrictEqual(frozen, beforeCut, 'the Sheet did take the last write before the freeze');
  });
  await t('while live: exportToSupabase refuses (it would overwrite newer data); resumeSupabase is harmless', async () => {
    assert.throws(() => run('exportToSupabase'), /Supabase is live/);
    run('resumeSupabase');                                        // harmless while forwarding: already live
    assert.strictEqual((await health()).live, true);
  });

  console.log('\n— the way back —');
  let atRevert = null;
  await t('revertToAppsScript copies everything back, then this web app serves again, with nothing lost', async () => {
    atRevert = {};
    for (const p of GETS) atRevert[JSON.stringify(p)] = (await http('GET', FN + qs(p))).text;
    run('revertToAppsScript');
    const h = await health();
    assert.deepStrictEqual([h.live, h.maintenance], [false, true]);
    assert.ok(!('__FORWARD_TO' in props), 'the switch is off');
    assert.strictEqual(props.ADMIN_KEY, ADMIN, 'Script Properties came back');
    const bad = [];
    for (const p of GETS) { const a = oldGet(p); if (a !== atRevert[JSON.stringify(p)]) bad.push(JSON.stringify(p) + ': ' + a.slice(0, 100)); }
    assert.ok(!bad.length, bad.length + ' answers differ from what Supabase gave just before: ' + bad.slice(0, 2).join(' | '));
    const th = oldGet({ action: 'dmThreads', handle: 'sean' });
    assert.ok(th.includes('via the old URL') && th.includes('just before the move'), 'the changes made on Supabase are in the Sheet');
    assert.ok(oldGet({ action: 'league', id: cl.id, handle: 'mika' }).includes('on Supabase now'));
    assert.ok(oldGet({ action: 'list' }).includes('Yumi on Supabase'));
  });
  await t('after the revert: Apps Script takes writes, Supabase pauses them, resumeSupabase refuses', async () => {
    assert.strictEqual(oldPost({ action: 'dmSend', handle: 'taro', auth: 'h4', to: 'mika', body: 'back on the Sheet' }).ok, true);
    const w = await http('POST', FN, { action: 'dmSend', handle: 'dave', auth: 'h3', to: 'sean', body: 'lost?' });
    assert.deepStrictEqual([w.status, w.json.maintenance], [503, true]);
    assert.throws(() => run('resumeSupabase'), /Run cutover instead/);
  });

  console.log('\n— and forward again —');
  await t('cutover again carries the Sheet’s newer changes across and goes live', async () => {
    run('cutover');
    assert.strictEqual((await health()).live, true);
    assert.ok((await http('GET', FN + qs({ action: 'dmThreads', handle: 'mika' }))).text.includes('back on the Sheet'));
    await sameEverywhere('after the second cutover');
  });
  await t('cron runs only when live, and only with the key', async () => {
    const p = await (await fetch('http://127.0.0.1:' + PG_PORT + '/__debug/props')).json();
    assert.deepStrictEqual((await http('POST', FN, { action: '__cron', key: 'nope', job: 'refreshResults' })).json, { ok: false, error: 'Not authorised.' });
    assert.strictEqual((await http('POST', FN, { action: '__cron', key: p.__CRON_KEY, job: 'setup' })).json.error, 'unknown job');
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  stopAll();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n0 passed, 1 failed'); stopAll(); process.exit(1); });
