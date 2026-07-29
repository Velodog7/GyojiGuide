/************************************************************************
 *  GYOJI GUIDE — FANTASY SUMO  ·  Google Apps Script backend  (v2)
 *  ------------------------------------------------------------------
 *  A tiny JSON API on top of a Google Sheet. It stores player ACCOUNTS
 *  (handle + display name + hashed PIN), each account's TEAM, and the
 *  tournament RESULTS — and hands everything the fantasy.html page
 *  needs to build the shared leaderboard.
 *
 *  ONE-TIME SETUP
 *  1.  Open your Google Sheet.
 *  2.  Extensions ▸ Apps Script. Delete anything there, paste ALL of
 *      this file in, and Save.
 *  3.  In the editor, run `setup` once (function dropdown ▸ Run) and
 *      approve the permissions prompt. This creates the "Users",
 *      "Results" and "Meta" tabs with headers.
 *  4.  Deploy ▸ New deployment ▸ type "Web app".
 *        · Execute as:   Me
 *        · Who has access:  Anyone            <-- important
 *      Deploy, then copy the /exec URL it gives you.
 *  5.  Paste that URL into fantasy.html as  API_URL  (top of the file).
 *
 *  ACCOUNTS & THE PIN
 *  The page hashes each player's PIN in the browser (salted SHA-256)
 *  and only ever sends the hash. This sheet stores that hash — never
 *  the PIN itself — and every team save must present the same hash.
 *  That keeps players from editing each other's teams, but it is
 *  game-grade protection, not real security: anyone with edit access
 *  to the Sheet can change anything. Don't reuse important passwords.
 *
 *  ENTERING RESULTS (day by day, during a basho)
 *  ·  Manual: add a row to "Results" per bout:
 *        day | division | east | west | winner | kimarite
 *     (division "Makuuchi" or "Juryo"; winner = the shikona that won)
 *  ·  Optional auto-pull from sumo-api.com: see refreshResults() at the
 *     bottom. Verify the endpoint/shape for the live basho before
 *     relying on it; the sheet is always the source of truth.
 *  ·  Bump the "lastDay" row in Meta as days complete (refreshResults
 *     does this automatically).
 ************************************************************************/

var SHEET_USERS   = 'Users';
var SHEET_RESULTS = 'Results';
var SHEET_META    = 'Meta';

// Label for the current tournament (shown in the app).
var BASHO_LABEL   = 'Aki 2026';

/* ---------- one-time: build the tabs ---------- */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var users = ensureSheet(ss, SHEET_USERS, ['handle', 'name', 'auth', 'team', 'updated']);
  migrateUsersV1(users);                       // upgrades a v1 sheet (no auth column) in place
  ensureSheet(ss, SHEET_RESULTS, ['day', 'division', 'east', 'west', 'winner', 'kimarite']);
  var meta = ensureSheet(ss, SHEET_META, ['key', 'value']);
  if (meta.getLastRow() < 2) {
    meta.appendRow(['basho', BASHO_LABEL]);
    meta.appendRow(['lastDay', 0]);
    meta.appendRow(['yusho', '']);      // Makuuchi champion's shikona (fill at basho end) -> +5
    meta.appendRow(['sansho', '']);     // Sansho winners, comma-separated -> +5 each
  }
}

function ensureSheet(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  return sh;
}

// v1 sheets had [handle, name, team, updated]. Insert the auth column so
// old rows survive; those accounts have no PIN yet — the first successful
// "register" with their handle claims them.
function migrateUsersV1(sh) {
  var head = sh.getRange(1, 1, 1, Math.max(4, sh.getLastColumn())).getValues()[0];
  if (String(head[2]).toLowerCase() === 'team') {
    sh.insertColumnBefore(3);
    sh.getRange(1, 3).setValue('auth');
  }
}

