/*  SUMO SLAP DOWN — the Apps Script engine
 *  ---------------------------------------------------------------------
 *  Runs sumo-fantasy.gs, unchanged, on top of the sheet store in Postgres
 *  (supabase/migrations: gg_sheets / gg_rows / gg_props / gg_cache).
 *
 *  The .gs code is synchronous: it calls getValues() and expects the rows
 *  back on the spot. A database answers asynchronously. The engine squares
 *  that by REPLAYING. It runs the code against what it has already loaded;
 *  when the code reaches for a sheet (or a URL) that isn't loaded yet, the
 *  engine notes it, lets that run fail, loads what was missing and runs the
 *  code again from the top. Nothing a run writes leaves the engine until a
 *  run finishes with everything it needed, so an abandoned run has no side
 *  effects. Most requests settle in one run, because the engine remembers
 *  which sheets each action used last time and loads them up front.
 *
 *  Writes go to the store in ONE transaction at the end (gg_commit). A run
 *  that took the script lock (waitLock / tryLock) also sends the version of
 *  every sheet it read, and the commit is refused if any of them changed in
 *  the meantime; the request then runs again on fresh data. On Sheets,
 *  LockService plus unlock_() was approximating this. Here every locked
 *  action behaves as if it ran alone, so the stale-read bugs in CLAUDE.md
 *  (seven picks on one turn, five auto-picks on one expired clock) cannot
 *  recur, whatever the .gs does inside the lock.
 *
 *  Plain JS with no imports, so the Edge Function (Deno) and the Node tests
 *  load the same file.
 *  ------------------------------------------------------------------- */

const MAX_ATTEMPTS = 12;    // commits refused for a conflict before giving up (backoff ~2.5 s in all)
const MAX_RUNS = 60;        // replays inside one attempt (refreshResults needs ~32)
const CELL_LIMIT = 50000;   // Sheets refuses longer cells; so do we
/* The draft room's snapshot cache (ds:<id>, dsg:<id>) existed because Sheet
   reads were slow. A cache miss is always a correct answer, so those keys are
   simply never stored: draftState takes its full path every time. */
const NEVER_CACHED = /^dsg?:/;

export const MIME = {
  JSON: 'application/json; charset=utf-8', TEXT: 'text/plain; charset=utf-8',
  JAVASCRIPT: 'application/javascript; charset=utf-8', CSV: 'text/csv; charset=utf-8',
  XML: 'application/xml; charset=utf-8', ICAL: 'text/calendar; charset=utf-8',
  RSS: 'application/rss+xml; charset=utf-8', ATOM: 'application/atom+xml; charset=utf-8',
  VCARD: 'text/vcard; charset=utf-8', HTML: 'text/html; charset=utf-8'
};

class NeedData extends Error {
  constructor(what) { super('gg engine needs ' + what); this.name = 'NeedData'; }
}

/* ======================================================================
   COMPILING
   ====================================================================== */

const GLOBALS = ['SpreadsheetApp', 'PropertiesService', 'LockService', 'CacheService',
  'UrlFetchApp', 'ContentService', 'Utilities', 'Session', 'ScriptApp', 'Logger',
  'Date', 'Math'];

/* The source becomes the body of one function, so every top-level var and
   function is local to a single run: like an Apps Script execution, each
   request starts from a clean slate. The trailer hands back a lookup for
   entry points (doGet, doPost, trigger functions) by name. */
export function compileBackend(source) {
  const trailer = '\n;return function (name) {\n' +
    '  if (!/^[A-Za-z_$][\\w$]*$/.test(name)) return undefined;\n' +
    '  try { return eval(name); } catch (e) { return undefined; }\n};';
  return new Function(...GLOBALS, String(source) + trailer);
}

/* ======================================================================
   CELLS
   ====================================================================== */

function isDate(v) { return Object.prototype.toString.call(v) === '[object Date]'; }
function isEmpty(v) { return v === '' || v === null || v === undefined; }

/* Postgres refuses a NUL, or half of a surrogate pair, inside JSON text */
export function storable(s) {
  if (!/[\u0000\ud800-\udfff]/.test(s)) return s;
  return s.replace(/\u0000/g, '').replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '�');
}
/* working value -> stored JSON. Dates are tagged so they come back as Dates. */
export function encodeCell(v) {
  if (isDate(v)) { const t = v.getTime(); return isNaN(t) ? '' : { $d: new Date(t).toISOString() }; }
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return storable(v);
  return v;
}
/* stored JSON -> working value */
export function decodeCell(v, D) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (typeof v.$d === 'string') return new D(Date.parse(v.$d));
    return String(v);
  }
  return v;
}
function encodeRow(cells) {
  let n = cells.length;
  while (n > 0 && isEmpty(cells[n - 1])) n--;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = encodeCell(cells[i]);
  return out;
}
/* what Sheets would hold after the code writes v */
function toCell(v, D) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    if (v.length > CELL_LIMIT) throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.');
    return v;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : '#NUM!';
  if (typeof v === 'boolean') return v;
  if (isDate(v)) { const t = v.getTime(); return isNaN(t) ? '' : new D(t); }
  return String(v);
}
/* reads hand out copies, so code that mutates a Date it read can't reach the store */
function copyOut(v, D) { return isDate(v) ? new D(v.getTime()) : v; }

