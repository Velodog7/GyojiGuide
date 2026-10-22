/* Spreadsheet behaviour the engine must reproduce, pinned one case at a
   time with small probe scripts. differential.js can't see most of these:
   the site's own flows never empty a final row or rely on a Date's
   printed form, but real Sheet data can. */
'use strict';
const path = require('path');
const assert = require('assert');
const { createMemStore } = require('./lib/memstore');

const ENGINE = process.env.GG_ENGINE || path.join(__dirname, '..', '..', 'supabase', 'functions', 'api', 'engine.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n         ' + (e && e.message)); fail++; }
}

const PROBES = String.raw`
function ss_(){ return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(n){ return ss_().getSheetByName(n) || ss_().insertSheet(n); }
function probeAppendAfterClear(){
  var sh = sheet_('T'); sh.appendRow(['a', 1]); sh.appendRow(['b', 2]);
  sh.getRange(2, 1, 1, 2).setValues([['', '']]);          // empty the last row
  var before = sh.getLastRow();
  sh.appendRow(['c', 3]);                                   // lands in row 2, not 3
  return { before: before, after: sh.getLastRow(), values: sh.getDataRange().getValues() };
}
function probeGaps(){
  var sh = sheet_('G'); sh.getRange(3, 2).setValue('x');
  return { last: [sh.getLastRow(), sh.getLastColumn()], values: sh.getDataRange().getValues(),
    beyond: sh.getRange(5, 5, 1, 2).getValues(), empty: sheet_('E').getDataRange().getValues() };
}
function probeWriteDate(){ sheet_('D').appendRow([new Date(Date.UTC(2026, 9, 22, 12, 9, 30)), 'x']); return 'ok'; }
function probeReadDate(){
  var v = sheet_('D').getRange(1, 1).getValue();
  return { isDate: v instanceof Date, t: v.getTime(), str: String(v), json: JSON.stringify(v) };
}
function probeDims(){
  var sh = sheet_('X'), out = [];
  try { sh.getRange(1, 1, 2, 2).setValues([[1, 2]]); } catch (e) { out.push(String(e.message)); }
  try { sh.getRange(1, 1, 1, 2).setValues([[1, 2, 3]]); } catch (e) { out.push(String(e.message)); }
  try { sh.getRange(0, 1); } catch (e) { out.push(String(e.message)); }
  try { sh.appendRow([new Array(50002).join('z')]); } catch (e) { out.push(String(e.message)); }
  return out;
}
function probeInsertColumn(){
  var sh = sheet_('C'); sh.appendRow(['h', 'n', 't']); sh.appendRow(['a', 'b']); sh.appendRow(['solo']);
  sh.insertColumnBefore(2);
  return sh.getDataRange().getValues();
}
function probeDeleteAndWrite(){
  var sh = sheet_('R');
  for (var i = 1; i <= 5; i++) sh.appendRow(['r' + i, i]);
  sh.deleteRow(2); sh.deleteRows(3, 2);                     // leaves r1, r3
  sh.getRange(2, 2).setValue(33);
  return sh.getDataRange().getValues();
}
function probeProps(){
  var p = PropertiesService.getScriptProperties();
  p.setProperty('A', 'one'); p.deleteProperty('ALLOW_ADMIN_CLAIM');
  return { a: p.getProperty('A'), claim: p.getProperty('ALLOW_ADMIN_CLAIM'), hidden: p.getProperty('__CRON_KEY'),
    keys: Object.keys(p.getProperties()).sort() };
}
function probePropsAgain(){ var p = PropertiesService.getScriptProperties(); return [p.getProperty('A'), p.getProperty('ALLOW_ADMIN_CLAIM')]; }
function probeFormat(){
  var d = new Date(Date.UTC(2026, 9, 22, 12, 9, 30));
  return [Utilities.formatDate(d, 'America/Los_Angeles', 'H'), Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss EEE'),
    Utilities.formatDate(d, 'Not/AZone', 'H'), Utilities.formatDate(d, 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'")];
}
function probeSwallow(){
  // the code catches everything; the engine must still notice what it lacked
  var n = -1;
  try { n = ss_().getSheetByName('Users').getLastRow(); } catch (e) {}
  return n;
}
function probeFetchAll(){
  var rs = UrlFetchApp.fetchAll([{ url: 'https://example.test/a' }, { url: 'https://example.test/b', muteHttpExceptions: true }]);
  var out = rs.map(function (r) { return r.getResponseCode() + ':' + r.getContentText(); });
  try { UrlFetchApp.fetch('https://example.test/b'); out.push('no throw'); }
  catch (e) { out.push(/returned code 404/.test(e.message) ? 'threw on 404' : e.message); }
  return out;
}
function probeThrow(){ throw new Error('boom'); }
function probeWritePageview(){ sheet_('PageViews').appendRow(['now', 'p', 'v']); return 'written'; }
function probeCacheOnly(){ CacheService.getScriptCache().put('presence:x', '1', 60); return 'cached'; }
function doGet(e){ return ContentService.createTextOutput(JSON.stringify({ ok: true, q: e.parameter })).setMimeType(ContentService.MimeType.JSON); }
`;

