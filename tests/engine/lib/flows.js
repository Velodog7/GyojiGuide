/* The scripted flows and the random phase, shared by differential.js (the
   in-memory store) and sql.js (the real SQL, in PGlite). Each flow takes a
   harness factory `make(opts)` and returns { name, H }; the caller checks
   H.failures, where every response or row that differed was recorded. */
'use strict';
const { MAK, JUR } = require('./harness');

const U = [['sean', 'h1', 'Sean'], ['mika', 'h2', 'Mika'], ['dave', 'h3', 'Dave'], ['taro', 'h4', 'Taro'], ['yumi', 'h5', 'Yumi']];
const AUTH = Object.fromEntries(U.map(u => [u[0], u[1]]));
const ADMIN = 'test';

async function world(make, opts) {
  const H = await make(opts);
  await H.fn('setup');
  for (const [h, a, n] of U) await H.post({ action: 'register', handle: h, auth: a, name: n });
  return H;
}

async function draftToEnd(H, id, commish, pool) {
  let guard = 0;
  for (;;) {
    const st = (await H.get({ action: 'draftState', id, who: commish })).json;
    if (!st || !st.ok || !st.league || st.league.draftStatus !== 'active') return st;
    if (++guard > 200) throw new Error('draft never finished');
    const who = st.turn && st.turn.handle;
    if (!who) return st;
    const taken = new Set((st.pickedNames || []).map(s => String(s).toLowerCase()));
    const list = (st.turn.phase === 'juryo' ? pool.juryo : pool.makuuchi).filter(n => !taken.has(n.toLowerCase()));
    // a wrong-turn pick now and then: must be refused identically
    if (guard % 5 === 0) {
      const other = U.map(u => u[0]).find(x => x !== who);
      await H.post({ action: 'makePick', handle: other, auth: AUTH[other], id, rikishi: list[0] });
    }
    await H.post({ action: 'makePick', handle: who, auth: AUTH[who], id, rikishi: list[0] });
  }
}