function int(v, what) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error('Invalid ' + what + ': ' + v);
  return n;
}

/* ======================================================================
   SPREADSHEET  (working copy for one run)
   ====================================================================== */

class Row {
  constructor(id, cells, isNew) {
    this.id = id; this.cells = cells; this.own = isNew; this.isNew = isNew;
    this.dirty = null; this.full = false;
  }
  mutable() { if (!this.own) { this.cells = this.cells.slice(); this.own = true; } return this.cells; }
  lastFilled() {
    for (let i = this.cells.length - 1; i >= 0; i--) if (!isEmpty(this.cells[i])) return i + 1;
    return 0;
  }
}

/* A sheet the code only ever appended to was never LOOKED at: its rows
   can't have shaped any decision, and an append lands after whatever is
   there by then. Such a sheet is left out of the commit's read check, so
   twenty people sending DMs at once don't queue behind each other. Anything
   that reads contents, sizes or positions marks the sheet observed. */
class Sheet {
  constructor(book, name, base) {
    this._book = book; this._name = name;
    this._rows = base.rows.map(r => new Row(r.id, r.cells, false));
    this._deleted = [];
    this._changed = false;
    this._observed = false;
  }
  getName() { return this._name; }
  getSheetName() { return this._name; }
  getParent() { return this._book.spreadsheet; }
  _lastRow() {
    for (let i = this._rows.length - 1; i >= 0; i--) if (this._rows[i].lastFilled()) return i + 1;
    return 0;
  }
  _lastColumn() { let m = 0; for (const r of this._rows) m = Math.max(m, r.lastFilled()); return m; }
  getLastRow() { this._observed = true; return this._lastRow(); }
  getLastColumn() { this._observed = true; return this._lastColumn(); }
  getMaxRows() { this._observed = true; return Math.max(1000, this._rows.length); }
  getMaxColumns() { this._observed = true; return Math.max(26, this._lastColumn()); }
  getDataRange() {
    this._observed = true;
    return new Range(this, 1, 1, Math.max(1, this._lastRow()), Math.max(1, this._lastColumn()));
  }
  getRange(row, col, numRows, numCols) {
    this._observed = true;
    if (typeof row === 'string') throw new Error('A1 notation is not supported by the Supabase engine (' + row + ').');
    const r = int(row, 'row'), c = int(col === undefined ? 1 : col, 'column');
    const nr = numRows === undefined ? 1 : int(numRows, 'number of rows');
    const nc = numCols === undefined ? 1 : int(numCols, 'number of columns');
    if (r < 1) throw new Error('The starting row of the range is too small.');
    if (c < 1) throw new Error('The starting column of the range is too small.');
    if (nr < 1) throw new Error('The number of rows in the range must be at least 1.');
    if (nc < 1) throw new Error('The number of columns in the range must be at least 1.');
    return new Range(this, r, c, nr, nc);
  }
  /* Sheets appends after the last row WITH CONTENT, reusing an emptied row */
  appendRow(values) {
    if (!Array.isArray(values)) throw new Error('The parameters don’t match the method signature for SpreadsheetApp.Sheet.appendRow.');
    const D = this._book.D;
    const cells = values.map(v => toCell(v, D));
    const at = this._lastRow();
    if (at < this._rows.length) {
      const row = this._rows[at];          // an emptied row: where it is depends on the contents
      row.cells = cells; row.own = true;
      if (!row.isNew) { row.full = true; this._observed = true; }
    } else {
      this._rows.push(new Row(null, cells, true));
    }
    this._changed = true;
    return this;
  }
  deleteRow(r) { return this.deleteRows(r, 1); }
  deleteRows(r, n) {
    r = int(r, 'row'); n = int(n === undefined ? 1 : n, 'number of rows');
    if (r < 1 || n < 1) throw new Error('Those rows are out of bounds.');
    this._observed = true;
    for (const row of this._rows.splice(r - 1, n)) if (!row.isNew) this._deleted.push(row.id);
    this._changed = true;
    return this;
  }
  insertColumnBefore(c) { return this.insertColumnsBefore(c, 1); }
  insertColumnsBefore(c, n) {
    c = int(c, 'column'); n = int(n === undefined ? 1 : n, 'number of columns');
    if (c < 1 || n < 1) throw new Error('Those columns are out of bounds.');
    this._observed = true;
    for (const row of this._rows) {
      if (row.cells.length < c) continue;               // nothing to shift
      row.mutable().splice(c - 1, 0, ...new Array(n).fill(''));
      if (!row.isNew) row.full = true;
    }
    this._changed = true;
    return this;
  }
  // formatting has no meaning off Sheets: accept and ignore
  setFrozenRows() { return this; }
  setFrozenColumns() { return this; }
  autoResizeColumn() { return this; }
  autoResizeColumns() { return this; }
  setColumnWidth() { return this; }
  hideSheet() { return this; }
  showSheet() { return this; }
  activate() { return this; }

