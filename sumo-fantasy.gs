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
var SHEET_RANKINGS  = 'Rankings';
var SHEET_ROSTERS  = 'KeeperRosters';
var SHEET_PICKS    = 'DraftPicks';
var SHEET_TRADES   = 'Trades';
var SHEET_FEEDBACK = 'Feedback';
var SHEET_PAGEVIEWS = 'PageViews';
var SHEET_BOARD = 'LeaderboardBoard';
var SHEET_BOARD_VOTES = 'LeaderboardVotes';
var SHEET_DMS = 'DirectMessages';
var SHEET_CHAMPS = 'Champions';
var SHEET_BOARDS = 'DraftBoards';

// Label for the current tournament (shown in the app).
var BASHO_LABEL   = 'Aki 2026';

// Password for the private /admin.html dashboard (connectivity, analytics,
// user moderation, message-board review).
//
// The secret itself is NOT stored in this source file anymore — it lives only
// in the Apps Script project's Script Properties, so this .gs can be zipped,
// backed up, or shared without leaking the key. To set (or rotate) it:
//   Apps Script editor → Project Settings (gear) → Script Properties →
//   Add property:  ADMIN_KEY = <your long random string>
// Then enter that SAME string into admin.html's unlock prompt. If the property
// is unset, ADMIN_KEY is "" and adminGate() below fails closed (rejects
// everything), so a misconfiguration locks the dashboard rather than opening it.
var ADMIN_KEY = (function () {
  try { return (PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || '').trim(); }
  catch (e) { return ''; }
})();

// The handle/name that admin-sent direct messages appear to come from. It's a
// reserved handle: register()/changeHandle() below block anyone else from
// taking it, so a DM from "Sumo Slapdown" is always genuinely from the admin.
var ADMIN_HANDLE = 'gyoji';
var ADMIN_NAME   = 'Sumo Slapdown';

/* ---- league scoring: the default rules, and a normalizer that clamps a
   commissioner's custom values into safe ranges. Shared by front and back;
   the client mirrors these defaults so scoring always agrees. ----
   winPoint      : points per match won            (default 1, capped 1..6)
   sanyakuBonus  : points per rank-gap step when beating a higher-ranked
                   sanyaku opponent (loserLevel - winnerLevel)  (default 1, 0..6)
   sansho        : points per special prize         (default 5, 0..20)
   yusho         : points for the Makuuchi yusho     (default 5, 0..20) */
function defaultScoring() {
  return { winPoint: 1, sanyakuBonus: 1, sansho: 5, yusho: 5 };
}
function normalizeScoring(raw) {
  var d = defaultScoring(), s = raw || {};
  function clamp(v, lo, hi, dflt) {
    var n = Number(v); if (isNaN(n)) n = dflt;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  }
  return {
    winPoint:     clamp(s.winPoint,     1, 6,  d.winPoint),   // cap point-per-win at 6
    sanyakuBonus: clamp(s.sanyakuBonus, 0, 6,  d.sanyakuBonus),
    sansho:       clamp(s.sansho,       0, 20, d.sansho),
    yusho:        clamp(s.yusho,        0, 20, d.yusho)
  };
}
function parseScoring(cell) {
  var raw = null; try { raw = JSON.parse(cell || '{}'); } catch (e) { raw = {}; }
  return normalizeScoring(raw);
}

// Bump this whenever the backend changes. Fetch <exec>?action=version to
// confirm which code is actually LIVE — if this number doesn't match, the
// deploy didn't land (you saved but didn't "Deploy → New version").
var BACKEND_VERSION = '2026-09-03-autoarchive';
/* The pick clock. A member with auto-draft ON is given only a short grace —
   he asked to be drafted for, so there is nothing to wait for. A member with
   it OFF gets the league's full clock before the board picks for him. Either
   way the pick comes off HIS board, which defaults to banzuke order, so an
   absentee who never touched it still drafts sensibly. */
var DRAFT_GRACE = 30;            // seconds, auto-draft on
var PICK_CLOCK_DEFAULT = 120;    // seconds, auto-draft off

/* ---------- one-time: build the tabs ---------- */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var users = ensureSheet(ss, SHEET_USERS, ['handle', 'name', 'auth', 'team', 'updated', 'avatar', 'status', 'warnMsg']);
  migrateUsersV1(users);                       // upgrades a v1 sheet (no auth column) in place
  migrateUsersV2(users);                       // upgrades a v1/v2 sheet (no avatar column) in place
  migrateUsersV3(users);                       // upgrades a v1/v2/v3 sheet (no status/warnMsg columns) in place
  ensureSheet(ss, SHEET_RESULTS, ['day', 'division', 'east', 'west', 'winner', 'kimarite']);
  var leagues = ensureSheet(ss, SHEET_LEAGUES, ['id', 'name', 'commissioner', 'created', 'inviteCode',
    'mode', 'rosterSize', 'draftStatus', 'draftOrder', 'draftPickIdx', 'draftPhase', 'scoring', 'draftDate', 'draftAgree',
    'benchSize', 'farmSize', 'pickClock', 'pickDeadline', 'defaultOrder']);
  migrateLeaguesV2(leagues);   // upgrades an older Leagues sheet (no keeper columns) in place
  ensureSheet(ss, SHEET_MEMBERS, ['leagueId', 'handle', 'joined']);
  ensureSheet(ss, SHEET_MESSAGES, ['id', 'leagueId', 'handle', 'name', 'body', 'parentId', 'created']);
  ensureSheet(ss, SHEET_LGTEAMS, ['leagueId', 'handle', 'team', 'updated']);
  ensureSheet(ss, SHEET_HISTORY, ['handle', 'basho', 'team', 'score', 'wins', 'rows', 'savedAt']);
  ensureSheet(ss, SHEET_RANKINGS, ['handle', 'rankIdx', 'bashoCount', 'topStreak', 'lastBasho']);
  var rosters = ensureSheet(ss, SHEET_ROSTERS, ['leagueId', 'handle', 'rikishi', 'division', 'acquiredVia', 'acquiredAt', 'slot']);
  migrateRostersSlot(rosters);
  ensureSheet(ss, SHEET_PICKS, ['leagueId', 'pickIndex', 'round', 'phase', 'handle', 'rikishi', 'pickedAt']);
  ensureSheet(ss, SHEET_TRADES, ['id', 'leagueId', 'fromHandle', 'toHandle', 'offer', 'request', 'status', 'createdAt', 'resolvedAt']);
  ensureSheet(ss, SHEET_FEEDBACK, ['createdAt', 'kind', 'handle', 'subject', 'message', 'targetUser', 'page', 'status']);
  var pageviews = ensureSheet(ss, SHEET_PAGEVIEWS, ['ts', 'page', 'visitorId', 'tz']);
  migratePageViewsV1(pageviews);  // upgrades a pre-regionality sheet (no tz column) in place
  ensureSheet(ss, SHEET_BOARD, ['id', 'handle', 'name', 'body', 'parentId', 'created', 'updated', 'editedByAdmin']);
  ensureSheet(ss, SHEET_BOARD_VOTES, ['msgId', 'handle', 'value', 'votedAt']);
  ensureSheet(ss, SHEET_DMS, ['id', 'fromHandle', 'fromName', 'toHandle', 'body', 'created', 'readByRecipient']);
  ensureSheet(ss, SHEET_CHAMPS, CHAMP_HEAD);
  ensureSheet(ss, SHEET_BOARDS, DBOARD_HEAD);
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
  // v3: custom scoring, scheduled draft date, and per-member date agreement
  head = sh.getRange(1, 1, 1, Math.max(11, sh.getLastColumn())).getValues()[0];
  if (String(head[11] || '').toLowerCase() !== 'scoring') {
    sh.getRange(1, 12, 1, 3).setValues([['scoring', 'draftDate', 'draftAgree']]);
  }
  /* v4: Makuuchi splits into ACTIVE (scores) + BENCH (kept, doesn't score), and
     the Juryo farm gets its own size. rosterSize keeps its old meaning — the
     active cap — so leagues written before this migration behave identically:
     a blank benchSize reads as 0 and a blank farmSize falls back to rosterSize,
     which is exactly what the farm used to be. */
  head = sh.getRange(1, 1, 1, Math.max(14, sh.getLastColumn())).getValues()[0];
  if (String(head[14] || '').toLowerCase() !== 'benchsize') {
    sh.getRange(1, 15, 1, 2).setValues([['benchSize', 'farmSize']]);
  }
  /* v5: the pick clock. Blank on an existing row is fine everywhere — pickClock
     falls back to the default, a blank deadline means "no clock running", and a
     blank defaultOrder just means a boardless member can't be auto-picked for
     (the draft then waits for him, exactly as it did before this migration). */
  head = sh.getRange(1, 1, 1, Math.max(16, sh.getLastColumn())).getValues()[0];
  if (String(head[16] || '').toLowerCase() !== 'pickclock') {
    sh.getRange(1, 17, 1, 3).setValues([['pickClock', 'pickDeadline', 'defaultOrder']]);
  }
}

// pre-regionality PageViews sheets had only [ts,page,visitorId]. Append the
// 'tz' column (visitor's IANA timezone, e.g. "America/Los_Angeles") if
// missing; existing rows just get a blank cell, which the admin dashboard's
// region/time-of-day breakdowns read as "Unknown" / UTC.
function migratePageViewsV1(sh) {
  var lastCol = Math.max(3, sh.getLastColumn());
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (String(head[3] || '').toLowerCase() !== 'tz') {
    sh.getRange(1, 4).setValue('tz');
  }
}

/* ---------- GET: hand back leaderboard data ---------- */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'data';
  try {
    if (action === 'version') return json({ ok: true, version: BACKEND_VERSION });
    if (action === 'list')    return json({ ok: true, users: readUsers() });
    if (action === 'results') return json({ ok: true, results: readResults() });
    if (action === 'leagues') return json(myLeagues(e.parameter.handle));
    if (action === 'league')  return json(leagueDetail(e.parameter.id, e.parameter.handle));
    if (action === 'invite')  return json(leagueByInvite(e.parameter.code));
    if (action === 'history') return json({ ok: true, history: myHistory(e.parameter.handle) });
    if (action === 'draftState') return json(draftState(e.parameter.id));
    if (action === 'trades')  return json({ ok: true, trades: myTrades(e.parameter.id, e.parameter.handle) });
    if (action === 'board')   return json({ ok: true, messages: boardMessages(e.parameter.handle) });
    if (action === 'accountSummary') return json(accountSummary(e.parameter.handle));
    // NOTE: admin reads (adminStats/adminUsers/adminMessages/adminFeedback/
    // adminDmThreads) used to live here as GET actions, which put ?adminKey=...
    // in the URL — and URLs land in browser history, referer headers, and Apps
    // Script's own execution logs. They're now POST-only (see doPost), so the
    // key travels in the request body instead. A stray GET to one of those
    // actions now just falls through to the public default below (which never
    // includes the auth column), so nothing admin-only leaks.
    if (action === 'dmThreads') return json(dmThreads(e.parameter.handle));
    if (action === 'dmUnread')  return json(dmUnread(e.parameter.handle));
    if (action === 'dmDirectory') return json(dmDirectory(e.parameter.handle));
    return json({ ok: true, users: readUsers(), results: readResults(), meta: readMeta(),
                  champion: reigningChampion_('') });
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
    if (body.action === 'changeHandle') return json(changeHandle(body));
    if (body.action === 'save')     return json(saveTeam(body));
    if (body.action === 'saveAvatar') return json(saveAvatar(body));
    if (body.action === 'createLeague') return json(createLeague(body));
    if (body.action === 'joinLeague')   return json(joinLeague(body));
    if (body.action === 'leaveLeague')  return json(leaveLeague(body));
    if (body.action === 'removeMember') return json(removeMember(body));
    if (body.action === 'renameLeague') return json(renameLeague(body));
    if (body.action === 'deleteLeague') return json(deleteLeague(body));
    if (body.action === 'postMessage')  return json(postMessage(body));
    if (body.action === 'setLeagueMode') return json(setLeagueMode(body));
    if (body.action === 'setLeagueRoster')  return json(setLeagueRoster(body));
    if (body.action === 'setLeagueScoring') return json(setLeagueScoring(body));
    if (body.action === 'setDraftDate')  return json(setDraftDate(body));
    if (body.action === 'agreeDraftDate') return json(agreeDraftDate(body));
    if (body.action === 'startDraft')    return json(startDraft(body));
    if (body.action === 'makePick')      return json(makePick(body));
    if (body.action === 'proposeTrade')  return json(proposeTrade(body));
    if (body.action === 'respondTrade')  return json(respondTrade(body));
    if (body.action === 'setActive')     return json(setActive(body));
    if (body.action === 'saveDraftBoard') return json(saveDraftBoard(body));
    if (body.action === 'openRedraft')   return json(openSupplementalDraft(body));
    if (body.action === 'redraftState')  return json(redraftState(body.id));
    if (body.action === 'redraftPick')   return json(redraftPick(body));
    if (body.action === 'addDrop')       return json(addDrop(body));
    if (body.action === 'deleteMessage')return json(deleteMessage(body));
    if (body.action === 'saveLeagueTeam') return json(saveLeagueTeam(body));
    if (body.action === 'archiveTeam') return json(archiveTeam(body));
    if (body.action === 'postBoardMessage')      return json(postBoardMessage(body));
    if (body.action === 'editBoardMessage')      return json(editBoardMessage(body));
    if (body.action === 'deleteBoardMessage')    return json(deleteBoardMessage(body));
    if (body.action === 'voteBoardMessage')      return json(voteBoardMessage(body));
    // Admin READS — moved here from doGet so the key rides in the POST body,
    // not the URL. adminGated() runs the gate and only calls the reader on pass.
    if (body.action === 'adminStats')     return json(adminGated(body.adminKey, adminStats));
    if (body.action === 'adminResetAnalytics') return json(adminGated(body.adminKey, adminResetAnalytics));
    if (body.action === 'adminResetBasho')     return json(adminResetBasho(body));
    if (body.action === 'adminArchiveBasho')   return json(adminArchiveBasho(body));
    if (body.action === 'adminUsers')     return json(adminGated(body.adminKey, adminUsers));
    if (body.action === 'adminMessages')  return json(adminGated(body.adminKey, adminMessages));
    if (body.action === 'adminFeedback')  return json(adminGated(body.adminKey, adminFeedback));
    if (body.action === 'adminDmThreads') return json(adminDmThreads(body.adminKey));
    if (body.action === 'adminEditBoardMessage') return json(adminEditBoardMessage(body));
    if (body.action === 'adminDeleteBoardMsg')   return json(adminDeleteBoardMsg(body));
    if (body.action === 'feedback')    return json(submitFeedback(body));
    if (body.action === 'logPageview') return json(logPageview(body));
    if (body.action === 'adminWarnUser')      return json(adminWarnUser(body));
    if (body.action === 'adminBanUser')       return json(adminBanUser(body));
    if (body.action === 'adminUnbanUser')     return json(adminUnbanUser(body));
    if (body.action === 'adminDeleteUser')    return json(adminDeleteUser(body));
    if (body.action === 'requestPinReset')    return json(requestPinReset(body));
    if (body.action === 'adminPinResets')     return json(adminPinResets(body.adminKey));
    if (body.action === 'adminApplyRanking')  return json(adminApplyRanking(body));
    if (body.action === 'adminResetPin')      return json(adminResetPin(body));
    if (body.action === 'adminDeleteMessage') return json(adminDeleteMessageFn(body));
    if (body.action === 'adminSetFeedbackStatus') return json(adminSetFeedbackStatus(body));
    if (body.action === 'adminDeleteFeedback')    return json(adminDeleteFeedback(body));
    if (body.action === 'dmSend')       return json(dmSend(body));
    if (body.action === 'dmMarkRead')   return json(dmMarkRead(body));
    if (body.action === 'dmDelete')     return json(dmDelete(body));
    if (body.action === 'adminDmSend')     return json(adminDmSend(body));
    if (body.action === 'adminBroadcast')  return json(adminBroadcast(body));
    if (body.action === 'adminDmMarkRead') return json(adminDmMarkRead(body));
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
  // handle + targetUser are account handles: run them through the same
  // charset filter accounts use (cleanHandle -> [A-Za-z0-9_.-] or '').
  // Feedback can be submitted anonymously and was NOT validated before, so a
  // crafted handle could carry quotes/script into the admin dashboard's
  // action buttons. cleanHandle blanks anything malformed; a blank handle just
  // means "anonymous" (no Reply button), which is the safe default.
  sh.appendRow([
    new Date(),
    kind,
    cleanHandle(body.handle),
    String(body.subject || '').trim().slice(0, 160),
    message,
    cleanHandle(body.targetUser),
    String(body.page || '').slice(0, 200),
    'new'
  ]);
  return { ok: true };
}

