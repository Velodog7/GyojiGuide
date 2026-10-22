/* The reference model: sumo-fantasy.gs over a plain, synchronous,
   in-memory spreadsheet, the way Apps Script runs it, one request at a
   time with nothing to load. The engine (replays, snapshots, commits, the
   store) must agree with it exactly, response for response and row for
   row. That is what differential.js and sql.js check.

   Also the deterministic environment both sides share: a clock that only
   moves between requests, and a seeded Math.random reset per request. */
'use strict';

function isEmpty(v) { return v === '' || v === null || v === undefined; }
function rowLen(r) { let n = r.length; while (n > 0 && isEmpty(r[n - 1])) n--; return n; }

function makeClock(start) {
  const c = { now: start || Date.UTC(2026, 9, 22, 12, 0, 0) };
  c.tick = (ms) => { c.now += (ms === undefined ? 1000 : ms); };
  return c;
}
function makeFakeDate(clock) {
  return class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(clock.now); else super(...a); }
    static now() { return clock.now; }
  };
}
/* mulberry32, reseeded at the start of every request */
function makeMath() {
  const M = Object.create(Math);
  let s = 1;
  M.random = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  M.reseed = (seed) => { s = seed | 0; };
  return M;
}

function toCell(v, D) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    if (v.length > 50000) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
    return v;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : '#NUM!';
  if (typeof v === 'boolean') return v;
  if (Object.prototype.toString.call(v) === '[object Date]') { const t = v.getTime(); return isNaN(t) ? '' : new D(t); }
  return String(v);
}

function makeSheet(name, D) {
  const s = { name, rows: [] };
  const lastRow = () => { for (let i = s.rows.length - 1; i >= 0; i--) if (rowLen(s.rows[i])) return i + 1; return 0; };
  const lastCol = () => s.rows.reduce((m, r) => Math.max(m, rowLen(r)), 0);
  const read = (i, j) => {
    const r = s.rows[i]; const v = r ? r[j] : undefined;
    if (v === undefined || v === null) return '';
    return Object.prototype.toString.call(v) === '[object Date]' ? new D(v.getTime()) : v;
  };
  const write = (i, j, v) => { while (s.rows.length <= i) s.rows.push([]); const r = s.rows[i]; while (r.length < j) r.push(''); r[j] = v; };
  function range(r, c, nr, nc) {
    return {
      getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(read(r - 1 + i, c - 1 + j)); o.push(row); } return o; },
      getValue() { return read(r - 1, c - 1); },
      setValues(v) {
        if (v.length !== nr) throw new Error('The number of rows in the data does not match the number of rows in the range. The data has ' + v.length + ' but the range has ' + nr + '.');
        for (const row of v) if (row.length !== nc) throw new Error('The number of columns in the data does not match the number of columns in the range. The data has ' + row.length + ' but the range has ' + nc + '.');
        const conv = v.map(row => row.map(x => toCell(x, D)));
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) write(r - 1 + i, c - 1 + j, conv[i][j]);
        return this;
      },
      setValue(v) { const x = toCell(v, D); for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) write(r - 1 + i, c - 1 + j, x); return this; }
    };
  }
  return Object.assign(s, {
    getName: () => name,
    getLastRow: lastRow,
    getLastColumn: lastCol,
    getDataRange() { return range(1, 1, Math.max(1, lastRow()), Math.max(1, lastCol())); },
    getRange(r, c, nr, nc) {
      if (r < 1) throw new Error('The starting row of the range is too small.');
      return range(r, c === undefined ? 1 : c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc);
    },
    appendRow(vals) { const at = lastRow(); const row = vals.map(x => toCell(x, D)); if (at < s.rows.length) s.rows[at] = row; else s.rows.push(row); return s; },
    deleteRow(r) { s.rows.splice(r - 1, 1); return s; },
    deleteRows(r, n) { s.rows.splice(r - 1, n); return s; },
    insertColumnBefore(c) { for (const row of s.rows) if (row.length >= c) row.splice(c - 1, 0, ''); return s; },
    setFrozenRows() { return s; }
  });
}

