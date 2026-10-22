/* Races, run for real: many requests at once through the engine, over a
   store that makes every call yield at random so they interleave.

   These are the races Sheets lost. 10 Sept, Chanko Boogie: one member drafted
   seven wrestlers on one turn, then one expired clock was auto-picked five
   times. On Sheets the fix was discipline (unlock_ flushing, draftRowStale_);
   here the store refuses any locked commit whose reads went stale.

   Each race also runs against a store that ignores the read-set check, and
   must go WRONG there. A race test that passes either way proves nothing. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createMemStore } = require('./lib/memstore');
const { makeClock, makeFakeDate } = require('./lib/model');
const { MAK, JUR } = require('./lib/harness');

const ROOT = path.join(__dirname, '..', '..');
const ENGINE = process.env.GG_ENGINE || path.join(ROOT, 'supabase', 'functions', 'api', 'engine.js');
const SRC = fs.readFileSync(process.env.GG_GS || path.join(ROOT, 'sumo-fantasy.gs'), 'utf8');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n         ' + (e && e.message)); fail++; }
}
const AUTH = { sean: 'h1', mika: 'h2', dave: 'h3', taro: 'h4' };

async function makeWorld(opts) {
  const E = await import(ENGINE);
  const clock = makeClock();
  const delay = () => Math.floor(Math.random() * 4);
  const store = createMemStore({ clock: () => clock.now, delay, props: { ADMIN_KEY: 'test', __CRON_KEY: 'k' } });
  if (opts && opts.noCheck) {                 // the control: a store that skips the read-set check
    const commit = store.commit;
    store.commit = (p) => commit(Object.assign({}, p, { check: null }));
  }
  const engine = E.createEngine({ source: SRC, store, baseDate: makeFakeDate(clock), log: () => {}, fetch: async () => ({ status: 404, text: async () => '', headers: new Map() }) });
  const post = async (body) => JSON.parse((await engine.execute({ kind: 'post', e: { parameter: {}, postData: { contents: JSON.stringify(body) } }, key: 'POST ' + body.action })).text);
  const get = async (params) => JSON.parse((await engine.execute({ kind: 'get', e: { parameter: params }, key: 'GET ' + params.action })).text);
  await engine.execute({ kind: 'fn', fn: 'setup', key: 'FN setup' });
  for (const h of Object.keys(AUTH)) await post({ action: 'register', handle: h, auth: AUTH[h], name: h });
  return { E, clock, store, engine, post, get };
}
async function draftingLeague(w, pickClock) {
  const cr = await w.post({ action: 'createLeague', handle: 'sean', auth: 'h1', name: 'Race', mode: 'keepers', rosterSize: 3, benchSize: 0, farmSize: 1 });
  for (const h of ['mika', 'dave']) await w.post({ action: 'joinLeague', handle: h, auth: AUTH[h], code: cr.inviteCode });
  const st = await w.post({ action: 'startDraft', handle: 'sean', auth: 'h1', id: cr.id, pickClock: pickClock || 3600, pool: { makuuchi: MAK, juryo: JUR } });
  assert.ok(st.ok, 'startDraft: ' + JSON.stringify(st));
  return cr.id;
}
/* the pick log straight from the store, so nothing the engine says can hide a double */
function pickIndexCol(store) {
  const head = (store.dump().DraftPicks || [[]])[0].map(String);
  return { idx: head.indexOf('pickIndex'), rik: head.indexOf('rikishi'), lg: head.indexOf('leagueId'), ph: head.indexOf('phase') };
}
// re-draft picks are all logged as index 0 with phase "redraft"; leave them out
function audit(store, id) {
  const c = pickIndexCol(store);
  const rows = (store.dump().DraftPicks || []).slice(1).filter(r => String(r[c.lg]) === id && String(r[c.ph]) !== 'redraft');
  const idx = rows.map(r => Number(r[c.idx])), riks = rows.map(r => String(r[c.rik]).toLowerCase());
  return { count: rows.length, dupIndex: idx.length - new Set(idx).size, dupRikishi: riks.length - new Set(riks).size };
}

async function racePicks(w, id) {
  const st = await w.get({ action: 'draftState', id, who: 'sean' });
  const who = st.turn.handle;
  const before = audit(w.store, id).count;
  const shots = MAK.slice(0, 8).map(r => w.post({ action: 'makePick', handle: who, auth: AUTH[who], id, rikishi: r }));
  const res = await Promise.all(shots);
  return { landed: res.filter(r => r.ok).length, after: audit(w.store, id), before };
}

async function racePollers(w, id) {
  const before = audit(w.store, id).count;
  w.clock.tick(31 * 1000);                     // past the 30-second clock: the turn is up
  await Promise.all([1, 2, 3, 4, 5].map(i => w.get({ action: 'draftState', id, who: ['sean', 'mika', 'dave', 'sean', 'mika'][i - 1] })));
  return { before, after: audit(w.store, id) };
}

