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
var SHEET_LGTEAMS  = 'LeagueTeams';
var SHEET_HISTORY   = 'TeamHistory';
var SHEET_ROSTERS  = 'KeeperRosters';
var SHEET_PICKS    = 'DraftPicks';
var SHEET_TRADES   = 'Trades';
var SHEET_FEEDBACK = 'Feedback';
var SHEET_PAGEVIEWS = 'PageViews';
var SHEET_BOARD = 'LeaderboardBoard';
var SHEET_BOARD_VOTES = 'LeaderboardVotes';

// Label for the current tournament (shown in the app).
var BASHO_LABEL   = 'Aki 2026';

// Password for the private /admin.html dashboard (connectivity, analytics,
// user moderation, message-board review). Change this to your own string
// before deploying, then enter the SAME string into admin.html when it
// asks — the page doesn't store it anywhere on its own. Same game-grade
// security note as the PIN system above: fine for keeping the dashboard
// away from casual visitors, not a hardened secret store.
var ADMIN_KEY = 'change-me-admin-key';

/* ---------- one-time: build the tabs ---------- */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var users = ensureSheet(ss, SHEET_USERS, ['handle', 'name', 'auth', 'team', 'updated', 'avatar', 'status', 'warnMsg']);
  migrateUsersV1(users);                       // upgrades a v1 sheet (no auth column) in place
  migrateUsersV2(users);                       // upgrades a v1/v2 sheet (no avatar column) in place
  migrateUsersV3(users);                       // upgrades a v1/v2/v3 sheet (no status/warnMsg columns) in place
  ensureSheet(ss, SHEET_RESULTS, ['day', 'division', 'east', 'west', 'winner', 'kimarite']);
  var leagues = ensureSheet(ss, SHEET_LEAGUES, ['id', 'name', 'commissioner', 'created', 'inviteCode',
    'mode', 'rosterSize', 'draftStatus', 'draftOrder', 'draftPickIdx', 'draftPhase']);
  migrateLeaguesV2(leagues);   // upgrades an older Leagues sheet (no keeper columns) in place
  ensureSheet(ss, SHEET_MEMBERS, ['leagueId', 'handle', 'joined']);
  ensureSheet(ss, SHEET_MESSAGES, ['id', 'leagueId', 'handle', 'name', 'body', 'parentId', 'created']);
  ensureSheet(ss, SHEET_LGTEAMS, ['leagueId', 'handle', 'team', 'updated']);
  ensureSheet(ss, SHEET_HISTORY, ['handle', 'basho', 'team', 'score', 'wins', 'rows', 'savedAt']);
  ensureSheet(ss, SHEET_ROSTERS, ['leagueId', 'handle', 'rikishi', 'division', 'acquiredVia', 'acquiredAt']);
  ensureSheet(ss, SHEET_PICKS, ['leagueId', 'pickIndex', 'round', 'phase', 'handle', 'rikishi', 'pickedAt']);
  ensureSheet(ss, SHEET_TRADES, ['id', 'leagueId', 'fromHandle', 'toHandle', 'offer', 'request', 'status', 'createdAt', 'resolvedAt']);
  ensureSheet(ss, SHEET_FEEDBACK, ['createdAt', 'kind', 'handle', 'subject', 'message', 'targetUser', 'page', 'status']);
  ensureSheet(ss, SHEET_PAGEVIEWS, ['ts', 'page', 'visitorId']);
  ensureSheet(ss, SHEET_BOARD, ['id', 'handle', 'name', 'body', 'parentId', 'created', 'updated', 'editedByAdmin']);
  ensureSheet(ss, SHEET_BOARD_VOTES, ['msgId', 'handle', 'value', 'votedAt']);
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

// pre-admin-dashboard Users sheets had no 'status'/'warnMsg' columns (used
// by the admin panel to warn/ban accounts). Append them as columns 7-8 if
// missing; existing rows just get blank cells, which read as "active".
function migrateUsersV3(sh) {
  var lastCol = Math.max(6, sh.getLastColumn());
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (String(head[6] || '').toLowerCase() !== 'status') {
    sh.getRange(1, 7, 1, 2).setValues([['status', 'warnMsg']]);
  }
}