  _read(i, j) {
    const row = this._rows[i];
    if (!row) return '';
    const v = row.cells[j];
    return v === undefined ? '' : v;
  }
  _write(i, j, v) {
    while (this._rows.length <= i) this._rows.push(new Row(null, [], true));
    const row = this._rows[i];
    const cells = row.mutable();
    while (cells.length < j) cells.push('');
    cells[j] = v;
    if (!row.isNew && !row.full) (row.dirty || (row.dirty = new Set())).add(j);
    this._changed = true;
  }
  _ops() {
    const ops = [], name = this._name;
    for (const id of this._deleted) ops.push({ op: 'del', sheet: name, id });
    for (const row of this._rows) {
      if (row.isNew) continue;
      if (row.full) ops.push({ op: 'put', sheet: name, id: row.id, cells: encodeRow(row.cells) });
      else if (row.dirty) {
        const cells = {};
        for (const j of row.dirty) cells[j] = encodeCell(row.cells[j]);
        ops.push({ op: 'set', sheet: name, id: row.id, cells });
      }
    }
    for (const row of this._rows) if (row.isNew) ops.push({ op: 'ins', sheet: name, cells: encodeRow(row.cells) });
    return ops;
  }
}

class Range {
  constructor(sh, r, c, nr, nc) { this._sh = sh; this._r = r; this._c = c; this._nr = nr; this._nc = nc; }
  getRow() { return this._r; }
  getColumn() { return this._c; }
  getNumRows() { return this._nr; }
  getNumColumns() { return this._nc; }
  getLastRow() { return this._r + this._nr - 1; }
  getLastColumn() { return this._c + this._nc - 1; }
  getSheet() { return this._sh; }
  getValues() {
    const D = this._sh._book.D, out = new Array(this._nr);
    for (let i = 0; i < this._nr; i++) {
      const row = new Array(this._nc);
      for (let j = 0; j < this._nc; j++) row[j] = copyOut(this._sh._read(this._r - 1 + i, this._c - 1 + j), D);
      out[i] = row;
    }
    return out;
  }
  getValue() { return copyOut(this._sh._read(this._r - 1, this._c - 1), this._sh._book.D); }
  getDisplayValues() { return this.getValues().map(r => r.map(v => String(v))); }
  getDisplayValue() { return String(this.getValue()); }
  setValues(values) {
    if (!Array.isArray(values)) throw new Error('The parameters don’t match the method signature for SpreadsheetApp.Range.setValues.');
    if (values.length !== this._nr) {
      throw new Error('The number of rows in the data does not match the number of rows in the range. The data has ' +
        values.length + ' but the range has ' + this._nr + '.');
    }
    for (const row of values) {
      const n = Array.isArray(row) ? row.length : 0;
      if (n !== this._nc) {
        throw new Error('The number of columns in the data does not match the number of columns in the range. The data has ' +
          n + ' but the range has ' + this._nc + '.');
      }
    }
    const D = this._sh._book.D;
    const conv = values.map(row => row.map(v => toCell(v, D)));   // all or nothing, like Sheets
    for (let i = 0; i < this._nr; i++)
      for (let j = 0; j < this._nc; j++) this._sh._write(this._r - 1 + i, this._c - 1 + j, conv[i][j]);
    return this;
  }
  setValue(v) {
    const cell = toCell(v, this._sh._book.D);
    for (let i = 0; i < this._nr; i++)
      for (let j = 0; j < this._nc; j++) this._sh._write(this._r - 1 + i, this._c - 1 + j, cell);
    return this;
  }
  clearContent() { return this.setValue(''); }
  setNumberFormat() { return this; }
  setNumberFormats() { return this; }
  setFontWeight() { return this; }
  setFontWeights() { return this; }
  setBackground() { return this; }
  setHorizontalAlignment() { return this; }
  setWrap() { return this; }
}