/* create an account: fails if the handle is taken (unless it's an
   unclaimed v1 row with no PIN, which the first register claims) */
/* Welcome DM dropped into a new player's inbox on sign-up, sent from the
   ADMIN_HANDLE account so it displays as being from "Sumo Slapdown". */
var WELCOME_MSG = "Welcome to Sumo Slap Down! The site is currently in beta and being updated regularly, so please bear with any temporary glitches. The suggestion box and bug reporting tools are wide open\u2014if you want to be one of our very first official beta testers, I'd love your help. Thank you for joining the league!";
function sendWelcomeDm(toHandle){
  try {
    sh_(SHEET_DMS).appendRow([ newId('dm_'), ADMIN_HANDLE, ADMIN_NAME, toHandle, WELCOME_MSG, new Date().toISOString(), '' ]);
  } catch (e) {}   // never let a welcome-note hiccup block account creation
}

function register(body) {
  var handle = cleanHandle(body.handle);
  if (!handle) return { ok: false, error: 'Handle: 2\u201340 letters, digits, _ . -' };
  var claimingAdmin = handle.toLowerCase() === ADMIN_HANDLE;   // the reserved "Sumo Slapdown" identity
  if (claimingAdmin && PropertiesService.getScriptProperties().getProperty('ALLOW_ADMIN_CLAIM') !== '1')
    return { ok: false, error: 'That handle is reserved \u2014 pick another.' };
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
          if (claimingAdmin) PropertiesService.getScriptProperties().deleteProperty('ALLOW_ADMIN_CLAIM'); else sendWelcomeDm(handle);
          return { ok: true, claimed: true, handle: handle };
        }
        return { ok: false, error: 'That handle is taken \u2014 sign in instead.' };
      }
    }
    sh.appendRow([handle, name, auth, '{}', when, avatar]);
    if (claimingAdmin) PropertiesService.getScriptProperties().deleteProperty('ALLOW_ADMIN_CLAIM'); else sendWelcomeDm(handle);
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

/* change handle: the account's PIN hash is bound to the handle string
   (see GG.pinAuth client-side — it hashes "handle:pin:salt"), so a rename
   needs a freshly-computed hash for the new handle, not just a rename. The
   client re-derives that hash from the PIN the user re-enters and sends
   both: the OLD auth (proving they own the account) and the NEW auth (to
   store going forward). Cascades the new handle into every sheet that
   references it as a foreign key. */
function changeHandle(body) {
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok: false, error: 'Not authorised.' };
  var newHandle = cleanHandle(body.newHandle);
  if (!newHandle) return { ok: false, error: 'Handle: 2\u201340 letters, digits, _ . -' };
  if (newHandle.toLowerCase() === ADMIN_HANDLE) return { ok: false, error: 'That handle is reserved \u2014 pick another.' };
  if (newHandle.toLowerCase() === u.handle.toLowerCase()) return { ok: false, error: 'That\u2019s already your handle.' };
  var newAuth = String(body.newAuth || '').slice(0, 80);
  if (!newAuth) return { ok: false, error: 'Missing new PIN hash.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (findUser(newHandle)) return { ok: false, error: 'That handle is already taken.' };
    var oldHandle = u.handle;
    var usersSh = sh_(SHEET_USERS), uv = usersSh.getDataRange().getValues();
    var found = false;
    for (var r = 1; r < uv.length; r++) {
      if (String(uv[r][0]).toLowerCase() === oldHandle.toLowerCase()) {
        usersSh.getRange(r + 1, 1).setValue(newHandle);
        usersSh.getRange(r + 1, 3).setValue(newAuth);
        found = true;
        break;
      }
    }
    if (!found) return { ok: false, error: 'Account not found.' };
    renameHandleInSheet_(SHEET_MEMBERS, [1], oldHandle, newHandle);
    renameHandleInSheet_(SHEET_MESSAGES, [2], oldHandle, newHandle);
    renameHandleInSheet_(SHEET_LGTEAMS, [1], oldHandle, newHandle);
    renameHandleInSheet_(SHEET_HISTORY, [0], oldHandle, newHandle);
    renameHandleInSheet_(SHEET_ROSTERS, [1], oldHandle, newHandle);
    renameHandleInSheet_(SHEET_PICKS, [4], oldHandle, newHandle);
    renameHandleInSheet_(SHEET_TRADES, [2, 3], oldHandle, newHandle);
    renameHandleInSheet_(SHEET_LEAGUES, [2], oldHandle, newHandle);      // commissioner
    renameHandleInSheet_(SHEET_BOARD, [1], oldHandle, newHandle);
    renameHandleInSheet_(SHEET_BOARD_VOTES, [1], oldHandle, newHandle);
    return { ok: true, handle: newHandle };
  } finally { lock.releaseLock(); }
}
function renameHandleInSheet_(sheetName, cols, oldHandle, newHandle) {
  var sh = sh_(sheetName); if (!sh) return;
  var v = sh.getDataRange().getValues();
  var key = oldHandle.toLowerCase();
  for (var r = 1; r < v.length; r++) {
    for (var ci = 0; ci < cols.length; ci++) {
      var c = cols[ci];
      if (String(v[r][c] || '').toLowerCase() === key) sh.getRange(r + 1, c + 1).setValue(newHandle);
    }
  }
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
  var ranks = rankBadgeMap_();
  for (var r = 1; r < v.length; r++) {
    if (!String(v[r][0]).trim()) continue;
    var team = {};
    try { team = JSON.parse(v[r][3] || '{}'); } catch (e) {}
    var rk = ranks[String(v[r][0]).toLowerCase()] || { idx:0, label:RANK_LADDER[0].label, div:RANK_LADDER[0].div };
    out.push({ handle: String(v[r][0]), name: String(v[r][1] || v[r][0]), team: team, updated: String(v[r][4] || ''), avatar: String(v[r][5] || ''), rank: rk });
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
    draftPhase: String(v[r][10]||''),
    scoring: parseScoring(v[r][11]),
    draftDate: String(v[r][12]||''),
    draftAgree: (function(){ try { return JSON.parse(v[r][13]||'{}'); } catch(e){ return {}; } })(),
    benchSize: Number(v[r][14] || 0) || 0,
    /* blank (pre-v4 row) means "farm was the same size as the active roster" —
       0 is a real, different answer, so test for blank rather than falsy */
    farmSize: (v[r][15] === '' || v[r][15] == null) ? (Number(v[r][6]||6) || 6) : (Number(v[r][15]) || 0),
    pickClock: Number(v[r][16] || 0) || PICK_CLOCK_DEFAULT,
    pickDeadline: String(v[r][17] || ''),
    /* The banzuke order as the client saw it when the draft started — the
       fallback board for a member who never saved one of his own. Snapshotted
       once so a mid-draft banzuke change can't reshuffle anyone's queue. */
    defaultOrder: (function(){ try { return JSON.parse(v[r][18]||'null') || null; } catch(e){ return null; } })()
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
  var boards = L.mode === 'keepers' ? draftBoardsOf(id) : {};
  var mem = members.map(function(h){
    var t = teams[h.toLowerCase()];
    var ros = rosters[h.toLowerCase()] || { makuuchi:[], juryo:[] };
    var bd = boards[h.toLowerCase()] || null;
    return { handle:h, name: byh[h.toLowerCase()] || h, team: t ? t.team : {}, teamUpdated: t ? t.updated : '',
      roster: ros,
      /* everyone sees WHETHER a member has set a board (so the commissioner can
         chase the stragglers) but only you get to see your own order */
      boardSet: !!(bd && (bd.makuuchi.length || bd.juryo.length)),
      boardUpdated: bd ? bd.updated : '',
      draftBoard: (handle && h.toLowerCase() === handle.toLowerCase()) ? bd : null };
  });
  var msgs = messagesOf(id);
  // draft-date agreement: which members have agreed to the scheduled date
  var agree = L.draftAgree || {};
  var agreedCount = 0;
  mem.forEach(function(m){
    m.agreedDraft = !!agree[m.handle.toLowerCase()];
    if (m.agreedDraft) agreedCount++;
  });
  return { ok:true, league:{ id:L.id, name:L.name, commissioner:L.commissioner, inviteCode:L.inviteCode,
    mode:L.mode, rosterSize:L.rosterSize, benchSize:L.benchSize, farmSize:L.farmSize, draftStatus:L.draftStatus,
    scoring:L.scoring, draftDate:L.draftDate,
    draftAgreedCount:agreedCount, draftMemberCount:mem.length,
    isCommissioner: handle && L.commissioner.toLowerCase()===handle.toLowerCase(),
    iAgreedDraft: handle ? !!agree[handle.toLowerCase()] : false,
    isMember: handle ? isMember(id, handle) : false },
    champion: reigningChampion_(id),
    members:mem, messages:msgs };
}

/* =====================================================================
   DRAFT BOARDS — a member's pre-draft auto-draft order for one league.
   One row per (league, member): the ordered shikona for each division plus
   the auto-draft toggle. Set on the league page any time before the draft,
   read back by the draft room on the day, and re-saved from the room when
   the order is changed there — so the two surfaces are the same board, not
   two copies of one.

   The order is stored as names, not ranks, so it survives a new banzuke:
   the draft room reconciles it against whatever roster actually loads,
   keeping your order for the men still ranked, dropping the departed and
   appending newcomers in banzuke order.
   ===================================================================== */
var DBOARD_HEAD = ['leagueId', 'handle', 'makuuchi', 'juryo', 'auto', 'updated'];
/* Creating the sheet is a WRITE, and it belongs only on the write path.
   draftBoardsOf() runs on every leagueDetail and on every draftState poll —
   four seconds apart during a live draft — and routing those through
   ensureSheet() meant the first request after a deploy paid for an
   insertSheet + appendRow before it could answer. Reads now get the
   read-only accessor and treat a missing sheet as "no boards yet". */
function boardSheet_(){ return ensureSheet(SpreadsheetApp.getActiveSpreadsheet(), SHEET_BOARDS, DBOARD_HEAD); }
function boardSheetIfAny_(){ return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_BOARDS); }

function parseNames_(cell){
  var out = [];
  try { out = JSON.parse(cell || '[]'); } catch(e){ out = []; }
  if (!Array.isArray(out)) return [];
  var seen = {}, keep = [];
  for (var i = 0; i < out.length && keep.length < 200; i++){
    var n = String(out[i] || '').trim().slice(0, 40);
    if (!n) continue;
    var k = n.toLowerCase(); if (seen[k]) continue;   // a duplicate would draft twice
    seen[k] = 1; keep.push(n);
  }
  return keep;
}

/* Every member's board for one league, keyed by lowercase handle. The whole
   league's boards ride along with leagueDetail so the page can show who has
   set one — a commissioner chasing people before draft day needs to see it. */
function draftBoardsOf(id){
  var sh = boardSheetIfAny_(); if (!sh) return {};
  var v = sh.getDataRange().getValues(), out = {};
  for (var r = 1; r < v.length; r++){
    if (String(v[r][0]) !== String(id)) continue;
    var h = String(v[r][1] || ''); if (!h) continue;
    out[h.toLowerCase()] = {
      makuuchi: parseNames_(v[r][2]),
      juryo:    parseNames_(v[r][3]),
      auto:     String(v[r][4]) === 'true',
      updated:  String(v[r][5] || '')
    };
  }
  return out;
}

function saveDraftBoard(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.mode !== 'keepers') return { ok:false, error:'Draft boards are for keepers leagues.' };
  if (!isMember(L.id, u.handle)) return { ok:false, error:'You are not in that league.' };
  var mak = parseNames_(JSON.stringify(body.makuuchi || []));
  var jur = parseNames_(JSON.stringify(body.juryo || []));
  var auto = !!body.auto;
  var when = new Date().toISOString();
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = boardSheet_(), v = sh.getDataRange().getValues(), key = u.handle.toLowerCase();
    for (var r = 1; r < v.length; r++){
      if (String(v[r][0]) !== String(L.id) || String(v[r][1] || '').toLowerCase() !== key) continue;
      sh.getRange(r + 1, 1, 1, DBOARD_HEAD.length)
        .setValues([[L.id, u.handle, JSON.stringify(mak), JSON.stringify(jur), auto, when]]);
      return { ok:true, saved:mak.length + jur.length, auto:auto, updated:when };
    }
    sh.appendRow([L.id, u.handle, JSON.stringify(mak), JSON.stringify(jur), auto, when]);
    return { ok:true, saved:mak.length + jur.length, auto:auto, updated:when };
  } finally { lock.releaseLock(); }
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
  var mode = (body.mode === 'keepers') ? 'keepers' : 'classic';
  var rosterSize = Math.max(1, Math.min(12, Number(body.rosterSize) || 6));
  var benchSize  = Math.max(0, Math.min(8,  Number(body.benchSize)  || 0));
  var farmSize   = (body.farmSize == null || body.farmSize === '')
        ? rosterSize : Math.max(0, Math.min(10, Number(body.farmSize) || 0));
  var scoring = normalizeScoring(body.scoring);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var id = newId('lg_'), code = inviteCode(), when = new Date().toISOString();
    // full row incl. mode + scoring columns so a league is never momentarily default
    sh_(SHEET_LEAGUES).appendRow([id, name, u.handle, when, code, mode, rosterSize, 'none', '', 0, 'makuuchi',
      JSON.stringify(scoring), '', '{}', benchSize, farmSize]);
    sh_(SHEET_MEMBERS).appendRow([id, u.handle, when]);
    return { ok:true, id:id, inviteCode:code, mode:mode, rosterSize:rosterSize,
             benchSize:benchSize, farmSize:farmSize, scoring:scoring };
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

/* A live draft holds a SNAPSHOT of the member list in draftOrder. Letting
   someone out of the league mid-draft leaves a ghost on the clock: he can no
   longer pick (makePick checks membership) but the clock keeps coming round to
   him and the auto-drafter keeps taking picks on his behalf, so the draft ends
   with a full roster owned by somebody who isn't in the league. Both doors are
   shut until the draft is done. */
function draftBusy_(L){
  if (L.draftStatus === 'active')  return { ok:false, error:'The draft is underway \u2014 wait for it to finish.' };
  if (L.draftStatus === 'redraft') return { ok:false, error:'The supplemental re-draft is underway \u2014 wait for it to finish.' };
  return null;
}

function leaveLeague(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.commissioner.toLowerCase()===u.handle.toLowerCase()) return { ok:false, error:'The commissioner can\u2019t leave — delete the league or hand it off.' };
  var busy = draftBusy_(L); if (busy) return busy;
  return removeMemberRow(L.id, u.handle);
}

