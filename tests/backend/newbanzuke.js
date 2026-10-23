/* A new banzuke, applied to everything already picked.

   Teams carry over from one basho to the next, so a new banzuke used to leave
   saved picks in slots they no longer fit, and keeper rosters in the divisions
   they were drafted in. When the new basho is started, checkPicksForNewBasho_
   takes the misfits out (leaving the player a note), re-sorts keeper rosters
   into their new divisions, and flags each keeper league with a roll-over to
   run. None of it may touch a team while a basho's bouts are on the sheet. */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const GS = process.env.GG_GS || require('path').join(__dirname, '..', '..', 'sumo-fantasy.gs');
const SRC = fs.readFileSync(GS, 'utf8');

/* ---- fake Apps Script ---- */
function makeSheet(name, rows){
  return {
    name, rows,
    getName(){ return name; },
    getLastRow(){ return this.rows.length; },
    getLastColumn(){ return this.rows.reduce((m,r)=>Math.max(m,r.length),0); },
    getDataRange(){ const s=this; return { getValues(){ return s.rows.map(r=>r.slice()); } }; },
    getRange(r,c,nr,nc){
      const s=this; nr=nr||1; nc=nc||1;
      return {
        getValues(){ const o=[]; for(let i=0;i<nr;i++){ const row=s.rows[r-1+i]||[]; o.push(row.slice(c-1,c-1+nc)); } return o; },
        getValue(){ return (s.rows[r-1]||[])[c-1]; },
        setValues(v){ for(let i=0;i<nr;i++){ while(s.rows.length<r-1+i+1) s.rows.push([]);
          for(let j=0;j<nc;j++) s.rows[r-1+i][c-1+j]=v[i][j]; } },
        setValue(v){ while(s.rows.length<r) s.rows.push([]); s.rows[r-1][c-1]=v; }
      };
    },
    appendRow(row){ this.rows.push(row.slice()); },
    deleteRow(pos){ this.rows.splice(pos-1, 1); },
    deleteRows(pos, n){ this.rows.splice(pos-1, n||1); }
  };
}
function makeCtx(sheets, net){
  const store = {};
  for (const k in sheets) store[k] = makeSheet(k, sheets[k].map(r=>r.slice()));
  const ss = { getSheetByName(n){ return store[n] || null; }, insertSheet(n){ store[n] = makeSheet(n, []); return store[n]; } };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet(){ return ss; }, flush(){} },
    PropertiesService: { getScriptProperties(){ return { getProperty(k){ return k === 'ADMIN_KEY' ? 'test-key' : null; }, setProperty(){} }; } },
    LockService: { getScriptLock(){ return { waitLock(){}, releaseLock(){} }; } },
    CacheService: { getScriptCache(){ const m={}; return { get(k){ return m[k]||null; }, getAll(){ return {}; }, put(k,v){ m[k]=v; }, remove(k){ delete m[k]; } }; } },
    /* sumo-api: a banzuke per basho id in net.banzuke, read at call time; anything else is 404 */
    UrlFetchApp: { fetch(url){
      const m = String(url).match(/\/basho\/(\d+)\/banzuke\/(\w+)/);
      const b = m && (net.banzuke || {})[m[1]];
      if (!b || !b[m[2]]) return { getResponseCode(){ return 404; }, getContentText(){ return ''; } };
      const rows = b[m[2]].map(([shikonaEn, rank]) => ({ shikonaEn, rank }));
      return { getResponseCode(){ return 200; }, getContentText(){ return JSON.stringify({ east: rows, west: [] }); } };
    } },
    ContentService: { createTextOutput(){ return { setMimeType(){ return this; } }; }, MimeType:{ JSON:'json' } },
    Utilities: { formatDate(){ return ''; }, getUuid(){ return 'u' + Math.random().toString(36).slice(2); } },
    console, JSON, Math, Date, Number, String, Object, Array, isNaN, parseInt, parseFloat, RegExp,
    __store: store
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename:'sumo-fantasy.gs' });
  return ctx;
}

/* ---- the world after Aki, and Kyushu's banzuke ---- */
const KYUSHU = { '202611': {
  Makuuchi: [['Onosato','Yokozuna 1 East'], ['Hoshoryu','Yokozuna 1 West'], ['Kirishima','Ozeki 1 East'],
             ['Churanoumi','Komusubi 1 East'],                // up from M3
             ['Hakunofuji','Maegashira 2 East'],              // down from Komusubi
             ['Asanoyama','Maegashira 6 West'], ['Ura','Maegashira 9 East'], ['Abi','Maegashira 13 West'],
             ['Daiseizan','Maegashira 15 East']],             // up from Juryo
  Juryo:    [['Shonannoumi','Juryo 3 East'],                  // down from M17
             ['Kazuma','Juryo 4 West'], ['Asahifuji','Juryo 14 East']] } };   // Tochitaikai has left