class Book {
  constructor(snap, run, D) {
    this.snap = snap; this.run = run; this.D = D;
    this.open = new Map(); this.created = [];
    const book = this;
    this.spreadsheet = {
      getSheetByName(n) { return book.sheet(n); },
      insertSheet(n) { return book.insertSheet(n); },
      getName() { return 'Sumo Slap Down'; },
      getId() { return 'supabase'; },
      getSpreadsheetTimeZone() { return run.tz; },
      getSheets() { throw new Error('getSheets() is not supported by the Supabase engine.'); }
    };
  }
  sheet(name) {
    name = String(name);
    if (this.open.has(name)) return this.open.get(name);
    if (!this.snap.sheets.has(name)) { this.run.needSheets.add(name); throw new NeedData('sheet "' + name + '"'); }
    this.run.read.add(name);
    const base = this.snap.sheets.get(name);
    const sh = base ? new Sheet(this, name, base) : null;
    this.open.set(name, sh);
    return sh;
  }
  insertSheet(name) {
    name = String(name);
    if (this.sheet(name)) throw new Error('A sheet with the name "' + name + '" already exists. Please enter another name.');
    const sh = new Sheet(this, name, { rows: [] });
    sh._changed = true;
    this.open.set(name, sh);
    this.created.push(name);
    return sh;
  }
  ops() {
    const ops = [];
    for (const name of this.created) ops.push({ op: 'sheet', sheet: name });
    for (const sh of this.open.values()) if (sh && sh._changed) ops.push(...sh._ops());
    return ops;
  }
  /* the version of every sheet this run looked at; null = it did not exist.
     A sheet it only appended to is left out (see Sheet). */
  check() {
    const out = {};
    for (const name of this.run.read) {
      const base = this.snap.sheets.get(name);
      if (!base) { out[name] = null; continue; }
      const sh = this.open.get(name);
      if (sh && !sh._observed) continue;
      out[name] = base.v;
    }
    return out;
  }
}

/* ======================================================================
   THE OTHER SERVICES
   ====================================================================== */

function isInternal(k) { return k.slice(0, 2) === '__'; }

function makeProperties(run) {
  const own = (k) => Object.prototype.hasOwnProperty.call(run.props, k);
  const store = {
    getProperty(k) { k = String(k); return !isInternal(k) && own(k) ? run.props[k] : null; },
    setProperty(k, v) {
      k = String(k);
      if (isInternal(k)) throw new Error('Property names starting with __ are reserved.');
      run.props[k] = String(v); run.propSet[k] = String(v); delete run.propDel[k];
      return store;
    },
    deleteProperty(k) {
      k = String(k);
      if (isInternal(k)) return store;
      delete run.props[k]; delete run.propSet[k]; run.propDel[k] = true;
      return store;
    },
    getProperties() {
      const o = {};
      for (const k of Object.keys(run.props)) if (!isInternal(k)) o[k] = run.props[k];
      return o;
    },
    setProperties(obj, deleteAllOthers) {
      if (deleteAllOthers) for (const k of Object.keys(store.getProperties())) if (!(k in obj)) store.deleteProperty(k);
      for (const k of Object.keys(obj || {})) store.setProperty(k, obj[k]);
      return store;
    },
    getKeys() { return Object.keys(store.getProperties()); },
    deleteAllProperties() { for (const k of store.getKeys()) store.deleteProperty(k); return store; }
  };
  return { getScriptProperties: () => store, getDocumentProperties: () => store, getUserProperties: () => store };
}

function makeCache(run) {
  const ttlOf = (t) => (t === undefined ? 600 : Math.max(1, Math.min(21600, Math.floor(Number(t) || 600))));
  const cache = {
    get(k) {
      k = String(k);
      if (NEVER_CACHED.test(k)) return null;
      const e = run.cache[k];
      return e && e[1] > run.now ? e[0] : null;
    },
    getAll(keys) {
      const o = {};
      for (const k of keys || []) { const v = cache.get(k); if (v !== null) o[k] = v; }
      return o;
    },
    put(k, v, ttl) {
      k = String(k);
      if (NEVER_CACHED.test(k)) return;
      const s = ttlOf(ttl);
      run.cache[k] = [String(v), run.now + s * 1000];
      run.cachePut[k] = [String(v), s]; delete run.cacheDel[k];
    },
    putAll(obj, ttl) { for (const k of Object.keys(obj || {})) cache.put(k, obj[k], ttl); },
    remove(k) { k = String(k); delete run.cache[k]; delete run.cachePut[k]; run.cacheDel[k] = true; },
    removeAll(keys) { for (const k of keys || []) cache.remove(k); }
  };
  return { getScriptCache: () => cache, getDocumentCache: () => cache, getUserCache: () => cache };
}