function removeMember(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.commissioner.toLowerCase()!==u.handle.toLowerCase()) return { ok:false, error:'Only the commissioner can remove members.' };
  var target = cleanHandle(body.member);
  if (target.toLowerCase()===L.commissioner.toLowerCase()) return { ok:false, error:'The commissioner can\u2019t be removed.' };
  var busy = draftBusy_(L); if (busy) return busy;
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

// Delete a whole league. Commissioner-only, and cascades: removes the
// league row plus every row keyed to its id in the member/message/team/
// roster/pick/trade sheets, so nothing is orphaned behind it.
function deleteLeague(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.commissioner.toLowerCase()!==u.handle.toLowerCase()) return { ok:false, error:'Only the commissioner can delete the league.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var id = String(L.id);
    deleteRowsWhere_(SHEET_MEMBERS,  0, id);
    deleteRowsWhere_(SHEET_MESSAGES, 1, id);
    deleteRowsWhere_(SHEET_LGTEAMS,  0, id);
    deleteRowsWhere_(SHEET_ROSTERS,  0, id);
    deleteRowsWhere_(SHEET_PICKS,    0, id);
    deleteRowsWhere_(SHEET_TRADES,   1, id);
    deleteRowsWhere_(SHEET_BOARDS,   0, id);
    // the league row itself last — re-read its row in case earlier deletes shifted nothing here (different sheet), but be safe
    var ls = sh_(SHEET_LEAGUES), lv = ls.getDataRange().getValues();
    for (var r=lv.length-1;r>=1;r--) if (String(lv[r][0])===id) ls.deleteRow(r+1);
    return { ok:true };
  } finally { lock.releaseLock(); }
}
// delete every row in `sheetName` whose column `col` (0-based) equals `id`
function deleteRowsWhere_(sheetName, col, id){
  var sh = sh_(sheetName); if (!sh) return;
  var v = sh.getDataRange().getValues();
  for (var r=v.length-1;r>=1;r--) if (String(v[r][col])===String(id)) sh.deleteRow(r+1);
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

/* ============================================================
   DIRECT MESSAGES  ·  user <-> user (and admin <-> user)
   One flat DirectMessages sheet; a "thread" is just every row between
   two handles. Rows: [id, fromHandle, fromName, toHandle, body, created,
   readByRecipient]. Reads are auth'd so you only ever see your own
   threads; the admin variants below are adminKey-gated and impersonate
   ADMIN_HANDLE so replies to feedback come from "Sumo Slapdown".
   ============================================================ */

/* the messaging directory: every real account except yourself and the
   reserved admin handle, as { handle, name, avatar }. Used by the account
   modal's "new message" picker so you can only ever address a verified
   user (search happens client-side over this list). */
function dmDirectory(handle) {
  var meKey = String(handle || '').toLowerCase();
  var v = sh_(SHEET_USERS).getDataRange().getValues();
  var out = [];
  for (var r = 1; r < v.length; r++) {
    var h = String(v[r][0] || '').trim();
    if (!h) continue;
    var k = h.toLowerCase();
    if (k === meKey || k === ADMIN_HANDLE) continue;       // not yourself, not the reserved admin row
    if (String(v[r][6] || '') === 'banned') continue;      // hide banned accounts
    out.push({ handle: h, name: String(v[r][1] || h), avatar: String(v[r][5] || '') });
  }
  out.sort(function (a, b) { return String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()); });
  return { ok: true, users: out };
}

/* every DM that involves `handle` (sent or received), oldest first,
   grouped into threads keyed by the OTHER participant's handle. */
function dmThreads(handle) {
  handle = cleanHandle(handle);
  if (!handle) return { ok: false, error: 'Bad handle.' };
  var key = handle.toLowerCase();
  var v = sh_(SHEET_DMS).getDataRange().getValues();
  var byOther = {}, order = [];
  for (var r = 1; r < v.length; r++) {
    var from = String(v[r][1] || ''), to = String(v[r][3] || '');
    if (!from && !to) continue;
    var fromKey = from.toLowerCase(), toKey = to.toLowerCase();
    if (fromKey !== key && toKey !== key) continue;
    var otherKey = fromKey === key ? toKey : fromKey;
    var otherHandle = fromKey === key ? to : from;
    if (!byOther[otherKey]) {
      byOther[otherKey] = { handle: otherHandle, name: otherHandle, messages: [], unread: 0, lastAt: '' };
      order.push(otherKey);
    }
    var t = byOther[otherKey];
    var mine = fromKey === key;
    if (!mine && t.handle.toLowerCase() !== ADMIN_HANDLE) t.name = String(v[r][2] || t.handle); // remember their display name
    if (fromKey === ADMIN_HANDLE) t.name = ADMIN_NAME;
    var unread = !mine && String(v[r][6] || '') !== '1';
    if (unread) t.unread++;
    t.lastAt = String(v[r][5] || '');
    t.messages.push({
      id: String(v[r][0]), fromHandle: from, fromName: String(v[r][2] || from),
      mine: mine, body: String(v[r][4] || ''), created: String(v[r][5] || ''), read: !unread
    });
  }
  var threads = order.map(function (k) { return byOther[k]; })
    .sort(function (a, b) { return new Date(b.lastAt) - new Date(a.lastAt); });
  var totalUnread = 0; threads.forEach(function (t) { totalUnread += t.unread; });
  return { ok: true, threads: threads, unread: totalUnread, admin: ADMIN_HANDLE };
}

/* lightweight unread count only — cheap enough for the nav badge to poll. */
function dmUnread(handle) {
  handle = cleanHandle(handle);
  if (!handle) return { ok: false, unread: 0 };
  var key = handle.toLowerCase();
  var v = sh_(SHEET_DMS).getDataRange().getValues(), n = 0;
  for (var r = 1; r < v.length; r++) {
    if (String(v[r][3] || '').toLowerCase() === key && String(v[r][6] || '') !== '1') n++;
  }
  return { ok: true, unread: n };
}

function dmSend(body) {
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok: false, error: 'Sign in first.' };
  var to = cleanHandle(body.to); if (!to) return { ok: false, error: 'Who to?' };
  if (to.toLowerCase() === u.handle.toLowerCase()) return { ok: false, error: 'You can\u2019t message yourself.' };
  var target = findUser(to); if (!target) return { ok: false, error: 'No user with that handle.' };
  var text = String(body.body || '').trim().slice(0, 2000); if (!text) return { ok: false, error: 'Empty message.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var id = newId('dm_');
    sh_(SHEET_DMS).appendRow([id, u.handle, u.name, target.handle, text, new Date().toISOString(), '']);
    return { ok: true, id: id };
  } finally { lock.releaseLock(); }
}

/* mark every message the OTHER handle sent to me as read. */
function dmMarkRead(body) {
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok: false, error: 'Sign in first.' };
  var other = cleanHandle(body.other); if (!other) return { ok: false, error: 'Which thread?' };
  var myKey = u.handle.toLowerCase(), otherKey = other.toLowerCase();
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sh_(SHEET_DMS), v = sh.getDataRange().getValues(), n = 0;
    for (var r = 1; r < v.length; r++) {
      if (String(v[r][3] || '').toLowerCase() === myKey &&
          String(v[r][1] || '').toLowerCase() === otherKey &&
          String(v[r][6] || '') !== '1') {
        sh.getRange(r + 1, 7, 1, 1).setValue('1'); n++;
      }
    }
    return { ok: true, marked: n };
  } finally { lock.releaseLock(); }
}

function dmDelete(body) {
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok: false, error: 'Sign in first.' };
  var sh = sh_(SHEET_DMS), v = sh.getDataRange().getValues(), key = u.handle.toLowerCase();
  for (var r = 1; r < v.length; r++) {
    if (String(v[r][0]) === String(body.msgId)) {
      // you can only delete a message you sent
      if (String(v[r][1] || '').toLowerCase() !== key) return { ok: false, error: 'You can only delete your own messages.' };
      sh.deleteRow(r + 1); return { ok: true };
    }
  }
  return { ok: false, error: 'Message not found.' };
}

/* ---- admin side: send/read DMs as ADMIN_HANDLE, adminKey-gated ---- */
function adminDmSend(body) {
  var bad = adminGate(body.adminKey); if (bad) return bad;
  var to = cleanHandle(body.to); if (!to) return { ok: false, error: 'Who to?' };
  var target = findUser(to); if (!target) return { ok: false, error: 'No user with that handle.' };
  var text = String(body.body || '').trim().slice(0, 2000); if (!text) return { ok: false, error: 'Empty message.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var id = newId('dm_');
    sh_(SHEET_DMS).appendRow([id, ADMIN_HANDLE, ADMIN_NAME, target.handle, text, new Date().toISOString(), '']);
    return { ok: true, id: id };
  } finally { lock.releaseLock(); }
}

/* One message to every user, delivered as a normal DM from the admin account so
   it lands in the inbox they already have and the nav's unread badge picks it up
   — no new delivery channel to build, and they can reply in the same thread.

   Written with a single setValues() rather than appendRow() per user: appendRow
   is one Sheets round trip each, which would crawl and then hit the 6-minute
   execution ceiling on a real roster.

   dryRun:true returns the recipient count without writing, so the admin screen
   can show "this will reach N people" before anything is sent. */
function adminBroadcast(body) {
  var bad = adminGate(body.adminKey); if (bad) return bad;
  var audience = String(body.audience || 'active') === 'all' ? 'all' : 'active';
  var dry = !!body.dryRun;
  var text = String(body.body || '').trim().slice(0, 2000);
  if (!dry && !text) return { ok: false, error: 'Empty message.' };

  var v = sh_(SHEET_USERS).getDataRange().getValues();
  var adminLc = String(ADMIN_HANDLE).toLowerCase(), to = [];
  for (var i = 1; i < v.length; i++) {
    var h = String(v[i][0] || '').trim(); if (!h) continue;
    if (h.toLowerCase() === adminLc) continue;                 // never message yourself
    var status = String(v[i][6] || 'active') || 'active';
    if (audience === 'active' && status !== 'active') continue;  // skip banned/suspended
    to.push(h);
  }
  if (dry) return { ok: true, recipients: to.length, dryRun: true, audience: audience };
  if (!to.length) return { ok: false, error: 'No one matches that audience.' };

  /* newId() is time + 6 random base36 chars; called in a tight loop the time
     half is identical, so a few hundred rows would collide often enough to
     matter (those ids are what dmDelete works from). The index makes each
     broadcast row unique by construction. */
  var stamp = new Date().toISOString(), batch = newId('bc_');
  var rows = to.map(function (h, idx) {
    return [batch + '_' + idx, ADMIN_HANDLE, ADMIN_NAME, h, text, stamp, ''];
  });

  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var sh = sh_(SHEET_DMS);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    return { ok: true, sent: rows.length, audience: audience, batch: batch };
  } finally { lock.releaseLock(); }
}

/* the admin's own inbox: every thread ADMIN_HANDLE is part of. */
function adminDmThreads(adminKey) {
  var bad = adminGate(adminKey); if (bad) return bad;
  return dmThreads(ADMIN_HANDLE);
}
function adminDmMarkRead(body) {
  var bad = adminGate(body.adminKey); if (bad) return bad;
  var other = cleanHandle(body.other); if (!other) return { ok: false, error: 'Which thread?' };
  var otherKey = other.toLowerCase();
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sh_(SHEET_DMS), v = sh.getDataRange().getValues(), n = 0;
    for (var r = 1; r < v.length; r++) {
      if (String(v[r][3] || '').toLowerCase() === ADMIN_HANDLE &&
          String(v[r][1] || '').toLowerCase() === otherKey &&
          String(v[r][6] || '') !== '1') {
        sh.getRange(r + 1, 7, 1, 1).setValue('1'); n++;
      }
    }
    return { ok: true, marked: n };
  } finally { lock.releaseLock(); }
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

/* The three roster numbers, normalised in one place so the draft, the roster
   caps and the lineup rules can never disagree:
     active — Makuuchi wrestlers that score
     bench  — Makuuchi wrestlers you keep but who don't score (may be 0)
     farm   — Juryo wrestlers (may be 0)
   mk = the whole Makuuchi roster, which is what the draft fills. */
function rosterPlan(L){
  var active = Math.max(1, Math.min(12, Number(L && L.rosterSize) || 6));
  var bench  = Math.max(0, Math.min(8,  Number(L && L.benchSize)  || 0));
  var farm   = (L && L.farmSize != null) ? Math.max(0, Math.min(10, Number(L.farmSize) || 0)) : active;
  return { active: active, bench: bench, farm: farm, mk: active + bench };
}

// whose turn is it, given the draft order, the league's roster plan, and a
// single pick counter that runs across BOTH phases (Makuuchi then Juryo).
// The phases can now be different lengths: Makuuchi fills active+bench.
function draftTurn(order, plan, pickIdx){
  var N = order.length;
  var p = (plan && plan.mk != null) ? plan : rosterPlan({ rosterSize: plan });   // tolerate an old numeric arg
  var mkPicks = N * p.mk, jrPicks = N * p.farm, total = mkPicks + jrPicks;
  if (!N || pickIdx >= total) return { phase:'done', handle:null, total:total };
  var phase = pickIdx < mkPicks ? 'makuuchi' : 'juryo';
  var local = pickIdx < mkPicks ? pickIdx : pickIdx - mkPicks;
  var round = Math.floor(local / N), pos = local % N;
  var handle = (round % 2 === 0) ? order[pos] : order[N - 1 - pos];
  return { phase:phase, handle:handle, round:round+1, pickInRound:pos+1,
           perPhase:(phase==='makuuchi'?mkPicks:jrPicks), mkPicks:mkPicks, jrPicks:jrPicks,
           total:total, pickIdx:pickIdx };
}

function setLeagueMode(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.commissioner.toLowerCase() !== u.handle.toLowerCase()) return { ok:false, error:'Only the commissioner can change the league mode.' };
  if (L.draftStatus === 'active' || L.draftStatus === 'complete') return { ok:false, error:'Mode is locked once a draft has started.' };
  var mode = (body.mode === 'keepers') ? 'keepers' : 'classic';
  var sizes = clampRoster(body, L);
  sh_(SHEET_LEAGUES).getRange(L.row, 6, 1, 2).setValues([[mode, sizes.active]]);
  sh_(SHEET_LEAGUES).getRange(L.row, 15, 1, 2).setValues([[sizes.bench, sizes.farm]]);
  return { ok:true, mode:mode, rosterSize:sizes.active, benchSize:sizes.bench, farmSize:sizes.farm };
}

/* Clamp a submitted roster shape, falling back to whatever the league already
   has for any field the caller left out. */
function clampRoster(body, L){
  var cur = rosterPlan(L);
  var active = (body.rosterSize == null || body.rosterSize === '') ? cur.active : Number(body.rosterSize);
  var bench  = (body.benchSize  == null || body.benchSize  === '') ? cur.bench  : Number(body.benchSize);
  var farm   = (body.farmSize   == null || body.farmSize   === '') ? cur.farm   : Number(body.farmSize);
  return {
    active: Math.max(1, Math.min(12, active || 6)),
    bench:  Math.max(0, Math.min(8,  bench  || 0)),
    farm:   Math.max(0, Math.min(10, farm   || 0))
  };
}

/* Commissioner resizes the roster. Open right up until the first pick — after
   that the draft order, pick count and everyone's roster are all sized against
   these numbers, so changing them would corrupt a draft in progress or leave a
   finished league with slots nobody drafted. */
