/* gg-config.js decides, page by page, which backend the site talks to.
   It must start on Apps Script, follow Supabase's __health answer on the
   next load, flip back when Supabase pauses or reverts, ask at most every
   five minutes, never ask from a dev box, and survive blocked storage. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'gg-config.js'), 'utf8');
const APPS = /script\.google\.com\/macros\/s\/.+\/exec$/;
const SUPA = 'https://ulzbcqnvltbioajvgvrr.supabase.co/functions/v1/api';

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n         ' + (e && e.message)); fail++; }
}
function page(opts) {
  opts = opts || {};
  const ls = opts.storage || new Map();
  const asked = [];
  const ctx = {
    location: { hostname: opts.host === undefined ? 'sumoslapdown.com' : opts.host },
    localStorage: opts.blocked ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
      : { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)) },
    Date, Number, String, JSON, Promise,
    fetch: async (url) => {
      asked.push(url);
      if (opts.health instanceof Error) throw opts.health;
      return { json: async () => opts.health };
    }
  };
  ctx.window = ctx;                       // as in a browser: window is the global object
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  if (opts.twice) vm.runInContext(SRC, ctx);
  const GG = ctx.window.GyojiGuide;
  return { GG, ctx, ls, asked, settle: () => new Promise(r => setTimeout(r, 5)) };
}
const PIN = 'forceFunctionRegion=us-west-2';

(async () => {
  console.log('\n— which backend a page talks to —');
  await t('a first visit starts on Apps Script and asks Supabase in the background', async () => {
    const p = page({ health: { ok: true, live: false } });
    assert.ok(APPS.test(p.GG.API_URL), p.GG.API_URL);
    assert.deepStrictEqual(p.asked, [SUPA + '?action=__health&' + PIN]);
    await p.settle();
    assert.strictEqual(p.ls.get('gg.api'), 'appsScript');
  });
  await t('once Supabase is live, the next page load uses it', async () => {
    const ls = new Map();
    const first = page({ storage: ls, health: { ok: true, live: true, maintenance: false } });
    assert.ok(APPS.test(first.GG.API_URL));
    await first.settle();
    const next = page({ storage: ls, health: { ok: true, live: true } });
    assert.strictEqual(next.GG.API_URL, SUPA);
    assert.strictEqual(next.asked.length, 0, 'asked a moment ago, so not again');
  });
  await t('a pause or a revert sends the next load back to Apps Script', async () => {
    for (const health of [{ ok: true, live: true, maintenance: true }, { ok: true, live: false, maintenance: true }]) {
      const ls = new Map([['gg.api', 'supabase']]);
      const p = page({ storage: ls, health });
      assert.strictEqual(p.GG.API_URL, SUPA, 'this load keeps what it had');
      await p.settle();
      assert.strictEqual(ls.get('gg.api'), 'appsScript');
      assert.ok(APPS.test(page({ storage: ls, health }).GG.API_URL));
    }
  });
  await t('it asks at most every five minutes', async () => {
    const ls = new Map([['gg.api.asked', String(Date.now() - 60 * 1000)]]);
    assert.strictEqual(page({ storage: ls, health: { ok: true, live: true } }).asked.length, 0);
    ls.set('gg.api.asked', String(Date.now() - 6 * 60 * 1000));
    assert.strictEqual(page({ storage: ls, health: { ok: true, live: true } }).asked.length, 1);
  });
  await t('a maintenance reply makes the next load ask again straight away', async () => {
    const ls = new Map([['gg.api', 'supabase'], ['gg.api.asked', String(Date.now())]]);
    // every call this page makes is answered "paused"
    const p = page({ storage: ls, health: { ok: false, maintenance: true, error: 'paused' } });
    assert.strictEqual(p.asked.length, 0, 'asked recently, so no background check');
    const r = await p.GG.apiPost({ action: 'save' });
    assert.strictEqual(r.maintenance, true);
    assert.strictEqual(ls.get('gg.api.asked'), '0', 'the next page load will ask');
    assert.strictEqual(page({ storage: ls, health: { ok: true, live: false } }).asked.length, 1);
  });
  await t('every call to the function runs next to the database (us-west-2); Apps Script calls are untouched', async () => {
    const ls = new Map([['gg.api', 'supabase'], ['gg.api.asked', String(Date.now())]]);
    const p = page({ storage: ls, health: { ok: true } });
    await p.GG.apiGet('data');
    await p.GG.apiGetQ('league', { id: 'lg1', handle: 'sean' });
    await p.GG.apiPost({ action: 'save' });
    await p.ctx.fetch(SUPA + '?action=data');                  // a page's own direct fetch, as fantasy.html does
    assert.deepStrictEqual(p.asked, [
      SUPA + '?action=data&' + PIN,
      SUPA + '?action=league&id=lg1&handle=sean&' + PIN,
      SUPA + '?' + PIN,
      SUPA + '?action=data&' + PIN]);
    const apps = page({ storage: new Map([['gg.api.asked', String(Date.now())]]), health: { ok: true } });
    await apps.GG.apiGet('data');
    assert.ok(APPS.test(apps.asked[0].split('?')[0]) && !apps.asked[0].includes(PIN), apps.asked[0]);
  });
  await t('loading gg-config.js twice pins once, and a URL that already says where to run is left alone', async () => {
    const p = page({ storage: new Map([['gg.api', 'supabase'], ['gg.api.asked', String(Date.now())]]), health: { ok: true }, twice: true });
    await p.GG.apiGet('data');
    await p.ctx.fetch(SUPA + '?action=x&forceFunctionRegion=eu-west-1');
    assert.deepStrictEqual(p.asked, [SUPA + '?action=data&' + PIN, SUPA + '?action=x&forceFunctionRegion=eu-west-1']);
  });
  await t('a dev box never asks and stays on Apps Script', async () => {
    for (const host of ['localhost', '127.0.0.1', '']) {
      const p = page({ host, health: { ok: true, live: true } });
      assert.strictEqual(p.asked.length, 0, host);
      assert.ok(APPS.test(p.GG.API_URL));
    }
  });
  await t('blocked storage or a failed check just means Apps Script', async () => {
    const p = page({ blocked: true, health: { ok: true, live: true } });
    assert.ok(APPS.test(p.GG.API_URL));
    await p.settle();
    const q = page({ health: new Error('offline') });
    await q.settle();
    assert.ok(APPS.test(q.GG.API_URL));
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crashed: ' + (e && e.stack || e)); console.log('\n0 passed, 1 failed'); process.exit(1); });