const LEAGUE_HEAD = ['id','name','commissioner','created','inviteCode','mode','rosterSize','draftStatus',
  'draftOrder','draftPickIdx','draftPhase','scoring','draftDate','draftAgree','benchSize','farmSize',
  'pickClock','pickDeadline','defaultOrder','keepMk','keepJr','draftPaused'];
const SCORING = JSON.stringify({ winPoint:1, sanyakuBonus:1, sansho:5, yusho:5 });
const lg = (id, commish, mode, status, keepMk, keepJr) =>
  [id, id, commish, '2026-08-01', id.toUpperCase(), mode, 2, status, '[]', 0, '', SCORING, '', '{}', 0, 1, '', '', '', keepMk, keepJr, ''];
const J = v => JSON.stringify(v);
function base(){
  return {
    Results: [['day','division','east','west','winner','kimarite'],     // Aki: Shonannoumi 2 wins, Kazuma 1
      [1,'Makuuchi','Shonannoumi','Abi','Shonannoumi','yorikiri'], [2,'Makuuchi','Shonannoumi','Ura','Shonannoumi','yorikiri'],
      [3,'Juryo','Kazuma','Tochitaikai','Kazuma','oshidashi']],
    Meta: [['key','value'], ['basho','Aki 2026'], ['bashoId','202609'], ['lastDay',15], ['rankedBasho','Aki 2026']],
    Users: [['handle','name','auth','team','updated','avatar','status','warnMsg'],
      ['ann','Ann','h1', J({ sanyaku:'Hakunofuji', m1:'Churanoumi', m5:'Asanoyama', m9:'Ura', m13:'Shonannoumi', any:'Abi', juryo:'Daiseizan' }), '2026-09-10', '', '', ''],
      ['bob','Bob','h1', J({ sanyaku:'Onosato', juryo:'Tochitaikai', any:'Kirishima' }), '2026-09-10', '', '', ''],
      ['cid','Cid','h1', J({ sanyaku:'Kirishima', juryo:'Kazuma' }), '2026-09-10', '', '', ''],
      ['dee','Dee','h1', '{}', '', '', '', '']],
    Leagues: [LEAGUE_HEAD,
      lg('lgC', 'ann', 'classic', 'none', '', ''),
      lg('lgK', 'ann', 'keepers', 'complete', 1, 1),       // keeps a limited number: declarations
      lg('lgN', 'bob', 'keepers', 'complete', '', ''),     // no limit, and a man has left: re-draft
      lg('lgQ', 'cid', 'keepers', 'complete', '', ''),     // no limit, nobody left: nothing to do
      lg('lgW', 'dee', 'keepers', 'keepers', 1, 1),        // declarations already open
      lg('lgD', 'ann', 'keepers', 'active', 1, 1)],        // mid-draft: leave alone
    LeagueMembers: [['leagueId','handle','joined'],
      ['lgC','ann',''], ['lgC','bob',''], ['lgK','ann',''], ['lgK','bob',''], ['lgN','bob',''], ['lgN','cid',''],
      ['lgQ','cid',''], ['lgW','dee',''], ['lgW','cid',''], ['lgD','ann','']],
    LeagueTeams: [['leagueId','handle','team','updated'],
      ['lgC','ann', J({ m1:'Churanoumi', juryo:'Kazuma' }), '2026-09-10'],
      ['lgC','bob', J({ sanyaku:'Kirishima' }), '2026-09-10']],
    KeeperRosters: [['leagueId','handle','rikishi','division','acquiredVia','acquiredAt','slot'],
      ['lgK','ann','Shonannoumi','makuuchi','draft','','active'], ['lgK','ann','Ura','makuuchi','draft','','active'],
      ['lgK','ann','Daiseizan','juryo','draft','','bench'], ['lgK','bob','Abi','makuuchi','draft','','active'],
      ['lgK','bob','Kazuma','juryo','draft','','bench'],
      ['lgN','bob','Onosato','makuuchi','draft','','active'], ['lgN','bob','Tochitaikai','juryo','draft','','bench'],
      ['lgN','cid','Kirishima','makuuchi','draft','','active'],
      ['lgQ','cid','Hoshoryu','makuuchi','draft','','active'],
      ['lgW','dee','Kazuma','juryo','draft','','bench'], ['lgW','dee','Shonannoumi','makuuchi','draft','','active'],
      ['lgW','dee','Ura','makuuchi','draft','','active'], ['lgW','cid','Abi','makuuchi','draft','','active'],
      ['lgD','ann','Shonannoumi','makuuchi','draft','','active']],
    KeeperKeeps: [['leagueId','handle','rikishi','declaredAt'],
      ['lgW','dee','Shonannoumi',''], ['lgW','dee','Kazuma','']],   // declared under Aki's divisions
    Champions: [['id','basho','scope','leagueId','leagueName','handle','score','runnerUp','runnerUpScore','entrants','awardedAt']],
    TeamHistory: [['handle','basho','team','score','wins','rows','savedAt']],
    Messages: [['id','leagueId','handle','name','body','parentId','created']]
  };
}
const user = (ctx, h) => ctx.readUsers().find(u => u.handle === h);
const ros = (ctx, lid, h) => ctx.__store.KeeperRosters.rows.filter(r => r[0] === lid && r[1] === h).map(r => r[2] + ':' + r[3]);
const myLeague = (ctx, h, lid) => ctx.myLeagues(h).leagues.find(l => l.id === lid);
const meta = (ctx, k) => (ctx.__store.Meta.rows.find(r => r[0] === k) || [])[1];
const rollOver = ctx => ctx.adminResetBasho({ adminKey:'test-key', basho:'Kyushu 2026' });