async function accounts(make) {
  const H = await world(make, { tz: 'America/Los_Angeles' });
  await H.post({ action: 'register', handle: 'SEAN', auth: 'x', name: 'Imposter' });
  await H.post({ action: 'register', handle: 'gyoji', auth: 'x' });
  await H.post({ action: 'login', handle: 'sean', auth: 'h1' });
  await H.post({ action: 'login', handle: 'sean', auth: 'nope' });
  await H.post({ action: 'login', handle: 'ghost', auth: 'h1' });
  await H.post({ action: 'saveName', handle: 'mika', auth: 'h2', name: 'Mika the Mighty' });
  await H.post({ action: 'saveAvatar', handle: 'dave', auth: 'h3', avatar: JSON.stringify({ v: 2, belt: '#2a5aa0', kanji: { ch: '山', color: '#fff' } }) });
  await H.post({ action: 'save', handle: 'sean', auth: 'h1', team: { sanyaku: 'Kotozakura', m1: 'Ura', juryo: 'Shishi' } });
  await H.post({ action: 'save', handle: 'taro', auth: 'h4', team: { sanyaku: 'Onosato', m5: 'Abi' } });
  await H.get({ action: 'data' });
  await H.get({ action: 'list' });
  await H.post({ action: 'dmSend', handle: 'sean', auth: 'h1', to: 'mika', body: 'hello mika' });
  await H.post({ action: 'dmSend', handle: 'mika', auth: 'h2', to: 'sean', body: 'hi sean — こんにちは' });
  await H.post({ action: 'dmSend', handle: 'sean', auth: 'h1', to: 'sean', body: 'me' });
  await H.post({ action: 'dmSend', handle: 'dave', auth: 'h3', to: 'nobody', body: 'x' });
  for (const [h] of U) { await H.get({ action: 'dmThreads', handle: h }); await H.get({ action: 'whatsNew', handle: h }); }
  await H.post({ action: 'dmMarkRead', handle: 'mika', auth: 'h2', other: 'sean' });
  await H.get({ action: 'dmUnread', handle: 'mika' });
  await H.get({ action: 'dmDirectory', handle: 'sean' });
  const b1 = (await H.post({ action: 'postBoardMessage', handle: 'sean', auth: 'h1', body: 'Who takes Onosato?' })).json;
  await H.post({ action: 'postBoardMessage', handle: 'mika', auth: 'h2', body: 'Me', parentId: b1 && b1.id });
  await H.get({ action: 'board', handle: 'dave' });
  const msgs = ((await H.get({ action: 'board', handle: 'sean' })).json || {}).messages || [];
  const mid = msgs[0] && (msgs[0].id || msgs[0].msgId);
  await H.post({ action: 'voteBoardMessage', handle: 'dave', auth: 'h3', msgId: mid, value: 1 });
  await H.post({ action: 'voteBoardMessage', handle: 'dave', auth: 'h3', msgId: mid, value: -1 });
  await H.post({ action: 'editBoardMessage', handle: 'sean', auth: 'h1', msgId: mid, body: 'edited' });
  await H.post({ action: 'feedback', kind: 'bug', message: 'the button is blue', handle: 'taro', page: 'fantasy.html' });
  await H.post({ action: 'feedback', kind: 'suggestion', message: 'more taiko', subject: 'idea' });
  await H.post({ action: 'feedback', kind: 'nope', message: 'x' });
  await H.post({ action: 'logPageview', page: 'index.html', visitorId: 'v1', tz: 'America/Los_Angeles' });
  await H.post({ action: 'logPageview', page: 'fantasy.html', visitorId: 'v2', tz: 'Asia/Tokyo' });
  await H.post({ action: 'requestPinReset', handle: 'taro' });
  await H.post({ action: 'adminPinResets', adminKey: ADMIN });
  await H.post({ action: 'adminResetPin', adminKey: ADMIN, handle: 'taro' });
  await H.post({ action: 'requestPinReset', handle: 'yumi' });
  await H.post({ action: 'adminDismissPinReset', adminKey: ADMIN, handle: 'yumi' });
  await H.post({ action: 'adminUsers', adminKey: ADMIN });
  await H.post({ action: 'adminFeedback', adminKey: ADMIN });
  await H.post({ action: 'adminStats', adminKey: ADMIN });
  await H.post({ action: 'adminMessages', adminKey: ADMIN });
  await H.post({ action: 'adminWarnUser', adminKey: ADMIN, handle: 'dave', message: 'be nice' });
  await H.post({ action: 'login', handle: 'dave', auth: 'h3' });
  await H.post({ action: 'adminBanUser', adminKey: ADMIN, handle: 'dave', message: 'bye' });
  await H.post({ action: 'login', handle: 'dave', auth: 'h3' });
  await H.post({ action: 'adminUnbanUser', adminKey: ADMIN, handle: 'dave' });
  await H.post({ action: 'adminDmSend', adminKey: ADMIN, to: 'mika', body: 'thanks for the report' });
  await H.post({ action: 'adminDmThreads', adminKey: ADMIN });
  await H.post({ action: 'adminDmMarkRead', adminKey: ADMIN, other: 'mika' });
  await H.post({ action: 'adminBroadcast', adminKey: ADMIN, audience: 'all', dryRun: true, body: 'hi all' });
  await H.post({ action: 'adminBroadcast', adminKey: ADMIN, audience: 'all', body: 'hi all' });
  await H.post({ action: 'adminSetFeedbackStatus', adminKey: ADMIN, id: 2, status: 'done' });
  for (let i = 0; i < 3; i++) await H.post({ action: 'adminUsers', adminKey: 'wrong' + i });
  await H.post({ action: 'changeHandle', handle: 'yumi', auth: 'h5', newHandle: 'yumiko', newAuth: 'h5b' });
  await H.post({ action: 'login', handle: 'yumiko', auth: 'h5b' });
  await H.post({ action: 'deleteBoardMessage', handle: 'sean', auth: 'h1', msgId: mid });
  await H.post({ action: 'adminDeleteUser', adminKey: ADMIN, handle: 'taro' });
  await H.post({ action: 'nonsense' });
  await H.get({ action: 'nonsense' });
  await H.get({});
  await H.get({ action: 'accountSummary', handle: 'sean' });
  await H.get({ action: 'history', handle: 'sean' });
  await H.compareState('accounts');
  return { name: 'accounts, DMs, board, feedback and admin agree with the model (' + H.stats().compared + ' requests)', H };
}