function setLeagueRoster(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.commissioner.toLowerCase() !== u.handle.toLowerCase()) return { ok:false, error:'Only the commissioner can change roster sizes.' };
  if (L.draftStatus === 'active')   return { ok:false, error:'The draft has started — roster sizes are locked.' };
  if (L.draftStatus === 'complete') return { ok:false, error:'This league has already drafted — roster sizes are locked.' };

  var sizes = clampRoster(body, L);
  var members = membersOf(L.id).length || 1;
  /* Warn rather than silently shrink: the commissioner should know if the pool
     cannot cover what they asked for once everyone drafts. */
  var mkMax = Math.floor(MAKUUCHI_POOL / members), jrMax = Math.floor(JURYO_POOL / members);
  var warn = '';
  if (sizes.active + sizes.bench > mkMax) warn = 'With ' + members + ' teams there are only ' + mkMax + ' Makuuchi wrestlers each — the draft will stop short.';
  else if (sizes.farm > jrMax) warn = 'With ' + members + ' teams there are only ' + jrMax + ' Juryo wrestlers each — the farm draft will stop short.';

  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    sh_(SHEET_LEAGUES).getRange(L.row, 7, 1, 1).setValue(sizes.active);
    sh_(SHEET_LEAGUES).getRange(L.row, 15, 1, 2).setValues([[sizes.bench, sizes.farm]]);
    return { ok:true, rosterSize:sizes.active, benchSize:sizes.bench, farmSize:sizes.farm, warn:warn };
  } finally { lock.releaseLock(); }
}

/* commissioner edits the league's scoring rules (both classic & keepers).
   Values are clamped by normalizeScoring (point-per-win capped at 6). Locked
   once a draft has started or results exist, so standings can't shift under
   players mid-basho. */
function setLeagueScoring(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.commissioner.toLowerCase() !== u.handle.toLowerCase()) return { ok:false, error:'Only the commissioner can change scoring.' };
  var scoring = normalizeScoring(body.scoring);
  sh_(SHEET_LEAGUES).getRange(L.row, 12, 1, 1).setValue(JSON.stringify(scoring));
  return { ok:true, scoring:scoring };
}

/* commissioner sets/updates the scheduled draft date (ISO string, or '' to
   clear). Changing the date resets everyone's agreement — a new date needs
   fresh sign-off. The commissioner is counted as agreeing to their own date. */
function setDraftDate(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.commissioner.toLowerCase() !== u.handle.toLowerCase()) return { ok:false, error:'Only the commissioner can set the draft date.' };
  var when = String(body.draftDate || '').slice(0, 40);   // ISO-ish; the client sends a datetime-local value
  var agree = {};
  if (when) agree[L.commissioner.toLowerCase()] = true;   // proposing it counts as agreeing to it
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    sh_(SHEET_LEAGUES).getRange(L.row, 13, 1, 2).setValues([[when, JSON.stringify(agree)]]);
    return { ok:true, draftDate:when };
  } finally { lock.releaseLock(); }
}

/* a member agrees to (or withdraws agreement from) the scheduled draft date. */
function agreeDraftDate(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (!isMember(L.id, u.handle)) return { ok:false, error:'Join the league first.' };
  if (!L.draftDate) return { ok:false, error:'No draft date has been set yet.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    L = leagueRow(body.id);                                // re-read under lock
    var agree = L.draftAgree || {};
    if (body.agree === false) delete agree[u.handle.toLowerCase()];
    else agree[u.handle.toLowerCase()] = true;
    sh_(SHEET_LEAGUES).getRange(L.row, 14, 1, 1).setValue(JSON.stringify(agree));
    return { ok:true, agreed: body.agree !== false };
  } finally { lock.releaseLock(); }
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
  /* Each phase draws from its own pool, so clamp them separately: the whole
     Makuuchi roster (active + bench) against MAKUUCHI_POOL, the farm against
     JURYO_POOL. Clamping both against the smaller of the two, as this used to,
     would needlessly shrink a bench-heavy league. */
  var plan = rosterPlan(L);
  var mkMax = Math.max(1, Math.floor(MAKUUCHI_POOL / members.length));
  var jrMax = Math.max(0, Math.floor(JURYO_POOL / members.length));
  var mkTotal = Math.min(plan.mk, mkMax);
  var rosterSize = Math.max(1, Math.min(plan.active, mkTotal));
  var benchSize = Math.max(0, mkTotal - rosterSize);
  var farmSize = Math.min(plan.farm, jrMax);
  var order = members.slice();
  for (var i = order.length - 1; i > 0; i--) {           // Fisher–Yates shuffle
    var j = Math.floor(Math.random() * (i + 1));
    var t = order[i]; order[i] = order[j]; order[j] = t;
  }
  /* The clock, and the banzuke as the client currently sees it. The server has
     no idea what the banzuke is, so the page that starts the draft hands it
     over once: it becomes the fallback board for anyone who never set one. */
  var pickClock = Math.max(15, Math.min(28800, Number(body.pickClock) || PICK_CLOCK_DEFAULT));
  var pool = body.pool || {};
  var defaultOrder = { makuuchi: parseNames_(JSON.stringify(pool.makuuchi || [])),
                       juryo:    parseNames_(JSON.stringify(pool.juryo || [])) };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    sh_(SHEET_LEAGUES).getRange(L.row, 6, 1, 6).setValues([[
      'keepers', rosterSize, 'active', JSON.stringify(order), 0, 'makuuchi'
    ]]);
    sh_(SHEET_LEAGUES).getRange(L.row, 15, 1, 2).setValues([[benchSize, farmSize]]);
    var L2 = leagueRow(L.id);
    L2.pickClock = pickClock;      // the row is written below; the first deadline must use the NEW clock
    var boards = draftBoardsOf(L.id);
    var first = draftTurn(order, rosterPlan(L2), 0);
    var deadline = deadlineFor_(L2, first.handle, boards);
    sh_(SHEET_LEAGUES).getRange(L.row, 17, 1, 3).setValues([[pickClock, deadline, JSON.stringify(defaultOrder)]]);
    return { ok:true, order:order, rosterSize:rosterSize, benchSize:benchSize, farmSize:farmSize,
             pickClock:pickClock, deadline:deadline };
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

/* =====================================================================
   THE PICK CLOCK
   ---------------------------------------------------------------------
   Apps Script has no background timer, so the clock is a DEADLINE stored on
   the league rather than a countdown running somewhere. Every read of the
   draft (draftState) and every write to it (makePick) first calls
   settleDraft_(), which awards any pick whose deadline has already passed —
   as many in a row as are overdue, so a whole row of absentees resolves in
   one poll and the draft can never stall.

   Whose turn it is decides how long the wait was, not what gets picked:

     auto-draft ON   -> DRAFT_GRACE (30s). He asked to be drafted for.
     auto-draft OFF  -> the league's full pick clock.

   Either way the pick is the top name still available on HIS board. A member
   who never arranged one has no row in DraftBoards, so we fall back to the
   league's defaultOrder — the banzuke as the client saw it when the draft
   started — which is exactly what his board would have shown him anyway.
   ===================================================================== */
function clockFor_(L, handle, boards){
  var b = boards[String(handle || '').toLowerCase()];
  var full = Math.max(10, Number(L.pickClock) || PICK_CLOCK_DEFAULT);
  return (b && b.auto) ? Math.min(DRAFT_GRACE, full) : full;
}
function deadlineFor_(L, handle, boards){
  return new Date(Date.now() + clockFor_(L, handle, boards) * 1000).toISOString();
}
/* The order this member drafts by for one phase: his own board first, the
   league's banzuke snapshot behind it. Concatenated rather than either/or, so
   a board that has been exhausted (everyone on it taken) still resolves. */
function orderFor_(L, handle, phase, boards){
  var b = boards[String(handle || '').toLowerCase()];
  var mine = (b && b[phase]) || [];
  var def  = (L.defaultOrder && L.defaultOrder[phase]) || [];
  var seen = {}, out = [];
  mine.concat(def).forEach(function(n){
    var k = String(n || '').toLowerCase();
    if (!k || seen[k]) return;
    seen[k] = 1; out.push(n);
  });
  return out;
}
/* Award every overdue pick. Call inside the caller's lock. Returns the league
   row as it now stands (re-read if anything was written). */
function settleDraft_(L){
  if (!L || L.draftStatus !== 'active') return L;
  if (!L.pickDeadline) return L;                 // no clock on this draft
  var boards = draftBoardsOf(L.id);
  var picks = draftPicksOf(L.id);
  var taken = {};
  picks.forEach(function(p){ taken[String(p.rikishi).toLowerCase()] = 1; });
  var plan = rosterPlan(L);
  var counts = {};   // handle -> makuuchi picks so far, for the active/bench slot
  picks.forEach(function(p){
    if (p.phase === 'juryo') return;
    var k = String(p.handle).toLowerCase(); counts[k] = (counts[k] || 0) + 1;
  });
  var idx = L.draftPickIdx, deadline = L.pickDeadline, wrote = 0;
  var pickRows = [], rosterRows = [];
  /* Bounded: one pass can only ever settle as many picks as the draft has. */
  for (var guard = 0; guard < 400; guard++){
    if (new Date(deadline).getTime() > Date.now()) break;    // the man on the clock still has time
    var turn = draftTurn(L.draftOrder, plan, idx);
    if (turn.phase === 'done' || !turn.handle) break;
    var order = orderFor_(L, turn.handle, turn.phase, boards);
    var name = null;
    for (var i = 0; i < order.length; i++){
      if (!taken[String(order[i]).toLowerCase()]) { name = order[i]; break; }
    }
    if (!name) break;   // nothing to draft him — leave the clock stopped for a human
    var key = String(turn.handle).toLowerCase(), when = new Date().toISOString();
    var slot = 'bench';
    if (turn.phase !== 'juryo') slot = (counts[key] || 0) < plan.active ? 'active' : 'bench';
    if (turn.phase !== 'juryo') counts[key] = (counts[key] || 0) + 1;
    pickRows.push([L.id, idx, turn.round, turn.phase, turn.handle, name, when]);
    rosterRows.push([L.id, turn.handle, name, turn.phase, 'auto', when, slot]);
    taken[String(name).toLowerCase()] = 1;
    idx++; wrote++;
    var next = draftTurn(L.draftOrder, plan, idx);
    deadline = (next.phase === 'done') ? '' : deadlineFor_(L, next.handle, boards);
  }
  if (!wrote) return L;
  if (pickRows.length)   sh_(SHEET_PICKS).getRange(sh_(SHEET_PICKS).getLastRow() + 1, 1, pickRows.length, 7).setValues(pickRows);
  if (rosterRows.length) sh_(SHEET_ROSTERS).getRange(sh_(SHEET_ROSTERS).getLastRow() + 1, 1, rosterRows.length, 7).setValues(rosterRows);
  var nextTurn = draftTurn(L.draftOrder, plan, idx);
  var status = nextTurn.phase === 'done' ? 'complete' : 'active';
  sh_(SHEET_LEAGUES).getRange(L.row, 8).setValue(status);
  sh_(SHEET_LEAGUES).getRange(L.row, 10, 1, 2).setValues([[idx, nextTurn.phase]]);
  sh_(SHEET_LEAGUES).getRange(L.row, 18).setValue(deadline);
  return leagueRow(L.id);
}

function draftState(id){
  var L = leagueRow(id); if (!L) return { ok:false, error:'League not found.' };
  /* Anyone polling advances the clock. Only take the lock when there is
     actually something overdue, so the common poll stays a plain read. */
  if (L.draftStatus === 'active' && L.pickDeadline && new Date(L.pickDeadline).getTime() <= Date.now()){
    var lock = LockService.getScriptLock();
    if (lock.tryLock(15000)){
      try { L = settleDraft_(leagueRow(id)); } finally { lock.releaseLock(); }
    }
  }
  var picks = draftPicksOf(L.id);
  var turn = L.draftStatus === 'active' ? draftTurn(L.draftOrder, rosterPlan(L), L.draftPickIdx) : { phase:L.draftStatus==='complete'?'done':'none' };
  var boards = L.mode === 'keepers' ? draftBoardsOf(L.id) : {};
  var onClock = boards[String(turn.handle || '').toLowerCase()];
  return { ok:true, league:{ id:L.id, mode:L.mode, rosterSize:L.rosterSize, benchSize:L.benchSize, farmSize:L.farmSize,
                             draftStatus:L.draftStatus, draftOrder:L.draftOrder, pickClock:L.pickClock },
    picks:picks, turn:turn, pickedNames:picks.map(function(p){ return p.rikishi; }),
    /* the clock, as the client needs to draw it: when this pick expires, how
       long the man on the clock was given, and whether he asked to be auto-drafted */
    deadline: L.pickDeadline || '',
    clockSeconds: turn.handle ? clockFor_(L, turn.handle, boards) : 0,
    onClockAuto: !!(onClock && onClock.auto),
    serverNow: new Date().toISOString() };
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
    /* Settle first: if his clock ran out while the click was in flight, the
       board has already picked for him and this click must not win a turn he
       no longer owns. */
    L = settleDraft_(L);
    if (L.draftStatus !== 'active') return { ok:false, error:'The draft is already complete.' };
    var turn = draftTurn(L.draftOrder, rosterPlan(L), L.draftPickIdx);
    if (turn.phase === 'done') return { ok:false, error:'The draft is already complete.' };
    if (!turn.handle || turn.handle.toLowerCase() !== u.handle.toLowerCase()) return { ok:false, error:'It\u2019s not your turn.' };
    var already = draftPicksOf(L.id).some(function(p){ return p.rikishi.toLowerCase() === rikishi.toLowerCase(); });
    if (already) return { ok:false, error: rikishi + ' has already been drafted in this league.' };

    var now = new Date().toISOString();
    /* Write the slot explicitly. keeperRostersOf() treats a BLANK slot on a
       Makuuchi row as active — right for pre-bench leagues, but it would make
       every bench pick score here. Fill the starting lineup first, then bench;
       the Juryo farm never scores. */
    var plan = rosterPlan(L);
    var slot = 'bench';
    if (turn.phase !== 'juryo') {
      var mineNow = (keeperRostersOf(L.id)[u.handle.toLowerCase()] || { active:[] }).active.length;
      slot = mineNow < plan.active ? 'active' : 'bench';
    }
    sh_(SHEET_PICKS).appendRow([L.id, L.draftPickIdx, turn.round, turn.phase, u.handle, rikishi, now]);
    sh_(SHEET_ROSTERS).appendRow([L.id, u.handle, rikishi, turn.phase, 'draft', now, slot]);

    var nextIdx = L.draftPickIdx + 1;
    var nextTurn = draftTurn(L.draftOrder, rosterPlan(L), nextIdx);
    var status = nextTurn.phase === 'done' ? 'complete' : 'active';
    sh_(SHEET_LEAGUES).getRange(L.row, 8).setValue(status);                                 // draftStatus (col 8)
    sh_(SHEET_LEAGUES).getRange(L.row, 10, 1, 2).setValues([[nextIdx, nextTurn.phase]]);     // draftPickIdx (10) + draftPhase (11); leave draftOrder (col 9) intact
    // the next man's clock starts the moment this pick lands, not when he polls
    var boardsNow = draftBoardsOf(L.id);
    var nextDeadline = (nextTurn.phase === 'done') ? '' : deadlineFor_(L, nextTurn.handle, boardsNow);
    sh_(SHEET_LEAGUES).getRange(L.row, 18).setValue(nextDeadline);
    return { ok:true, nextTurn:nextTurn, draftStatus:status, deadline:nextDeadline };
  } finally { lock.releaseLock(); }
}