let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e){ fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

console.log('\nbefore the new basho is started');
{
  const ctx = makeCtx(base(), { banzuke: KYUSHU });
  const before = J(ctx.__store.Users.rows);
  ctx.keeperClock();
  t('nothing is checked while the finished basho is still on the sheet', () => {
    assert.strictEqual(J(ctx.__store.Users.rows), before);
    assert.strictEqual(meta(ctx, 'picksChecked'), undefined);
  });
  t('and a classic-league team is locked meanwhile, like the public one', () => {
    const r = ctx.saveLeagueTeam({ handle:'bob', auth:'h1', id:'lgC', team: J({ sanyaku:'Onosato' }) });
    assert.ok(!r.ok && r.locked, J(r));
  });
}

console.log('\nstarting the new basho');
{
  const ctx = makeCtx(base(), { banzuke: KYUSHU });
  const res = rollOver(ctx);
  t('the roll-over reports the check', () => {
    assert.ok(res.ok && res.picks && res.picks.ok, J(res));
    assert.strictEqual(J(res.picks.counts), J({ teams:2, picks:5, leagueTeams:1, leaguePicks:1, keeperMoves:3, rollovers:2 }));
  });
  t('a public team loses exactly the picks that no longer fit, and keeps the rest', () => {
    assert.strictEqual(J(user(ctx, 'ann').team), J({ m5:'Asanoyama', m9:'Ura', any:'Abi' }));
    assert.strictEqual(J(user(ctx, 'bob').team), J({ sanyaku:'Onosato', any:'Kirishima' }));
    assert.strictEqual(J(user(ctx, 'cid').team), J({ sanyaku:'Kirishima', juryo:'Kazuma' }));
  });
  t('and its player gets a note of what went and why', () => {
    const n = user(ctx, 'ann').teamNote;
    assert.strictEqual(n.basho, 'Kyushu 2026');
    assert.strictEqual(J(n.picks), J([
      { slot:'sanyaku', name:'Hakunofuji', now:'Maegashira 2' }, { slot:'m1', name:'Churanoumi', now:'Komusubi' },
      { slot:'m13', name:'Shonannoumi', now:'Jūryō 3' }, { slot:'juryo', name:'Daiseizan', now:'Maegashira 15' }]));
    assert.strictEqual(J(user(ctx, 'bob').teamNote.picks), J([{ slot:'juryo', name:'Tochitaikai', now:'' }]));
    assert.strictEqual(user(ctx, 'cid').teamNote, undefined, 'nothing went, so no note');
  });
  t('a classic-league team is checked the same way, and the league page carries the note', () => {
    const mem = ctx.leagueDetail('lgC', 'ann').members, ann = mem.find(m => m.handle === 'ann'), bob = mem.find(m => m.handle === 'bob');
    assert.strictEqual(J(ann.team), J({ juryo:'Kazuma' }));
    assert.strictEqual(J(ann.teamNote.picks), J([{ slot:'m1', name:'Churanoumi', now:'Komusubi' }]));
    assert.strictEqual(bob.teamNote, null);
  });
  t('keeper rosters move into the divisions they will fight in', () => {
    assert.strictEqual(J(ros(ctx, 'lgK', 'ann')), J(['Shonannoumi:juryo', 'Ura:makuuchi', 'Daiseizan:makuuchi']));
    assert.strictEqual(J(ros(ctx, 'lgW', 'dee')), J(['Kazuma:juryo', 'Shonannoumi:juryo', 'Ura:makuuchi']));
  });
  t('a man who has left the banzuke stays until the re-draft releases him', () =>
    assert.strictEqual(J(ros(ctx, 'lgN', 'bob')), J(['Onosato:makuuchi', 'Tochitaikai:juryo'])));
  t('a league mid-draft is left alone', () => assert.strictEqual(J(ros(ctx, 'lgD', 'ann')), J(['Shonannoumi:makuuchi'])));
  t('each commissioner with a roll-over to run is told which', () => {
    assert.strictEqual(myLeague(ctx, 'ann', 'lgK').rollover, 'keepers');
    assert.strictEqual(myLeague(ctx, 'bob', 'lgN').rollover, 'redraft');
    assert.strictEqual(myLeague(ctx, 'cid', 'lgQ').rollover, undefined, 'nobody left, no limit: nothing to run');
    assert.strictEqual(myLeague(ctx, 'dee', 'lgW').rollover, undefined, 'already declaring');
  });
  t('it runs once: the clock afterwards changes nothing', () => {
    const snap = J([ctx.__store.Users.rows, ctx.__store.LeagueTeams.rows, ctx.__store.KeeperRosters.rows]);
    ctx.keeperClock();
    assert.strictEqual(J([ctx.__store.Users.rows, ctx.__store.LeagueTeams.rows, ctx.__store.KeeperRosters.rows]), snap);
  });

  console.log('\nsaving after it');
  t('a save with a pick that no longer fits is refused, naming it', () => {
    const r = ctx.saveTeam({ handle:'ann', auth:'h1', team:{ m1:'Churanoumi', m5:'Asanoyama' } });
    assert.ok(!r.ok && r.misfits && r.misfits.length === 1, J(r));
    assert.ok(/Churanoumi is now Komusubi and can’t stay in M1–M4/.test(r.error), r.error);
  });
  t('a good save goes through and clears the note', () => {
    assert.ok(ctx.saveTeam({ handle:'ann', auth:'h1', team:{ sanyaku:'Churanoumi', m5:'Asanoyama' } }).ok);
    assert.strictEqual(user(ctx, 'ann').teamNote, undefined);
  });
  t('the same for a classic-league team', () => {
    const bad = ctx.saveLeagueTeam({ handle:'ann', auth:'h1', id:'lgC', team: J({ juryo:'Daiseizan' }) });
    assert.ok(!bad.ok && /Daiseizan is now Maegashira 15/.test(bad.error), J(bad));
    assert.ok(ctx.saveLeagueTeam({ handle:'ann', auth:'h1', id:'lgC', team: J({ sanyaku:'Churanoumi', juryo:'Kazuma' }) }).ok);
    assert.strictEqual(ctx.leagueDetail('lgC', 'ann').members.find(m => m.handle === 'ann').teamNote, null);
  });

  console.log('\nthe keeper roll-overs');
  const rd = ctx.openSupplementalDraft({ handle:'bob', auth:'h1', id:'lgN' });
  t('the no-limit league’s re-draft releases the man who left, and the prompt goes', () => {
    assert.ok(rd.ok, J(rd));
    assert.strictEqual(J(ros(ctx, 'lgN', 'bob')), J(['Onosato:makuuchi']));
    assert.strictEqual(myLeague(ctx, 'bob', 'lgN').rollover, undefined);
  });
  const cl = ctx.closeKeeperWindow({ handle:'dee', auth:'h1', id:'lgW' });
  t('a declaration the re-sort pushed over a limit keeps the best by wins, not roster order', () => {
    assert.ok(cl.ok, J(cl));
    assert.strictEqual(J(ros(ctx, 'lgW', 'dee')), J(['Shonannoumi:juryo']));    // 2 Aki wins beat Kazuma's 1
  });
}

console.log('\nwhen sumo-api is late with the banzuke');
{
  const net = { banzuke: {} };
  const ctx = makeCtx(base(), net);
  const res = rollOver(ctx);
  const before = J(ctx.__store.Users.rows);
  t('the roll-over still happens, and says the check is waiting', () => {
    assert.ok(res.ok && res.picks && res.picks.notReady, J(res));
    assert.strictEqual(J(ctx.__store.Users.rows), before);
  });
  net.banzuke = KYUSHU;
  ctx.keeperClock();
  t('the keeper clock runs it once the banzuke appears', () => {
    assert.strictEqual(meta(ctx, 'picksChecked'), 'Kyushu 2026');
    assert.strictEqual(J(user(ctx, 'bob').team), J({ sanyaku:'Onosato', any:'Kirishima' }));
  });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