function makeLocks(run) {
  const lock = {
    waitLock() { run.locked = true; },
    tryLock() { run.locked = true; return true; },
    releaseLock() {},
    hasLock() { return run.locked; }
  };
  return { getScriptLock: () => lock, getDocumentLock: () => lock, getUserLock: () => lock };
}

class HTTPResponse {
  constructor(r) { this._r = r; }
  getResponseCode() { return this._r.status; }
  getContentText() { return this._r.text; }
  getHeaders() { return Object.assign({}, this._r.headers); }
  getAllHeaders() { return Object.assign({}, this._r.headers); }
  getContent() { return Array.from(new TextEncoder().encode(this._r.text)); }
}

function fetchRequest(url, p) {
  p = p || {};
  const method = String(p.method || 'get').toUpperCase();
  const headers = Object.assign({}, p.headers || {});
  let body = p.payload, ctype = p.contentType;
  if (body !== undefined && body !== null && typeof body === 'object') {
    body = Object.keys(body).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(body[k])).join('&');
    ctype = ctype || 'application/x-www-form-urlencoded';
  }
  if (ctype) headers['Content-Type'] = ctype;
  return {
    url: String(url), method, headers,
    body: body === undefined || body === null ? undefined : String(body),
    mute: !!p.muteHttpExceptions, follow: p.followRedirects !== false
  };
}
const fetchKey = (q) => q.method + ' ' + q.url + '\n' + (q.body || '');

function makeUrlFetch(run, fetched) {
  function answer(q) {
    const k = fetchKey(q);
    if (!fetched.has(k)) { run.needFetch.set(k, q); throw new NeedData('fetch ' + q.url); }
    const r = fetched.get(k);
    if (r.error) throw new Error(r.error);
    if (!q.mute && r.status >= 400) {
      throw new Error('Request failed for ' + q.url + ' returned code ' + r.status +
        '. Truncated server response: ' + r.text.slice(0, 200) + ' (use muteHttpExceptions option to examine full response)');
    }
    return new HTTPResponse(r);
  }
  return {
    fetch(url, params) { return answer(fetchRequest(url, params)); },
    fetchAll(requests) {
      const qs = (requests || []).map(rq => (typeof rq === 'string' ? fetchRequest(rq, {}) : fetchRequest(rq.url, rq)));
      const missing = qs.filter(q => !fetched.has(fetchKey(q)));
      if (missing.length) { for (const q of missing) run.needFetch.set(fetchKey(q), q); throw new NeedData('fetchAll'); }
      return qs.map(answer);
    }
  };
}

class TextOutput {
  constructor(t) { this._t = t === undefined || t === null ? '' : String(t); this._m = 'TEXT'; }
  getContent() { return this._t; }
  setContent(t) { this._t = String(t); return this; }
  append(t) { this._t += String(t); return this; }
  setMimeType(m) { this._m = m; return this; }
  getMimeType() { return this._m; }
  downloadAsFile() { return this; }
}
const CONTENT_SERVICE = {
  createTextOutput: (t) => new TextOutput(t),
  MimeType: { JSON: 'JSON', TEXT: 'TEXT', JAVASCRIPT: 'JAVASCRIPT', CSV: 'CSV', XML: 'XML', ICAL: 'ICAL', RSS: 'RSS', ATOM: 'ATOM', VCARD: 'VCARD' }
};

/* ---------- dates and time zones ---------- */

const fmtCache = new Map();
function dtf(tz, opts) {
  const k = tz + JSON.stringify(opts);
  let f = fmtCache.get(k);
  if (!f) { f = new Intl.DateTimeFormat('en-US', Object.assign({ timeZone: tz }, opts)); fmtCache.set(k, f); }
  return f;
}
/* Java's TimeZone.getTimeZone() quietly answers GMT for a zone it doesn't know */
export function zoneOrUtc(tz) {
  try { dtf(String(tz), {}); return String(tz); } catch (e) { return 'UTC'; }
}
function zoned(t, tz) {
  const p = {};
  for (const x of dtf(tz, { hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric',
    minute: 'numeric', second: 'numeric', weekday: 'long' }).formatToParts(new Date(t))) p[x.type] = x.value;
  const y = +p.year, mo = +p.month, d = +p.day, h = (+p.hour) % 24, mi = +p.minute, s = +p.second;
  const ms = ((t % 1000) + 1000) % 1000;
  const off = Math.round((Date.UTC(y, mo - 1, d, h, mi, s) - (t - ms)) / 60000);
  return { y, mo, d, h, mi, s, ms, wd: p.weekday, off };
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n, w) => String(Math.abs(n)).padStart(w || 2, '0');
function zoneName(t, tz, style) {
  const p = dtf(tz, { timeZoneName: style }).formatToParts(new Date(t)).find(x => x.type === 'timeZoneName');
  return p ? p.value : tz;
}
function offsetText(off, colon) {
  const a = Math.abs(off);
  return (off < 0 ? '-' : '+') + pad(Math.floor(a / 60)) + (colon ? ':' : '') + pad(a % 60);
}

