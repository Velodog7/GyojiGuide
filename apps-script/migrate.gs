/************************************************************************
 *  SUMO SLAP DOWN: moving between this Sheet and Supabase, either way
 *  ------------------------------------------------------------------
 *  Add this to the Apps Script project as a NEW file named "migrate" and
 *  save. It works alongside the current sumo-fantasy.gs (the one with the
 *  __FORWARD_TO switch), which must be saved AND deployed as a new
 *  version first; cutover checks that before touching anything.
 *
 *  Pick a function in the toolbar and press Run:
 *
 *    cutover             Moves the site to Supabase. About two minutes.
 *                        Copies the Sheet, freezes it, copies it again,
 *                        checks every cell, then goes live. If anything
 *                        fails it puts everything back and says why.
 *
 *    revertToAppsScript  Moves the site back. Copies everything from
 *                        Supabase into this Sheet first (including all
 *                        changes made since the cutover), then this web
 *                        app serves again. Nothing is lost.
 *
 *    exportToSupabase    A rehearsal: copies the Sheet without switching.
 *                        Optional; cutover does its own copy.
 *
 *  It signs in to Supabase with the ADMIN_KEY already in Script
 *  Properties, so there is nothing to paste.
 ************************************************************************/

var GG_SUPABASE_API = 'https://ulzbcqnvltbioajvgvrr.supabase.co/functions/v1/api';
var GG_EXEC_URL = 'https://script.google.com/macros/s/AKfycbyrhng3sZoNNpgDA2JApz2Z0xx01x9N1TwnGhqkMfbmXCR-q11NIqlB_i3krHPZ3yZ7GA/exec';
var GG_CHUNK_BYTES = 400000;   // keep every request well under any size limit

function exportToSupabase() {
  var h = ggHealth_();
  if (h.live) throw new Error('Supabase is live, so this would overwrite newer data there with the Sheet. Nothing done.');
  var res = ggExport_(false).result;
  Logger.log('Rehearsal copy done: ' + res.sheets + ' sheets, ' + res.rows + ' rows. The site is still on Apps Script.');
  return res;
}

function cutover() {
  ggPreflight_();
  if (ggHealth_().live) { Logger.log('Supabase is already live. Nothing to do.'); return; }
  var props = PropertiesService.getScriptProperties();

  Logger.log('1/5  Copying the Sheet while the site keeps running...');
  ggExport_(false);
  Logger.log('2/5  Pausing changes and freezing the Sheet...');
  ggMaint_({ on: true });
  props.setProperty('__FORWARD_TO', GG_SUPABASE_API);
  try {
    ggCheckForwarding_();
    Logger.log('3/5  Final copy of the frozen Sheet...');
    var exp = ggExport_(true);
    Logger.log('4/5  Checking every cell, and a sample of answers, old against new...');
    ggVerify_(exp);
    Logger.log('5/5  Going live...');
    ggMaint_({ on: false, live: true });
  } catch (err) {
    props.deleteProperty('__FORWARD_TO');            // this web app serves again, Sheet untouched
    try { ggMaint_({ on: false, live: false }); } catch (e2) {}
    throw new Error('Cutover stopped and put everything back: the site is still on Apps Script, nothing was lost. Reason: ' +
      (err && err.message || err));
  }
  Logger.log('Done. The site is on Supabase. Each browser switches on its next page load (within a few ' +
    'minutes); until then the old URL forwards to Supabase, so everyone sees the same data.');
}

function revertToAppsScript() {
  ggPreflight_();
  var props = PropertiesService.getScriptProperties();
  Logger.log('1/3  Pausing changes on Supabase...');
  ggMaint_({ on: true, live: false });
  Logger.log('2/3  Copying everything from Supabase into this Sheet...');
  var n = ggPull_();
  Logger.log('3/3  Switching this web app back on...');
  props.deleteProperty('__FORWARD_TO');
  Logger.log('Done. The site is back on Apps Script: ' + n.sheets + ' sheets, ' + n.rows + ' rows copied back. ' +
    'Browsers switch back within a few minutes; until then Supabase still answers reads and pauses changes.');
}

