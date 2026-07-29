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
var SHEET_LEAGUES  = 'Leagues';
var SHEET_MEMBERS  = 'LeagueMembers';
var SHEET_MESSAGES = 'Messages';

// Label for the current tournament (shown in the app).
var BASHO_LABEL   = 'Aki 2026';

/* ---------- one-time: build the tabs ---------- */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var users = ensureSheet(ss, SHEET_USERS, ['handle', 'name', 'auth', 'team', 'updated', 'avatar']);
  migrateUsersV1(users);                       // upgrades a v1 sheet (no auth column) in place
  migrateUsersV2(users);                       // upgrades a v1/v2 sheet (no avatar column) in place
  ensureSheet(ss, SHEET_RESULTS, ['day', 'division', 'east', 'west', 'winner', 'kimarite']);
  ensureSheet(ss, SHEET_LEAGUES, ['id', 'name', 'commissioner', 'created', 'inviteCode']);
  ensureSheet(ss, SHEET_MEMBERS, ['leagueId', 'handle', 'joined']);
  ensureSheet(ss, SHEET_MESSAGES, ['id', 'leagueId', 'handle', 'name', 'body', 'parentId', 'created']);
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

// v1/v2 sheets had no 'avatar' column (mawashi design, stored as JSON).
// Append it as column 6 if missing, so existing rows just get a blank cell.
function migrateUsersV2(sh) {
  var lastCol = Math.max(5, sh.getLastColumn());
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (String(head[5] || '').toLowerCase() !== 'avatar') {
    sh.getRange(1, 6).setValue('avatar');
  }
}

/* ---------- GET: hand back leaderboard data ---------- */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'data';
  try {
    if (action === 'list')    return json({ ok: true, users: readUsers() });
    if (action === 'results') return json({ ok: true, results: readResults() });
    if (action === 'leagues') return json(myLeagues(e.parameter.handle));
    if (action === 'league')  return json(leagueDetail(e.parameter.id, e.parameter.handle));
    if (action === 'invite')  return json(leagueByInvite(e.parameter.code));
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
    if (body.action === 'saveAvatar') return json(saveAvatar(body));
    if (body.action === 'createLeague') return json(createLeague(body));
    if (body.action === 'joinLeague')   return json(joinLeague(body));
    if (body.action === 'leaveLeague')  return json(leaveLeague(body));
    if (body.action === 'removeMember') return json(removeMember(body));
    if (body.action === 'renameLeague') return json(renameLeague(body));
    if (body.action === 'postMessage')  return json(postMessage(body));
    if (body.action === 'deleteMessage')return json(deleteMessage(body));
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
  var avatar = String(body.avatar || '').slice(0, 4000);
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
          sh.getRange(r + 1, 1, 1, 6).setValues([[handle, name, auth, v[r][3] || '{}', when, avatar || v[r][5] || '']]);
          return { ok: true, claimed: true, handle: handle };
        }
        return { ok: false, error: 'That handle is taken \u2014 sign in instead.' };
      }
    }
    sh.appendRow([handle, name, auth, '{}', when, avatar]);
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
  return { ok: true, handle: row.handle, name: row.name, team: team, avatar: row.avatar || '' };
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