function keeperRostersOf(id){
  var v = sh_(SHEET_ROSTERS).getDataRange().getValues(), out = {};
  for (var r=1;r<v.length;r++){
    if (String(v[r][0]) !== String(id)) continue;
    var h = String(v[r][1]||''); if (!h) continue;
    var key = h.toLowerCase();
    if (!out[key]) out[key] = { makuuchi:[], juryo:[], active:[] };
    var div = String(v[r][3]||'').toLowerCase() === 'juryo' ? 'juryo' : 'makuuchi';
    var name = String(v[r][2]);
    out[key][div].push(name);
    var slot = String(v[r][6]||'').toLowerCase();
    if (slot === 'active' || (slot === '' && div === 'makuuchi')) out[key].active.push(name);   // default: Makuuchi starts active
  }
  return out;
}
/* migration for older KeeperRosters sheets (no 'slot' column) */
function migrateRostersSlot(sh){
  var lastCol = Math.max(6, sh.getLastColumn());
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (String(head[6] || '').toLowerCase() !== 'slot') sh.getRange(1, 7).setValue('slot');
}
/* Set a team's active lineup (which owned wrestlers score). Capped at the
   league's rosterSize; locked once a tournament starts. Anything owned that
   isn't listed active is benched. */
function setActive(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.mode !== 'keepers' || L.draftStatus !== 'complete') return { ok:false, error:'Set your lineup once the keeper draft is complete.' };
  if (tournamentActive()) return { ok:false, error:'Lineups are locked once the tournament starts.' };
  var cap = Number(L.rosterSize) || 6;
  var wanted = {}; (Array.isArray(body.active) ? body.active : []).forEach(function(n){ wanted[String(n).toLowerCase()] = 1; });
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sh_(SHEET_ROSTERS), v = sh.getDataRange().getValues(), key = u.handle.toLowerCase();
    var mine = [];
    for (var r=1;r<v.length;r++){
      if (String(v[r][0])!==String(L.id) || String(v[r][1]||'').toLowerCase()!==key) continue;
      mine.push({ row:r+1, active: !!wanted[String(v[r][2]||'').toLowerCase()] });
    }
    var nActive = mine.filter(function(m){ return m.active; }).length;
    if (nActive > cap) return { ok:false, error:'You can only start ' + cap + ' active wrestlers.' };
    mine.forEach(function(m){ sh.getRange(m.row, 7).setValue(m.active ? 'active' : 'bench'); });
    return { ok:true, active:nActive, cap:cap };
  } finally { lock.releaseLock(); }
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
    /* A waiver is a swap, not a promotion: the man coming in inherits the slot
       of the man going out. Writing the slot explicitly matters \u2014 keeperRostersOf()
       reads a BLANK slot on a Makuuchi row as active, so an unslotted add would
       quietly start over the league's cap and score alongside the full lineup. */
    var slot = String(sh_(SHEET_ROSTERS).getRange(owned.row, 7).getValue() || '').toLowerCase();
    if (slot !== 'active' && slot !== 'bench'){
      /* a legacy row with no slot at all: fall back to the draft's own rule */
      if (String(owned.division).toLowerCase() === 'juryo') slot = 'bench';
      else {
        var mineNow = (keeperRostersOf(L.id)[u.handle.toLowerCase()] || { active:[] }).active.length;
        slot = (mineNow - 1) < rosterPlan(L).active ? 'active' : 'bench';
      }
    }
    sh_(SHEET_ROSTERS).deleteRow(owned.row);
    sh_(SHEET_ROSTERS).appendRow([L.id, u.handle, add, owned.division, 'waiver', new Date().toISOString(), slot]);
    return { ok:true };
  } finally { lock.releaseLock(); }
}

/* ============================================================
   TEAM HISTORY
   A tournament runs every ~6 weeks; once one finishes, each player's
   finished roster + final score is snapshotted here so it survives them
   drafting a fresh team for the next basho. Once the results sheet is
   cleared for the next tournament the score CANNOT be recomputed, so a
   missing row is a permanently lost basho.

   Two writers, same rows, upserting on (handle, basho) so they can't
   duplicate or fight:
     · archiveAllTeams_() — the authority. Runs server-side at basho
       close (refreshResults, once Meta.lastDay hits 15) and scores every
       account off the sheet, whether or not its owner ever comes back.
     · archiveTeam()  — the client's own snapshot, kept because it lands
       the moment a player watches the last bout rather than on the next
       hourly tick. It sends its own score, computed by gg-account.js.
   The server pass is what makes the archive complete; the client one just
   makes it prompt.
   ============================================================ */
function archiveTeam(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var basho = String(body.basho || '').trim().slice(0, 60);
  if (!basho) return { ok:false, error:'Missing basho name.' };
  var teamJson = typeof body.team === 'string' ? body.team : JSON.stringify(body.team || {});
  var rowsJson = typeof body.rows === 'string' ? body.rows : JSON.stringify(body.rows || []);
  var score = Number(body.score || 0), wins = Number(body.wins || 0);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { return historyUpsert_(u.handle, basho, teamJson, score, wins, rowsJson); }
  finally { lock.releaseLock(); }
}

/* One TeamHistory row, keyed on (handle, basho). Caller holds the script
   lock — both writers above are inside one. */
function historyUpsert_(handle, basho, teamJson, score, wins, rowsJson){
  var sh = sh_(SHEET_HISTORY), v = sh.getDataRange().getValues(), key = String(handle).toLowerCase();
  var vals = [handle, basho, teamJson, score, wins, rowsJson, new Date().toISOString()];
  for (var r=1;r<v.length;r++){
    if (String(v[r][0]).toLowerCase()===key && String(v[r][1])===basho){
      sh.getRange(r+1, 1, 1, 7).setValues([vals]);
      return { ok:true, updated:true };
    }
  }
  sh.appendRow(vals);
  return { ok:true, created:true };
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

/* everyone's archived basho results in one read — used by both the badge
   computation (needs other players' scores to know who was "highest") and
   the all-time rank (needs everyone's running totals). */
function allHistoryRows_(){
  var v = sh_(SHEET_HISTORY).getDataRange().getValues(), out = [];
  for (var r = 1; r < v.length; r++) {
    if (!String(v[r][0]).trim()) continue;
    var rows = []; try { rows = JSON.parse(v[r][5] || '[]'); } catch (e) {}
    out.push({ handle: String(v[r][0]), basho: String(v[r][1] || ''), score: Number(v[r][3] || 0), wins: Number(v[r][4] || 0), rows: rows, savedAt: String(v[r][6] || '') });
  }
  return out;
}
/* Minor accolades \u2014 the things worth noting that AREN'T titles.
   "Highest Scorer" used to live here and has been retired: it was the public
   championship computed on the fly, so keeping it would hand the same player
   two awards for one achievement. What remains is deliberately not a title:
   backing the yusho winner says a rikishi YOU picked took the Emperor's Cup,
   which a last-placed team can manage. It's named to say exactly that \u2014 the
   old label, "Y\u016bsh\u014d Winner", read like a championship it never was. */
function computeBadges_(handle, allHistory) {
  var key = handle.toLowerCase();
  var badges = [];
  allHistory.forEach(function (h) {
    if (h.handle.toLowerCase() !== key) return;
    if ((h.rows || []).some(function (row) { return row.yusho; })) {
      badges.push({ id: 'yusho-' + h.basho, icon: '\ud83c\udf3f',
                    label: 'Backed the Y\u016bsh\u014d \u2014 ' + h.basho });
    }
  });
  return badges;
}
function allTimeRank_(allHistory, handle) {
  var totals = {};
  allHistory.forEach(function (h) { var k = h.handle.toLowerCase(); totals[k] = (totals[k] || 0) + (h.score || 0); });
  var ranked = Object.keys(totals).map(function (k) { return { handle: k, total: totals[k] }; })
    .sort(function (a, b) { return b.total - a.total; });
  var key = handle.toLowerCase();
  var idx = ranked.findIndex(function (r) { return r.handle === key; });
  return { rank: idx >= 0 ? idx + 1 : null, of: ranked.length, total: totals[key] || 0 };
}
/* one consolidated read for the account modal: trophy case, historical
   performance (with an all-time rank), and active-league quick links. */
function accountSummary(handle) {
  handle = cleanHandle(handle);
  if (!handle) return { ok: false, error: 'Bad handle.' };
  var allHistory = allHistoryRows_();
  var mine = allHistory.filter(function (h) { return h.handle.toLowerCase() === handle.toLowerCase(); })
    .sort(function (a, b) { return new Date(b.savedAt) - new Date(a.savedAt); });
  var leaguesRes = myLeagues(handle);

  /* Where each of those scores placed him on the public board that basho.
     A raw points line is hard to read on its own — 47 is a runaway in a thin
     field and mid-table in a strong one — and every number needed is already
     in allHistory, so the placing costs one pass and no extra sheet read.
     Ties share the better place, as a competition ranking should. */
  var fieldByBasho = {};
  allHistory.forEach(function (h) {
    (fieldByBasho[h.basho] = fieldByBasho[h.basho] || []).push(h.score);
  });

  return {
    ok: true,
    titles: championsOf_(handle),                 // championships — the trophy case proper
    badges: computeBadges_(handle, allHistory),   // minor accolades, shown beneath
    history: mine.map(function (h) {
      var field = (fieldByBasho[h.basho] || []).slice().sort(function (a, b) { return b - a; });
      var place = field.indexOf(h.score) + 1;
      return { basho: h.basho, score: h.score, wins: h.wins, savedAt: h.savedAt,
               place: place || null, of: field.length };
    }),
    allTime: allTimeRank_(allHistory, handle),
    leagues: (leaguesRes && leaguesRes.ok) ? leaguesRes.leagues : []
  };
}

/* ============================================================
   ADMIN DASHBOARD
   Backs the private admin.html page: site/API connectivity, pageview
   analytics, user moderation (warn/ban/delete), a read-only feed of every
   message-board post across all leagues, and incoming Feedback (FAQ
   questions, suggestions, bug reports, user reports). Every admin action
   here requires body.adminKey (or ?adminKey= on GETs) to match ADMIN_KEY
   above.
   ============================================================ */
/* Gate every admin action. Returns null when the key is correct, or an
   {ok:false,error} object to short-circuit with when it isn't.

   Brute-force protection: Apps Script doesn't hand us a reliable per-visitor
   IP, so this is a GLOBAL counter in the script cache — after MAX_FAILS bad
   keys inside FAIL_WINDOW, all unlock attempts are refused for LOCKOUT_SECS.
   Crude but it turns "guess forever" into "guess 8, then wait 5 minutes,"
   which (with a long random key) puts brute force out of reach. Tradeoff:
   a stranger spamming wrong keys can briefly lock YOU out too — acceptable
   for a single-admin site, and the window is short. A correct key clears the
   counter immediately. */
var SHEET_RESETS = 'PinResets';

/* A user who has forgotten their PIN asks for a reset. We record a pending
   request and drop the admin a DM. No account details are exposed. */
function requestPinReset(body) {
  var handle = cleanHandle(body.handle);
  if (!handle) return { ok: false, error: 'Enter your handle.' };
  var u = findUser(handle);
  if (!u) return { ok: false, error: 'No account with that handle.' };
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var sh = ensureSheet(SpreadsheetApp.getActiveSpreadsheet(), SHEET_RESETS,
      ['id', 'handle', 'name', 'requested', 'status']);
    var v = sh.getDataRange().getValues();
    for (var r = 1; r < v.length; r++) {                       // don't stack duplicate pending requests
      if (String(v[r][1]).toLowerCase() === handle.toLowerCase() && v[r][4] === 'pending')
        return { ok: true, already: true };
    }
    sh.appendRow([newId('rst_'), u.handle, u.name, new Date().toISOString(), 'pending']);
  } finally { lock.releaseLock(); }
  try {                                                         // notify the admin inbox
    sh_(SHEET_DMS).appendRow([newId('dm_'), u.handle, u.name, ADMIN_HANDLE,
      'PIN reset requested \u2014 approve it from the admin page.', new Date().toISOString(), '']);
  } catch (e) {}
  return { ok: true };
}

/* Admin read: the pending reset requests. */
function adminPinResets(key) {
  var bad = adminGate(key); if (bad) return bad;
  var sh = ensureSheet(SpreadsheetApp.getActiveSpreadsheet(), SHEET_RESETS,
    ['id', 'handle', 'name', 'requested', 'status']);
  var v = sh.getDataRange().getValues(), out = [];
  for (var r = 1; r < v.length; r++)
    if (v[r][4] === 'pending') out.push({ id: v[r][0], handle: v[r][1], name: v[r][2], requested: v[r][3] });
  return { ok: true, resets: out };
}

/* Admin write: approve a reset. Because the PIN is only ever hashed in the
   user's browser, we can't set a plaintext PIN here \u2014 instead we clear the
   stored hash, which returns the account to "unclaimed". The user then opens
   Create account, enters the same handle, and picks a new PIN (that claims the
   row again via register()'s claim path). */
function adminResetPin(body) {
  var bad = adminGate(body.adminKey); if (bad) return bad;
  var handle = cleanHandle(body.handle);
  if (!handle) return { ok: false, error: 'Missing handle.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var users = sh_(SHEET_USERS), uv = users.getDataRange().getValues(), found = false;
    for (var r = 1; r < uv.length; r++) {
      if (String(uv[r][0]).toLowerCase() === handle.toLowerCase()) {
        users.getRange(r + 1, 3).setValue('');                 // col 3 = auth (the PIN hash)
        found = true; break;
      }
    }
    if (!found) return { ok: false, error: 'No account with that handle.' };
    var sh = ensureSheet(SpreadsheetApp.getActiveSpreadsheet(), SHEET_RESETS,
      ['id', 'handle', 'name', 'requested', 'status']);
    var v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++)
      if (String(v[i][1]).toLowerCase() === handle.toLowerCase() && v[i][4] === 'pending')
        sh.getRange(i + 1, 5).setValue('done');
  } finally { lock.releaseLock(); }
  try {                                                         // tell the user how to finish
    sh_(SHEET_DMS).appendRow([newId('dm_'), ADMIN_HANDLE, ADMIN_NAME, handle,
      'Your PIN has been reset. Open \u201cCreate account\u201d, enter your handle, and choose a new PIN to get back in.',
      new Date().toISOString(), '']);
  } catch (e) {}
  return { ok: true };
}

function adminGate(key) {
  var MAX_FAILS = 8, FAIL_WINDOW = 600, LOCKOUT_SECS = 300;
  var cache = CacheService.getScriptCache();
  var LOCK = 'admin_lockout', FAILS = 'admin_fails';

  if (cache.get(LOCK)) return { ok: false, error: 'Too many attempts \u2014 try again in a few minutes.' };

  if (ADMIN_KEY && String(key || '') === String(ADMIN_KEY)) {
    cache.remove(FAILS);                       // good key wipes the fail streak
    return null;
  }

  var n = (parseInt(cache.get(FAILS), 10) || 0) + 1;
  if (n >= MAX_FAILS) { cache.put(LOCK, '1', LOCKOUT_SECS); cache.remove(FAILS); }
  else { cache.put(FAILS, String(n), FAIL_WINDOW); }
  return { ok: false, error: 'Not authorised.' };
}

/* Run an admin read behind the gate: returns the gate's rejection object if
   the key is bad/locked, otherwise the reader's result. Keeps doPost tidy. */
function adminGated(key, reader) {
  var bad = adminGate(key);
  return bad ? bad : reader();
}

/* record one pageview; called from every public page via gg-nav.js.
   No auth needed — it's write-only and never echoes anything back. */