(async () => {
  console.log('\n— picks —');
  await t('eight simultaneous picks on one turn: exactly one lands', async () => {
    for (let round = 0; round < 5; round++) {
      const w = await makeWorld();
      const id = await draftingLeague(w);
      const r = await racePicks(w, id);
      assert.strictEqual(r.landed, 1, 'landed ' + r.landed);
      assert.strictEqual(r.after.count, r.before + 1, 'picks ' + r.before + ' -> ' + r.after.count);
      assert.strictEqual(r.after.dupIndex + r.after.dupRikishi, 0, 'duplicates in the log');
    }
  });
  await t('control: with the check switched off, the same race double-picks', async () => {
    let wrong = 0;
    for (let round = 0; round < 5; round++) {
      const w = await makeWorld({ noCheck: true });
      const id = await draftingLeague(w);
      const r = await racePicks(w, id);
      if (r.landed > 1 || r.after.dupIndex > 0) wrong++;
    }
    assert.ok(wrong > 0, 'the race never showed itself without the check, so the test above proves nothing');
  });

  console.log('\n— the clock —');
  await t('five pollers on one expired clock: the turn is auto-picked once, as one poll would', async () => {
    // what a single poll does
    const solo = await makeWorld();
    const sid = await draftingLeague(solo, 30);
    solo.clock.tick(31 * 1000);
    await solo.get({ action: 'draftState', id: sid, who: 'sean' });
    const want = audit(solo.store, sid).count;
    assert.ok(want >= 1, 'a single poll auto-picks the expired turn');
    for (let round = 0; round < 5; round++) {
      const w = await makeWorld();
      const id = await draftingLeague(w, 30);
      const r = await racePollers(w, id);
      assert.strictEqual(r.after.count, want, 'auto-picks ' + r.after.count + ', one poll makes ' + want);
      assert.strictEqual(r.after.dupIndex + r.after.dupRikishi, 0, 'duplicates in the log');
    }
  });
  await t('control: without the check, concurrent pollers auto-pick the same turn more than once', async () => {
    let wrong = 0;
    for (let round = 0; round < 6; round++) {
      const w = await makeWorld({ noCheck: true });
      const id = await draftingLeague(w, 30);
      const r = await racePollers(w, id);
      if (r.after.dupIndex > 0 || r.after.dupRikishi > 0) wrong++;
    }
    assert.ok(wrong > 0, 'never reproduced the five-auto-picks bug without the check');
  });

  console.log('\n— everything else that writes —');
  await t('two sign-ups for one handle at once: one account', async () => {
    const w = await makeWorld();
    const res = await Promise.all([1, 2, 3].map(i => w.post({ action: 'register', handle: 'newbie', auth: 'x' + i, name: 'N' + i })));
    assert.strictEqual(res.filter(r => r.ok).length, 1, JSON.stringify(res));
    const users = (w.store.dump().Users || []).filter(r => String(r[0]).toLowerCase() === 'newbie');
    assert.strictEqual(users.length, 1);
  });
  await t('twenty DMs at once: twenty rows, none lost', async () => {
    const w = await makeWorld();
    const before = (w.store.dump().DirectMessages || []).length;
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => w.post({ action: 'dmSend', handle: i % 2 ? 'sean' : 'mika', auth: i % 2 ? 'h1' : 'h2', to: i % 2 ? 'mika' : 'sean', body: 'm' + i })));
    assert.strictEqual(res.filter(r => r.ok).length, 20, JSON.stringify(res.filter(r => !r.ok)));
    assert.strictEqual((w.store.dump().DirectMessages || []).length, before + 20);
  });
  await t('twenty sign-ups at once (every one rewrites Users): all twenty land', async () => {
    const w = await makeWorld();
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => w.post({ action: 'register', handle: 'fan' + i, auth: 'a' + i, name: 'Fan ' + i })));
    assert.strictEqual(res.filter(r => r.ok).length, 20, JSON.stringify(res.filter(r => !r.ok)));
    assert.strictEqual((w.store.dump().Users || []).length - 1, 4 + 20);
  });
  await t('thirty team saves in the same second (basho day one): all thirty land', async () => {
    const w = await makeWorld();
    for (let i = 0; i < 30; i++) await w.post({ action: 'register', handle: 'p' + i, auth: 'a' + i, name: 'P' + i });
    const res = await Promise.all(Array.from({ length: 30 }, (_, i) => w.post({ action: 'save', handle: 'p' + i, auth: 'a' + i, team: { sanyaku: MAK[i % MAK.length] } })));
    assert.strictEqual(res.filter(r => r.ok).length, 30, JSON.stringify(res.filter(r => !r.ok).slice(0, 2)));
    const users = (w.store.dump().Users || []).slice(1);
    for (let i = 0; i < 30; i++) {
      const row = users.find(r => r[0] === 'p' + i);
      assert.ok(row && String(row[3]).includes(MAK[i % MAK.length]), 'team for p' + i + ' kept');
    }
  });
  await t('joins, chat, page views and a team save all at once: every write lands', async () => {
    const w = await makeWorld();
    const cr = await w.post({ action: 'createLeague', handle: 'sean', auth: 'h1', name: 'Busy', mode: 'classic' });
    const jobs = [
      ...['mika', 'dave', 'taro'].map(h => w.post({ action: 'joinLeague', handle: h, auth: AUTH[h], code: cr.inviteCode })),
      ...[1, 2, 3, 4].map(i => w.post({ action: 'postMessage', handle: 'sean', auth: 'h1', id: cr.id, body: 'msg ' + i })),
      ...[1, 2, 3, 4, 5].map(i => w.post({ action: 'logPageview', page: 'p' + i, visitorId: 'v' + i })),
      w.post({ action: 'save', handle: 'taro', auth: 'h4', team: { sanyaku: 'Onosato' } })
    ];
    const res = await Promise.all(jobs);
    assert.ok(res.every(r => r.ok), JSON.stringify(res.filter(r => !r.ok)));
    const d = await w.get({ action: 'league', id: cr.id, handle: 'sean' });
    assert.strictEqual(d.members.length, 4, 'members ' + d.members.length);
    assert.strictEqual(d.messages.length, 4, 'messages ' + d.messages.length);
    assert.strictEqual((w.store.dump().PageViews || []).length - 1, 5);
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n0 passed, 1 failed'); process.exit(1); });