(async () => {
  const E = await import(ENGINE);
  const mk = (opts) => {
    const store = opts && opts.store || createMemStore({ props: { ALLOW_ADMIN_CLAIM: '1', __CRON_KEY: 'k', __GG_TZ: (opts && opts.tz) || 'America/Los_Angeles' } });
    const engine = E.createEngine({ source: PROBES, store, log: () => {},
      fetch: async (url) => ({ status: url.endsWith('/a') ? 200 : 404, text: async () => 'body ' + url.slice(-1), headers: new Map() }) });
    const fn = async (name) => { const r = await engine.execute({ kind: 'fn', fn: name, key: 'FN ' + name }); return Object.assign(JSON.parse(r.text), { _r: r }); };
    return { store, engine, fn };
  };

  console.log('\n— rows and ranges —');
  await t('appendRow after the last row was emptied reuses that row, like Sheets', async () => {
    const { fn, store } = mk();
    const r = (await fn('probeAppendAfterClear')).result;
    assert.deepStrictEqual([r.before, r.after], [1, 2]);
    assert.deepStrictEqual(r.values, [['a', 1], ['c', 3]]);
    assert.deepStrictEqual(store.dump().T, [['a', 1], ['c', 3]]);
  });
  await t('getDataRange pads with "" and ignores trailing empties; empty sheet is [[""]]', async () => {
    const r = (await mk().fn('probeGaps')).result;
    assert.deepStrictEqual(r.last, [3, 2]);
    assert.deepStrictEqual(r.values, [['', ''], ['', ''], ['', 'x']]);
    assert.deepStrictEqual(r.beyond, [['', '']]);
    assert.deepStrictEqual(r.empty, [['']]);
  });
  await t('deleteRow / deleteRows shift later rows up and later writes find the right row', async () => {
    const { fn, store } = mk();
    assert.deepStrictEqual((await fn('probeDeleteAndWrite')).result, [['r1', 1], ['r3', 33]]);
    assert.deepStrictEqual(store.dump().R, [['r1', 1], ['r3', 33]]);
  });
  await t('insertColumnBefore shifts every row that reaches the column', async () => {
    assert.deepStrictEqual((await mk().fn('probeInsertColumn')).result, [['h', '', 'n', 't'], ['a', '', 'b', ''], ['solo', '', '', '']]);
  });
  await t('Sheets errors: setValues dimensions, row 0, the 50,000-character cell', async () => {
    const r = (await mk().fn('probeDims')).result;
    assert.strictEqual(r.length, 4);
    assert.ok(/number of rows in the data does not match/.test(r[0]), r[0]);
    assert.ok(/number of columns in the data does not match/.test(r[1]), r[1]);
    assert.ok(/starting row of the range is too small/.test(r[2]), r[2]);
    assert.ok(/maximum of 50000 characters/.test(r[3]), r[3]);
  });

  console.log('\n— dates, zones, properties —');
  await t('a Date written in one request comes back as a Date in the next, printing in the script zone', async () => {
    const { fn, store } = mk({ tz: 'America/Los_Angeles' });
    await fn('probeWriteDate');
    assert.deepStrictEqual(store.dump().D[0][0], { $d: '2026-10-22T12:09:30.000Z' });
    const r = (await fn('probeReadDate')).result;
    assert.strictEqual(r.isDate, true);
    assert.strictEqual(r.t, Date.UTC(2026, 9, 22, 12, 9, 30));
    assert.strictEqual(r.str, 'Thu Oct 22 2026 05:09:30 GMT-0700 (Pacific Daylight Time)');
    assert.strictEqual(r.json, '"2026-10-22T12:09:30.000Z"');
  });
  await t('in UTC a Date prints the way V8 prints it', async () => {
    const { fn } = mk({ tz: 'UTC' });
    await fn('probeWriteDate');
    assert.strictEqual((await fn('probeReadDate')).result.str, 'Thu Oct 22 2026 12:09:30 GMT+0000 (Coordinated Universal Time)');
  });
  await t('Utilities.formatDate: zones, patterns, and GMT for a zone it does not know', async () => {
    assert.deepStrictEqual((await mk().fn('probeFormat')).result, ['5', '2026-10-22 21:09:30 Thu', '12', '2026-10-22T12:09:30Z']);
  });
  await t('Script Properties persist across requests; engine keys (__*) stay invisible', async () => {
    const { fn, store } = mk();
    const r = (await fn('probeProps')).result;
    assert.deepStrictEqual([r.a, r.claim, r.hidden], ['one', null, null]);
    assert.ok(!r.keys.some(k => k.slice(0, 2) === '__'), 'no __ keys: ' + r.keys);
    assert.deepStrictEqual((await fn('probePropsAgain')).result, ['one', null]);
    assert.strictEqual(store.props().__CRON_KEY, 'k', 'the engine key is untouched');
  });

  console.log('\n— the request loop —');
  await t('a sheet the code reached for inside its own try/catch is still loaded, and the answer is right', async () => {
    const store = createMemStore({ props: {} });
    await store.commit({ check: null, ops: [{ op: 'sheet', sheet: 'Users' }, { op: 'ins', sheet: 'Users', cells: ['h'] }, { op: 'ins', sheet: 'Users', cells: ['u1'] }] });
    const r = await mk({ store }).fn('probeSwallow');
    assert.strictEqual(r.result, 2);
    assert.ok(r._r.runs >= 2, 'it replayed once the sheet was known: ' + r._r.runs);
  });
  await t('the second request for the same action loads its sheets up front: one run', async () => {
    const store = createMemStore({ props: {} });
    await store.commit({ check: null, ops: [{ op: 'sheet', sheet: 'Users' }] });
    const e = mk({ store });
    await e.fn('probeSwallow');
    const r = await e.fn('probeSwallow');
    assert.strictEqual(r._r.runs, 1);
  });
  await t('UrlFetchApp.fetchAll fetches in one go; a 404 throws unless muteHttpExceptions', async () => {
    const r = await mk().fn('probeFetchAll');
    assert.deepStrictEqual(r.result, ['200:body a', '404:body b', 'threw on 404']);
    assert.strictEqual(r._r.runs, 2);
  });
  await t('an uncaught error answers 500 with the message, and writes nothing', async () => {
    const { fn, store } = mk();
    const r = await fn('probeThrow');
    assert.strictEqual(r._r.status, 500);
    assert.strictEqual(r.ok, false);
    assert.ok(/boom/.test(r.error));
    assert.strictEqual(store.stats.commits, 0);
  });
  await t('doGet gets e.parameter and its TextOutput becomes the body', async () => {
    const { engine } = mk();
    const r = await engine.execute({ kind: 'get', e: { parameter: { action: 'x', id: '7' } }, key: 'GET x' });
    assert.strictEqual(r.status, 200);
    assert.ok(/application\/json/.test(r.mime));
    assert.deepStrictEqual(JSON.parse(r.text), { ok: true, q: { action: 'x', id: '7' } });
  });
  await t('maintenance pauses sheet writes but lets cache-only writes (presence) through', async () => {
    const store = createMemStore({ props: { __MAINTENANCE: '1' } });
    const { fn } = mk({ store });
    const w = await fn('probeWritePageview');
    assert.strictEqual(w._r.status, 503);
    assert.strictEqual(w.maintenance, true);
    assert.strictEqual(store.dump().PageViews, undefined, 'nothing written');
    const c = await fn('probeCacheOnly');
    assert.strictEqual(c.result, 'cached');
    assert.strictEqual(c._r.committed, true);
  });
  await t('the real .gs on the engine never forwards, even with __FORWARD_TO in the store', async () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'sumo-fantasy.gs'), 'utf8');
    const store = createMemStore({ props: { __FORWARD_TO: 'https://loop.example/api' } });
    let fetched = 0;
    const engine = E.createEngine({ source: src, store, log: () => {}, fetch: async () => { fetched++; return { status: 200, text: async () => '{}', headers: new Map() }; } });
    const r = await engine.execute({ kind: 'get', e: { parameter: { action: 'version' }, queryString: 'action=version' }, key: 'GET version' });
    assert.ok(JSON.parse(r.text).version, 'answered by the engine itself');
    assert.strictEqual(fetched, 0, 'nothing was forwarded');
  });
  await t('a store that always reports a conflict ends in a polite "busy", not a hang', async () => {
    const real = createMemStore({ props: {} });
    const store = Object.assign({}, real, { commit: async () => ({ ok: false, conflict: true }) });
    const r = await mk({ store }).fn('probeWritePageview');
    assert.strictEqual(r._r.status, 503);
    assert.strictEqual(r.busy, true);
    assert.strictEqual(r._r.attempts, 12);
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n0 passed, 1 failed'); process.exit(1); });