// pre-Keepers Leagues sheets had only [id,name,commissioner,created,inviteCode].
// Append the draft/keeper columns if missing; existing (Classic) leagues just
// get blank cells, which mode-aware code below treats as mode:'classic'.
function migrateLeaguesV2(sh) {
  var lastCol = Math.max(5, sh.getLastColumn());
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (String(head[5] || '').toLowerCase() !== 'mode') {
    sh.getRange(1, 6, 1, 6).setValues([['mode', 'rosterSize', 'draftStatus', 'draftOrder', 'draftPickIdx', 'draftPhase']]);
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
    if (action === 'history') return json({ ok: true, history: myHistory(e.parameter.handle) });
    if (action === 'draftState') return json(draftState(e.parameter.id));
    if (action === 'trades')  return json({ ok: true, trades: myTrades(e.parameter.id, e.parameter.handle) });
    if (action === 'board')   return json({ ok: true, messages: boardMessages(e.parameter.handle) });
    if (action === 'adminStats')    { var g1 = adminGate(e.parameter.adminKey); if (g1) return json(g1); return json(adminStats()); }
    if (action === 'adminUsers')    { var g2 = adminGate(e.parameter.adminKey); if (g2) return json(g2); return json(adminUsers()); }
    if (action === 'adminMessages') { var g3 = adminGate(e.parameter.adminKey); if (g3) return json(g3); return json(adminMessages()); }
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
    if (body.action === 'setLeagueMode') return json(setLeagueMode(body));
    if (body.action === 'startDraft')    return json(startDraft(body));
    if (body.action === 'makePick')      return json(makePick(body));
    if (body.action === 'proposeTrade')  return json(proposeTrade(body));
    if (body.action === 'respondTrade')  return json(respondTrade(body));
    if (body.action === 'addDrop')       return json(addDrop(body));
    if (body.action === 'deleteMessage')return json(deleteMessage(body));
    if (body.action === 'saveLeagueTeam') return json(saveLeagueTeam(body));
    if (body.action === 'archiveTeam') return json(archiveTeam(body));
    if (body.action === 'postBoardMessage')      return json(postBoardMessage(body));
    if (body.action === 'editBoardMessage')      return json(editBoardMessage(body));
    if (body.action === 'deleteBoardMessage')    return json(deleteBoardMessage(body));
    if (body.action === 'voteBoardMessage')      return json(voteBoardMessage(body));
    if (body.action === 'adminEditBoardMessage') return json(adminEditBoardMessage(body));
    if (body.action === 'adminDeleteBoardMsg')   return json(adminDeleteBoardMsg(body));
    if (body.action === 'feedback')    return json(submitFeedback(body));
    if (body.action === 'logPageview') return json(logPageview(body));
    if (body.action === 'adminWarnUser')      return json(adminWarnUser(body));
    if (body.action === 'adminBanUser')       return json(adminBanUser(body));
    if (body.action === 'adminUnbanUser')     return json(adminUnbanUser(body));
    if (body.action === 'adminDeleteUser')    return json(adminDeleteUser(body));
    if (body.action === 'adminDeleteMessage') return json(adminDeleteMessageFn(body));
    return json({ ok: false, error: 'unknown action' });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function cleanHandle(h) {
  h = String(h || '').trim().slice(0, 40);
  return /^[A-Za-z0-9_.\-]{2,40}$/.test(h) ? h : '';
}

/* Help & feedback: FAQ questions, suggestions, bug reports, abuse reports.
   kind = 'question' | 'suggestion' | 'bug' | 'abuse'. All fields optional
   except a non-empty message; everything is length-capped and stored on the
   Feedback sheet with a 'new' status for the admin to triage. */
function submitFeedback(body) {
  var kinds = { question: 1, suggestion: 1, bug: 1, abuse: 1 };
  var kind = String(body.kind || '').toLowerCase();
  if (!kinds[kind]) return { ok: false, error: 'bad kind' };
  var message = String(body.message || '').trim().slice(0, 4000);
  if (!message) return { ok: false, error: 'Please add some detail.' };
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_FEEDBACK);
  if (!sh) return { ok: false, error: 'not set up' };
  sh.appendRow([
    new Date(),
    kind,
    String(body.handle || '').slice(0, 40),
    String(body.subject || '').trim().slice(0, 160),
    message,
    String(body.targetUser || '').trim().slice(0, 40),
    String(body.page || '').slice(0, 200),
    'new'
  ]);
  return { ok: true };
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
  if (row.status === 'banned') return { ok: false, error: 'This account has been suspended.' };
  var team = {};
  try { team = JSON.parse(row.team || '{}'); } catch (x) {}
  return { ok: true, handle: row.handle, name: row.name, team: team, avatar: row.avatar || '', warning: row.status === 'warned' ? row.warnMsg : '' };
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
      return { handle: String(v[r][0]), name: String(v[r][1] || v[r][0]), auth: String(v[r][2] || ''), team: v[r][3], updated: String(v[r][4] || ''), avatar: String(v[r][5] || ''), status: String(v[r][6] || ''), warnMsg: String(v[r][7] || '') };
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
  if (u.status === 'banned') return null;
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
  for (var r=1;r<v.length;r++) if (String(v[r][0])===String(id)) return {
    row:r+1, id:String(v[r][0]), name:String(v[r][1]), commissioner:String(v[r][2]), created:String(v[r][3]), inviteCode:String(v[r][4]||''),
    mode: String(v[r][5]||'classic') || 'classic',
    rosterSize: Number(v[r][6]||6) || 6,
    draftStatus: String(v[r][7]||'none') || 'none',
    draftOrder: (function(){ try { return JSON.parse(v[r][8]||'[]'); } catch(e){ return []; } })(),
    draftPickIdx: Number(v[r][9]||0) || 0,
    draftPhase: String(v[r][10]||'')
  };
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
      mode:String(lv[i][5]||'classic') || 'classic', draftStatus:String(lv[i][7]||'none') || 'none',
      isCommissioner: String(lv[i][2]).toLowerCase()===k });
  }
  return { ok:true, leagues:out };
}

function leagueTeamsOf(id){
  var v = sh_(SHEET_LGTEAMS).getDataRange().getValues(), out={};
  for (var r=1;r<v.length;r++){
    if (String(v[r][0])!==String(id)) continue;
    var h = String(v[r][1]||''); if (!h) continue;
    var team = {}; try { team = JSON.parse(v[r][2] || '{}'); } catch(e){}
    out[h.toLowerCase()] = { team: team, updated: String(v[r][3]||'') };
  }
  return out;
}