/* java.text.SimpleDateFormat, the parts of it anyone uses */
export function formatDate(date, tz, pattern) {
  const t = date.getTime();
  if (isNaN(t)) throw new Error('Invalid argument: date');
  tz = zoneOrUtc(tz);
  const z = zoned(t, tz);
  return String(pattern).replace(/'[^']*'|y+|M+|d+|H+|h+|k+|K+|m+|s+|S+|a+|E+|u+|z+|Z+|X+/g, (tok) => {
    const n = tok.length;
    switch (tok[0]) {
      case "'": return tok === "''" ? "'" : tok.slice(1, -1);
      case 'y': return n === 2 ? pad(z.y % 100) : pad(z.y, n);
      case 'M': return n >= 4 ? MONTHS[z.mo - 1] : n === 3 ? MONTHS[z.mo - 1].slice(0, 3) : pad(z.mo, n);
      case 'd': return pad(z.d, n);
      case 'H': return pad(z.h, n);
      case 'k': return pad(z.h === 0 ? 24 : z.h, n);
      case 'K': return pad(z.h % 12, n);
      case 'h': return pad(z.h % 12 === 0 ? 12 : z.h % 12, n);
      case 'm': return pad(z.mi, n);
      case 's': return pad(z.s, n);
      case 'S': return pad(z.ms, 3).slice(0, Math.max(n, 3)).padEnd(n, '0');
      case 'a': return z.h < 12 ? 'AM' : 'PM';
      case 'E': return n >= 4 ? z.wd : z.wd.slice(0, 3);
      case 'u': return String(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(z.wd) + 1);
      case 'z': return n >= 4 ? zoneName(t, tz, 'long') : zoneName(t, tz, 'short');
      case 'Z': return offsetText(z.off, false);
      case 'X': return z.off === 0 ? 'Z' : n === 1 ? offsetText(z.off, false).slice(0, 3) : offsetText(z.off, n >= 3);
      default: return tok;
    }
  });
}

/* V8's Date.prototype.toString() as it reads in the script's time zone:
   "Thu Oct 22 2026 05:09:30 GMT-0700 (Pacific Daylight Time)". Apps Script
   prints dates in the project's zone; this runtime runs in UTC. */
function v8DateString(d, tz) {
  const t = d.getTime();
  if (isNaN(t)) return 'Invalid Date';
  const z = zoned(t, tz);
  return z.wd.slice(0, 3) + ' ' + MONTHS[z.mo - 1].slice(0, 3) + ' ' + pad(z.d) + ' ' + pad(z.y, 4) + ' ' +
    pad(z.h) + ':' + pad(z.mi) + ':' + pad(z.s) + ' GMT' + offsetText(z.off, false) + ' (' + zoneName(t, tz, 'long') + ')';
}

const dateClasses = new Map();
/* the Date the backend sees: a real Date that prints in the script's zone */
export function dateClassFor(tz, Base) {
  Base = Base || Date;
  tz = zoneOrUtc(tz || 'UTC');
  let byBase = dateClasses.get(Base);
  if (!byBase) { byBase = new Map(); dateClasses.set(Base, byBase); }
  let D = byBase.get(tz);
  if (!D) {
    D = class extends Base { toString() { return v8DateString(this, tz); } };
    byBase.set(tz, D);
  }
  return D;
}