async function classic(make) {
  const H = await world(make);
  const cr = (await H.post({ action: 'createLeague', handle: 'sean', auth: 'h1', name: 'Slap Down', mode: 'classic' })).json;
  await H.get({ action: 'invite', code: cr.inviteCode });
  await H.post({ action: 'joinLeague', handle: 'mika', auth: 'h2', code: cr.inviteCode });
  await H.post({ action: 'joinLeague', handle: 'dave', auth: 'h3', code: cr.inviteCode });
  await H.post({ action: 'joinLeague', handle: 'dave', auth: 'h3', code: cr.inviteCode });
  await H.post({ action: 'joinLeague', handle: 'taro', auth: 'h4', code: 'NOPE123' });
  await H.get({ action: 'leagues', handle: 'mika' });
  await H.get({ action: 'league', id: cr.id, handle: 'sean' });
  await H.post({ action: 'renameLeague', handle: 'sean', auth: 'h1', id: cr.id, name: 'Slap Down II' });
  await H.post({ action: 'renameLeague', handle: 'mika', auth: 'h2', id: cr.id, name: 'mine now' });
  await H.post({ action: 'setLeagueScoring', handle: 'sean', auth: 'h1', id: cr.id, scoring: { winPoint: 2, yusho: 10, sansho: 3, sanyakuBonus: 0 } });
  const m1 = (await H.post({ action: 'postMessage', handle: 'mika', auth: 'h2', id: cr.id, body: 'good luck' })).json;
  await H.post({ action: 'postMessage', handle: 'dave', auth: 'h3', id: cr.id, body: 'you too', parentId: m1 && m1.id });
  await H.post({ action: 'postMessage', handle: 'taro', auth: 'h4', id: cr.id, body: 'let me in' });
  await H.post({ action: 'saveLeagueTeam', handle: 'mika', auth: 'h2', id: cr.id, team: { sanyaku: 'Hoshoryu', m1: 'Abi' } });
  await H.get({ action: 'league', id: cr.id, handle: 'mika' });
  if (m1 && m1.id) await H.post({ action: 'deleteMessage', handle: 'mika', auth: 'h2', msgId: m1.id });
  await H.post({ action: 'leaveLeague', handle: 'dave', auth: 'h3', id: cr.id });
  await H.post({ action: 'removeMember', handle: 'sean', auth: 'h1', id: cr.id, member: 'mika' });
  await H.post({ action: 'setLeagueMode', handle: 'sean', auth: 'h1', id: cr.id, mode: 'keepers' });
  await H.get({ action: 'league', id: cr.id, handle: 'sean' });
  await H.post({ action: 'deleteLeague', handle: 'sean', auth: 'h1', id: cr.id });
  await H.get({ action: 'leagues', handle: 'sean' });
  await H.compareState('classic');
  return { name: 'classic league lifecycle agrees with the model (' + H.stats().compared + ' requests)', H };
}