function logPageview(body) {
  var page = String(body.page || '').trim().slice(0, 80);
  var vid = String(body.visitorId || '').trim().slice(0, 60);
  // Visitor's browser-reported IANA zone (e.g. "America/Los_Angeles"), used
  // only for the admin dashboard's region/time-of-day breakdowns — charset-
  // limited to what a real zone name can contain, not verified against the
  // actual IANA list (that's handled at read time, see localHour_).
  var tz = String(body.tz || '').trim().slice(0, 40);
  if (!/^[A-Za-z0-9_+\-\/]*$/.test(tz)) tz = '';
  if (!page || !vid) return { ok: false };
  try { sh_(SHEET_PAGEVIEWS).appendRow([new Date().toISOString(), page, vid, tz]); }
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

/* Monday-aligned (UTC) week key for a Date, as a 'YYYY-MM-DD' string —
   used to bucket pageviews into calendar weeks for the admin trend chart. */
function weekStart_(d) {
  var day = d.getUTCDay(); // 0=Sun..6=Sat
  var diff = (day === 0 ? -6 : 1 - day); // days back to Monday
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
}
function isoDate_(d) { return d.toISOString().slice(0, 10); }

/* Local hour-of-day (0-23, as a number) for a timestamp+IANA-zone pair.
   Falls back to UTC when tz is blank/unrecognized — Utilities.formatDate
   throws on a bad zone name, and client-supplied tz is only charset-
   validated, not verified against the real IANA list. */
function localHour_(d, tz) {
  if (tz) {
    try { return parseInt(Utilities.formatDate(d, tz, 'H'), 10); } catch (e) {}
  }
  return d.getUTCHours();
}

function adminStats() {
  var v = sh_(SHEET_PAGEVIEWS).getDataRange().getValues();
  var total = 0, uniques = {}, byPage = {}, since7 = Date.now() - 7 * 24 * 3600 * 1000, total7 = 0, uniq7 = {};
  var byWeek = {};   // 'YYYY-MM-DD' (Monday) -> { total, uniques:{} }
  var byDay = {};    // 'YYYY-MM-DD' (UTC calendar day) -> { total, uniques:{} }
  var byHour = {};   // 0-23 (visitor-local hour where known, else UTC) -> total
  var byRegion = {}; // IANA tz string, or 'Unknown' -> { total, uniques:{} }
  // Read column D directly rather than gating on the header label saying
  // 'tz' — the header only gets renamed when setup() is manually re-run
  // after a redeploy, but logPageview() has been writing real tz values
  // into column D since the moment the new backend went live either way.
  // Gating on the header meant real per-row data sat in the sheet unread
  // until someone remembered to re-run setup(). hasRegionData now reflects
  // whether any row actually carries a timezone, which is the true signal.
  var anyTz = false;
  for (var r = 1; r < v.length; r++) {
    var vid = String(v[r][2] || ''); if (!vid) continue;
    var page = String(v[r][1] || '(unknown)');
    var tz = String(v[r][3] || '').trim();
    if (tz) anyTz = true;
    total++; uniques[vid] = 1;
    if (!byPage[page]) byPage[page] = { total: 0, uniques: {} };
    byPage[page].total++; byPage[page].uniques[vid] = 1;
    var t = Date.parse(String(v[r][0] || ''));
    if (isNaN(t)) continue;
    if (t >= since7) { total7++; uniq7[vid] = 1; }
    var d = new Date(t);
    var wk = isoDate_(weekStart_(d));
    if (!byWeek[wk]) byWeek[wk] = { total: 0, uniques: {} };
    byWeek[wk].total++; byWeek[wk].uniques[vid] = 1;

    var day = isoDate_(d);
    if (!byDay[day]) byDay[day] = { total: 0, uniques: {} };
    byDay[day].total++; byDay[day].uniques[vid] = 1;

    var hr = localHour_(d, tz);
    byHour[hr] = (byHour[hr] || 0) + 1;

    var region = tz || 'Unknown';
    if (!byRegion[region]) byRegion[region] = { total: 0, uniques: {} };
    byRegion[region].total++; byRegion[region].uniques[vid] = 1;
  }
  var pages = [];
  for (var p in byPage) pages.push({ page: p, total: byPage[p].total, unique: Object.keys(byPage[p].uniques).length });
  pages.sort(function (a, b) { return b.total - a.total; });

  // Last 8 calendar weeks (Mon-start, UTC), oldest first, zero-filled so a
  // quiet week still shows as a bar rather than a gap.
  var weeks = [];
  var thisWeek = weekStart_(new Date());
  for (var i = 7; i >= 0; i--) {
    var wkDate = new Date(thisWeek.getTime() - i * 7 * 24 * 3600 * 1000);
    var key = isoDate_(wkDate);
    var bucket = byWeek[key];
    weeks.push({
      weekStart: key,
      total: bucket ? bucket.total : 0,
      unique: bucket ? Object.keys(bucket.uniques).length : 0
    });
  }

  // Last 14 calendar days (UTC), oldest first, zero-filled.
  var days = [];
  var todayUTC = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  for (var j = 13; j >= 0; j--) {
    var dDate = new Date(todayUTC.getTime() - j * 24 * 3600 * 1000);
    var dKey = isoDate_(dDate);
    var dBucket = byDay[dKey];
    days.push({
      date: dKey,
      total: dBucket ? dBucket.total : 0,
      unique: dBucket ? Object.keys(dBucket.uniques).length : 0
    });
  }

  // 24 hourly buckets, visitor-local time where we know it (falls back to
  // UTC for older rows recorded before we captured a timezone).
  var hours = [];
  for (var h = 0; h < 24; h++) hours.push({ hour: h, total: byHour[h] || 0 });

  // Top 15 regions by pageviews; anything smaller folds into "Other" so a
  // long tail of one-off timezones doesn't swamp the list.
  var regionList = [];
  for (var rg in byRegion) regionList.push({ tz: rg, total: byRegion[rg].total, unique: Object.keys(byRegion[rg].uniques).length });
  regionList.sort(function (a, b) { return b.total - a.total; });
  var regions = regionList.slice(0, 15);
  if (regionList.length > 15) {
    var rest = regionList.slice(15);
    var otherTotal = 0, otherUnique = 0;
    for (var ri = 0; ri < rest.length; ri++) { otherTotal += rest[ri].total; otherUnique += rest[ri].unique; }
    regions.push({ tz: 'Other', total: otherTotal, unique: otherUnique });
  }

  var userRows = Math.max(0, sh_(SHEET_USERS).getDataRange().getValues().length - 1);
  var leagueRows = Math.max(0, sh_(SHEET_LEAGUES).getDataRange().getValues().length - 1);
  var msgRows = Math.max(0, sh_(SHEET_MESSAGES).getDataRange().getValues().length - 1);

  return {
    ok: true,
    pageviews: {
      total: total, unique: Object.keys(uniques).length,
      last7Total: total7, last7Unique: Object.keys(uniq7).length,
      byPage: pages, byWeek: weeks, byDay: days, byHour: hours, byRegion: regions,
      hasRegionData: anyTz
    },
    counts: { users: userRows, leagues: leagueRows, messages: msgRows },
    api: checkSumoApi()
  };
}

/* Wipes all recorded pageviews (keeps the sheet + header row) so the
   analytics dashboard goes back to 0. Gated behind the admin key like every
   other adminX action — this is destructive and not undoable. */
/* ---- roll the Sheet over to a new basho ----
   Results carries no basho column and every score on the site is summed
   straight off it, so a leftover tournament is not just stale points:
     · refreshResults() keys bouts on day|division|east|west, so the new
       basho's matching pairings look "already imported" and never land;
     · tournamentActive() is (any results && lastDay < 15), so with lastDay
       still on 15 it stays false and lineups, trades and waivers never lock.
   One button, pressed once, between tournaments. It refuses to run until the
   basho being cleared has been ranked — clearing Results first would leave
   players unable to archive their final scores — unless it's forced. */
function adminResetBasho(body){
  var bad = adminGate(body && body.adminKey); if (bad) return bad;
  var meta = readMeta();
  var was = String(meta.basho || '').trim();
  var label = String((body && body.basho) || BASHO_LABEL).trim().slice(0, 60) || BASHO_LABEL;
  if (!(body && body.force) && was && String(meta.rankedBasho || '') !== was)
    return { ok:false, needsRanking:true, basho:was,
             error:'Rank ' + was + ' first \u2014 its champions and banzuke moves haven\u2019t been applied yet.' };
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var sh = sh_(SHEET_RESULTS), last = sh.getLastRow(), cleared = Math.max(0, last - 1);
    if (cleared > 0) sh.deleteRows(2, cleared);
    setMeta_('basho',   label);
    setMeta_('lastDay', 0);
    setMeta_('yusho',   '');
    setMeta_('sansho',  '');
    return { ok:true, basho:label, previous:was, clearedRows:cleared };
  } finally { lock.releaseLock(); }
}

function adminResetAnalytics() {
  var sh = sh_(SHEET_PAGEVIEWS);
  var last = sh.getLastRow();
  var cleared = Math.max(0, last - 1);
  if (cleared > 0) sh.deleteRows(2, cleared);
  return { ok: true, clearedRows: cleared };
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

/* Feedback sheet has no id column of its own — rows are only ever appended,
   never reordered, so a row's timestamp plus its current row number makes a
   stable-enough id: it still resolves correctly after other rows are deleted,
   and simply fails to match (rather than hitting the wrong row) if the row
   it names is gone. */
function feedbackRowId_(ts, r) {
  var ms = ts instanceof Date ? ts.getTime() : Date.parse(ts);
  return String(ms) + ':' + r;
}
function findFeedbackRow_(id) {
  var v = sh_(SHEET_FEEDBACK).getDataRange().getValues();
  for (var r = 1; r < v.length; r++) {
    if (feedbackRowId_(v[r][0], r) === String(id)) return r + 1;
  }
  return 0;
}

/* every incoming message to the admin — FAQ questions, suggestions, bug
   reports, and user reports — read straight off the Feedback sheet. */
function adminFeedback() {
  var v = sh_(SHEET_FEEDBACK).getDataRange().getValues();
  var out = [];
  for (var r = 1; r < v.length; r++) {
    if (!String(v[r][1] || '').trim()) continue;               // skip blank rows
    var ts = v[r][0];
    out.push({
      id: feedbackRowId_(ts, r),
      created: ts instanceof Date ? ts.toISOString() : String(ts),
      kind: String(v[r][1] || ''), handle: String(v[r][2] || ''),
      subject: String(v[r][3] || ''), message: String(v[r][4] || ''),
      targetUser: String(v[r][5] || ''), page: String(v[r][6] || ''),
      status: String(v[r][7] || 'new') || 'new'
    });
  }
  out.sort(function (a, b) { return new Date(b.created) - new Date(a.created); });
  return { ok: true, feedback: out };
}

function adminSetFeedbackStatus(body) {
  var bad = adminGate(body.adminKey); if (bad) return bad;
  var status = String(body.status || '').toLowerCase();
  if (['new', 'read', 'resolved'].indexOf(status) < 0) return { ok: false, error: 'bad status' };
  var row = findFeedbackRow_(body.id); if (!row) return { ok: false, error: 'Not found — try refreshing.' };
  sh_(SHEET_FEEDBACK).getRange(row, 8, 1, 1).setValue(status);
  return { ok: true };
}

function adminDeleteFeedback(body) {
  var bad = adminGate(body.adminKey); if (bad) return bad;
  var row = findFeedbackRow_(body.id); if (!row) return { ok: false, error: 'Not found — try refreshing.' };
  sh_(SHEET_FEEDBACK).deleteRow(row);
  return { ok: true };
}

/* ================= supplemental re-draft (new banzuke) =================
   Runs between tournaments when the commissioner opens it. Reads the live
   top-two-division banzuke from sumo-api, auto-releases anyone who fell out
   of the top two divisions, pools the unclaimed + newly-promoted rikishi, and
   fills rosters in worst-first (reverse-standings) order. All transient state
   lives in a Meta key ('redraft:<id>') so we only touch the unambiguous
   draftStatus column on the league row. */
function fetchBanzukeNames(bashoId){
  bashoId = bashoId || BASHO_ID;
  var out = { makuuchi:[], juryo:[] }, divs = [['Makuuchi','makuuchi'],['Juryo','juryo']];
  for (var d=0; d<divs.length; d++){
    try {
      var resp = UrlFetchApp.fetch('https://sumo-api.com/api/basho/' + bashoId + '/banzuke/' + divs[d][0], { muteHttpExceptions:true });
      if (resp.getResponseCode() !== 200) continue;
      var data = JSON.parse(resp.getContentText());
      var rows = [].concat(data.east||[], data.west||[]);
      for (var i=0;i<rows.length;i++){
        var name = rows[i].shikonaEn || rows[i].shikona || rows[i].Rikishi || '';
        if (name) out[divs[d][1]].push(String(name));
      }
    } catch(e){}
  }
  return out;
}
function keeperStandings(id){          // member handles, worst-first, by last-basho active-lineup wins
  var wins = {}; readResults().forEach(function(b){ var w=String(b.winner||'').toLowerCase(); if(w) wins[w]=(wins[w]||0)+1; });
  var rosters = keeperRostersOf(id);
  return membersOf(id).map(function(h){
    var r = rosters[h.toLowerCase()] || { active:[] };
    var score = (r.active||[]).reduce(function(s,n){ return s + (wins[String(n).toLowerCase()]||0); }, 0);
    return { h:h, score:score };
  }).sort(function(a,b){ return a.score - b.score; }).map(function(x){ return x.h; });
}
function getRedraft_(id){ try { return JSON.parse(readMeta()['redraft:'+id] || 'null'); } catch(e){ return null; } }
function setRedraft_(id, obj){ setMeta_('redraft:'+id, obj ? JSON.stringify(obj) : ''); }
function redraftPool_(id, rd){
  rd = rd || getRedraft_(id); if (!rd || !rd.banzuke) return [];
  var owned = {}, rosters = keeperRostersOf(id);
  Object.keys(rosters).forEach(function(k){ rosters[k].makuuchi.concat(rosters[k].juryo).forEach(function(n){ owned[String(n).toLowerCase()]=1; }); });
  var pool = [];
  (rd.banzuke.makuuchi||[]).forEach(function(n){ if(!owned[n.toLowerCase()]) pool.push({ name:n, division:'makuuchi' }); });
  (rd.banzuke.juryo||[]).forEach(function(n){ if(!owned[n.toLowerCase()]) pool.push({ name:n, division:'juryo' }); });
  return pool;
}
function redraftTurn_(id, L, rd, rosters){
  rd = rd || getRedraft_(id); if (!rd) return { phase:'done' };
  rosters = rosters || keeperRostersOf(id);
  var order = rd.order||[], n = order.length, plan = rosterPlan(L);
  if (!n) return { phase:'done' };
  function open(h){ var r=rosters[h.toLowerCase()]||{makuuchi:[],juryo:[]};
    return { mk:Math.max(0,plan.mk-r.makuuchi.length), jr:Math.max(0,plan.farm-r.juryo.length) }; }
  var cursor = Number(rd.cursor)||0;
  for (var i=0;i<n;i++){
    var idx=(cursor+i)%n, o=open(order[idx]);
    if (o.mk>0 || o.jr>0) return { phase:'redraft', handle:order[idx], cursor:idx, open:o };
  }
  return { phase:'done' };
}
function openSupplementalDraft(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.commissioner.toLowerCase() !== u.handle.toLowerCase()) return { ok:false, error:'Only the commissioner can open the re-draft.' };
  if (L.mode !== 'keepers' || L.draftStatus !== 'complete') return { ok:false, error:'The keeper draft must be complete first.' };
  if (tournamentActive()) return { ok:false, error:'Wait until the tournament is over to re-draft.' };
  var banzuke = fetchBanzukeNames(BASHO_ID);
  if (!banzuke.makuuchi.length && !banzuke.juryo.length) return { ok:false, error:'Could not read the current banzuke from sumo-api. Try again shortly.' };
  var inB = {}; banzuke.makuuchi.forEach(function(n){ inB[n.toLowerCase()]='makuuchi'; }); banzuke.juryo.forEach(function(n){ inB[n.toLowerCase()]='juryo'; });
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var sh = sh_(SHEET_ROSTERS), v = sh.getDataRange().getValues(), released=[], del=[];
    for (var r=1;r<v.length;r++){
      if (String(v[r][0]) !== String(L.id)) continue;
      var name = String(v[r][2]||''), div = inB[name.toLowerCase()];
      if (!div){ del.push(r+1); released.push(name); }
      else if (String(v[r][3]||'').toLowerCase() !== div) sh.getRange(r+1,4).setValue(div);   // moved between the two divisions
    }
    del.sort(function(a,b){return b-a;}).forEach(function(row){ sh.deleteRow(row); });
    var order = keeperStandings(L.id);                       // worst first
    setRedraft_(L.id, { order:order, cursor:0, banzuke:banzuke });
    sh_(SHEET_LEAGUES).getRange(L.row, 8).setValue('redraft');
    return { ok:true, released:released, order:order, pool: redraftPool_(L.id).length };
  } finally { lock.releaseLock(); }
}
function redraftState(id){
  var L = leagueRow(id); if (!L) return { ok:false, error:'League not found.' };
  if (L.draftStatus !== 'redraft') return { ok:true, redraft:false, draftStatus:L.draftStatus };
  var rd = getRedraft_(L.id), rosters = keeperRostersOf(L.id);
  return { ok:true, redraft:true, rosterSize:L.rosterSize, benchSize:L.benchSize, farmSize:L.farmSize, order:(rd&&rd.order)||[],
    turn: redraftTurn_(L.id, L, rd, rosters), pool: redraftPool_(L.id, rd) };
}
function redraftPick(body){
  var u = verifyAuth(body.handle, body.auth); if (!u) return { ok:false, error:'Not authorised.' };
  var L = leagueRow(body.id); if (!L) return { ok:false, error:'League not found.' };
  if (L.draftStatus !== 'redraft') return { ok:false, error:'The re-draft isn\u2019t running.' };
  var rikishi = String(body.rikishi||'').trim(); if (!rikishi) return { ok:false, error:'No wrestler given.' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    L = leagueRow(body.id);
    var rd = getRedraft_(L.id); if (!rd) return { ok:false, error:'Re-draft state missing.' };
    var rosters = keeperRostersOf(L.id);
    var turn = redraftTurn_(L.id, L, rd, rosters);
    if (turn.phase === 'done') return { ok:false, error:'The re-draft is complete.' };
    if (turn.handle.toLowerCase() !== u.handle.toLowerCase()) return { ok:false, error:'It\u2019s not your turn.' };
    var pool = redraftPool_(L.id, rd), pick=null;
    for (var i=0;i<pool.length;i++){ if (pool[i].name.toLowerCase()===rikishi.toLowerCase()){ pick=pool[i]; break; } }
    if (!pick) return { ok:false, error: rikishi + ' isn\u2019t available.' };
    var mine = rosters[u.handle.toLowerCase()] || { makuuchi:[], juryo:[] };
    var plan = rosterPlan(L);
    var capInDiv = (pick.division === 'juryo') ? plan.farm : plan.mk;   // mk = active + bench
    var openInDiv = capInDiv - (pick.division==='juryo' ? mine.juryo.length : mine.makuuchi.length);
    if (openInDiv <= 0) return { ok:false, error:'You have no open ' + pick.division + ' slot.' };
    var now = new Date().toISOString();
    sh_(SHEET_PICKS).appendRow([L.id, 0, 0, 'redraft', u.handle, pick.name, now]);
    sh_(SHEET_ROSTERS).appendRow([L.id, u.handle, pick.name, pick.division, 'redraft', now, '']);
    rd.cursor = (turn.cursor + 1) % (rd.order.length || 1);
    var fresh = keeperRostersOf(L.id);
    var next = redraftTurn_(L.id, L, rd, fresh);
    if (next.phase === 'done'){ sh_(SHEET_LEAGUES).getRange(L.row, 8).setValue('complete'); setRedraft_(L.id, ''); }
    else { rd.cursor = next.cursor; setRedraft_(L.id, rd); }
    return { ok:true, nextTurn:next, draftStatus: next.phase==='done' ? 'complete' : 'redraft' };
  } finally { lock.releaseLock(); }
}