/* ---------- GET: hand back leaderboard data ---------- */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'data';
  try {
    if (action === 'list')    return json({ ok: true, users: readUsers() });
    if (action === 'results') return json({ ok: true, results: readResults() });
    return json({ ok: true, users: readUsers(), results: readResults(), meta: readMeta() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/* ---------- POST: accounts + team saves ---------- */
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'register') return json(register(body));
    if (body.action === 'login')    return json(login(body));
    if (body.action === 'save')     return json(saveTeam(body));
    return json({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function cleanHandle(h) {
  h = String(h || '').trim().slice(0, 40);
  return /^[A-Za-z0-9_.\-]{2,40}$/.test(h) ? h : '';
}

/* create an account: fails if the handle is taken (unless it's an
   unclaimed v1 row with no PIN, which the first register claims) */
function register(body) {
  var handle = cleanHandle(body.handle);
  if (!handle) return { ok: false, error: 'Handle: 2\u201340 letters, digits, _ . -' };
  var auth = String(body.auth || '').slice(0, 80);
  if (!auth) return { ok: false, error: 'missing auth' };
  var name = String(body.name || handle).trim().slice(0, 60);
  var when = new Date().toISOString();

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
    var v = sh.getDataRange().getValues();
    var key = handle.toLowerCase();
    for (var r = 1; r < v.length; r++) {
      if (String(v[r][0]).trim().toLowerCase() === key) {
        if (String(v[r][2] || '') === '') {          // unclaimed v1 account — claim it
          sh.getRange(r + 1, 1, 1, 5).setValues([[handle, name, auth, v[r][3] || '{}', when]]);
          return { ok: true, claimed: true, handle: handle };
        }
        return { ok: false, error: 'That handle is taken \u2014 sign in instead.' };
      }
    }
    sh.appendRow([handle, name, auth, '{}', when]);
    return { ok: true, created: true, handle: handle };
  } finally {
    lock.releaseLock();
  }
}

/* sign in: verify the hash; return the stored display name + team so
   picks follow the player across devices */
function login(body) {
  var handle = cleanHandle(body.handle);
  var auth = String(body.auth || '');
  var row = findUser(handle);
  if (!row) return { ok: false, error: 'No account with that handle \u2014 create one.' };
  if (String(row.auth || '') === '') return { ok: false, error: 'This handle has no PIN yet \u2014 use Create account to claim it.' };
  if (row.auth !== auth) return { ok: false, error: 'Wrong PIN.' };
  var team = {};
  try { team = JSON.parse(row.team || '{}'); } catch (x) {}
  return { ok: true, handle: row.handle, name: row.name, team: team };
}

/* save a team: only with the account's own hash */
function saveTeam(body) {
  var handle = cleanHandle(body.handle);
  var auth = String(body.auth || '');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
    var v = sh.getDataRange().getValues();
    var key = handle.toLowerCase();
    for (var r = 1; r < v.length; r++) {
      if (String(v[r][0]).trim().toLowerCase() === key) {
        if (String(v[r][2] || '') !== auth) return { ok: false, error: 'Not authorised for this handle.' };
        var name = String(body.name || v[r][1] || handle).trim().slice(0, 60);
        sh.getRange(r + 1, 1, 1, 5).setValues([[String(v[r][0]), name, auth, JSON.stringify(body.team || {}), new Date().toISOString()]]);
        return { ok: true, updated: true, handle: handle };
      }
    }
    return { ok: false, error: 'No account with that handle \u2014 create one first.' };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- readers (auth hashes never leave the sheet) ---------- */
function findUser(handle) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  var v = sh.getDataRange().getValues();
  var key = String(handle || '').toLowerCase();
  for (var r = 1; r < v.length; r++) {
    if (String(v[r][0]).trim().toLowerCase() === key) {
      return { handle: String(v[r][0]), name: String(v[r][1] || v[r][0]), auth: String(v[r][2] || ''), team: v[r][3], updated: String(v[r][4] || '') };
    }
  }
  return null;
}

function readUsers() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  var v = sh.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < v.length; r++) {
    if (!String(v[r][0]).trim()) continue;
    var team = {};
    try { team = JSON.parse(v[r][3] || '{}'); } catch (e) {}
    out.push({ handle: String(v[r][0]), name: String(v[r][1] || v[r][0]), team: team, updated: String(v[r][4] || '') });
  }
  return out;
}

function readResults() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RESULTS);
  var v = sh.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < v.length; r++) {
    if (v[r][0] === '' || v[r][0] === null) continue;
    out.push({
      day:      Number(v[r][0]) || 0,
      division: String(v[r][1] || ''),
      east:     String(v[r][2] || ''),
      west:     String(v[r][3] || ''),
      winner:   String(v[r][4] || ''),
      kimarite: String(v[r][5] || '')
    });
  }
  return out;
}

