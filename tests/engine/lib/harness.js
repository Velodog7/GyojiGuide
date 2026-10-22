/* Runs every request twice, through the reference model (model.js) and
   through the real engine over a store, and insists the answers match
   byte for byte. compareState() checks the stored rows match too. */
'use strict';
const fs = require('fs');
const path = require('path');
const { createModel, makeClock, makeFakeDate, makeMath, rowLen, isEmpty } = require('./model');
const { createMemStore } = require('./memstore');

const ROOT = path.join(__dirname, '..', '..', '..');
const GS = process.env.GG_GS || path.join(ROOT, 'sumo-fantasy.gs');
const ENGINE = process.env.GG_ENGINE || path.join(ROOT, 'supabase', 'functions', 'api', 'engine.js');

let enginePromise = null;
function loadEngine() { return enginePromise || (enginePromise = import(ENGINE)); }

/* a small, fixed sumo-api: bouts for Aki 2026 days 1-3, nothing else */
const MAK = ['Onosato', 'Hoshoryu', 'Kotozakura', 'Aonishiki', 'Kirishima', 'Wakatakakage', 'Takayasu', 'Atamifuji',
  'Kotoshoho', 'Gonoyama', 'Oshoma', 'Hiradoumi', 'Ura', 'Abi', 'Tamawashi', 'Churanoumi', 'Shonannoumi', 'Onokatsu'];
const JUR = ['Dewanoryu', 'Kyokukaiyu', 'Daiseizan', 'Kazuma', 'Tokihayate', 'Shishi', 'Asakoryu', 'Fujiseiun', 'Tanji', 'Nabatame'];
function cannedSumoApi(url) {
  let m = url.match(/\/api\/basho\/(\d{6})\/torikumi\/(Makuuchi|Juryo)\/(\d+)$/);
  if (m) {
    const day = Number(m[3]);
    if (m[1] !== '202609' || day > 3) return { status: 200, text: JSON.stringify({ torikumi: [] }) };
    const pool = m[2] === 'Makuuchi' ? MAK : JUR, bouts = [];
    for (let i = 0; i + 1 < pool.length; i += 2) {
      const a = pool[(i + day) % pool.length], b = pool[(i + 1 + day) % pool.length];
      bouts.push({ eastShikona: a, westShikona: b, winnerEn: (i + day) % 3 ? a : b, kimarite: 'yorikiri' });
    }
    return { status: 200, text: JSON.stringify({ torikumi: bouts }) };
  }
  if (/rikishis\?limit=1/.test(url)) return { status: 200, text: '{"limit":1,"records":[]}' };
  return { status: 404, text: '{"error":"not found"}' };
}

async function createHarness(opts) {
  opts = opts || {};
  const E = await loadEngine();
  const source = opts.source || fs.readFileSync(GS, 'utf8');
  const clock = makeClock(opts.start);
  const FakeDate = makeFakeDate(clock);
  const mathA = makeMath(), mathB = makeMath();
  const respond = opts.fetch || cannedSumoApi;
  const fetchError = (url, msg) => 'Exception: ' + msg + ' (url: ' + url + ')';
  const fetchSync = (url, p) => { try { return respond(url, p); } catch (e) { return { error: fetchError(url, e.message) }; } };

  const model = createModel({ source, compileBackend: E.compileBackend, formatDate: E.formatDate,
    dateClassFor: E.dateClassFor, clock, math: mathA, fetchSync, props: opts.props, tz: opts.tz });

  const seedProps = Object.assign({ ADMIN_KEY: 'test', __CRON_KEY: 'cron-test-key', __GG_TZ: opts.tz || 'UTC' }, opts.props || {});
  const store = opts.makeStore ? await opts.makeStore(clock, seedProps)
    : createMemStore({ clock: () => clock.now, props: seedProps, delay: opts.delay });
  let seed = 0;
  const engine = E.createEngine({
    source, store, baseDate: FakeDate, math: mathB, tz: opts.tz,
    beforeRun: () => mathB.reseed(seed),
    log: () => {},
    fetch: async (url, init) => {
      const r = respond(url, init || {});
      return { status: r.status, text: async () => r.text, headers: new Map() };
    }
  });

  let reqNo = 0, compared = 0;
  const failures = [];
  function diffAt(a, b) {
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return 'at ' + i + ':\n      model:  ' + JSON.stringify(a.slice(Math.max(0, i - 60), i + 80)) +
      '\n      engine: ' + JSON.stringify(b.slice(Math.max(0, i - 60), i + 80));
  }
  async function both(label, modelName, modelArgs, spec) {
    reqNo++; seed = reqNo * 7919;
    clock.tick(opts.stepMs === undefined ? 1000 : opts.stepMs);
    const a = model.run(modelName, modelArgs, seed);
    const res = await engine.execute(spec);
    const b = res.text;
    compared++;
    if (a !== b) failures.push(label + ' differs ' + diffAt(a, b));
    let parsed = null; try { parsed = JSON.parse(b); } catch (e) {}
    return { text: b, json: parsed, res };
  }
  const get = (params) => {
    const e = { parameter: Object.assign({}, params), parameters: {}, queryString: '' };
    return both('GET ' + JSON.stringify(params), 'doGet', [e], { kind: 'get', e: { parameter: Object.assign({}, params), parameters: {}, queryString: '' }, key: 'GET ' + (params.action || 'data') });
  };
  const post = (body) => {
    const contents = JSON.stringify(body);
    const e = () => ({ parameter: {}, parameters: {}, postData: { contents, length: contents.length, type: 'text/plain', name: 'postData' } });
    return both('POST ' + contents.slice(0, 160), 'doPost', [e()], { kind: 'post', e: e(), key: 'POST ' + body.action });
  };
  const fn = (name, args) => both('FN ' + name, name, args || [], { kind: 'fn', fn: name, args: args || [], key: 'FN ' + name });

  /* the stored rows must match the model's, cell for cell */
  async function compareState(label) {
    const a = model.dump(E.encodeCell);
    const raw = await store.dump();
    const b = {};
    for (const n of Object.keys(raw)) b[n] = raw[n].map(r => { let k = r.length; while (k > 0 && isEmpty(r[k - 1])) k--; return r.slice(0, k); });
    const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const n of names) {
      const ja = JSON.stringify(a[n] || null), jb = JSON.stringify(b[n] || null);
      if (ja !== jb) { failures.push('state ' + (label || '') + ': sheet ' + n + ' differs ' + diffAt(ja, jb)); return false; }
    }
    return true;
  }
  return { get, post, fn, compareState, failures, clock, store, engine, model,
    stats: () => ({ compared, requests: reqNo }), MAK, JUR };
}

module.exports = { createHarness, cannedSumoApi, MAK, JUR };
