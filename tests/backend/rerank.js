/* Undoing a ranking pass.

   The promotion curve reads each account's rankIdx and writes the new one into
   the same cell, so running it twice promotes off one tournament. That made a
   pass built on bad input permanent — not because fixing it is hard, but
   because the number to fix it FROM had been overwritten.

   Aki 2026 supplied the bad input: lastDay ticks to 15 on the first day-15
   bout, so the archive froze most of the board several bouts short while the
   players who happened to open the site that evening got a complete score from
   the client. The curve was then applied to the short one.

   Two things under test: that the archive now waits for the feed to go quiet,
   and that a pass made on short numbers can be redone to land exactly where a
   clean pass would have. */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const GS = process.env.GG_GS || require('path').join(__dirname, '..', '..', 'sumo-fantasy.gs');
const SRC = fs.readFileSync(GS, 'utf8');

function makeSheet(name, rows){
  return { name, rows,
    getName(){ return name; }, getLastRow(){ return this.rows.length; },
    getLastColumn(){ return this.rows.reduce((m,r)=>Math.max(m,r.length),0); },
    getDataRange(){ const s=this; return { getValues(){ return s.rows.map(r=>r.slice()); } }; },
    getRange(r,c,nr,nc){ const s=this; nr=nr||1; nc=nc||1; return {
      getValues(){ const o=[]; for(let i=0;i<nr;i++){ const row=s.rows[r-1+i]||[]; o.push(row.slice(c-1,c-1+nc)); } return o; },
      setValues(v){ for(let i=0;i<nr;i++){ while(s.rows.length<r-1+i+1) s.rows.push([]);
        for(let j=0;j<nc;j++) s.rows[r-1+i][c-1+j]=v[i][j]; } },
      setValue(v){ while(s.rows.length<r) s.rows.push([]); s.rows[r-1][c-1]=v; } }; },
    appendRow(row){ this.rows.push(row.slice()); },
    deleteRow(pos){ this.rows.splice(pos-1,1); },
    deleteRows(pos,n){ this.rows.splice(pos-1,n||1); },
    insertSheet(){} };
}

const BOARD = { Makuuchi:[['Onosato','Yokozuna 1 East'],['Hoshoryu','Yokozuna 1 West'],
                          ['Aonishiki','Ozeki 1 East'],['Kirishima','Ozeki 1 West'],
                          ['Fujinokawa','Sekiwake 1 East'],['Atamifuji','Sekiwake 1 West'],
                          ['Daieisho','Komusubi 1 East'],['Hakunofuji','Komusubi 1 West']],
                Juryo:[['Kazuma','Juryo 1 East']] };
for (let i = 1; i <= 34; i++) BOARD.Makuuchi.push(['Filler'+i,'Maegashira '+i+' East']);

function makeCtx(sheets){
  const store = {};
  for (const k in sheets) store[k] = makeSheet(k, sheets[k].map(r=>r.slice()));
  const ss = { getSheetByName(n){ return store[n]||null; },
               insertSheet(n){ store[n]=makeSheet(n,[]); return store[n]; },
               getSheets(){ return Object.keys(store).map(k=>store[k]); } };
  const ctx = {
    SpreadsheetApp:{ getActiveSpreadsheet(){ return ss; } },
    PropertiesService:{ getScriptProperties(){ return { getProperty(){ return 'test-key'; } }; } },
    LockService:{ getScriptLock(){ return { waitLock(){}, releaseLock(){} }; } },
    CacheService:{ getScriptCache(){ const m={}; return { get(k){return m[k]||null;}, getAll(){return {};},
      put(k,v){m[k]=v;}, remove(k){delete m[k];} }; } },
    UrlFetchApp:{ fetch(url){
      const m = String(url).match(/\/basho\/(\d+)\/banzuke\/(\w+)/);
      if (!m) return { getResponseCode(){return 404;}, getContentText(){return '';} };
      const rows = (BOARD[m[2]]||[]).map(([shikonaEn,rank])=>({shikonaEn,rank}));
      return { getResponseCode(){return 200;}, getContentText(){ return JSON.stringify({east:rows,west:[]}); } };
    } },
    ContentService:{ createTextOutput(){ return { setMimeType(){ return this; } }; }, MimeType:{JSON:'json'} },
    Utilities:{ formatDate(){ return ''; } },
    console, JSON, Math, Date, Number, String, Object, Array, isNaN, parseInt, parseFloat, RegExp, Error,
    __store: store };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename:'sumo-fantasy.gs' });
  return ctx;
}

const TEAM = JSON.stringify({ sanyaku:'Onosato', m1:'Filler1', m5:'Filler5', m9:'Filler9',
                              m13:'Filler13', any:'Atamifuji', juryo:'Kazuma' });
const HIST_HEAD = ['handle','basho','team','score','wins','rows','savedAt'];
const CHAMP_HEAD = ['id','basho','scope','leagueId','leagueName','handle','score',
  'runnerUp','runnerUpScore','entrants','awardedAt'];
const LEAGUE_HEAD = ['id','name','commissioner','created','inviteCode','mode','rosterSize','draftStatus',
  'draftOrder','draftPickIdx','draftPhase','scoring','draftDate','draftAgree','benchSize','farmSize'];