/* Undo a revert that stopped part-way, while the Sheet was still frozen.
   Refuses once a revert has finished, because the Sheet may have taken
   changes since; run cutover instead, which copies them across. */
function resumeSupabase() {
  ggPreflight_();
  if (!PropertiesService.getScriptProperties().getProperty('__FORWARD_TO')) {
    throw new Error('This web app is serving the Sheet, which may now be newer than Supabase. Run cutover instead.');
  }
  ggMaint_({ on: false, live: true });
  Logger.log('Supabase is live again.');
}

/* ---------------------------------------------------------------- checks */

function ggPreflight_() {
  if (typeof forwardTarget_ !== 'function' || typeof BACKEND_VERSION === 'undefined') {
    throw new Error('This project still has the old sumo-fantasy.gs. Paste in the new one (it has the ' +
      '__FORWARD_TO switch), save, deploy a new version, and run this again.');
  }
  ggKey_();
  var h = ggHealth_();
  if (h.backend !== BACKEND_VERSION) {
    throw new Error('Supabase runs backend ' + h.backend + ' but this project has ' + BACKEND_VERSION +
      '. Push the repo, give Supabase a minute or two to deploy, then run this again.');
  }
  var dep = ggFetchJson_(GG_EXEC_URL + '?action=version&gg_fwd=1');
  if (!dep || dep.version !== BACKEND_VERSION) {
    throw new Error('The deployed web app runs ' + (dep && dep.version) + ', not the saved ' + BACKEND_VERSION +
      '. Deploy > Manage deployments > pencil > Version: New version > Deploy, then run this again.');
  }
}

/* the deployed web app now passes requests to Supabase (Script Properties
   reach new executions at once) */
function ggCheckForwarding_() {
  for (var i = 0; i < 3; i++) {
    var h = ggFetchJson_(GG_EXEC_URL + '?action=__health');
    if (h && h.engine === 'supabase') return;
    Utilities.sleep(2000);
  }
  throw new Error('the deployed web app did not start forwarding to Supabase');
}

function ggVerify_(exp) {
  // 1. every cell: per-sheet checksums, computed the same way on both sides
  var theirs = ggCall_({ action: '__export', adminKey: ggKey_(), step: 'checksums' }).sheets;
  var bad = [];
  Object.keys(exp.checksums).forEach(function (name) {
    var a = exp.checksums[name], b = theirs[name];
    if (!b || a.rows !== b.rows || a.sha !== b.sha) bad.push(name + ' (' + a.rows + ' rows here, ' + (b ? b.rows : 'none') + ' there)');
  });
  Object.keys(theirs).forEach(function (name) { if (!exp.checksums[name]) bad.push(name + ' (only on Supabase)'); });
  if (bad.length) throw new Error('the copy differs in: ' + bad.join(', '));

  // 2. a sample of answers: this project's code over the frozen Sheet vs Supabase
  var asks = [{ action: 'data' }, { action: 'list' }, { action: 'results' }, { action: 'version' }];
  var users = (ggLocal_({ action: 'list' }).users || []).slice(0, 4);
  var leagueIds = {};
  users.forEach(function (u) {
    ['leagues', 'accountSummary', 'dmThreads', 'history'].forEach(function (a) { asks.push({ action: a, handle: u.handle }); });
    (ggLocal_({ action: 'leagues', handle: u.handle }).leagues || []).forEach(function (l) { leagueIds[l.id] = l.commissioner; });
  });
  Object.keys(leagueIds).slice(0, 4).forEach(function (id) { asks.push({ action: 'league', id: id, handle: leagueIds[id] }); });
  var remote = UrlFetchApp.fetchAll(asks.map(function (p) { return { url: GG_SUPABASE_API + ggQs_(p), muteHttpExceptions: true }; }));
  var diffs = [];
  asks.forEach(function (p, i) {
    var mine = doGet({ parameter: ggWith_(p, { gg_fwd: '1' }), queryString: ggQs_(p).slice(1) }).getContent();
    var theirsText = remote[i].getContentText();
    if (mine !== theirsText) diffs.push(JSON.stringify(p) + ': here ' + mine.slice(0, 120) + ' / there ' + theirsText.slice(0, 120));
  });
  if (diffs.length) throw new Error(diffs.length + ' of ' + asks.length + ' sample answers differ, e.g. ' + diffs.slice(0, 2).join(' | '));
  Logger.log('     ' + Object.keys(exp.checksums).length + ' sheets identical, ' + asks.length + ' sample answers identical.');
}