function leagueDetail(id, handle){
  var L = leagueRow(id); if (!L) return { ok:false, error:'League not found.' };
  handle = cleanHandle(handle);
  var members = membersOf(id);
  // hydrate member display names from Users
  var users = readUsers(), byh={};
  users.forEach(function(u){ byh[u.handle.toLowerCase()] = u.name; });
  var teams = leagueTeamsOf(id);
  var rosters = L.mode === 'keepers' ? keeperRostersOf(id) : {};
  var mem = members.map(function(h){
    var t = teams[h.toLowerCase()];
    var ros = rosters[h.toLowerCase()] || { makuuchi:[], juryo:[] };
    return { handle:h, name: byh[h.toLowerCase()] || h, team: t ? t.team : {}, teamUpdated: t ? t.updated : '',
      roster: ros };
  });
  var msgs = messagesOf(id);
  return { ok:true, league:{ id:L.id, name:L.name, commissioner:L.commissioner, inviteCode:L.inviteCode,
    mode:L.mode, rosterSize:L.rosterSize, draftStatus:L.draftStatus,
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

/* ============================================================
   LEADERBOARD BOARD
   One shared, site-wide message board (not per-league) shown on the
   Fantasy page's Leaderboard tab. Any signed-in player can post and
   reply; a poster can edit or delete their own posts; the admin
   dashboard can edit or delete anyone's (see adminEditBoardMessage /
   adminDeleteBoardMsg below). Upvote/downvote is one vote per
   (message, handle) — casting the same value again removes it.
   ============================================================ */
function boardVoteTally_(){
  var v = sh_(SHEET_BOARD_VOTES).getDataRange().getValues();
  var out = {};
  for (var r=1;r<v.length;r++){
    var mid = String(v[r][0]); if (!mid) continue;
    if (!out[mid]) out[mid] = { up:0, down:0, voters:{} };
    var val = Number(v[r][2]) || 0;
    if (val > 0) out[mid].up++; else if (val < 0) out[mid].down++;
    out[mid].voters[String(v[r][1]).toLowerCase()] = val;
  }
  return out;
}
function boardMessages(handle){
  var v = sh_(SHEET_BOARD).getDataRange().getValues();
  var tally = boardVoteTally_();
  var key = cleanHandle(handle).toLowerCase();
  var out = [];
  for (var r=1;r<v.length;r++){
    if (!String(v[r][0]).trim()) continue;
    var id = String(v[r][0]);
    var t = tally[id] || { up:0, down:0, voters:{} };
    out.push({
      id:id, handle:String(v[r][1]), name:String(v[r][2]||v[r][1]), body:String(v[r][3]||''),
      parentId:String(v[r][4]||''), created:String(v[r][5]||''), updated:String(v[r][6]||''),
      editedByAdmin: String(v[r][7]||'')==='1',
      up:t.up, down:t.down, score:t.up-t.down,
      myVote: key ? (t.voters[key]||0) : 0
    });
  }
  return out;
}
function postBoardMessage(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Sign in to post.' };
  var text = String(body.body||'').trim().slice(0,2000); if (!text) return { ok:false, error:'Empty message.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var mid = newId('bm_');
    sh_(SHEET_BOARD).appendRow([mid, u.handle, u.name, text, String(body.parentId||''), new Date().toISOString(), '', '']);
    return { ok:true, id:mid };
  } finally { lock.releaseLock(); }
}
function boardMsgRow_(msgId){
  var sh = sh_(SHEET_BOARD), v = sh.getDataRange().getValues();
  for (var r=1;r<v.length;r++) if (String(v[r][0])===String(msgId)) return { row:r+1, handle:String(v[r][1]) };
  return null;
}
function editBoardMessage(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Sign in first.' };
  var m = boardMsgRow_(body.msgId); if (!m) return { ok:false, error:'Message not found.' };
  if (m.handle.toLowerCase() !== u.handle.toLowerCase()) return { ok:false, error:'You can only edit your own posts.' };
  var text = String(body.body||'').trim().slice(0,2000); if (!text) return { ok:false, error:'Message can\u2019t be empty.' };
  sh_(SHEET_BOARD).getRange(m.row,4,1,1).setValue(text);
  sh_(SHEET_BOARD).getRange(m.row,7,1,1).setValue(new Date().toISOString());
  return { ok:true };
}
function deleteBoardMessage(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Sign in first.' };
  var m = boardMsgRow_(body.msgId); if (!m) return { ok:false, error:'Message not found.' };
  if (m.handle.toLowerCase() !== u.handle.toLowerCase()) return { ok:false, error:'You can only delete your own posts.' };
  sh_(SHEET_BOARD).deleteRow(m.row);
  return { ok:true };
}
function voteBoardMessage(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Sign in to vote.' };
  var m = boardMsgRow_(body.msgId); if (!m) return { ok:false, error:'Message not found.' };
  var val = Number(body.value);
  if (val !== 1 && val !== -1) return { ok:false, error:'Bad vote value.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sh_(SHEET_BOARD_VOTES), v = sh.getDataRange().getValues(), key = u.handle.toLowerCase();
    for (var r=1;r<v.length;r++){
      if (String(v[r][0])===String(body.msgId) && String(v[r][1]).toLowerCase()===key){
        if (Number(v[r][2]) === val){ sh.deleteRow(r+1); }               // same value again -> remove the vote
        else sh.getRange(r+1,3,1,2).setValues([[val, new Date().toISOString()]]);
        return { ok:true, tally: boardVoteTally_()[String(body.msgId)] || { up:0, down:0 } };
      }
    }
    sh.appendRow([body.msgId, u.handle, val, new Date().toISOString()]);
    return { ok:true, tally: boardVoteTally_()[String(body.msgId)] || { up:0, down:0 } };
  } finally { lock.releaseLock(); }
}
function adminEditBoardMessage(body){
  var bad = adminGate(body.adminKey); if (bad) return bad;
  var m = boardMsgRow_(body.msgId); if (!m) return { ok:false, error:'Message not found.' };
  var text = String(body.body||'').trim().slice(0,2000); if (!text) return { ok:false, error:'Message can\u2019t be empty.' };
  var sh = sh_(SHEET_BOARD);
  sh.getRange(m.row,4,1,1).setValue(text);
  sh.getRange(m.row,7,1,2).setValues([[new Date().toISOString(), '1']]);
  return { ok:true };
}
function adminDeleteBoardMsg(body){
  var bad = adminGate(body.adminKey); if (bad) return bad;
  var m = boardMsgRow_(body.msgId); if (!m) return { ok:false, error:'Message not found.' };
  sh_(SHEET_BOARD).deleteRow(m.row);
  return { ok:true };
}

/* save a member's team for one specific league (independent of their
   global team, and independent of any other league they're in) */
function saveLeagueTeam(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (!isMember(L.id, u.handle)) return { ok:false, error:'Join the league to draft a team there.' };
  var teamJson = typeof body.team === 'string' ? body.team : JSON.stringify(body.team || {});
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sh_(SHEET_LGTEAMS), v = sh.getDataRange().getValues(), key = u.handle.toLowerCase();
    for (var r=1;r<v.length;r++){
      if (String(v[r][0])===String(L.id) && String(v[r][1]).toLowerCase()===key){
        sh.getRange(r+1, 1, 1, 4).setValues([[L.id, u.handle, teamJson, new Date().toISOString()]]);
        return { ok:true, updated:true };
      }
    }
    sh.appendRow([L.id, u.handle, teamJson, new Date().toISOString()]);
    return { ok:true, created:true };
  } finally { lock.releaseLock(); }
}

/* ============================================================
   KEEPERS · SNAKE DRAFT · ROSTERS · TRADES · WAIVERS
   ------------------------------------------------------------
   A league is either 'classic' (repick from scratch each basho,
   duplicates across players allowed — the original mode above) or
   'keepers' (one persistent roster, kept basho after basho, built via
   a one-time snake draft where every rikishi can only be owned by one
   member of the league at a time).

   Ownership is a flat ledger in KeeperRosters: one row per owned
   rikishi. The draft itself is turn-based and stateless between
   requests — whose turn it is is always recomputed from
   (draftOrder, rosterSize, draftPickIdx), never trusted from the
   client, so concurrent requests can't desync it.

   NOTE ON VALIDATION: like the rest of this file, this is game-grade
   protection for friends, not a hardened server — picks/trades/waivers
   are checked for the things that actually matter (won't double-own a
   rikishi, must be your turn, must own what you're trading away) but
   the client — not this file — is trusted to only ever offer rikishi
   from the correct division (Makuuchi vs Juryo) in its own UI.
   ============================================================ */

var MAKUUCHI_POOL = 42, JURYO_POOL = 28;   // approximate banzuke sizes, used only to cap roster size

function tournamentActive(){
  var meta = readMeta();
  var results = readResults();
  return results.length > 0 && Number(meta.lastDay || 0) < 15;
}

// whose turn is it, given the draft order, roster size (per division), and
// a single pick counter that runs across BOTH phases (Makuuchi then Juryo)
function draftTurn(order, rosterSize, pickIdx){
  var N = order.length, R = Number(rosterSize) || 6;
  var perPhase = N * R, total = perPhase * 2;
  if (!N || pickIdx >= total) return { phase:'done', handle:null };
  var phase = pickIdx < perPhase ? 'makuuchi' : 'juryo';
  var local = pickIdx < perPhase ? pickIdx : pickIdx - perPhase;
  var round = Math.floor(local / N), pos = local % N;
  var handle = (round % 2 === 0) ? order[pos] : order[N - 1 - pos];
  return { phase:phase, handle:handle, round:round+1, pickInRound:pos+1, perPhase:perPhase, total:total, pickIdx:pickIdx };
}

function setLeagueMode(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.commissioner.toLowerCase() !== u.handle.toLowerCase()) return { ok:false, error:'Only the commissioner can change the league mode.' };
  if (L.draftStatus === 'active' || L.draftStatus === 'complete') return { ok:false, error:'Mode is locked once a draft has started.' };
  var mode = (body.mode === 'keepers') ? 'keepers' : 'classic';
  var rosterSize = Math.max(5, Math.min(10, Number(body.rosterSize) || 6));
  sh_(SHEET_LEAGUES).getRange(L.row, 6, 1, 2).setValues([[mode, rosterSize]]);
  return { ok:true, mode:mode, rosterSize:rosterSize };
}

function startDraft(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.commissioner.toLowerCase() !== u.handle.toLowerCase()) return { ok:false, error:'Only the commissioner can start the draft.' };
  if (L.mode !== 'keepers') return { ok:false, error:'Switch the league to Keepers mode first.' };
  if (L.draftStatus === 'active') return { ok:false, error:'The draft is already underway.' };
  if (L.draftStatus === 'complete') return { ok:false, error:'This league has already drafted.' };
  var members = membersOf(L.id);
  if (members.length < 2) return { ok:false, error:'Need at least two members to draft.' };
  var maxByPool = Math.floor(Math.min(MAKUUCHI_POOL, JURYO_POOL) / members.length);
  var rosterSize = Math.max(5, Math.min(10, L.rosterSize || 6, maxByPool || 10));
  var order = members.slice();
  for (var i = order.length - 1; i > 0; i--) {           // Fisher–Yates shuffle
    var j = Math.floor(Math.random() * (i + 1));
    var t = order[i]; order[i] = order[j]; order[j] = t;
  }
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    sh_(SHEET_LEAGUES).getRange(L.row, 6, 1, 6).setValues([[
      'keepers', rosterSize, 'active', JSON.stringify(order), 0, 'makuuchi'
    ]]);
    return { ok:true, order:order, rosterSize:rosterSize };
  } finally { lock.releaseLock(); }
}

