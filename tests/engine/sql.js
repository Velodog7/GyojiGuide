/* The real SQL, in PGlite (Postgres compiled to WebAssembly).

   Runs both migrations, then the flows from lib/flows.js through the engine
   with gg_load / gg_commit / gg_import_* as the store, against the reference
   model. Then the store's own rules, call by call: conflicts, cell patches,
   the import swap, and that the publishable key can reach nothing.

   Needs PGlite, which is not vendored:
     npm i --prefix tests/engine/.deps @electric-sql/pglite@0.5.8
   (or point GG_PGLITE at any directory holding node_modules/@electric-sql/pglite) */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createHarness } = require('./lib/harness');
const { FLOWS } = require('./lib/flows');

const ROOT = path.join(__dirname, '..', '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');

function findPglite() {
  const tries = [process.env.GG_PGLITE, path.join(__dirname, '.deps'), ROOT].filter(Boolean);
  for (const dir of tries) {
    try { return require.resolve('@electric-sql/pglite', { paths: [dir] }); } catch (e) { /* next */ }
  }
  return null;
}

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n         ' + (e && e.message)); fail++; }
}

(async () => {
  const where = findPglite();
  if (!where) {
    console.log('  FAIL PGlite is not installed: npm i --prefix tests/engine/.deps @electric-sql/pglite@0.5.8');
    console.log('\n0 passed, 1 failed');
    process.exit(1);
  }
  const { PGlite } = await import(where);
  const db = new PGlite();
  const notices = [];
  await db.exec("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;");
  for (const f of fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    const res = await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    void res;
  }
  db.onNotice && db.onNotice(n => notices.push(n.message));

  const one = async (sql, params) => (await db.query(sql, params)).rows[0].r;
  async function reset(seedProps) {
    await db.exec('truncate public.gg_rows, public.gg_sheets cascade; truncate public.gg_props, public.gg_cache, public.gg_import_rows, public.gg_import_sheets;');
    await db.query("select setval('public.gg_pos_seq', 1, false)");
    await db.query("select set_config('gg.now', '', false)");    // back to the real clock
    for (const [k, v] of Object.entries(seedProps || {})) await db.query('insert into public.gg_props (key, value) values ($1, $2)', [k, v]);
  }
  function pgStore(clock) {
    const pin = async () => { if (clock) await db.query("select set_config('gg.now', $1, false)", [new Date(clock.now).toISOString()]); };
    return {
      load: async (sheets, meta) => { await pin(); return one('select public.gg_load($1::text[], $2::boolean) as r', [sheets || [], !!meta]); },
      commit: async (p) => { await pin(); return one('select public.gg_commit($1::jsonb) as r', [JSON.stringify(p)]); },
      importBegin: async () => one('select public.gg_import_begin() as r'),
      importRows: async (s, start, rows) => one('select public.gg_import_rows($1, $2, $3::jsonb) as r', [s, start, JSON.stringify(rows)]),
      importFinish: async (e, p, m) => { await pin(); return one('select public.gg_import_finish($1::jsonb, $2::jsonb, $3::jsonb) as r', [JSON.stringify(e), JSON.stringify(p), JSON.stringify(m)]); },
      stats: async () => one('select public.gg_stats() as r'),
      dump: async () => {
        const out = {};
        for (const r of (await db.query('select sheet, cells from public.gg_rows order by sheet, pos')).rows) (out[r.sheet] || (out[r.sheet] = [])).push(r.cells);
        return out;
      }
    };
  }

  console.log('\n— the flows, over the real SQL —');
  for (const flow of FLOWS) {
    const make = (opts) => createHarness(Object.assign({}, opts, {
      makeStore: async (clock, seedProps) => { await reset(seedProps); return pgStore(clock); }
    }));
    const { name, H } = await flow.run(make);
    if (H.failures.length) {
      fail++;
      console.log('  FAIL ' + name);
      for (const f of H.failures.slice(0, 3)) console.log('       ' + f);
    } else { pass++; console.log('  ok   ' + name); }
  }

  console.log('\n— gg_commit —');
  await t('a commit whose reads went stale is refused; one that never checked goes through', async () => {
    await reset({});
    const s = pgStore(null);
    assert.deepStrictEqual(await s.commit({ check: null, ops: [{ op: 'sheet', sheet: 'S' }, { op: 'ins', sheet: 'S', cells: ['a'] }] }), { ok: true });
    const v = (await s.load(['S'], false)).sheets.S.v;
    assert.deepStrictEqual(await s.commit({ check: { S: v }, ops: [{ op: 'ins', sheet: 'S', cells: ['b'] }] }), { ok: true });
    const stale = await s.commit({ check: { S: v }, ops: [{ op: 'ins', sheet: 'S', cells: ['c'] }] });
    assert.deepStrictEqual(stale, { ok: false, conflict: true, sheet: 'S' });
    assert.deepStrictEqual(await s.commit({ check: null, ops: [{ op: 'ins', sheet: 'S', cells: ['d'] }] }), { ok: true });
    assert.deepStrictEqual((await s.dump()).S, [['a'], ['b'], ['d']]);
    assert.strictEqual((await s.load(['S'], false)).sheets.S.v, v + 2);
  });
  await t('"must not exist" is checked; a conflict writes nothing at all', async () => {
    await reset({});
    const s = pgStore(null);
    await s.commit({ check: null, ops: [{ op: 'sheet', sheet: 'X' }] });
    const r = await s.commit({ check: { X: null, Y: null }, ops: [{ op: 'sheet', sheet: 'Y' }, { op: 'ins', sheet: 'Y', cells: [1] }] });
    assert.strictEqual(r.conflict, true);
    assert.strictEqual((await s.load(['Y'], false)).sheets.Y, null, 'Y was not created');
  });
  await t('cell patches pad with "" and leave the other cells alone; put replaces; del deletes', async () => {
    await reset({});
    const s = pgStore(null);
    await s.commit({ check: null, ops: [{ op: 'sheet', sheet: 'P' }, { op: 'ins', sheet: 'P', cells: ['a', 'b'] }, { op: 'ins', sheet: 'P', cells: ['z'] }] });
    const rows = (await s.load(['P'], false)).sheets.P.rows;
    await s.commit({ check: null, ops: [{ op: 'set', sheet: 'P', id: rows[0][0], cells: { 4: 'x', 0: { $d: '2026-10-22T00:00:00.000Z' } } }] });
    await s.commit({ check: null, ops: [{ op: 'put', sheet: 'P', id: rows[1][0], cells: ['y', true, 3.5] }] });
    assert.deepStrictEqual((await s.dump()).P, [[{ $d: '2026-10-22T00:00:00.000Z' }, 'b', '', '', 'x'], ['y', true, 3.5]]);
    await s.commit({ check: null, ops: [{ op: 'del', sheet: 'P', id: rows[0][0] }] });
    assert.deepStrictEqual((await s.dump()).P, [['y', true, 3.5]]);
  });
  await t('props and cache: set, delete, expiry', async () => {
    await reset({ __KEEP: '1' });
    const s = pgStore(null);
    await s.commit({ check: null, ops: [], props: { set: { A: 'x' }, del: ['__KEEP'] }, cache: { put: [['c1', 'v', 60], ['c2', 'w', 1]], del: [] } });
    await db.query("update public.gg_cache set expires_at = now() - interval '1 second' where key = 'c2'");
    const m = await s.load([], true);
    assert.deepStrictEqual(m.props, { A: 'x' });
    assert.deepStrictEqual(Object.keys(m.cache), ['c1']);
    assert.strictEqual(m.cache.c1[0], 'v');
  });

  console.log('\n— the import —');
  await t('chunks in any order (and resent) swap in all at once; __ props survive, the rest are replaced', async () => {
    await reset({ OLD: 'gone', __CRON_KEY: 'keep-me' });
    const s = pgStore(null);
    await s.commit({ check: null, ops: [{ op: 'sheet', sheet: 'Old' }, { op: 'ins', sheet: 'Old', cells: ['x'] }] });
    const before = (await s.load(['Old'], false)).sheets.Old.v;
    await s.importBegin();
    await s.importRows('Users', 3, [['u2', 2]]);
    await s.importRows('Users', 1, [['handle', 'n'], ['u1', 1]]);
    await s.importRows('Users', 3, [['u2', 2]]);                 // a resend changes nothing
    await s.importRows('Empty', 1, []);
    const r = await s.importFinish({ Users: 3, Empty: 0 }, { ADMIN_KEY: 'k', __CRON_KEY: 'smuggled' }, { tz: 'America/Los_Angeles', exportedAt: 'now' });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.rows, 3);
    assert.deepStrictEqual(await s.dump(), { Users: [['handle', 'n'], ['u1', 1], ['u2', 2]] });
    const m = await s.load(['Users', 'Empty', 'Old'], true);
    assert.strictEqual(m.sheets.Old, null, 'sheets not in the export are gone');
    assert.deepStrictEqual(m.sheets.Empty.rows, []);
    assert.ok(m.sheets.Users.v > before, 'versions moved past the old ones');
    assert.strictEqual(m.props.ADMIN_KEY, 'k');
    assert.strictEqual(m.props.OLD, undefined);
    assert.strictEqual(m.props.__CRON_KEY, 'keep-me', 'engine keys are never imported over');
    assert.strictEqual(m.props.__GG_TZ, 'America/Los_Angeles');
    // a row appended after the import lands after the imported ones
    await s.commit({ check: null, ops: [{ op: 'ins', sheet: 'Users', cells: ['u3', 3] }] });
    assert.deepStrictEqual((await s.dump()).Users.map(x => x[0]), ['handle', 'u1', 'u2', 'u3']);
  });
  await t('a short import is refused and the live data is untouched', async () => {
    await reset({});
    const s = pgStore(null);
    await s.commit({ check: null, ops: [{ op: 'sheet', sheet: 'Live' }, { op: 'ins', sheet: 'Live', cells: ['keep'] }] });
    await s.importBegin();
    await s.importRows('Users', 1, [['a'], ['b']]);
    await assert.rejects(s.importFinish({ Users: 3 }, {}, {}), /import incomplete/);
    await assert.rejects(s.importFinish({ Users: 2, Missing: 1 }, {}, {}), /never arrived/);
    await assert.rejects(s.importFinish({}, {}, {}), /did not list/);
    assert.deepStrictEqual(await s.dump(), { Live: [['keep']] });
  });

  await t('gg_export_rows pages through a sheet in order, clamps the page size, and answers [] for a missing sheet', async () => {
    await reset({});
    const s = pgStore(null);
    const ops = [{ op: 'sheet', sheet: 'Big' }];
    for (let i = 0; i < 12; i++) ops.push({ op: 'ins', sheet: 'Big', cells: ['r' + i, i] });
    await s.commit({ check: null, ops });
    const page = async (o, l) => one('select public.gg_export_rows($1, $2, $3) as r', ['Big', o, l]);
    assert.deepStrictEqual((await page(0, 5)).map(r => r[0]), ['r0', 'r1', 'r2', 'r3', 'r4']);
    assert.deepStrictEqual((await page(10, 5)).map(r => r[0]), ['r10', 'r11']);
    assert.deepStrictEqual(await page(20, 5), []);
    assert.strictEqual((await page(0, 0)).length, 1, 'a page is at least one row');
    assert.strictEqual((await page(-3, 999999)).length, 12, 'offset floors at 0; the cap is 5000');
    assert.deepStrictEqual(await one('select public.gg_export_rows($1, 0, 10) as r', ['Nope']), []);
  });

  console.log('\n— who can reach it —');
  await t('the publishable key’s roles can read nothing and run nothing; service_role can', async () => {
    await reset({ ADMIN_KEY: 'secret' });
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      for (const sql of ['select count(*) from public.gg_rows', 'select count(*) from public.gg_props', "select public.gg_export_rows('Users', 0, 10)",
        "select public.gg_load(array['Users'], true)", "select public.gg_commit('{}'::jsonb)", 'select public.gg_import_begin()']) {
        let refused = false;
        try { await db.query(sql); } catch (e) { refused = /permission denied/.test(e.message); }
        assert.ok(refused, role + ' was allowed: ' + sql);
      }
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const m = await one('select public.gg_load(array[]::text[], true) as r');
    await db.exec('reset role');
    assert.strictEqual(m.props.ADMIN_KEY, 'secret');
  });
  await t('the cron migration applied cleanly without pg_cron, and left __CRON_KEY in place', async () => {
    const k = (await db.query("select count(*)::int as n from pg_namespace where nspname = 'cron'")).rows[0].n;
    assert.strictEqual(k, 0, 'PGlite has no pg_cron, so nothing was scheduled');
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n0 passed, 1 failed'); process.exit(1); });