/* --------------------------------------------------------------- copying */

function ggExport_(isFinal) {
  var started = new Date();
  var key = ggKey_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  ggCall_({ action: '__import', key: key, step: 'begin' });

  var expected = {}, formulas = {}, checksums = {}, total = 0;
  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s], name = sh.getName();
    var lr = sh.getLastRow(), lc = sh.getLastColumn();
    var values = [];
    if (lr > 0 && lc > 0) {
      var range = sh.getRange(1, 1, lr, lc);
      values = range.getValues();
      var f = range.getFormulas(), nf = 0;
      for (var i = 0; i < f.length; i++) for (var j = 0; j < f[i].length; j++) if (f[i][j]) nf++;
      if (nf) formulas[name] = nf;
    }
    var encoded = values.map(ggRow_);
    expected[name] = encoded.length;
    checksums[name] = { rows: encoded.length, sha: ggSha_(ggCanonical_(encoded)) };
    total += encoded.length;
    if (!encoded.length) {
      ggCall_({ action: '__import', key: key, step: 'rows', sheet: name, start: 1, rows: [] });
      continue;
    }
    var at = 0;
    while (at < encoded.length) {
      var rows = [], bytes = 0, first = at;
      while (at < encoded.length && (bytes < GG_CHUNK_BYTES || !rows.length)) {
        bytes += JSON.stringify(encoded[at]).length;
        rows.push(encoded[at]);
        at++;
      }
      ggCall_({ action: '__import', key: key, step: 'rows', sheet: name, start: first + 1, rows: rows });
    }
  }

  var triggers = [];
  try {
    triggers = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction() + ' (' + t.getEventType() + ')'; });
  } catch (e) { triggers = ['(could not list: ' + e + ')']; }
  var own = {}, all = PropertiesService.getScriptProperties().getProperties();
  Object.keys(all).forEach(function (k) { if (k.slice(0, 2) !== '__') own[k] = all[k]; });
  var meta = {
    tz: Session.getScriptTimeZone(), sheetTz: ss.getSpreadsheetTimeZone(), exportedAt: started.toISOString(),
    backendVersion: (typeof BACKEND_VERSION !== 'undefined' ? BACKEND_VERSION : ''),
    triggers: triggers, formulas: formulas, sheets: sheets.length, rows: total, final: !!isFinal
  };
  var res = ggCall_({ action: '__import', key: key, step: 'finish', expected: expected, props: own, meta: meta });
  Logger.log('     copied ' + sheets.length + ' sheets, ' + total + ' rows in ' + Math.round((new Date() - started) / 1000) + ' s');
  if (Object.keys(formulas).length) {
    Logger.log('     some cells held formulas; their current VALUES were copied: ' + JSON.stringify(formulas));
  }
  return { result: res, checksums: checksums };
}

/* Supabase -> this Sheet: every sheet it has, and the Script Properties */
function ggPull_() {
  var key = ggKey_();
  var list = ggCall_({ action: '__export', adminKey: key, step: 'list' });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var names = Object.keys(list.sheets), total = 0;
  names.forEach(function (name) {
    var n = list.sheets[name].rows, rows = [];
    for (var off = 0; off < n; off += 2000) {
      rows = rows.concat(ggCall_({ action: '__export', adminKey: key, step: 'rows', sheet: name, offset: off, limit: 2000 }).rows);
    }
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.clearContents();
    if (rows.length) {
      var width = 1;
      rows.forEach(function (r) { width = Math.max(width, r.length); });
      if (sh.getMaxRows() < rows.length) sh.insertRowsAfter(sh.getMaxRows(), rows.length - sh.getMaxRows());
      if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
      var values = rows.map(function (r) {
        var out = new Array(width);
        for (var i = 0; i < width; i++) out[i] = ggCell_(r[i]);
        return out;
      });
      sh.getRange(1, 1, values.length, width).setValues(values);
    }
    total += rows.length;
  });
  var props = PropertiesService.getScriptProperties(), have = props.getProperties();
  Object.keys(have).forEach(function (k) { if (k.slice(0, 2) !== '__' && !(k in list.props)) props.deleteProperty(k); });
  Object.keys(list.props).forEach(function (k) { if (k.slice(0, 2) !== '__') props.setProperty(k, list.props[k]); });
  return { sheets: names.length, rows: total };
}