function draftPicksOf(id){
  var v = sh_(SHEET_PICKS).getDataRange().getValues(), out = [];
  for (var r=1;r<v.length;r++){
    if (String(v[r][0]) !== String(id)) continue;
    out.push({ pickIndex:Number(v[r][1]), round:Number(v[r][2]), phase:String(v[r][3]),
      handle:String(v[r][4]), rikishi:String(v[r][5]), pickedAt:String(v[r][6]||'') });
  }
  out.sort(function(a,b){ return a.pickIndex - b.pickIndex; });
  return out;
}

function draftState(id){
  var L = leagueRow(id); if (!L) return { ok:false, error:'League not found.' };
  var picks = draftPicksOf(L.id);
  var turn = L.draftStatus === 'active' ? draftTurn(L.draftOrder, L.rosterSize, L.draftPickIdx) : { phase:L.draftStatus==='complete'?'done':'none' };
  return { ok:true, league:{ id:L.id, mode:L.mode, rosterSize:L.rosterSize, draftStatus:L.draftStatus, draftOrder:L.draftOrder },
    picks:picks, turn:turn, pickedNames:picks.map(function(p){ return p.rikishi; }) };
}

function makePick(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.draftStatus !== 'active') return { ok:false, error:'The draft isn\u2019t running.' };
  if (!isMember(L.id, u.handle)) return { ok:false, error:'You\u2019re not in this league.' };
  var rikishi = String(body.rikishi || '').trim();
  if (!rikishi) return { ok:false, error:'No wrestler given.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    // re-read fresh inside the lock — another pick may have landed since the client last polled
    L = leagueRow(body.id);
    var turn = draftTurn(L.draftOrder, L.rosterSize, L.draftPickIdx);
    if (turn.phase === 'done') return { ok:false, error:'The draft is already complete.' };
    if (!turn.handle || turn.handle.toLowerCase() !== u.handle.toLowerCase()) return { ok:false, error:'It\u2019s not your turn.' };
    var already = draftPicksOf(L.id).some(function(p){ return p.rikishi.toLowerCase() === rikishi.toLowerCase(); });
    if (already) return { ok:false, error: rikishi + ' has already been drafted in this league.' };

    var now = new Date().toISOString();
    sh_(SHEET_PICKS).appendRow([L.id, L.draftPickIdx, turn.round, turn.phase, u.handle, rikishi, now]);
    sh_(SHEET_ROSTERS).appendRow([L.id, u.handle, rikishi, turn.phase, 'draft', now]);

    var nextIdx = L.draftPickIdx + 1;
    var nextTurn = draftTurn(L.draftOrder, L.rosterSize, nextIdx);
    var status = nextTurn.phase === 'done' ? 'complete' : 'active';
    sh_(SHEET_LEAGUES).getRange(L.row, 8, 1, 3).setValues([[status, nextIdx, nextTurn.phase]]);
    return { ok:true, nextTurn:nextTurn, draftStatus:status };
  } finally { lock.releaseLock(); }
}