/* Four accounts. SHORT is the board as Aki froze it — a and b cut off before
   their last day. FULL is the tournament as it was actually fought, and it
   puts b ahead of a. If the re-rank works, that swap has to reach the curve. */
const SHORT = { alf:60, bea:58, cal:40, dot:20 };
const FULL  = { alf:62, bea:70, cal:41, dot:21 };

function history(winsBy){
  const rows = [HIST_HEAD];
  Object.keys(winsBy).forEach(h => rows.push([h,'Aki 2026',TEAM, winsBy[h], winsBy[h], '[]',
                                              '2026-09-27T05:17:06.376Z']));
  return rows;
}
function base(winsBy, extra){
  return Object.assign({
    Results:[['day','division','east','west','winner','kimarite'],
             [15,'Makuuchi','Onosato','Atamifuji','Onosato','yorikiri']],
    /* archivedBasho is set so the close pass leaves this hand-built archive
       alone — these tests are about the curve, not the importer */
    Meta:[['key','value'],['basho','Aki 2026'],['bashoId','202609'],['lastDay',15],
          ['archivedBasho','Aki 2026'],['yusho',''],['sansho','']],
    TeamHistory: history(winsBy),
    Champions:[CHAMP_HEAD],
    Users:[['handle','name','auth','team','updated','avatar','status','warnMsg']],
    Leagues:[LEAGUE_HEAD], LeagueMembers:[['leagueId','handle','joined']],
    LeagueTeams:[['leagueId','handle','team','updated']],
    KeeperRosters:[['leagueId','handle','rikishi','division','acquiredVia','acquiredAt','slot']]
  }, extra||{});
}
function ranksOf(ctx){
  const sh = ctx.__store.Rankings; if (!sh) return {};
  const out = {};
  sh.rows.slice(1).forEach(r => { out[String(r[0])] = Number(r[1]||0); });
  return out;
}
function priorOf(ctx, handle){
  const r = ctx.__store.Rankings.rows.slice(1).find(x => String(x[0])===handle);
  return { rankIdx:Number(r[5]||0), bashoCount:Number(r[6]||0), topStreak:Number(r[7]||0), basho:String(r[8]||'') };
}

let pass=0, fail=0;
function t(name, fn){
  try { fn(); pass++; console.log('  ok   '+name); }
  catch(e){ fail++; console.log('  FAIL '+name+'\n       '+e.message); }
}