/* save just the mawashi avatar design (doesn't touch the team) */
function saveAvatar(body) {
  var handle = cleanHandle(body.handle);
  var auth = String(body.auth || '');
  var avatar = String(body.avatar || '').slice(0, 4000);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
    var v = sh.getDataRange().getValues();
    var key = handle.toLowerCase();
    for (var r = 1; r < v.length; r++) {
      if (String(v[r][0]).trim().toLowerCase() === key) {
        if (String(v[r][2] || '') !== auth) return { ok: false, error: 'Not authorised for this handle.' };
        sh.getRange(r + 1, 6).setValue(avatar);
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
      return { handle: String(v[r][0]), name: String(v[r][1] || v[r][0]), auth: String(v[r][2] || ''), team: v[r][3], updated: String(v[r][4] || ''), avatar: String(v[r][5] || '') };
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
    out.push({ handle: String(v[r][0]), name: String(v[r][1] || v[r][0]), team: team, updated: String(v[r][4] || ''), avatar: String(v[r][5] || '') });
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

/* ============================================================
   LEAGUES · MEMBERS · MESSAGE BOARD
   All writes are authenticated with the same salted PIN hash the
   accounts use: the caller sends { handle, auth } and we verify it
   against the Users sheet before touching anything.
   ============================================================ */

function verifyAuth(handle, auth) {
  var u = findUser(handle);
  if (!u) return null;
  if (String(u.auth || '') === '' || String(u.auth) !== String(auth || '')) return null;
  return u;
}
function sh_(name){ return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }
function newId(prefix){ return prefix + Date.now().toString(36) + Math.floor(Math.random()*1e6).toString(36); }
function inviteCode(){
  var a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s='';
  for (var i=0;i<7;i++) s += a.charAt(Math.floor(Math.random()*a.length));
  return s;
}

function leagueRow(id){
  var v = sh_(SHEET_LEAGUES).getDataRange().getValues();
  for (var r=1;r<v.length;r++) if (String(v[r][0])===String(id)) return { row:r+1, id:String(v[r][0]), name:String(v[r][1]), commissioner:String(v[r][2]), created:String(v[r][3]), inviteCode:String(v[r][4]||'') };
  return null;
}
function membersOf(id){
  var v = sh_(SHEET_MEMBERS).getDataRange().getValues(), out=[];
  for (var r=1;r<v.length;r++) if (String(v[r][0])===String(id) && String(v[r][1]).trim()) out.push(String(v[r][1]));
  return out;
}
function isMember(id, handle){
  var k=String(handle||'').toLowerCase();
  return membersOf(id).some(function(h){ return h.toLowerCase()===k; });
}

function myLeagues(handle){
  handle = cleanHandle(handle);
  if (!handle) return { ok:false, error:'bad handle' };
  var mem = sh_(SHEET_MEMBERS).getDataRange().getValues();
  var mine = {}, k=handle.toLowerCase();
  for (var r=1;r<mem.length;r++) if (String(mem[r][1]).toLowerCase()===k) mine[String(mem[r][0])]=true;
  var lv = sh_(SHEET_LEAGUES).getDataRange().getValues(), out=[];
  for (var i=1;i<lv.length;i++){
    var id=String(lv[i][0]); if (!mine[id]) continue;
    out.push({ id:id, name:String(lv[i][1]), commissioner:String(lv[i][2]),
      inviteCode:String(lv[i][4]||''), members:membersOf(id).length,
      isCommissioner: String(lv[i][2]).toLowerCase()===k });
  }
  return { ok:true, leagues:out };
}

function leagueDetail(id, handle){
  var L = leagueRow(id); if (!L) return { ok:false, error:'League not found.' };
  handle = cleanHandle(handle);
  var members = membersOf(id);
  // hydrate member display names from Users
  var users = readUsers(), byh={};
  users.forEach(function(u){ byh[u.handle.toLowerCase()] = u.name; });
  var mem = members.map(function(h){ return { handle:h, name: byh[h.toLowerCase()] || h }; });
  var msgs = messagesOf(id);
  return { ok:true, league:{ id:L.id, name:L.name, commissioner:L.commissioner, inviteCode:L.inviteCode,
    isCommissioner: handle && L.commissioner.toLowerCase()===handle.toLowerCase(),
    isMember: handle ? isMember(id, handle) : false },
    members:mem, messages:msgs };
}

function leagueByInvite(code){
  code = String(code||'').trim().toUpperCase();
  if (!code) return { ok:false, error:'No invite code.' };
  var v = sh_(SHEET_LEAGUES).getDataRange().getValues();
  for (var r=1;r<v.length;r++) if (String(v[r][4]||'').toUpperCase()===code)
    return { ok:true, league:{ id:String(v[r][0]), name:String(v[r][1]), commissioner:String(v[r][2]), members:membersOf(String(v[r][0])).length } };
  return { ok:false, error:'That invite code doesn\u2019t match any league.' };
}

function createLeague(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var name = String(body.name||'').trim().slice(0,60); if (!name) return { ok:false, error:'Name your league first.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var id = newId('lg_'), code = inviteCode(), when = new Date().toISOString();
    sh_(SHEET_LEAGUES).appendRow([id, name, u.handle, when, code]);
    sh_(SHEET_MEMBERS).appendRow([id, u.handle, when]);
    return { ok:true, id:id, inviteCode:code };
  } finally { lock.releaseLock(); }
}

function joinLeague(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var L = null;
    if (body.id) L = leagueRow(body.id);
    else if (body.code){ var r = leagueByInvite(body.code); if (r.ok) L = leagueRow(r.league.id); }
    if (!L) return { ok:false, error:'League not found.' };
    if (isMember(L.id, u.handle)) return { ok:true, id:L.id, already:true };
    sh_(SHEET_MEMBERS).appendRow([L.id, u.handle, new Date().toISOString()]);
    return { ok:true, id:L.id, name:L.name };
  } finally { lock.releaseLock(); }
}

function leaveLeague(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.commissioner.toLowerCase()===u.handle.toLowerCase()) return { ok:false, error:'The commissioner can\u2019t leave — delete the league or hand it off.' };
  return removeMemberRow(L.id, u.handle);
}

function removeMember(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.commissioner.toLowerCase()!==u.handle.toLowerCase()) return { ok:false, error:'Only the commissioner can remove members.' };
  var target = cleanHandle(body.member);
  if (target.toLowerCase()===L.commissioner.toLowerCase()) return { ok:false, error:'The commissioner can\u2019t be removed.' };
  return removeMemberRow(L.id, target);
}