/* ------------------------------------------------------------- plumbing */

function ggKey_() {
  var k = (PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || '').trim();
  if (!k) throw new Error('ADMIN_KEY is not set in this project’s Script Properties.');
  return k;
}
function ggHealth_() {
  var h = ggFetchJson_(GG_SUPABASE_API + '?action=__health');
  if (!h || !h.ok) throw new Error('Supabase is not answering yet (has the push deployed?): ' + JSON.stringify(h).slice(0, 200));
  return h;
}
function ggMaint_(flags) {
  var body = { action: '__maint', adminKey: ggKey_() };
  Object.keys(flags).forEach(function (k) { body[k] = flags[k]; });
  return ggCall_(body);
}
function ggLocal_(p) {
  try { return JSON.parse(doGet({ parameter: ggWith_(p, { gg_fwd: '1' }), queryString: ggQs_(p).slice(1) }).getContent()); }
  catch (e) { return {}; }
}
function ggWith_(a, b) { var o = {}; Object.keys(a).forEach(function (k) { o[k] = a[k]; }); Object.keys(b).forEach(function (k) { o[k] = b[k]; }); return o; }
function ggQs_(p) { return '?' + Object.keys(p).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]); }).join('&'); }

/* Dates travel tagged so they arrive as Dates; text Postgres can't hold
   (a NUL, half a surrogate pair) is cleaned the way the engine cleans it */
function ggRow_(row) {
  var out = new Array(row.length);
  for (var i = 0; i < row.length; i++) {
    var v = row[i];
    if (v instanceof Date) out[i] = isNaN(v.getTime()) ? '' : { $d: v.toISOString() };
    else if (typeof v === 'string' && /[\u0000\ud800-\udfff]/.test(v)) {
      out[i] = v.replace(/\u0000/g, '').replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '�');
    } else out[i] = v;
  }
  return out;
}
function ggCell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object' && typeof v.$d === 'string') return new Date(v.$d);
  return v;
}
/* must match canonical() in supabase/functions/api/index.ts */
function ggCanonical_(rows) {
  return JSON.stringify(rows.map(function (r) {
    var c = r.slice();
    while (c.length && (c[c.length - 1] === '' || c[c.length - 1] === null)) c.pop();
    return c;
  }));
}
function ggSha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function ggFetchJson_(url) {
  try { return JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText()); }
  catch (e) { return null; }
}
function ggCall_(body) {
  var what = body.action === '__import' || body.action === '__export'
    ? body.action.slice(2) + ' ' + body.step + (body.sheet ? ' (' + body.sheet + ')' : '') : body.action;
  var last = null;
  for (var attempt = 1; attempt <= 4; attempt++) {
    var r = UrlFetchApp.fetch(GG_SUPABASE_API, {
      method: 'post', contentType: 'text/plain;charset=utf-8',
      payload: JSON.stringify(body), muteHttpExceptions: true
    });
    var text = r.getContentText(), j = null;
    try { j = JSON.parse(text); } catch (e) {}
    if (j && j.ok) return j;
    last = what + ' failed (HTTP ' + r.getResponseCode() + '): ' + text.slice(0, 400);
    if (j && j.error === 'Not authorised.') break;      // a wrong key won't get righter
    Utilities.sleep(1500 * attempt);
  }
  throw new Error(last);
}