/* ============================================================
   LONG-TERM RANKING (JSA-style banzuke). Mirrors gg-ranking.js (the
   simulation-tuned canonical version) so promotions are computed once,
   server-side, from every player basho win rate = wins / (teamSize*15).
   ============================================================ */
var RANK_LADDER = [
  { key:'jonokuchi',  label:'Jonokuchi',  div:'jonokuchi' },
  { key:'jonidan',    label:'Jonidan',    div:'jonidan'   },
  { key:'sandanme',   label:'Sandanme',   div:'sandanme'  },
  { key:'makushita',  label:'Makushita',  div:'makushita' },
  { key:'juryo',      label:'J\u016bry\u014d', div:'juryo' },
  { key:'maegashira', label:'Maegashira', div:'makuuchi'  },
  { key:'komusubi',   label:'Komusubi',   div:'makuuchi'  },
  { key:'sekiwake',   label:'Sekiwake',   div:'makuuchi'  },
  { key:'ozeki',      label:'\u014czeki', div:'makuuchi'  },
  { key:'yokozuna',   label:'Yokozuna',   div:'makuuchi'  }
];
var RANK_CFG = [
  { up:0.50, down:-1,    jump:2 }, { up:0.50, down:0.15, jump:2 }, { up:0.52, down:0.18, jump:2 },
  { up:0.56, down:0.22,  jump:1 }, { up:0.66, down:0.30, jump:1 }, { up:0.85, down:0.35, jump:1 },
  { up:0.90, down:0.60,  jump:1 }, { up:0.94, down:0.72, jump:1 }, { up:0.98, down:0.86, jump:1 },
  { up:2,    down:0.90,  jump:0 }
];
var RANK_YOK_MIN_BASHO = 6, RANK_TOP_PCTL = 0.985, RANK_MAX_FALL = 3;
function rankClampIdx(i){ i = i|0; return i<0?0:(i>9?9:i); }
function rankApplyBasho(users){
  var active = users.filter(function(u){ return typeof u.score === 'number'; });
  var N = active.length; if (!N) return users;
  active.forEach(function(u){
    var below=0, eq=0, i;
    for (i=0;i<N;i++){ if (active[i].score < u.score) below++; else if (active[i].score === u.score) eq++; }
    u._p = N>1 ? (below + 0.5*(eq-1))/(N-1) : 1;
  });
  active.forEach(function(u){
    var idx = rankClampIdx(u.rankIdx||0), cfg = RANK_CFG[idx], p = u._p;
    var bashoCount = (u.bashoCount||0) + 1;
    u.topStreak = (p >= RANK_TOP_PCTL) ? (u.topStreak||0)+1 : 0;
    var next = idx;
    if (idx === 9){ if (p < cfg.down) next = 8; }
    else if (idx === 8){
      if (p >= cfg.up && u.topStreak >= 2 && bashoCount >= RANK_YOK_MIN_BASHO) next = 9;
      else if (p < cfg.down) next = 7;
    } else if (p >= cfg.up){
      var steps = 1;
      if (cfg.jump > 1){ var over=(p-cfg.up)/(1-cfg.up+1e-9); steps = Math.min(cfg.jump, 1 + Math.floor(over*cfg.jump)); }
      next = idx + steps;
      if (next >= 9 && !(bashoCount >= RANK_YOK_MIN_BASHO && u.topStreak >= 2)) next = 8;
    } else if (p < cfg.down){
      var depth = (cfg.down - p)/(cfg.down + 1e-9);
      next = idx - (1 + Math.floor(depth * RANK_MAX_FALL));
    }
    u.rankIdx = rankClampIdx(next);
    u.bashoCount = bashoCount;
    delete u._p;
  });
  return users;
}
function rankTeamSize_(t){
  if (!t) return 0;
  if (Object.prototype.toString.call(t) === '[object Array]'){ var n=0,i; for (i=0;i<t.length;i++) if (t[i]) n++; return n; }
  if (typeof t === 'object'){ var c=0,k; for (k in t){ if (t.hasOwnProperty(k) && t[k]) c++; } return c; }
  return 0;
}
function rankStateMap_(){
  var sh = ensureSheet(SpreadsheetApp.getActiveSpreadsheet(), SHEET_RANKINGS, ['handle','rankIdx','bashoCount','topStreak','lastBasho']);
  var v = sh.getDataRange().getValues(), map = {}, r;
  for (r=1;r<v.length;r++){
    var h = String(v[r][0]||'').toLowerCase(); if (!h) continue;
    map[h] = { rankIdx:Number(v[r][1]||0), bashoCount:Number(v[r][2]||0), topStreak:Number(v[r][3]||0), lastBasho:String(v[r][4]||'') };
  }
  return map;
}
function rankBadgeMap_(){
  var state = rankStateMap_(), out = {}, h;
  for (h in state){ if (!state.hasOwnProperty(h)) continue; var idx = rankClampIdx(state[h].rankIdx||0), R = RANK_LADDER[idx]; out[h] = { idx:idx, label:R.label, div:R.div }; }
  return out;
}
function writeRankings_(arr, basho){
  var sh = ensureSheet(SpreadsheetApp.getActiveSpreadsheet(), SHEET_RANKINGS, ['handle','rankIdx','bashoCount','topStreak','lastBasho']);
  var v = sh.getDataRange().getValues(), rowByHandle = {}, r;
  for (r=1;r<v.length;r++){ rowByHandle[String(v[r][0]||'').toLowerCase()] = r+1; }
  arr.forEach(function(u){
    var key = u.handle.toLowerCase(), row = rowByHandle[key];
    var vals = [u.handle, u.rankIdx||0, u.bashoCount||0, u.topStreak||0, basho];
    if (row) sh.getRange(row,1,1,5).setValues([vals]); else sh.appendRow(vals);
  });
}
function setMeta_(key, value){
  var sh = sh_(SHEET_META); if (!sh) return;
  var v = sh.getDataRange().getValues(), r;
  for (r=1;r<v.length;r++){ if (String(v[r][0])===key){ sh.getRange(r+1,2).setValue(value); return; } }
  sh.appendRow([key, value]);
}
/* ============================================================
   CHAMPIONS
   ------------------------------------------------------------
   One row per title won. Two scopes:
     public — the Sumo Slap Down League, i.e. the top archived score on the
              shared board for that basho
     league — one per private league, scored under THAT league's own rules
   Titles are crowned once, at basho close, from applyBashoRanking() — so
   there is a single button to press and a single idempotency guard. Nothing
   here is ever recomputed afterwards: a title is a historical fact, and if
   the banzuke or the scoring rules change next basho, last basho's champion
   must not silently change with them.
   ============================================================ */
var CHAMP_HEAD = ['id', 'basho', 'scope', 'leagueId', 'leagueName', 'handle', 'score',
                  'runnerUp', 'runnerUpScore', 'entrants', 'awardedAt'];
function champSheet_(){ return ensureSheet(SpreadsheetApp.getActiveSpreadsheet(), SHEET_CHAMPS, CHAMP_HEAD); }

/* Sanyaku rank levels, mirroring LEVEL in gg-account.js. The bonus for
   beating a higher-ranked opponent is (loserLevel - winnerLevel) steps. */
var TIER_LEVEL = { Y:4, O:3, S:2, K:1, M:0, J:0 };

/* name -> banzuke tier for one basho, in order of trust:
     1. the map the admin page posts at award time (gg-account.js RANKS, the
        same table every score on the site was computed from). It's stored in
        Meta so a title can be explained months later.
     2. the tiers embedded in archived TeamHistory rows, if no map was posted
     3. 'M' for an unknown name — exactly what gg-account.js falls back to */
function tierMapFor_(basho, posted){
  var key = 'tiers:' + basho, map = {}, n;
  if (posted && typeof posted === 'object' && Object.keys(posted).length){
    for (n in posted){
      if (!posted.hasOwnProperty(n)) continue;
      map[String(n)] = String(posted[n] || 'M').toUpperCase().charAt(0);
    }
    setMeta_(key, JSON.stringify(map));
    return map;
  }
  try { map = JSON.parse(readMeta()[key] || '{}'); } catch(e){ map = {}; }
  if (Object.keys(map).length) return map;
  var v = sh_(SHEET_HISTORY).getDataRange().getValues();
  for (var r = 1; r < v.length; r++){
    if (String(v[r][1]) !== basho) continue;
    var rows = []; try { rows = JSON.parse(v[r][5] || '[]'); } catch(e){ rows = []; }
    rows.forEach(function(x){ if (x && x.name && x.tier) map[String(x.name)] = String(x.tier); });
  }
  return map;
}
function tierLevel_(name, tiers){ return TIER_LEVEL[String((tiers || {})[name] || 'M')] || 0; }

/* Server mirror of GG.scoreModel + GG.teamScore in gg-account.js.
   KEEP THESE TWO IN STEP. If the client's scoring changes and this doesn't,
   a league's crowned champion won't be the player its members watched top the
   table all basho — the worst kind of bug, because nothing errors. */
function serverScoreModel_(scoring, tiers){
  var results = readResults(), meta = readMeta();
  var wins = {}, bonus = {};
  results.forEach(function(b){
    var w = String(b.winner || ''); if (!w) return;
    var loser = (w === b.east) ? b.west : b.east;
    wins[w] = (wins[w] || 0) + 1;
    var diff = tierLevel_(loser, tiers) - tierLevel_(w, tiers);
    if (diff > 0) bonus[w] = (bonus[w] || 0) + diff * scoring.sanyakuBonus;
  });
  var sansho = {};
  String(meta.sansho || '').split(/[,;\/]+/).forEach(function(x){ x = x.trim(); if (x) sansho[x] = 1; });
  return { wins:wins, bonus:bonus, sansho:sansho, yusho:String(meta.yusho || '').trim(), scoring:scoring };
}
function serverTeamScore_(names, model){
  var sc = model.scoring, pts = 0;
  (names || []).forEach(function(n){
    if (!n) return;
    pts += (model.wins[n] || 0) * sc.winPoint
         + (model.bonus[n] || 0)
         + (model.sansho[n] ? sc.sansho : 0)
         + ((model.yusho && model.yusho === n) ? sc.yusho : 0);
  });
  return pts;
}

/* The same score, itemised — the per-rikishi breakdown the archive stores and
   the account page reads back. Mirrors GG.teamScore's `rows` field field for
   field (name/tier/w/wins/bonus/sansho/yusho/pts, sorted by points), because
   computeBadges_ and tierMapFor_ both read those keys out of archived rows.
   `wins` on the returned object is the sum of the row `w` values, matching
   what the client sends as its win count. */
function serverTeamRows_(team, model, tiers){
  var sc = model.scoring, pts = 0, wins = 0, rows = [];
  Object.keys(team || {}).forEach(function(k){
    var n = team[k]; if (!n) return;
    var wgames = model.wins[n] || 0, bn = model.bonus[n] || 0;
    var w  = wgames * sc.winPoint;
    var sa = model.sansho[n] ? sc.sansho : 0;
    var yu = (model.yusho && model.yusho === n) ? sc.yusho : 0;
    var p  = w + bn + sa + yu;
    pts += p; wins += w;
    rows.push({ name:n, tier:String((tiers || {})[n] || 'M'), w:w, wins:wgames, bonus:bn,
                sansho:!!sa, yusho:!!yu, pts:p });
  });
  rows.sort(function(a, b){ return b.pts - a.pts; });
  return { pts:pts, wins:wins, rows:rows };
}

/* name -> banzuke tier, read straight off sumo-api's banzuke for the basho.
   fetchBanzukeNames() above wants only the shikona; this wants the rank, so
   the sanyaku bonus can be computed on the server without waiting for the
   admin page to post gg-account.js's hand-maintained RANKS table. */