function keeperRostersOf(id){
  var v = sh_(SHEET_ROSTERS).getDataRange().getValues(), out = {};
  for (var r=1;r<v.length;r++){
    if (String(v[r][0]) !== String(id)) continue;
    var h = String(v[r][1]||''); if (!h) continue;
    var key = h.toLowerCase();
    if (!out[key]) out[key] = { makuuchi:[], juryo:[] };
    var div = String(v[r][3]||'').toLowerCase() === 'juryo' ? 'juryo' : 'makuuchi';
    out[key][div].push(String(v[r][2]));
  }
  return out;
}
function whoOwns(id, rikishi){
  var v = sh_(SHEET_ROSTERS).getDataRange().getValues(), key = rikishi.toLowerCase();
  for (var r=1;r<v.length;r++) if (String(v[r][0])===String(id) && String(v[r][2]).toLowerCase()===key) return { row:r+1, handle:String(v[r][1]), division:String(v[r][3]) };
  return null;
}

/* ---- trades (between-tournament only) ---- */
function myTrades(id, handle){
  handle = cleanHandle(handle);
  var v = sh_(SHEET_TRADES).getDataRange().getValues(), out = [], k = handle.toLowerCase();
  for (var r=1;r<v.length;r++){
    if (String(v[r][1]) !== String(id)) continue;
    if (String(v[r][2]).toLowerCase() !== k && String(v[r][3]).toLowerCase() !== k) continue;
    var offer=[], request=[]; try { offer=JSON.parse(v[r][4]||'[]'); } catch(e){} try { request=JSON.parse(v[r][5]||'[]'); } catch(e){}
    out.push({ id:String(v[r][0]), fromHandle:String(v[r][2]), toHandle:String(v[r][3]), offer:offer, request:request,
      status:String(v[r][6]), createdAt:String(v[r][7]||'') });
  }
  return out;
}
function proposeTrade(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.mode !== 'keepers' || L.draftStatus !== 'complete') return { ok:false, error:'Trades are only available after the keeper draft.' };
  if (tournamentActive()) return { ok:false, error:'Trades are closed once the tournament starts.' };
  var toHandle = cleanHandle(body.toHandle);
  if (!toHandle || !isMember(L.id, toHandle)) return { ok:false, error:'That player isn\u2019t in this league.' };
  var offer = Array.isArray(body.offer) ? body.offer : [];
  var request = Array.isArray(body.request) ? body.request : [];
  if (!offer.length && !request.length) return { ok:false, error:'Offer at least one wrestler.' };
  for (var i=0;i<offer.length;i++){ var o = whoOwns(L.id, offer[i]); if (!o || o.handle.toLowerCase()!==u.handle.toLowerCase()) return { ok:false, error:'You don\u2019t own ' + offer[i] + '.' }; }
  for (var j=0;j<request.length;j++){ var w = whoOwns(L.id, request[j]); if (!w || w.handle.toLowerCase()!==toHandle.toLowerCase()) return { ok:false, error: toHandle + ' doesn\u2019t own ' + request[j] + '.' }; }
  var id = newId('tr_'), now = new Date().toISOString();
  sh_(SHEET_TRADES).appendRow([id, L.id, u.handle, toHandle, JSON.stringify(offer), JSON.stringify(request), 'pending', now, '']);
  return { ok:true, id:id };
}
function respondTrade(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var sh = sh_(SHEET_TRADES), v = sh.getDataRange().getValues();
  for (var r=1;r<v.length;r++){
    if (String(v[r][0]) !== String(body.tradeId)) continue;
    if (String(v[r][6]) !== 'pending') return { ok:false, error:'That trade isn\u2019t pending anymore.' };
    if (String(v[r][3]).toLowerCase() !== u.handle.toLowerCase()) return { ok:false, error:'Only the recipient can respond to this trade.' };
    var leagueId = String(v[r][1]);
    if (!body.accept){
      sh.getRange(r+1, 7, 1, 2).setValues([['declined', new Date().toISOString()]]);
      return { ok:true, declined:true };
    }
    if (tournamentActive()) return { ok:false, error:'Trades are closed once the tournament starts.' };
    var offer=[], request=[]; try { offer=JSON.parse(v[r][4]||'[]'); } catch(e){} try { request=JSON.parse(v[r][5]||'[]'); } catch(e){}
    var fromHandle = String(v[r][2]), toHandle = String(v[r][3]);
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      for (var i=0;i<offer.length;i++){ var o = whoOwns(leagueId, offer[i]); if (!o || o.handle.toLowerCase()!==fromHandle.toLowerCase()) return { ok:false, error: offer[i] + ' is no longer available to trade.' }; }
      for (var j=0;j<request.length;j++){ var w = whoOwns(leagueId, request[j]); if (!w || w.handle.toLowerCase()!==toHandle.toLowerCase()) return { ok:false, error: request[j] + ' is no longer available to trade.' }; }
      offer.forEach(function(name){ var o = whoOwns(leagueId, name); sh_(SHEET_ROSTERS).getRange(o.row, 2).setValue(toHandle); });
      request.forEach(function(name){ var w = whoOwns(leagueId, name); sh_(SHEET_ROSTERS).getRange(w.row, 2).setValue(fromHandle); });
      sh.getRange(r+1, 7, 1, 2).setValues([['accepted', new Date().toISOString()]]);
      return { ok:true, accepted:true };
    } finally { lock.releaseLock(); }
  }
  return { ok:false, error:'Trade not found.' };
}