async function keepers(make) {
  const H = await world(make, { tz: 'Asia/Tokyo' });
  const cr = (await H.post({ action: 'createLeague', handle: 'sean', auth: 'h1', name: 'Chanko Boogie', mode: 'keepers', rosterSize: 3, benchSize: 1, farmSize: 1 })).json;
  const id = cr.id;
  for (const h of ['mika', 'dave']) await H.post({ action: 'joinLeague', handle: h, auth: AUTH[h], code: cr.inviteCode });
  await H.post({ action: 'setLeagueKeepers', handle: 'sean', auth: 'h1', id, keepMk: 1, keepJr: '' });
  await H.post({ action: 'setDraftDate', handle: 'sean', auth: 'h1', id, draftDate: '2026-11-01T18:00:00.000Z' });
  for (const h of ['sean', 'mika', 'dave']) await H.post({ action: 'agreeDraftDate', handle: h, auth: AUTH[h], id, agree: true });
  await H.post({ action: 'saveDraftBoard', handle: 'mika', auth: 'h2', id, makuuchi: ['Atamifuji', 'Onosato'], juryo: ['Kazuma'], auto: true });
  await H.post({ action: 'saveDraftBoard', handle: 'dave', auth: 'h3', id, makuuchi: ['Ura'], juryo: [], auto: false });
  await H.get({ action: 'league', id, handle: 'mika' });
  const pool = { makuuchi: MAK, juryo: JUR };
  await H.post({ action: 'startDraft', handle: 'mika', auth: 'h2', id, pool });
  await H.post({ action: 'startDraft', handle: 'sean', auth: 'h1', id, pickClock: 90, pool });
  for (let i = 0; i < 2; i++) {
    const st = (await H.get({ action: 'draftState', id, who: 'sean' })).json;
    const who = st.turn.handle, taken = new Set(st.pickedNames.map(s => s.toLowerCase()));
    await H.post({ action: 'makePick', handle: who, auth: AUTH[who], id, rikishi: MAK.find(n => !taken.has(n.toLowerCase())) });
  }
  await H.post({ action: 'pauseDraft', handle: 'mika', auth: 'h2', id });
  await H.post({ action: 'pauseDraft', handle: 'sean', auth: 'h1', id });
  await H.post({ action: 'makePick', handle: 'sean', auth: 'h1', id, rikishi: 'Ura' });
  await H.post({ action: 'setDraftDate', handle: 'sean', auth: 'h1', id, draftDate: '2026-11-02T18:00:00.000Z' });
  await H.post({ action: 'agreeDraftDate', handle: 'dave', auth: 'h3', id, agree: true });
  await H.get({ action: 'draftState', id, who: 'dave' });
  await H.post({ action: 'resumeDraft', handle: 'sean', auth: 'h1', id, pickClock: 120 });
  await H.post({ action: 'rewindDraft', handle: 'sean', auth: 'h1', id, toPick: 1 });
  await H.post({ action: 'resumeDraft', handle: 'sean', auth: 'h1', id });
  // a clock that runs out with nobody watching, then a poll settles it
  H.clock.tick(5 * 60 * 1000);
  await H.get({ action: 'draftState', id, who: 'dave' });
  await H.post({ action: 'postMessage', handle: 'dave', auth: 'h3', id, body: 'from the draft room' });
  const end = await draftToEnd(H, id, 'sean', pool);
  if (!end || !end.league || end.league.draftStatus !== 'complete') H.failures.push('the keepers draft did not complete: ' + JSON.stringify(end && end.league));
  await H.get({ action: 'league', id, handle: 'sean' });
  await H.get({ action: 'keeperState', id, handle: 'sean' });
  await H.get({ action: 'keeperState', id, handle: 'mika' });
  await H.post({ action: 'setActive', handle: 'sean', auth: 'h1', id, active: [MAK[0], MAK[3]] });
  const lg = (await H.get({ action: 'league', id, handle: 'sean' })).json;
  const rosterOf = (h) => ((lg.members || []).find(m => m.handle === h) || { roster: { makuuchi: [], juryo: [] } }).roster;
  const mine = rosterOf('sean').makuuchi[0], hers = rosterOf('mika').makuuchi[0];
  const tr = (await H.post({ action: 'proposeTrade', handle: 'sean', auth: 'h1', id, toHandle: 'mika', offer: [mine], request: [hers] })).json;
  if (!tr || !tr.ok) H.failures.push('the trade was never proposed: ' + JSON.stringify(tr));
  await H.get({ action: 'trades', id, handle: 'mika' });
  await H.post({ action: 'respondTrade', handle: 'dave', auth: 'h3', tradeId: tr && tr.id, accept: true });
  await H.post({ action: 'respondTrade', handle: 'mika', auth: 'h2', tradeId: tr && tr.id, accept: true });
  const owned = new Set([].concat(...(lg.members || []).map(m => [].concat(m.roster.makuuchi || [], m.roster.juryo || []))));
  const free = MAK.filter(n => !owned.has(n));
  await H.post({ action: 'addDrop', handle: 'dave', auth: 'h3', id, drop: rosterOf('dave').makuuchi[0], add: free[0] || 'Nobody' });
  await H.post({ action: 'addDrop', handle: 'dave', auth: 'h3', id, drop: 'Nobody', add: 'Nobody' });
  await H.post({ action: 'openKeeperWindow', handle: 'mika', auth: 'h2', id });
  await H.post({ action: 'openKeeperWindow', handle: 'sean', auth: 'h1', id });
  await H.post({ action: 'declareKeepers', handle: 'sean', auth: 'h1', id, keep: [rosterOf('sean').makuuchi[1] || MAK[0]] });
  await H.post({ action: 'declareKeepers', handle: 'mika', auth: 'h2', id, keep: [MAK[0], MAK[1], MAK[2]] });
  await H.get({ action: 'keeperState', id, handle: 'sean' });
  // the deadline: only the commissioner sets it; the leagues list carries it
  const due = new Date(H.clock.now + 2 * 86400000).toISOString();
  await H.post({ action: 'setKeeperDeadline', handle: 'mika', auth: 'h2', id, deadline: due });
  await H.post({ action: 'setKeeperDeadline', handle: 'sean', auth: 'h1', id, deadline: due });
  await H.get({ action: 'leagues', handle: 'mika' });
  // closing before the new basho is started is refused, with nothing cut
  await H.post({ action: 'closeKeeperWindow', handle: 'sean', auth: 'h1', id });
  await H.post({ action: 'adminResetBasho', adminKey: ADMIN, basho: 'Kyushu 2026', force: true });
  await H.get({ action: 'keeperState', id, handle: 'mika' });
  const closed = (await H.post({ action: 'closeKeeperWindow', handle: 'sean', auth: 'h1', id })).json;
  if (!closed || !closed.ok) H.failures.push('the keeper window did not close after the roll-over: ' + JSON.stringify(closed));
  await H.get({ action: 'leagueHistory', id });
  await H.post({ action: 'openRedraft', handle: 'sean', auth: 'h1', id });
  await H.post({ action: 'redraftState', id });
  await H.post({ action: 'redraftPick', handle: 'mika', auth: 'h2', id, rikishi: JUR[9] });
  await H.get({ action: 'history', handle: 'mika' });
  await H.get({ action: 'accountSummary', handle: 'mika' });
  await H.compareState('keepers');
  return { name: 'keepers league: schedule, draft, pause/rewind, clock, trades, keepers agree (' + H.stats().compared + ' requests)', H };
}

