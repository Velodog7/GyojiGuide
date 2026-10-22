/* Stand-ins for Supabase's side of the rehearsal (tests/engine/e2e.mjs):
     :PG_PORT     /rest/v1/rpc/<fn>  - PostgREST, over PGlite with the real migrations
     :LEGACY_PORT /exec              - the old Apps Script, as far as the admin-key check goes
   Runs as its own process so the rehearsal's synchronous Apps Script
   UrlFetchApp (curl) can never block it. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const { PGlite } = await import(require.resolve('@electric-sql/pglite', { paths: [process.env.GG_PGLITE || ROOT] }));

const SECRET = process.env.GG_SECRET;
const ADMIN = process.env.GG_LEGACY_ADMIN_KEY;
const db = new PGlite();
await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;');
const dir = path.join(ROOT, 'supabase', 'migrations');
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));

const RPC = {
  gg_load: (b) => ['select public.gg_load($1::text[], $2::boolean) as r', [b.p_sheets || [], !!b.p_meta]],
  gg_commit: (b) => ['select public.gg_commit($1::jsonb) as r', [JSON.stringify(b.p)]],
  gg_import_begin: () => ['select public.gg_import_begin() as r', []],
  gg_import_rows: (b) => ['select public.gg_import_rows($1, $2, $3::jsonb) as r', [b.p_sheet, b.p_start, JSON.stringify(b.p_rows)]],
  gg_import_finish: (b) => ['select public.gg_import_finish($1::jsonb, $2::jsonb, $3::jsonb) as r',
    [JSON.stringify(b.p_expected), JSON.stringify(b.p_props), JSON.stringify(b.p_meta)]],
  gg_export_rows: (b) => ['select public.gg_export_rows($1, $2, $3) as r', [b.p_sheet, b.p_offset, b.p_limit]],
  gg_stats: () => ['select public.gg_stats() as r', []]
};
let calls = 0;
const body = (req) => new Promise(res => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => res(s)); });

http.createServer(async (req, res) => {
  const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    if (req.url === '/__debug/props') {
      return send(200, Object.fromEntries((await db.query('select key, value from public.gg_props')).rows.map(r => [r.key, r.value])));
    }
    if (req.url === '/__debug/calls') return send(200, { calls });
    const m = req.url.match(/^\/rest\/v1\/rpc\/(\w+)$/);
    if (!m || req.method !== 'POST' || !RPC[m[1]]) return send(404, { message: 'not found' });
    if (req.headers.apikey !== SECRET) return send(401, { message: 'Invalid API key' });
    if (/^sb_/.test(SECRET) && req.headers.authorization) return send(401, { message: 'a secret key must not be sent as a bearer token' });
    calls++;
    const [sql, params] = RPC[m[1]](JSON.parse((await body(req)) || '{}'));
    await db.exec("set role service_role");
    try { return send(200, (await db.query(sql, params)).rows[0].r); }
    finally { await db.exec('reset role'); }
  } catch (e) {
    return send(400, { message: String(e && e.message || e) });
  }
}).listen(Number(process.env.PG_PORT), '127.0.0.1');

http.createServer(async (req, res) => {
  const b = JSON.parse((await body(req)) || '{}');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(b.action === 'adminBasho' && b.adminKey === ADMIN ? { ok: true } : { ok: false, error: 'Not authorised.' }));
}).listen(Number(process.env.LEGACY_PORT), '127.0.0.1');

console.log('ready');