/* ---- waivers: drop one, add an unowned rikishi of the same division ---- */
function addDrop(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.mode !== 'keepers' || L.draftStatus !== 'complete') return { ok:false, error:'Waivers open once the keeper draft is complete.' };
  if (tournamentActive()) return { ok:false, error:'Adds/drops are closed once the tournament starts.' };
  var drop = String(body.drop||'').trim(), add = String(body.add||'').trim();
  if (!drop || !add) return { ok:false, error:'Pick both a wrestler to drop and one to add.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var owned = whoOwns(L.id, drop);
    if (!owned || owned.handle.toLowerCase() !== u.handle.toLowerCase()) return { ok:false, error:'You don\u2019t own ' + drop + '.' };
    if (whoOwns(L.id, add)) return { ok:false, error: add + ' is already owned in this league.' };
    sh_(SHEET_ROSTERS).deleteRow(owned.row);
    sh_(SHEET_ROSTERS).appendRow([L.id, u.handle, add, owned.division, 'waiver', new Date().toISOString()]);
    return { ok:true };
  } finally { lock.releaseLock(); }
}

/* ============================================================
   TEAM HISTORY
   A tournament runs every ~6 weeks; once one finishes, the client
   snapshots the player's finished roster + final score here so it
   survives them drafting a fresh team for the next basho. The score
   and win count are computed client-side (scoring lives in
   gg-account.js) and sent along with the snapshot — this just stores
   it. Upserts on (handle, basho) so a repeated/auto call is harmless.
   ============================================================ */
