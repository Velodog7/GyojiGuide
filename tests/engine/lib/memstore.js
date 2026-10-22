/* An in-memory stand-in for the sheet store in supabase/migrations, with
   the same rules as gg_load / gg_commit / gg_import_*: per-sheet versions,
   per-sheet locks taken in name order, the read-set check, atomic apply.
   `delay` (a function returning ms) makes every call yield, so concurrent
   requests genuinely interleave. sql.js runs the same scenarios against the
   real SQL to keep the two honest. */
'use strict';

function clone(x) { return JSON.parse(JSON.stringify(x)); }

function createMemStore(opts) {
  opts = opts || {};
  const clock = opts.clock || (() => Date.now());
  const delay = opts.delay || null;
  const sheets = new Map();          // name -> { version, rows: [{ id, pos, cells }] }
  const props = new Map(Object.entries(opts.props || { __CRON_KEY: 'cron-test-key' }));
  const cache = new Map();           // key -> [value, expiresMs]
  const stage = { sheets: new Set(), rows: new Map() };
  let pos = 0, nextId = 1;
  const stats = { loads: 0, commits: 0, conflicts: 0 };

  const pause = async () => { if (delay) await new Promise(r => setTimeout(r, delay())); };

  // async mutex per sheet name
  const tails = new Map();
  function acquire(name) {
    const prev = tails.get(name) || Promise.resolve();
    let release;
    const mine = new Promise(r => { release = r; });
    tails.set(name, prev.then(() => mine));
    return prev.then(() => release);
  }
  async function acquireAll(names) {
    const rels = [];
    for (const n of names) rels.push(await acquire(n));
    return () => { for (const r of rels.reverse()) r(); };
  }

  async function load(names, withMeta) {
    stats.loads++;
    await pause();
    const out = { sheets: {}, now: clock() };
    for (const n of new Set(names || [])) {
      const s = sheets.get(n);
      out.sheets[n] = s ? { v: s.version, rows: s.rows.map(r => [r.id, r.cells]) } : null;
    }
    if (withMeta) {
      out.props = Object.fromEntries(props);
      out.cache = {};
      for (const [k, e] of cache) if (e[1] > clock()) out.cache[k] = e;
    } else {
      out.props = null; out.cache = null;
    }
    const wire = clone(out);   // as if it crossed the network
    await pause();
    return wire;
  }

  async function commit(p) {
    stats.commits++;
    p = clone(p);
    await pause();
    const ops = p.ops || [];
    const names = [...new Set([...Object.keys(p.check || {}), ...ops.map(o => o.sheet).filter(Boolean)])].sort();
    const release = await acquireAll(names);
    try {
      await pause();
      if (p.check) {
        for (const [n, want] of Object.entries(p.check)) {
          const s = sheets.get(n);
          const have = s ? s.version : null;
          if (want === null ? have !== null : have !== want) { stats.conflicts++; return { ok: false, conflict: true, sheet: n }; }
        }
      }
      // apply to copies of the locked sheets, then swap them in: all or nothing
      const work = new Map();
      const get = (n) => {
        if (!work.has(n)) { const s = sheets.get(n); work.set(n, s ? { version: s.version, rows: s.rows.map(r => Object.assign({}, r)) } : undefined); }
        return work.get(n);
      };
      const written = new Set();
      let seq = pos, ids = nextId;
      for (const op of ops) {
        const n = op.sheet;
        if (op.op === 'sheet') { if (!get(n)) work.set(n, { version: 1, rows: [] }); written.add(n); continue; }
        const s = get(n);
        if (!s) throw new Error('memstore: ' + op.op + ' on missing sheet ' + n + ' (FK violation)');
        if (op.op === 'ins') s.rows.push({ id: ids++, pos: ++seq, cells: op.cells || [] });
        else if (op.op === 'put') { const r = s.rows.find(x => x.id === op.id); if (r) r.cells = op.cells || []; }
        else if (op.op === 'set') {
          const r = s.rows.find(x => x.id === op.id);
          if (r) {
            const cells = r.cells.slice();
            for (const [k, v] of Object.entries(op.cells || {})) { const i = Number(k); while (cells.length < i) cells.push(''); cells[i] = v; }
            r.cells = cells;
          }
        } else if (op.op === 'del') s.rows = s.rows.filter(x => x.id !== op.id);
        else throw new Error('memstore: unknown op ' + op.op);
        written.add(n);
      }
      for (const n of written) { const s = work.get(n); s.version += 1; }
      for (const [n, s] of work) if (s) sheets.set(n, s);
      pos = seq; nextId = ids;
      if (p.props) {
        for (const [k, v] of Object.entries(p.props.set || {})) props.set(k, String(v));
        for (const k of p.props.del || []) props.delete(k);
      }
      if (p.cache) {
        for (const [k, v, ttl] of p.cache.put || []) cache.set(k, [String(v), clock() + Math.max(1, Math.min(21600, ttl || 600)) * 1000]);
        for (const k of p.cache.del || []) cache.delete(k);
      }
      return { ok: true };
    } finally {
      release();
    }
  }

  async function importBegin() { stage.sheets.clear(); stage.rows.clear(); return { ok: true }; }
  async function importRows(sheet, start, rows) {
    if (!sheet) throw new Error('memstore: a sheet name is required');
    stage.sheets.add(sheet);
    rows.forEach((cells, i) => stage.rows.set(sheet + '\u0000' + (start + i), { sheet, idx: start + i, cells: clone(cells) }));
    return { ok: true, rows: rows.length };
  }
  async function importFinish(expected, newProps, meta) {
    for (const [n, want] of Object.entries(expected)) {
      if (!stage.sheets.has(n)) throw new Error('import incomplete: sheet ' + n + ' never arrived');
      const have = [...stage.rows.values()].filter(r => r.sheet === n);
      if (have.length !== want || have.some(r => r.idx < 1 || r.idx > want)) throw new Error('import incomplete: ' + n);
    }
    for (const n of stage.sheets) if (!(n in expected)) throw new Error('import has a sheet the export did not list');
    const release = await acquireAll([...new Set([...sheets.keys(), ...stage.sheets])].sort());
    try {
      const ver = Math.max(0, ...[...sheets.values()].map(s => s.version)) + 1;
      sheets.clear();
      let maxIdx = 0;
      for (const n of stage.sheets) sheets.set(n, { version: ver, rows: [] });
      for (const r of [...stage.rows.values()].sort((a, b) => a.idx - b.idx)) {
        sheets.get(r.sheet).rows.push({ id: nextId++, pos: r.idx, cells: r.cells });
        maxIdx = Math.max(maxIdx, r.idx);
      }
      pos = maxIdx;
      for (const k of [...props.keys()]) if (k.slice(0, 2) !== '__') props.delete(k);
      for (const [k, v] of Object.entries(newProps || {})) if (k.slice(0, 2) !== '__') props.set(k, String(v));
      props.set('__GG_TZ', (meta && meta.tz) || 'UTC');
      props.set('__IMPORT_META', JSON.stringify(meta || {}));
      props.set('__IMPORTED_AT', new Date(clock()).toISOString());
      cache.clear();
      stage.sheets.clear(); stage.rows.clear();
      let rows = 0; for (const s of sheets.values()) rows += s.rows.length;
      return { ok: true, sheets: sheets.size, rows, version: ver };
    } finally { release(); }
  }

  /* {sheet: [cells...]} in row order, for comparing with the reference model */
  function dump() {
    const out = {};
    for (const n of [...sheets.keys()].sort()) out[n] = sheets.get(n).rows.slice().sort((a, b) => a.pos - b.pos).map(r => r.cells);
    return out;
  }

  return { load, commit, importBegin, importRows, importFinish, dump, stats,
    props: () => Object.fromEntries(props), _sheets: sheets };
}

module.exports = { createMemStore };