/* createModel({ source, compileBackend, formatDate, dateClassFor, clock, math, fetchSync, props, tz }) */
function createModel(o) {
  const factory = o.compileBackend(o.source);
  const D = o.dateClassFor(o.tz || 'UTC', makeFakeDate(o.clock));
  const store = {};
  const props = Object.assign({ ADMIN_KEY: 'test' }, o.props || {});
  const cache = new Map();
  const NEVER = /^dsg?:/;
  const ss = {
    getSheetByName: (n) => store[n] || null,
    insertSheet(n) { if (store[n]) throw new Error('A sheet with the name "' + n + '" already exists. Please enter another name.'); store[n] = makeSheet(n, D); return store[n]; },
    getSpreadsheetTimeZone: () => o.tz || 'UTC'
  };
  const lock = { waitLock() {}, tryLock() { return true; }, releaseLock() {}, hasLock() { return true; } };
  const propStore = {
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty(k, v) { props[k] = String(v); return propStore; },
    deleteProperty(k) { delete props[k]; return propStore; },
    getProperties: () => Object.assign({}, props)
  };
  const ttl = (t) => (t === undefined ? 600 : Math.max(1, Math.min(21600, Math.floor(Number(t) || 600))));
  const cacheApi = {
    get(k) { if (NEVER.test(k)) return null; const e = cache.get(k); return e && e[1] > o.clock.now ? e[0] : null; },
    getAll(keys) { const r = {}; for (const k of keys || []) { const v = cacheApi.get(k); if (v !== null) r[k] = v; } return r; },
    put(k, v, t) { if (NEVER.test(k)) return; cache.set(k, [String(v), o.clock.now + ttl(t) * 1000]); },
    putAll(obj, t) { for (const k of Object.keys(obj)) cacheApi.put(k, obj[k], t); },
    remove(k) { cache.delete(k); },
    removeAll(keys) { for (const k of keys || []) cache.delete(k); }
  };
  class TextOutput {
    constructor(t) { this.t = t === undefined || t === null ? '' : String(t); this.m = 'TEXT'; }
    setMimeType(m) { this.m = m; return this; }
    getContent() { return this.t; }
  }
  const svc = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
    PropertiesService: { getScriptProperties: () => propStore },
    LockService: { getScriptLock: () => lock },
    CacheService: { getScriptCache: () => cacheApi },
    UrlFetchApp: {
      fetch(url, p) {
        const r = o.fetchSync(String(url), p || {});
        if (r.error) throw new Error(r.error);
        return { getResponseCode: () => r.status, getContentText: () => r.text, getHeaders: () => ({}) };
      }
    },
    ContentService: { createTextOutput: (t) => new TextOutput(t), MimeType: { JSON: 'JSON', TEXT: 'TEXT' } },
    Utilities: { formatDate: o.formatDate, sleep() {} },
    Session: { getScriptTimeZone: () => o.tz || 'UTC' },
    ScriptApp: { getService: () => ({ getUrl: () => '' }) },
    Logger: { log() { return svc.Logger; } }
  };

  function call(name, args, seed) {
    o.math.reseed(seed);
    const entry = factory(svc.SpreadsheetApp, svc.PropertiesService, svc.LockService, svc.CacheService,
      svc.UrlFetchApp, svc.ContentService, svc.Utilities, svc.Session, svc.ScriptApp, svc.Logger, D, o.math);
    return entry(name).apply(null, args);
  }
  function asReply(fnName, out, err) {
    if (err) return JSON.stringify({ ok: false, error: String((err && err.message) || err) });
    if (fnName === 'doGet' || fnName === 'doPost') return out instanceof TextOutput ? out.getContent() : 'The script completed but did not return anything.';
    let result = null;
    try { result = JSON.parse(JSON.stringify(out === undefined ? null : out)); } catch (e) { result = String(out); }
    return JSON.stringify({ ok: true, result });
  }
  function run(name, args, seed) {
    try { return asReply(name, call(name, args, seed)); } catch (err) { return asReply(name, null, err); }
  }
  /* {sheet: [cells...]} with cells encoded the way the store keeps them */
  function dump(encodeCell) {
    const out = {};
    for (const n of Object.keys(store).sort()) {
      out[n] = store[n].rows.map(r => { const c = r.slice(0, rowLen(r)).map(v => encodeCell(isEmpty(v) ? '' : v)); return c; });
    }
    return out;
  }
  return { run, dump, store, props, cache, ss };
}

module.exports = { createModel, makeClock, makeFakeDate, makeMath, rowLen, isEmpty };