function archiveTeam(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var basho = String(body.basho || '').trim().slice(0, 60);
  if (!basho) return { ok:false, error:'Missing basho name.' };
  var teamJson = typeof body.team === 'string' ? body.team : JSON.stringify(body.team || {});
  var rowsJson = typeof body.rows === 'string' ? body.rows : JSON.stringify(body.rows || []);
  var score = Number(body.score || 0), wins = Number(body.wins || 0);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sh_(SHEET_HISTORY), v = sh.getDataRange().getValues(), key = u.handle.toLowerCase();
    for (var r=1;r<v.length;r++){
      if (String(v[r][0]).toLowerCase()===key && String(v[r][1])===basho){
        sh.getRange(r+1, 1, 1, 7).setValues([[u.handle, basho, teamJson, score, wins, rowsJson, new Date().toISOString()]]);
        return { ok:true, updated:true };
      }
    }
    sh.appendRow([u.handle, basho, teamJson, score, wins, rowsJson, new Date().toISOString()]);
    return { ok:true, created:true };
  } finally { lock.releaseLock(); }
}

function myHistory(handle){
  handle = cleanHandle(handle);
  if (!handle) return [];
  var v = sh_(SHEET_HISTORY).getDataRange().getValues(), out=[], key = handle.toLowerCase();
  for (var r=1;r<v.length;r++){
    if (String(v[r][0]).toLowerCase()!==key) continue;
    var team = {}; try { team = JSON.parse(v[r][2] || '{}'); } catch(e){}
    var rows = []; try { rows = JSON.parse(v[r][5] || '[]'); } catch(e){}
    out.push({ basho:String(v[r][1]||''), team:team, score:Number(v[r][3]||0), wins:Number(v[r][4]||0), rows:rows, savedAt:String(v[r][6]||'') });
  }
  out.sort(function(a,b){ return new Date(b.savedAt) - new Date(a.savedAt); });
  return out;
}

/* ============================================================
   ADMIN DASHBOARD
   Backs the private admin.html page: site/API connectivity, pageview
   analytics, user moderation (warn/ban/delete), and a read-only feed of
   every message-board post across all leagues. Every admin action here
   requires body.adminKey (or ?adminKey= on GETs) to match ADMIN_KEY above.
   ============================================================ */
function adminGate(key) {
  if (ADMIN_KEY && String(key || '') === String(ADMIN_KEY)) return null;
  return { ok: false, error: 'Not authorised.' };
}

/* record one pageview; called from every public page via gg-nav.js.
   No auth needed — it's write-only and never echoes anything back. */
function logPageview(body) {
  var page = String(body.page || '').trim().slice(0, 80);
  var vid = String(body.visitorId || '').trim().slice(0, 60);
  if (!page || !vid) return { ok: false };
  try { sh_(SHEET_PAGEVIEWS).appendRow([new Date().toISOString(), page, vid]); }
  catch (e) { return { ok: false }; }
  return { ok: true };
}

/* live reachability check from the server side — this is the same side
   that actually needs sumo-api (refreshResults, gg-roster.js's fallback
   chain), so it's a truer signal than checking from the visitor's browser. */
function checkSumoApi() {
  var start = Date.now();
  try {
    var resp = UrlFetchApp.fetch('https://www.sumo-api.com/api/rikishis?limit=1', { muteHttpExceptions: true });
    var code = resp.getResponseCode();
    return { ok: code >= 200 && code < 300, code: code, ms: Date.now() - start, checkedAt: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: String(e), ms: Date.now() - start, checkedAt: new Date().toISOString() };
  }
}

function adminStats() {
  var v = sh_(SHEET_PAGEVIEWS).getDataRange().getValues();
  var total = 0, uniques = {}, byPage = {}, since7 = Date.now() - 7 * 24 * 3600 * 1000, total7 = 0, uniq7 = {};
  for (var r = 1; r < v.length; r++) {
    var vid = String(v[r][2] || ''); if (!vid) continue;
    var page = String(v[r][1] || '(unknown)');
    total++; uniques[vid] = 1;
    if (!byPage[page]) byPage[page] = { total: 0, uniques: {} };
    byPage[page].total++; byPage[page].uniques[vid] = 1;
    var t = Date.parse(String(v[r][0] || ''));
    if (!isNaN(t) && t >= since7) { total7++; uniq7[vid] = 1; }
  }
  var pages = [];
  for (var p in byPage) pages.push({ page: p, total: byPage[p].total, unique: Object.keys(byPage[p].uniques).length });
  pages.sort(function (a, b) { return b.total - a.total; });

  var userRows = Math.max(0, sh_(SHEET_USERS).getDataRange().getValues().length - 1);
  var leagueRows = Math.max(0, sh_(SHEET_LEAGUES).getDataRange().getValues().length - 1);
  var msgRows = Math.max(0, sh_(SHEET_MESSAGES).getDataRange().getValues().length - 1);

  return {
    ok: true,
    pageviews: { total: total, unique: Object.keys(uniques).length, last7Total: total7, last7Unique: Object.keys(uniq7).length, byPage: pages },
    counts: { users: userRows, leagues: leagueRows, messages: msgRows },
    api: checkSumoApi()
  };
}