async function results(make) {
  const H = await world(make, { tz: 'America/Los_Angeles' });
  await H.post({ action: 'save', handle: 'sean', auth: 'h1', team: { sanyaku: 'Onosato', m1: 'Ura', juryo: 'Shishi' } });
  await H.post({ action: 'save', handle: 'mika', auth: 'h2', team: { sanyaku: 'Hoshoryu', m1: 'Abi', juryo: 'Tanji' } });
  await H.fn('refreshResults');
  await H.fn('refreshResults');                         // second run: nothing new to add
  const res = (await H.get({ action: 'results' })).json;
  if (!res || !res.results || !res.results.length) H.failures.push('refreshResults imported no bouts');
  await H.get({ action: 'data' });
  await H.get({ action: 'whatsNew', handle: 'sean' });
  await H.post({ action: 'adminBasho', adminKey: ADMIN });
  await H.post({ action: 'adminRefreshResults', adminKey: ADMIN });
  await H.post({ action: 'save', handle: 'dave', auth: 'h3', team: { sanyaku: 'Kirishima' } });   // the basho is under way
  await H.post({ action: 'archiveTeam', handle: 'sean', auth: 'h1', basho: 'Aki 2026', team: { Onosato: 1 }, rows: [], score: 9, wins: 9 });
  await H.post({ action: 'adminArchiveBasho', adminKey: ADMIN });
  await H.post({ action: 'adminArchiveBasho', adminKey: ADMIN, force: true });
  await H.post({ action: 'adminRecrown', adminKey: ADMIN, basho: 'Aki 2026' });
  await H.post({ action: 'adminRerank', adminKey: ADMIN, basho: 'Aki 2026' });
  await H.post({ action: 'adminSnapshotKeepers', adminKey: ADMIN, basho: 'Aki 2026' });
  await H.post({ action: 'adminApplyRanking', adminKey: ADMIN, basho: 'Aki 2026' });
  await H.post({ action: 'adminStandTitle', adminKey: ADMIN, basho: 'Aki 2026', scope: 'public', note: 'called on day 15' });
  await H.post({ action: 'adminResetAnalytics', adminKey: ADMIN });
  await H.post({ action: 'adminResetBasho', adminKey: ADMIN, basho: 'Kyushu 2026' });
  await H.get({ action: 'data' });
  await H.get({ action: 'history', handle: 'sean' });
  await H.get({ action: 'accountSummary', handle: 'sean' });
  await H.compareState('results');
  return { name: 'results import, scoring, archive and the admin basho tools agree (' + H.stats().compared + ' requests)', H };
}