function readMeta() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_META);
  if (!sh) return { basho: BASHO_LABEL, lastDay: 0 };
  var v = sh.getDataRange().getValues();
  var m = { basho: BASHO_LABEL, lastDay: 0 };
  for (var r = 1; r < v.length; r++) m[String(v[r][0])] = v[r][1];
  return m;
}

/* ---------- JSON helper ----------
   POSTs from the page use Content-Type text/plain (a CORS-safelisted
   type), so no preflight is sent — the one pattern that reliably works
   with Apps Script web apps. */
function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/************************************************************************
 *  OPTIONAL — auto-pull results from sumo-api.com
 *  ------------------------------------------------------------------
 *  Runs server-side (no browser CORS limits). Add a time-driven trigger
 *  (Triggers ▸ Add Trigger ▸ refreshResults ▸ every hour) during the
 *  basho, or run it by hand each evening. It appends bouts it doesn't
 *  already have and advances Meta.lastDay.
 *
 *  IMPORTANT: confirm BASHO_ID and the JSON field names against
 *  sumo-api.com for the live tournament before trusting it — they have
 *  changed over time. When in doubt, enter results by hand.
 ************************************************************************/
var BASHO_ID = '202609';   // next basho, YYYYMM (Aki 2026 = 202609)

function refreshResults() {
  var divisions = ['Makuuchi', 'Juryo'];
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RESULTS);
  var have = {};
  var existing = sh.getDataRange().getValues();
  for (var r = 1; r < existing.length; r++) {
    have[existing[r][0] + '|' + existing[r][1] + '|' + existing[r][2] + '|' + existing[r][3]] = true;
  }

  var maxDay = 0;
  for (var day = 1; day <= 15; day++) {
    for (var d = 0; d < divisions.length; d++) {
      var div = divisions[d];
      var url = 'https://sumo-api.com/api/basho/' + BASHO_ID + '/torikumi/' + div + '/' + day;
      var bouts;
      try {
        var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
        if (resp.getResponseCode() !== 200) continue;
        var data = JSON.parse(resp.getContentText());
        bouts = data.torikumi || data.Torikumi || [];
      } catch (e) { continue; }
      if (!bouts || !bouts.length) continue;

      for (var i = 0; i < bouts.length; i++) {
        var b = bouts[i];
        var east   = b.eastShikona || b.east || '';
        var west   = b.westShikona || b.west || '';
        var winner = b.winnerEn || b.winner_en || b.winner || '';
        var kim    = b.kimarite || '';
        if (!east || !west || !winner) continue;
        var key = day + '|' + div + '|' + east + '|' + west;
        if (have[key]) continue;
        sh.appendRow([day, div, east, west, winner, kim]);
        have[key] = true;
        if (day > maxDay) maxDay = day;
      }
    }
  }

  if (maxDay) {
    var meta = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_META);
    if (meta) {
      var mv = meta.getDataRange().getValues();
      for (var r2 = 1; r2 < mv.length; r2++) {
        if (String(mv[r2][0]) === 'lastDay') { meta.getRange(r2 + 1, 2).setValue(Math.max(Number(mv[r2][1]) || 0, maxDay)); break; }
      }
    }
  }
}