function makeUtilities(run) {
  const b64 = {
    enc(s) { const bytes = typeof s === 'string' ? new TextEncoder().encode(s) : Uint8Array.from(s, x => x & 255); let bin = ''; for (const x of bytes) bin += String.fromCharCode(x); return btoa(bin); },
    dec(s) { return Array.from(atob(String(s)), c => { const x = c.charCodeAt(0); return x > 127 ? x - 256 : x; }); }
  };
  return {
    formatDate: (d, tz, p) => formatDate(d, tz, p),
    getUuid: () => crypto.randomUUID(),
    sleep: () => {},                       // nothing to wait for: every read is fresh
    base64Encode: b64.enc,
    base64EncodeWebSafe: (s) => b64.enc(s).replace(/\+/g, '-').replace(/\//g, '_'),
    base64Decode: b64.dec,
    newBlob() { throw new Error('Utilities.newBlob is not supported by the Supabase engine.'); },
    computeDigest() { throw new Error('Utilities.computeDigest is not supported by the Supabase engine.'); },
    DigestAlgorithm: { MD5: 'MD5', SHA_1: 'SHA_1', SHA_256: 'SHA_256', SHA_512: 'SHA_512' },
    Charset: { UTF_8: 'UTF_8', US_ASCII: 'US_ASCII' }
  };
}

function services(book, run, fetched, deps) {
  const log = (...a) => { (deps.log || console.log)('[gs]', ...a); return logger; };
  const logger = { log, getLog: () => '', clear: () => logger };
  return {
    SpreadsheetApp: { getActiveSpreadsheet: () => book.spreadsheet, getActive: () => book.spreadsheet, flush() {} },
    PropertiesService: makeProperties(run),
    LockService: makeLocks(run),
    CacheService: makeCache(run),
    UrlFetchApp: makeUrlFetch(run, fetched),
    ContentService: CONTENT_SERVICE,
    Utilities: makeUtilities(run),
    Session: {
      getScriptTimeZone: () => run.tz,
      getActiveUser: () => ({ getEmail: () => '' }),
      getEffectiveUser: () => ({ getEmail: () => '' }),
      getActiveUserLocale: () => 'en',
      getTemporaryActiveUserKey: () => ''
    },
    ScriptApp: {
      getService: () => ({ getUrl: () => deps.selfUrl || '' }),
      getScriptId: () => 'supabase',
      getProjectTriggers: () => [],
      deleteTrigger() {},
      newTrigger() { throw new Error('Triggers are pg_cron jobs now: see supabase/migrations.'); }
    },
    Logger: logger
  };
}

/* ======================================================================
   RUNNING A REQUEST
   ====================================================================== */

function newSnapshot() { return { sheets: new Map(), props: null, cache: null, now: 0, D: null, tz: 'UTC' }; }

function decodeSheet(raw, D) {
  if (!raw) return null;
  return {
    v: raw.v,
    rows: (raw.rows || []).map(([id, cells]) => ({ id, cells: (cells || []).map(c => decodeCell(c, D)) }))
  };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/*  createEngine({ source, store, fetch, selfUrl, log, baseDate, math, beforeRun, now })
      store: { load(sheets[], withMeta) -> {sheets, props, cache, now}, commit(body) -> {ok}|{ok:false,conflict} }
    engine.execute(spec) -> { status, mime, text, committed, attempts, runs }
      spec: { kind: 'get'|'post'|'fn', e, fn, args, key } */
export function createEngine(opts) {
  const factory = compileBackend(opts.source);
  const store = opts.store;
  const fetchImpl = opts.fetch || ((...a) => globalThis.fetch(...a));
  const learned = new Map();   // action key -> sheets it used last time
  for (const [k, sheets] of Object.entries(opts.seed || {})) learned.set(k, new Set(sheets));

  /* Every load is the whole set at once, one statement in the store, so a
     run never sees one sheet from before somebody's write and another from
     after it. (Topping up piecemeal did exactly that, and the draft room's
     own guard caught it: "The board just moved".) */
  async function snapshot(names) {
    const list = [...names];
    const res = await store.load(list, true);
    const snap = newSnapshot();
    snap.props = res.props || {};
    snap.cache = res.cache || {};
    snap.now = Number(res.now) || Date.now();
    snap.tz = zoneOrUtc(snap.props.__GG_TZ || opts.tz || 'UTC');
    snap.D = dateClassFor(snap.tz, opts.baseDate);
    for (const n of list) snap.sheets.set(n, decodeSheet(res.sheets ? res.sheets[n] : null, snap.D));
    return snap;
  }

  async function doFetches(need, fetched) {
    await Promise.all([...need].map(async ([k, q]) => {
      try {
        const res = await fetchImpl(q.url, {
          method: q.method, headers: q.headers,
          body: q.method === 'GET' || q.method === 'HEAD' ? undefined : q.body,
          redirect: q.follow ? 'follow' : 'manual',
          signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined
        });
        const text = await res.text();
        const headers = {};
        res.headers.forEach((v, h) => { headers[h] = v; });
        fetched.set(k, { status: res.status, text, headers });
      } catch (err) {
        fetched.set(k, { error: 'Exception: ' + ((err && err.message) || String(err)) + ' (url: ' + q.url + ')' });
      }
    }));
  }

  function runOnce(spec, snap, fetched) {
    const run = {
      needSheets: new Set(), needFetch: new Map(), read: new Set(), locked: false,
      props: Object.assign({}, snap.props), propSet: {}, propDel: {},
      cache: Object.assign({}, snap.cache), cachePut: {}, cacheDel: {},
      now: snap.now, tz: snap.tz
    };
    const book = new Book(snap, run, snap.D);
    const svc = services(book, run, fetched, opts);
    if (opts.beforeRun) opts.beforeRun(spec);
    try {
      const entry = factory(svc.SpreadsheetApp, svc.PropertiesService, svc.LockService, svc.CacheService,
        svc.UrlFetchApp, svc.ContentService, svc.Utilities, svc.Session, svc.ScriptApp, svc.Logger,
        snap.D, opts.math || Math);
      const name = spec.kind === 'get' ? 'doGet' : spec.kind === 'post' ? 'doPost' : spec.fn;
      const fn = entry(name);
      if (typeof fn !== 'function') throw new Error('Script function not found: ' + name);
      run.out = spec.kind === 'fn' ? fn.apply(null, spec.args || []) : fn(spec.e);
    } catch (err) {
      run.err = err;
    }
    run.book = book;
    return run;
  }

  function commitBody(run) {
    const ops = run.book.ops();
    const propKeys = Object.keys(run.propSet).length + Object.keys(run.propDel).length;
    const cacheKeys = Object.keys(run.cachePut).length + Object.keys(run.cacheDel).length;
    if (!ops.length && !propKeys && !cacheKeys) return null;
    return {
      check: run.locked && ops.length ? run.book.check() : null,
      ops,
      props: propKeys ? { set: run.propSet, del: Object.keys(run.propDel) } : null,
      cache: cacheKeys ? { put: Object.entries(run.cachePut).map(([k, [v, s]]) => [k, v, s]), del: Object.keys(run.cacheDel) } : null
    };
  }

  function reply(spec, run) {
    if (run.err) {
      return { status: 500, mime: MIME.JSON,
        text: JSON.stringify({ ok: false, error: String((run.err && run.err.message) || run.err) }) };
    }
    if (spec.kind === 'fn') {
      let result = null;
      try { result = JSON.parse(JSON.stringify(run.out === undefined ? null : run.out)); } catch (e) { result = String(run.out); }
      return { status: 200, mime: MIME.JSON, text: JSON.stringify({ ok: true, result }) };
    }
    if (run.out instanceof TextOutput) return { status: 200, mime: MIME[run.out.getMimeType()] || MIME.TEXT, text: run.out.getContent() };
    return { status: 200, mime: MIME.HTML, text: 'The script completed but did not return anything.' };
  }

  async function execute(spec) {
    const key = spec.key || spec.kind;
    const fetched = new Map();
    const names = new Set(learned.get(key) || []);
    let snap = await snapshot(names);
    let runs = 0;
    for (let attempt = 1; ; attempt++) {
      let run;
      for (;;) {
        if (++runs > MAX_RUNS * attempt) throw new Error('gg engine: "' + key + '" kept asking for more data');
        run = runOnce(spec, snap, fetched);
        if (!run.needSheets.size && !run.needFetch.size) break;
        for (const n of run.needSheets) names.add(n);
        const [fresh] = await Promise.all([
          run.needSheets.size ? snapshot(names) : null,
          run.needFetch.size ? doFetches(run.needFetch, fetched) : null
        ]);
        if (fresh) snap = fresh;
      }
      const prev = learned.get(key);
      learned.set(key, prev ? new Set([...prev, ...run.read]) : new Set(run.read));

      const body = commitBody(run);
      if (!body) return Object.assign(reply(spec, run), { committed: false, attempts: attempt, runs });
      /* Maintenance pauses changes to the data. Cache-only writes (draft-room
         presence) still go through, so open rooms keep reading normally. */
      if (snap.props.__MAINTENANCE === '1' && !spec.allowDuringMaintenance && (body.ops.length || body.props)) {
        return { status: 503, mime: MIME.JSON, committed: false, attempts: attempt, runs, maintenance: true,
          text: JSON.stringify({ ok: false, maintenance: true,
            error: 'Sumo Slap Down is moving to a faster server. Changes are paused for a few minutes — please try again shortly.' }) };
      }
      const res = await store.commit(body);
      if (res && res.ok) return Object.assign(reply(spec, run), { committed: true, attempts: attempt, runs });
      if (!(res && res.conflict)) throw new Error('commit refused: ' + JSON.stringify(res));
      if (attempt >= MAX_ATTEMPTS) {
        return { status: 503, mime: MIME.JSON, committed: false, attempts: attempt, runs,
          text: JSON.stringify({ ok: false, busy: true, error: 'The server is busy — please try again in a moment.' }) };
      }
      // somebody else's write landed first: back off, then start over on fresh data
      for (const n of run.read) names.add(n);
      await sleep(Math.floor(Math.random() * Math.min(400, 10 * 2 ** attempt)));
      snap = await snapshot(names);
    }
  }

  return { execute, learned };
}