function randomPhase(seedBase, steps) {
  return async function (make) {
    const H = await world(make, { tz: seedBase === 11 ? 'UTC' : 'Europe/London' });
    let s = seedBase;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const leagues = [], codes = [], msgIds = [], tradeIds = [];
    const handles = U.map(u => u[0]).concat(['ghost', 'gyoji']);
    const val = () => pick([1, 0, -1, '', 'x', true, false, null, 3, 99, '2026-11-01T18:00:00.000Z']);
    const ACTIONS = ['register', 'login', 'save', 'saveName', 'saveAvatar', 'createLeague', 'joinLeague', 'leaveLeague',
      'removeMember', 'renameLeague', 'postMessage', 'setLeagueMode', 'setLeagueRoster', 'setLeagueKeepers', 'openKeeperWindow',
      'declareKeepers', 'closeKeeperWindow', 'setLeagueScoring', 'setDraftDate', 'agreeDraftDate', 'startDraft', 'makePick',
      'pauseDraft', 'resumeDraft', 'rewindDraft', 'proposeTrade', 'respondTrade', 'setActive', 'saveDraftBoard', 'openRedraft',
      'redraftState', 'redraftPick', 'addDrop', 'deleteMessage', 'saveLeagueTeam', 'postBoardMessage', 'editBoardMessage',
      'deleteBoardMessage', 'voteBoardMessage', 'feedback', 'logPageview', 'requestPinReset', 'dmSend', 'dmMarkRead', 'dmDelete',
      'adminUsers', 'adminWarnUser', 'adminBanUser', 'adminUnbanUser', 'adminResetPin', 'adminDmSend', 'adminDeleteMessage',
      'adminEditBoardMessage', 'adminDeleteBoardMsg', 'adminSetFeedbackStatus', 'adminDeleteFeedback', 'adminBroadcast'];
    const GETS = ['data', 'list', 'results', 'leagues', 'league', 'invite', 'history', 'draftState', 'keeperState', 'trades', 'leagueHistory',
      'board', 'accountSummary', 'dmThreads', 'dmUnread', 'whatsNew', 'dmDirectory', 'version'];
    for (let i = 0; i < steps; i++) {
      const h = pick(handles), auth = rnd() < 0.85 ? (AUTH[h] || 'zz') : 'wrong';
      const id = leagues.length && rnd() < 0.9 ? pick(leagues) : 'lgNOPE';
      if (rnd() < 0.35) {
        const action = pick(GETS);
        const r = await H.get({ action, handle: h, id, who: h, code: codes.length ? pick(codes) : 'X' });
        if (action === 'board' && r.json && r.json.messages) for (const m of r.json.messages) if (m.id) msgIds.push(m.id);
        continue;
      }
      const action = pick(ACTIONS);
      const body = { action, handle: h, auth, id, adminKey: rnd() < 0.8 ? ADMIN : 'nope',
        name: pick(['League ' + i, '', 'x'.repeat(70)]), mode: pick(['keepers', 'classic', 'bogus']),
        rosterSize: pick([3, 0, 12, '']), benchSize: pick([0, 1, '']), farmSize: pick([0, 1, '']),
        code: codes.length ? pick(codes) : 'NOPE', member: pick(handles), body: pick(['hey', '', 'y'.repeat(30)]),
        parentId: msgIds.length && rnd() < 0.3 ? pick(msgIds) : '', msgId: msgIds.length ? pick(msgIds) : 'm0',
        keepMk: val(), keepJr: val(), keep: [pick(MAK), pick(JUR)], scoring: { winPoint: pick([1, 2, 9]), yusho: pick([0, 5]) },
        draftDate: pick(['2026-11-01T18:00:00.000Z', '', 'soon']), agree: rnd() < 0.7, pickClock: pick([30, 120, '', 900]),
        pool: { makuuchi: MAK, juryo: JUR }, rikishi: pick(MAK.concat(JUR, ['Nobody'])), toPick: pick([0, 1, 2, -1, '']),
        toHandle: pick(handles), offer: [pick(MAK)], request: [pick(MAK)], tradeId: tradeIds.length ? pick(tradeIds) : 't0',
        accept: rnd() < 0.6, active: [pick(MAK)], makuuchi: [pick(MAK), pick(MAK)], juryo: [pick(JUR)], auto: rnd() < 0.5,
        drop: pick(MAK), add: pick(MAK), team: { sanyaku: pick(MAK), m1: pick(MAK) }, value: pick([1, -1, 0]),
        kind: pick(['bug', 'suggestion', 'question', 'abuse', 'zz']), message: pick(['hm', '']), subject: 's',
        page: pick(['index.html', 'fantasy.html']), visitorId: 'v' + Math.floor(rnd() * 5), tz: pick(['Asia/Tokyo', 'bad zone!']),
        to: pick(handles), other: pick(handles), status: pick(['new', 'done']), audience: pick(['all', 'leagues']), dryRun: rnd() < 0.5,
        avatar: JSON.stringify({ v: 2, belt: '#957b91' }), newHandle: 'n' + i, newAuth: 'na' + i };
      if (action === 'register') { body.handle = pick(['newbie' + (i % 7), h]); body.auth = 'hz'; }
      const r = await H.post(body);
      const j = r.json || {};
      if (action === 'createLeague' && j.ok) { leagues.push(j.id); codes.push(j.inviteCode); }
      if (j.ok && j.id && (action === 'postMessage' || action === 'postBoardMessage' || action === 'dmSend')) msgIds.push(j.id);
      if (j.ok && j.id && action === 'proposeTrade') tradeIds.push(j.id);
      if (i % 40 === 0) { H.clock.tick(rnd() < 0.5 ? 200000 : 1000); await H.compareState('random ' + i); }
    }
    await H.compareState('random end');
    return { name: 'random phase (seed ' + seedBase + ') agrees: ' + H.stats().compared + ' requests', H };
  };
}

const FLOWS = [
  { title: 'accounts, DMs, the board, admin', run: accounts },
  { title: 'a classic league', run: classic },
  { title: 'a keepers league, drafted end to end', run: keepers },
  { title: 'results, the importer, the admin basho tools', run: results },
  { title: 'the random phase (seed 11)', run: randomPhase(11, 320) },
  { title: 'the random phase (seed 23)', run: randomPhase(23, 320) }
];

module.exports = { FLOWS, U, AUTH, ADMIN, world };