function removeMemberRow(id, handle){
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sh_(SHEET_MEMBERS), v = sh.getDataRange().getValues(), k=String(handle).toLowerCase();
    for (var r=v.length-1;r>=1;r--) if (String(v[r][0])===String(id) && String(v[r][1]).toLowerCase()===k) sh.deleteRow(r+1);
    return { ok:true };
  } finally { lock.releaseLock(); }
}

function renameLeague(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.commissioner.toLowerCase()!==u.handle.toLowerCase()) return { ok:false, error:'Only the commissioner can rename the league.' };
  var name = String(body.name||'').trim().slice(0,60); if (!name) return { ok:false, error:'Name can\u2019t be empty.' };
  sh_(SHEET_LEAGUES).getRange(L.row,2).setValue(name);
  return { ok:true };
}

/* ---- message board ---- */
function messagesOf(id){
  var v = sh_(SHEET_MESSAGES).getDataRange().getValues(), out=[];
  for (var r=1;r<v.length;r++){
    if (String(v[r][1])!==String(id)) continue;
    out.push({ id:String(v[r][0]), handle:String(v[r][2]), name:String(v[r][3]||v[r][2]),
      body:String(v[r][4]||''), parentId:String(v[r][5]||''), created:String(v[r][6]||'') });
  }
  return out;
}
function postMessage(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (!isMember(L.id, u.handle)) return { ok:false, error:'Join the league to post.' };
  var text = String(body.body||'').trim().slice(0,2000); if (!text) return { ok:false, error:'Empty message.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var mid = newId('m_');
    sh_(SHEET_MESSAGES).appendRow([mid, L.id, u.handle, u.name, text, String(body.parentId||''), new Date().toISOString()]);
    return { ok:true, id:mid };
  } finally { lock.releaseLock(); }
}
function deleteMessage(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var sh = sh_(SHEET_MESSAGES), v = sh.getDataRange().getValues();
  for (var r=1;r<v.length;r++){
    if (String(v[r][0])===String(body.msgId)){
      var L = leagueRow(String(v[r][1]));
      var owner = String(v[r][2]).toLowerCase()===u.handle.toLowerCase();
      var commish = L && L.commissioner.toLowerCase()===u.handle.toLowerCase();
      if (!owner && !commish) return { ok:false, error:'You can only delete your own posts.' };
      sh.deleteRow(r+1);
      return { ok:true };
    }
  }
  return { ok:false, error:'Message not found.' };
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