console.log('\nthe archive waits for the feed to go quiet');
{
  const ctx = makeCtx(base(SHORT));
  const settled = (m) => ctx.bashoResultsSettled_(m);
  t('day 14 is never settled, whatever the importer says', () =>
    assert.strictEqual(settled({ lastDay:14, lastImportAdded:'0' }), false));
  t('day 15 with rows still arriving is not settled', () =>
    assert.strictEqual(settled({ lastDay:15, lastImport:new Date().toISOString(), lastImportAdded:'12' }), false));
  t('a poll that found nothing new settles it', () =>
    assert.strictEqual(settled({ lastDay:15, lastImport:new Date().toISOString(), lastImportAdded:'0' }), true));
  t('an importer gone quiet for hours settles it', () =>
    assert.strictEqual(settled({ lastDay:15, lastImportAdded:'12',
      lastImport:new Date(Date.now() - 5*3600*1000).toISOString() }), true));
  t('a hand-entered basho has nothing to wait for', () =>
    assert.strictEqual(settled({ lastDay:15 }), true));
  t('an unreadable stamp does not wait forever', () =>
    assert.strictEqual(settled({ lastDay:15, lastImport:'not a date', lastImportAdded:'3' }), true));

  t('and the archive itself refuses while the day is still landing', () => {
    const c = makeCtx(base(SHORT, { Meta:[['key','value'],['basho','Aki 2026'],['bashoId','202609'],
      ['lastDay',15],['lastImport',new Date().toISOString()],['lastImportAdded','9'],['yusho',''],['sansho','']] }));
    const r = c.archiveAllTeams_({ basho:'Aki 2026' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.waiting, true);
    assert.ok(/settle/i.test(r.error), r.error);
  });
  t('force still overrides it, for an admin who knows better', () => {
    const c = makeCtx(base(SHORT, { Meta:[['key','value'],['basho','Aki 2026'],['bashoId','202609'],
      ['lastDay',15],['lastImport',new Date().toISOString()],['lastImportAdded','9'],['yusho',''],['sansho','']] }));
    const r = c.archiveAllTeams_({ basho:'Aki 2026', force:true });
    assert.notStrictEqual(r.waiting, true);
  });
}

console.log('\nthe pass keeps what it overwrites');
{
  const ctx = makeCtx(base(SHORT));
  ctx.applyBashoRanking('Aki 2026', null);
  t('every graded account stores the state it started from', () => {
    const p = priorOf(ctx, 'alf');
    assert.strictEqual(p.rankIdx, 0);
    assert.strictEqual(p.bashoCount, 0);
    assert.strictEqual(p.basho, '—', 'a first basho records an explicit "none", not a blank');
  });
  t('and the current state is the graded one', () =>
    assert.ok(ranksOf(ctx).alf > 0, JSON.stringify(ranksOf(ctx))));
}

console.log('\nredoing a pass made on short numbers');
{
  /* what the curve should have said all along */
  const clean = makeCtx(base(FULL));
  clean.applyBashoRanking('Aki 2026', null);
  const want = ranksOf(clean);

  /* what it did say */
  const ctx = makeCtx(base(SHORT));
  ctx.applyBashoRanking('Aki 2026', null);
  const got = ranksOf(ctx);

  t('the short archive really did rank people differently', () =>
    assert.notStrictEqual(JSON.stringify(got), JSON.stringify(want),
      'fixture is not exercising the bug: ' + JSON.stringify(got)));

  /* the archive is corrected, the way a forced re-archive would correct it */
  ctx.__store.TeamHistory.rows = history(FULL);

  t('a dry run writes nothing and names who moves', () => {
    const before = JSON.stringify(ranksOf(ctx));
    const dry = ctx.rerankBasho_({ basho:'Aki 2026' });
    assert.strictEqual(dry.dryRun, true);
    assert.strictEqual(JSON.stringify(ranksOf(ctx)), before);
    assert.ok(dry.moving >= 1, JSON.stringify(dry));
    assert.ok(dry.moves.every(m => m.was !== m.now), JSON.stringify(dry.moves));
  });

  t('applying lands exactly where a clean first pass would have', () => {
    const res = ctx.rerankBasho_({ basho:'Aki 2026', apply:true });
    assert.strictEqual(res.ok, true);
    assert.strictEqual(JSON.stringify(ranksOf(ctx)), JSON.stringify(want),
      JSON.stringify(ranksOf(ctx)) + ' vs ' + JSON.stringify(want));
  });
  t('nobody is promoted twice off one tournament', () => {
    assert.strictEqual(Number(ctx.__store.Rankings.rows[1][2]), 1, 'bashoCount');
  });
  t('re-running it again is stable, not cumulative', () => {
    const once = JSON.stringify(ranksOf(ctx));
    ctx.rerankBasho_({ basho:'Aki 2026', apply:true });
    ctx.rerankBasho_({ basho:'Aki 2026', apply:true });
    assert.strictEqual(JSON.stringify(ranksOf(ctx)), once);
  });
  t('and the prior state is still the pre-basho one, not the last answer', () => {
    const p = priorOf(ctx, 'alf');
    assert.strictEqual(p.rankIdx, 0);
    assert.strictEqual(p.bashoCount, 0);
  });
}

console.log('\nwhat it refuses to do');
{
  const ctx = makeCtx(base(FULL));
  ctx.applyBashoRanking('Aki 2026', null);

  t('it will not re-rank a basho that is not the last one graded', () => {
    const r = ctx.rerankBasho_({ basho:'Natsu 2026' });
    assert.strictEqual(r.ok, false);
    assert.ok(/last ranked basho/i.test(r.error), r.error);
  });
  t('it will not guess at a prior it never stored', () => {
    /* an account ranked twice before the prior columns existed: the state it
       started this basho at is simply not recoverable */
    const c = makeCtx(base(FULL));
    c.__store.Rankings = makeSheet('Rankings', [['handle','rankIdx','bashoCount','topStreak','lastBasho'],
      ['alf', 4, 3, 0, 'Aki 2026'], ['bea', 2, 3, 0, 'Aki 2026'],
      ['cal', 1, 3, 0, 'Aki 2026'], ['dot', 0, 3, 0, 'Aki 2026']]);
    c.setMeta_('rankedBasho','Aki 2026');
    const r = c.rerankBasho_({ basho:'Aki 2026' });
    assert.strictEqual(r.ok, false);
    assert.ok(/invent a rank history/i.test(r.error), r.error);
  });
  t('an empty archive is refused rather than ranking nobody', () => {
    const c = makeCtx(base(FULL));
    c.applyBashoRanking('Aki 2026', null);
    c.__store.TeamHistory.rows = [HIST_HEAD];
    const r = c.rerankBasho_({ basho:'Aki 2026', apply:true });
    assert.strictEqual(r.ok, false);
    assert.ok(/no archived results/i.test(r.error), r.error);
  });
}

console.log('\nthe door is locked');
{
  const ctx = makeCtx(base(FULL));
  ctx.applyBashoRanking('Aki 2026', null);
  const before = JSON.stringify(ranksOf(ctx));
  t('adminRerank refuses a wrong key', () => {
    const r = ctx.adminRerank({ adminKey:'nope', basho:'Aki 2026', apply:true });
    assert.strictEqual(r.ok, false);
    assert.ok(/auth/i.test(r.error||''), JSON.stringify(r));
    assert.strictEqual(JSON.stringify(ranksOf(ctx)), before);
  });
  t('the right key with no apply is only a dry run', () => {
    const r = ctx.adminRerank({ adminKey:'test-key', basho:'Aki 2026' });
    assert.strictEqual(r.dryRun, true);
    assert.strictEqual(JSON.stringify(ranksOf(ctx)), before);
  });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