function tierFromRank_(rank, div){
  var r = String(rank || '').toLowerCase();
  if (r.indexOf('yokozuna')   >= 0) return 'Y';
  if (r.indexOf('ozeki')      >= 0) return 'O';
  if (r.indexOf('sekiwake')   >= 0) return 'S';
  if (r.indexOf('komusubi')   >= 0) return 'K';
  if (r.indexOf('juryo')      >= 0) return 'J';
  if (r.indexOf('maegashira') >= 0) return 'M';
  return String(div || '').toLowerCase().indexOf('juryo') >= 0 ? 'J' : 'M';
}
function fetchBanzukeTiers_(bashoId){
  bashoId = bashoId || BASHO_ID;
  var out = {}, divs = ['Makuuchi', 'Juryo'];
  for (var d = 0; d < divs.length; d++){
    try {
      var resp = UrlFetchApp.fetch('https://sumo-api.com/api/basho/' + bashoId + '/banzuke/' + divs[d], { muteHttpExceptions:true });
      if (resp.getResponseCode() !== 200) continue;
      var data = JSON.parse(resp.getContentText());
      var rows = [].concat(data.east || [], data.west || []);
      for (var i = 0; i < rows.length; i++){
        var name = String(rows[i].shikonaEn || rows[i].shikona || '').trim();
        if (name) out[name] = tierFromRank_(rows[i].rank || rows[i].Rank || '', divs[d]);
      }
    } catch (e) {}
  }
  return out;
}

/* ---- the basho-close archive ----------------------------------------------
   Scores every account off the sheet and writes it to TeamHistory. This used
   to be the client's job alone (maybeArchive() in fantasy.html), which meant a
   player who didn't open the page between the last bout and the next "New
   basho" simply lost that tournament — silently, and unrecoverably, because
   the reset clears the very rows the score is computed from.

   Guards, in order: the basho must have finished (Meta.lastDay >= 15), there
   must be results to score, and it runs once per basho (Meta.archivedBasho).
   Re-running it is safe while those hold — it upserts on (handle, basho) — but
   the flag matters anyway: after the tournament, players start editing their
   teams for the NEXT one, and a second pass would archive those instead.

   CALLER MUST HOLD THE SCRIPT LOCK. Use archiveBasho_() if you don't.       */
function archiveAllTeams_(opts){
  opts = opts || {};
  var meta = readMeta();
  var basho = String(opts.basho || meta.basho || BASHO_LABEL).trim().slice(0, 60);
  if (!basho) return { ok:false, error:'No basho label in Meta.', archived:0 };
  var lastDay = Number(meta.lastDay || 0);
  if (!opts.force && lastDay < 15)
    return { ok:false, waiting:true, lastDay:lastDay, archived:0,
             error:'Basho still running \u2014 day ' + lastDay + ' of 15.' };
  if (!opts.force && String(meta.archivedBasho || '') === basho)
    return { ok:true, already:true, basho:basho, archived:0 };

  var tiers = {};
  try { tiers = JSON.parse(meta['tiers:' + basho] || '{}'); } catch (e) { tiers = {}; }
  if (!Object.keys(tiers).length) tiers = tierMapFor_(basho, fetchBanzukeTiers_(BASHO_ID));

  var model = serverScoreModel_(defaultScoring(), tiers);
  if (!Object.keys(model.wins).length)
    return { ok:false, error:'No results in the sheet to score \u2014 nothing to archive.', archived:0 };

  var users = readUsers();
  var sh = sh_(SHEET_HISTORY), v = sh.getDataRange().getValues(), rowByHandle = {}, r;
  for (r = 1; r < v.length; r++){
    if (String(v[r][1]) !== basho) continue;
    rowByHandle[String(v[r][0] || '').toLowerCase()] = r + 1;
  }
  var appends = [], updated = 0, skipped = 0;
  users.forEach(function(u){
    var team = u.team || {};
    var s = serverTeamRows_(team, model, tiers);
    if (!s.rows.length) { skipped++; return; }                 // registered but never picked
    var vals = [u.handle, basho, JSON.stringify(team), s.pts, s.wins, JSON.stringify(s.rows), new Date().toISOString()];
    var row = rowByHandle[u.handle.toLowerCase()];
    if (row) { sh.getRange(row, 1, 1, 7).setValues([vals]); updated++; }
    else appends.push(vals);
  });
  if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, 7).setValues(appends);
  setMeta_('archivedBasho', basho);
  setMeta_('archiveError', '');
  return { ok:true, basho:basho, archived:updated + appends.length, created:appends.length,
           updated:updated, skipped:skipped, yusho:model.yusho,
           sansho:Object.keys(model.sansho).join(', ') };
}
function archiveBasho_(opts){
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try { return archiveAllTeams_(opts); } finally { lock.releaseLock(); }
}
function adminArchiveBasho(body){
  var bad = adminGate(body && body.adminKey); if (bad) return bad;
  return archiveBasho_({ basho: body && body.basho, force: !!(body && body.force) });
}

/* Given [{handle,score}], who takes the title?
   A title needs a contest, so: at least two scored teams, and a top score
   above zero. A tie crowns co-champions rather than nobody — sumo settles
   these with a playoff we have no way to run, and splitting the honour reads
   better than voiding it. */
function championsFrom_(entries){
  if (!entries || entries.length < 2) return null;
  var top = entries.reduce(function(m, e){ return Math.max(m, e.score); }, 0);
  if (top <= 0) return null;
  var winners = entries.filter(function(e){ return e.score === top; });
  var rest = entries.filter(function(e){ return e.score < top; })
                    .sort(function(a, b){ return b.score - a.score; });
  return { winners:winners, top:top, runnerUp:rest[0] || null, entrants:entries.length };
}

/* Crown every title for a finished basho. Idempotent: if the sheet already
   holds a row for this basho we return untouched, so a re-run of the ranking
   pass can never mint a second set of trophies. */
function awardChampions_(basho, tiers){
  var sh = champSheet_(), v = sh.getDataRange().getValues(), r;
  for (r = 1; r < v.length; r++) if (String(v[r][1]) === basho) return { already:true, awarded:0 };
  var now = new Date().toISOString(), rows = [];

  function push(scope, leagueId, leagueName, res){
    if (!res) return;
    res.winners.forEach(function(w){
      // index-suffixed: newId() alone collides often enough to matter in a
      // batch this size, and two trophies sharing an id would be confusing
      rows.push([newId('ch_') + '_' + rows.length, basho, scope, leagueId, leagueName, w.handle, w.score,
                 res.runnerUp ? res.runnerUp.handle : '', res.runnerUp ? res.runnerUp.score : '',
                 res.entrants, now]);
    });
  }

  /* --- the public title: the top archived score on the shared board --- */
  var hv = sh_(SHEET_HISTORY).getDataRange().getValues(), pub = [];
  for (r = 1; r < hv.length; r++){
    if (String(hv[r][1]) !== basho) continue;
    var h = String(hv[r][0] || ''); if (!h) continue;
    pub.push({ handle:h, score:Number(hv[r][3] || 0) });
  }
  push('public', '', 'Sumo Slap Down League', championsFrom_(pub));

  /* --- one title per private league, under that league's own scoring --- */
  var lv = sh_(SHEET_LEAGUES).getDataRange().getValues();
  var modelCache = {};
  for (r = 1; r < lv.length; r++){
    var id = String(lv[r][0] || ''); if (!id) continue;
    var name = String(lv[r][1] || 'League');
    var mode = String(lv[r][5] || 'classic') || 'classic';
    var scoring = parseScoring(lv[r][11]);
    var ck = JSON.stringify(scoring);
    var model = modelCache[ck] || (modelCache[ck] = serverScoreModel_(scoring, tiers));
    var members = membersOf(id), entries = [];
    if (mode === 'keepers'){
      var rosters = keeperRostersOf(id);
      members.forEach(function(mh){
        var ros = rosters[mh.toLowerCase()];
        if (!ros || !ros.active.length) return;          // no lineup set, no title shot
        entries.push({ handle:mh, score:serverTeamScore_(ros.active, model) });
      });
    } else {
      var teams = leagueTeamsOf(id);
      members.forEach(function(mh){
        var t = teams[mh.toLowerCase()]; if (!t) return;
        var names = Object.keys(t.team || {}).map(function(k){ return t.team[k]; })
                          .filter(function(x){ return !!x; });
        if (!names.length) return;
        entries.push({ handle:mh, score:serverTeamScore_(names, model) });
      });
    }
    push('league', id, name, championsFrom_(entries));
  }

  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, CHAMP_HEAD.length).setValues(rows);
  return { already:false, awarded:rows.length };
}

/* Every title one handle holds, newest first — the trophy case. */
function championsOf_(handle){
  var key = String(handle || '').toLowerCase(); if (!key) return [];
  var v = champSheet_().getDataRange().getValues(), out = [];
  for (var r = 1; r < v.length; r++){
    if (String(v[r][5] || '').toLowerCase() !== key) continue;
    out.push({ id:String(v[r][0]), basho:String(v[r][1]), scope:String(v[r][2]),
               leagueId:String(v[r][3] || ''), leagueName:String(v[r][4] || ''),
               score:Number(v[r][6] || 0), runnerUp:String(v[r][7] || ''),
               runnerUpScore:(v[r][8] === '' ? null : Number(v[r][8])),
               entrants:Number(v[r][9] || 0), awardedAt:String(v[r][10] || '') });
  }
  out.sort(function(a, b){ return new Date(b.awardedAt) - new Date(a.awardedAt); });
  return out;
}

/* The reigning title-holder in one scope — what the league banner and the
   leaderboard crown show. leagueId '' means the public board. Returns handles
   only (plural: co-champions); callers already hold a handle->name map and
   shouldn't pay for a second Users read on a hot endpoint. */
function reigningChampion_(leagueId){
  var want = String(leagueId || ''), scope = want ? 'league' : 'public';
  var v = champSheet_().getDataRange().getValues(), best = null;
  for (var r = 1; r < v.length; r++){
    if (String(v[r][2]) !== scope) continue;
    if (scope === 'league' && String(v[r][3]) !== want) continue;
    var at = String(v[r][10] || '');
    if (!best || new Date(at) > new Date(best.at)) best = { at:at, basho:String(v[r][1]), handles:[], score:Number(v[r][6] || 0) };
    if (best.at === at) best.handles.push(String(v[r][5]));
  }
  return best ? { basho:best.basho, handles:best.handles, score:best.score } : null;
}

/* Compute promotions for a completed basho from everyone archived win rate.
   Idempotent per basho (guarded by Meta.rankedBasho). New handles start at
   Jonokuchi; returning handles carry rankIdx/bashoCount/topStreak forward. */
function applyBashoRanking(basho, tiers){
  basho = String(basho || readMeta().basho || '').trim();
  if (!basho) return { ok:false, error:'no basho' };
  if (String(readMeta().rankedBasho||'') === basho) return { ok:true, already:true, basho:basho };
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    if (String(readMeta().rankedBasho||'') === basho) return { ok:true, already:true, basho:basho };
    /* Grade the archive, but make sure there IS one first. Pressing "Apply
       ranking" used to fail with "no archived results" if the players hadn't
       each opened the site since the last bout; now the button archives the
       current basho itself. Same lock, and archiveAllTeams_ is the no-lock
       core precisely so this call can't deadlock against it. */
    if (basho === String(readMeta().basho || '').trim()) {
      try { archiveAllTeams_({ basho: basho }); } catch (e) {}
    }
    var hv = sh_(SHEET_HISTORY).getDataRange().getValues(), arr = [], r;
    for (r=1;r<hv.length;r++){
      if (String(hv[r][1]) !== basho) continue;
      var handle = String(hv[r][0]||''); if (!handle) continue;
      var wins = Number(hv[r][4]||0), team = {};
      try { team = JSON.parse(hv[r][2] || '{}'); } catch(e){}
      var size = rankTeamSize_(team), possible = (size>0?size:1)*15;
      arr.push({ handle:handle, score: possible>0 ? wins/possible : 0 });
    }
    /* Crown the basho's titles in the same pass, and do it BEFORE the
       no-archives bail-out: private leagues score off LeagueTeams and are
       perfectly rankable even in a basho where nobody saved to the public
       board. It runs inside the same lock, before the rankedBasho guard is
       set, and is idempotent — so a run that dies half-way is safe to repeat. */
    var champs = { awarded:0 };
    try { champs = awardChampions_(basho, tierMapFor_(basho, tiers)); }
    catch (e){ champs = { awarded:0, error:String(e) }; }   // never lose a ranking over a trophy

    if (!arr.length) return { ok:false, error:'no archived results for '+basho,
                              champions:champs.awarded };
    var state = rankStateMap_();
    arr.forEach(function(u){ var st = state[u.handle.toLowerCase()] || {}; u.rankIdx=st.rankIdx||0; u.bashoCount=st.bashoCount||0; u.topStreak=st.topStreak||0; });
    rankApplyBasho(arr);
    writeRankings_(arr, basho);
    setMeta_('rankedBasho', basho);
    return { ok:true, ranked:arr.length, basho:basho,
             champions:champs.awarded, championError:champs.error || '' };
  } finally { lock.releaseLock(); }
}
function adminApplyRanking(body){
  var bad = adminGate(body.adminKey); if (bad) return bad;
  return applyBashoRanking(body && body.basho, body && body.tiers);
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

  var maxDay = 0, awards = { yusho:'', sansho:{} };
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
        captureAwards_(div, data, awards);
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

  /* The tournament's honours \u2014 y\u016bsh\u014d and the three sansh\u014d \u2014 ride along on the
     same payload as the bouts, and they're worth +5 each. Fill them in before
     the archive below freezes anyone's score, or every prize silently fails to
     pay out. We only ever fill a BLANK: a value typed onto the Meta tab by
     hand is a deliberate correction and outranks the feed. */
  var m = readMeta();
  if (Number(m.lastDay || 0) >= 15) {
    if (awards.yusho && !String(m.yusho || '').trim()) setMeta_('yusho', awards.yusho);
    var prizes = Object.keys(awards.sansho);
    if (prizes.length && !String(m.sansho || '').trim()) setMeta_('sansho', prizes.join(', '));
  }

  /* Basho over? Snapshot everyone. Self-guarding (day 15, once per basho), so
     calling it on every tick costs one Meta read while the basho is running. */
  try { archiveBasho_({}); }
  catch (err) { try { setMeta_('archiveError', new Date().toISOString() + ' ' + String(err)); } catch (e2) {} }
}

/* Pull the y\u016bsh\u014d winner and the special prizes out of a torikumi payload.
   Sansh\u014d are a Makuuchi award, and only the Makuuchi y\u016bsh\u014d scores, so both
   are read from the Makuuchi fetch; the y\u016bsh\u014d list carries a division in
   `type`, and we accept a lone unlabelled entry from the Makuuchi call. */
function captureAwards_(div, data, into){
  if (!data || !into || String(div).toLowerCase().indexOf('makuuchi') < 0) return;
  var y = data.yusho || data.Yusho || [];
  for (var i = 0; i < y.length; i++){
    var name = String(y[i].shikonaEn || y[i].shikona || '').trim();
    var type = String(y[i].type || y[i].Type || '');
    if (name && (/makuuchi/i.test(type) || (!type && y.length === 1))) into.yusho = name;
  }
  var sp = data.specialPrizes || data.SpecialPrizes || [];
  for (var j = 0; j < sp.length; j++){
    var sn = String(sp[j].shikonaEn || sp[j].shikona || '').trim();
    if (sn) into.sansho[sn] = 1;          // two prizes for one man still score once, as on the client
  }
}
