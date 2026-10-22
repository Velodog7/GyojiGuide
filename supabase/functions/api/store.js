/*  SUMO SLAP DOWN — the sheet store, over Supabase's REST API
 *  ---------------------------------------------------------------------
 *  Thin wrappers around the SQL functions in supabase/migrations. Every
 *  call is one HTTP request and one database transaction.
 *
 *  Uses the project's secret key, which bypasses row level security: the
 *  gg_* tables have RLS on and no policies, so the publishable key reads
 *  nothing. The key never leaves the Edge Function.
 *  ------------------------------------------------------------------- */

export function createRestStore({ url, key, fetch: fetchImpl = null }) {
  if (!url || !key) throw new Error('store: SUPABASE_URL and a secret key are required');
  const f = fetchImpl || ((...a) => globalThis.fetch(...a));
  const base = String(url).replace(/\/+$/, '') + '/rest/v1/rpc/';
  const headers = { 'Content-Type': 'application/json', apikey: key };
  // legacy service_role keys are JWTs and also travel as a bearer token;
  // the newer sb_secret_ keys must not
  if (!/^sb_/.test(key)) headers.Authorization = 'Bearer ' + key;

  async function rpc(name, args) {
    const res = await f(base + name, { method: 'POST', headers, body: JSON.stringify(args) });
    const text = await res.text();
    if (!res.ok) throw new Error('store.' + name + ': HTTP ' + res.status + ' ' + text.slice(0, 500));
    return text ? JSON.parse(text) : null;
  }

  return {
    load: (sheets, withMeta) => rpc('gg_load', { p_sheets: sheets || [], p_meta: !!withMeta }),
    commit: (body) => rpc('gg_commit', { p: body }),
    importBegin: () => rpc('gg_import_begin', {}),
    importRows: (sheet, start, rows) => rpc('gg_import_rows', { p_sheet: sheet, p_start: start, p_rows: rows }),
    importFinish: (expected, props, meta) => rpc('gg_import_finish', { p_expected: expected, p_props: props, p_meta: meta }),
    exportRows: (sheet, offset, limit) => rpc('gg_export_rows', { p_sheet: sheet, p_offset: offset, p_limit: limit }),
    stats: () => rpc('gg_stats', {})
  };
}