function adminUsers() {
  var v = sh_(SHEET_USERS).getDataRange().getValues();
  var mem = sh_(SHEET_MEMBERS).getDataRange().getValues();
  var msgs = sh_(SHEET_MESSAGES).getDataRange().getValues();
  var leagueCount = {}, msgCount = {};
  for (var r = 1; r < mem.length; r++) { var h = String(mem[r][1] || '').toLowerCase(); if (h) leagueCount[h] = (leagueCount[h] || 0) + 1; }
  for (var r2 = 1; r2 < msgs.length; r2++) { var h2 = String(msgs[r2][2] || '').toLowerCase(); if (h2) msgCount[h2] = (msgCount[h2] || 0) + 1; }
  var out = [];
  for (var i = 1; i < v.length; i++) {
    if (!String(v[i][0]).trim()) continue;
    var handle = String(v[i][0]), key = handle.toLowerCase();
    var team = {}; try { team = JSON.parse(v[i][3] || '{}'); } catch (e) {}
    out.push({
      handle: handle, name: String(v[i][1] || handle), updated: String(v[i][4] || ''),
      teamPicks: Object.keys(team).filter(function (k) { return team[k]; }).length,
      status: String(v[i][6] || 'active') || 'active', warnMsg: String(v[i][7] || ''),
      leagues: leagueCount[key] || 0, messages: msgCount[key] || 0
    });
  }
  out.sort(function (a, b) { return new Date(b.updated) - new Date(a.updated); });
  return { ok: true, users: out };
}

function findUserRow_(handle) {
  var sh = sh_(SHEET_USERS), v = sh.getDataRange().getValues(), key = String(handle || '').toLowerCase();
  for (var r = 1; r < v.length; r++) if (String(v[r][0]).trim().toLowerCase() === key) return r + 1;
  return 0;
}

function adminWarnUser(body) {
  var bad = adminGate(body.adminKey); if (bad) return bad;
  var row = findUserRow_(body.handle); if (!row) return { ok: false, error: 'User not found.' };
  var msg = String(body.message || '').trim().slice(0, 500);
  if (!msg) return { ok: false, error: 'A warning needs a message.' };
  sh_(SHEET_USERS).getRange(row, 7, 1, 2).setValues([['warned', msg]]);
  return { ok: true };
}

function adminBanUser(body) {
  var bad = adminGate(body.adminKey); if (bad) return bad;
  var row = findUserRow_(body.handle); if (!row) return { ok: false, error: 'User not found.' };
  var msg = String(body.message || '').trim().slice(0, 500) || 'This account has been suspended.';
  sh_(SHEET_USERS).getRange(row, 7, 1, 2).setValues([['banned', msg]]);
  return { ok: true };
}

function adminUnbanUser(body) {
  var bad = adminGate(body.adminKey); if (bad) return bad;
  var row = findUserRow_(body.handle); if (!row) return { ok: false, error: 'User not found.' };
  sh_(SHEET_USERS).getRange(row, 7, 1, 2).setValues([['active', '']]);
  return { ok: true };
}

function adminDeleteUser(body) {
  var bad = adminGate(body.adminKey); if (bad) return bad;
  var row = findUserRow_(body.handle); if (!row) return { ok: false, error: 'User not found.' };
  sh_(SHEET_USERS).deleteRow(row);
  return { ok: true };
}

function adminMessages() {
  var v = sh_(SHEET_MESSAGES).getDataRange().getValues();
  var lv = sh_(SHEET_LEAGUES).getDataRange().getValues();
  var names = {}; for (var r = 1; r < lv.length; r++) names[String(lv[r][0])] = String(lv[r][1]);
  var out = [];
  for (var i = 1; i < v.length; i++) {
    if (!String(v[i][0]).trim()) continue;
    out.push({
      id: String(v[i][0]), leagueId: String(v[i][1]), league: names[String(v[i][1])] || '(deleted league)',
      handle: String(v[i][2]), name: String(v[i][3] || v[i][2]), body: String(v[i][4] || ''),
      parentId: String(v[i][5] || ''), created: String(v[i][6] || ''), board: 'league'
    });
  }
  var bv = sh_(SHEET_BOARD).getDataRange().getValues();
  for (var j = 1; j < bv.length; j++) {
    if (!String(bv[j][0]).trim()) continue;
    out.push({
      id: String(bv[j][0]), leagueId: '', league: 'Leaderboard (site-wide)',
      handle: String(bv[j][1]), name: String(bv[j][2] || bv[j][1]), body: String(bv[j][3] || ''),
      parentId: String(bv[j][4] || ''), created: String(bv[j][5] || ''), board: 'leaderboard'
    });
  }
  out.sort(function (a, b) { return new Date(b.created) - new Date(a.created); });
  return { ok: true, messages: out };
}

function adminDeleteMessageFn(body) {
  var bad = adminGate(body.adminKey); if (bad) return bad;
  var sh = sh_(SHEET_MESSAGES), v = sh.getDataRange().getValues();
  for (var r = 1; r < v.length; r++) {
    if (String(v[r][0]) === String(body.msgId)) { sh.deleteRow(r + 1); return { ok: true }; }
  }
  return { ok: false, error: 'Message not found.' };
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
