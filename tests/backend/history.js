/* League history: what a league has on record, and how the record is kept.

   leagueHistory() reads the titles (Champions) and the stored basho records
   (KeeperHistory) for one league. The record now covers classic leagues as
   well as keeper leagues, and `fill` backfills a basho for leagues that have
   no record of it yet, but only where what it would write agrees with the
   title already awarded. */
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
function makeCtx(sheets){
  const store = {};
  for (const k in sheets) store[k] = makeSheet(k, sheets[k].map(r=>r.slice()));
  const ss = { getSheetByName(n){ return store[n] || null; }, insertSheet(n){ store[n] = makeSheet(n, []); return store[n]; } };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet(){ return ss; }, flush(){} },
    PropertiesService: { getScriptProperties(){ return { getProperty(k){ return k === 'ADMIN_KEY' ? 'test-key' : null; }, setProperty(){} }; } },
    LockService: { getScriptLock(){ return { waitLock(){}, releaseLock(){} }; } },
    CacheService: { getScriptCache(){ const m={}; return { get(k){ return m[k]||null; }, getAll(){ return {}; }, put(k,v){ m[k]=v; }, remove(k){ delete m[k]; } }; } },
    UrlFetchApp: { fetch(){ throw new Error('offline in tests'); } },
    ContentService: { createTextOutput(){ return { setMimeType(){ return this; } }; }, MimeType:{ JSON:'json' } },
    Utilities: { formatDate(){ return ''; }, getUuid(){ return 'u' + Math.random().toString(36).slice(2); } },
    console, JSON, Math, Date, Number, String, Object, Array, isNaN, parseInt, parseFloat, RegExp,
    __store: store
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename:'sumo-fantasy.gs' });
  return ctx;
}

/* ---- the fixture ----
   lgK, a keeper league, has two basho on record and a co-championship at
   Natsu. lgC, a classic league, has a title for Aki but no record yet. lgX is
   another classic league whose title disagrees with what its teams score now
   (someone changed his team after the basho). */
const TIERS = { Onosato:'Y', Hoshoryu:'Y', Ura:'M', Abi:'M', Oho:'M' };
const SCORING = JSON.stringify({ winPoint:1, sanyakuBonus:1, sansho:5, yusho:5 });
const LEAGUE_HEAD = ['id','name','commissioner','created','inviteCode','mode','rosterSize','draftStatus',
  'draftOrder','draftPickIdx','draftPhase','scoring','draftDate','draftAgree','benchSize','farmSize'];
const CH = ['id','basho','scope','leagueId','leagueName','handle','score','runnerUp','runnerUpScore','entrants','awardedAt',
            'standsAsCalled','note','correctedHandle','correctedScore'];
const KH = ['id','basho','leagueId','leagueName','handle','pos','score','wins','bonus','extras','entrants','active','bench','benchPts','savedAt'];
const row = (b, lg, h, pos, score, at) => ['kh_' + b + h, b, lg, 'Chanko', h, pos, score, score, 0, 0, 2,
  JSON.stringify([{ name:'Ura', tier:'M', w:score, wins:score, bonus:0, sansho:false, yusho:false, pts:score }]), '[]', 0, at];
function base(extra){
  return Object.assign({
    Results: [['day','division','east','west','winner','kimarite'],
      [1,'Makuuchi','Ura','Abi','Ura','yorikiri'], [2,'Makuuchi','Ura','Oho','Ura','yorikiri'],
      [3,'Makuuchi','Oho','Abi','Oho','oshidashi']],
    Meta: [['key','value'],['basho','Aki 2026'],['bashoId','202609'],['lastDay',15],['rankedBasho','Aki 2026']],
    Users: [['handle','name','auth','team','updated','avatar','status','warnMsg'],
      ['ace','Ace Ō','h1','{}','','','',''], ['bob','Bob','h1','{}','','','',''], ['cid','Cid','h1','{}','','','','']],
    Leagues: [LEAGUE_HEAD,
      ['lgK','Chanko','ace','2026-09-01','KKK','keepers',2,'complete','[]',0,'',SCORING,'','{}',0,0],
      ['lgC','Classic','bob','2026-08-30','CCC','classic',7,'none','[]',0,'',SCORING,'','{}',0,0],
      ['lgX','Drifted','cid','2026-08-30','XXX','classic',7,'none','[]',0,'',SCORING,'','{}',0,0]],
    LeagueMembers: [['leagueId','handle','joined'], ['lgK','ace',''], ['lgK','bob',''],
      ['lgC','bob',''], ['lgC','cid',''], ['lgX','cid',''], ['lgX','ace','']],
    LeagueTeams: [['leagueId','handle','team','updated'],
      ['lgC','bob',JSON.stringify({ a:'Ura' }),''], ['lgC','cid',JSON.stringify({ a:'Oho' }),''],
      ['lgX','cid',JSON.stringify({ a:'Ura' }),''], ['lgX','ace',JSON.stringify({ a:'Abi' }),'']],
    KeeperRosters: [['leagueId','handle','rikishi','division','acquiredVia','acquiredAt','slot'],
      ['lgK','ace','Ura','makuuchi','draft','','active'], ['lgK','bob','Oho','makuuchi','draft','','active']],
    Champions: [CH,
      ['ch1','Natsu 2026','league','lgK','Chanko','ace',9,'',null,2,'2026-05-25T00:00:00Z','','','',''],
      ['ch2','Natsu 2026','league','lgK','Chanko','bob',9,'',null,2,'2026-05-25T00:00:00Z','','','',''],
      ['ch3','Aki 2026','league','lgK','Chanko','ace',2,'bob',1,2,'2026-09-27T00:00:00Z','','','',''],
      ['ch4','Aki 2026','league','lgC','Classic','bob',2,'cid',1,2,'2026-09-27T00:00:00Z','','','',''],
      ['ch5','Aki 2026','league','lgX','Drifted','ace',9,'cid',2,2,'2026-09-27T00:00:00Z','','','',''],
      ['ch6','Aki 2026','public','','Sumo Slap Down League','ace',50,'bob',40,30,'2026-09-27T00:00:00Z','','','','']],
    KeeperHistory: [KH,
      row('Natsu 2026','lgK','ace',1,9,'2026-05-25T00:00:00Z'), row('Natsu 2026','lgK','bob',1,9,'2026-05-25T00:00:00Z'),
      row('Aki 2026','lgK','bob',2,1,'2026-09-27T00:00:00Z'), row('Aki 2026','lgK','ace',1,2,'2026-09-27T00:00:00Z')],
    TeamHistory: [['handle','basho','team','score','wins','rows','savedAt']]
  }, extra || {});
}

let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e){ fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
const J = v => JSON.stringify(v);

console.log('\nwhat a league has on record');
{
  const ctx = makeCtx(base());
  const h = ctx.leagueHistory('lgK');
  t('it answers for a league', () => assert.ok(h.ok && h.league.name === 'Chanko' && h.league.mode === 'keepers', J(h.league)));
  t('titles come newest first', () => assert.strictEqual(J(h.titles.map(x => x.basho)), '["Aki 2026","Natsu 2026"]'));
  t('a shared title is ONE entry with both champions, by display name', () =>
    assert.strictEqual(J(h.titles[1].champions.map(c => c.name)), '["Ace Ō","Bob"]'));
  t('the runner-up comes with his name and score', () => {
    assert.strictEqual(h.titles[0].runnerUpName, 'Bob'); assert.strictEqual(h.titles[0].runnerUpScore, 1);
  });
  t('only this league’s titles, and never the public one', () =>
    assert.ok(h.titles.every(x => x.champions.every(c => c.handle !== '' )) && h.titles.length === 2));
  t('records come newest first, each in finishing order', () => {
    assert.strictEqual(J(h.records.map(r => r.basho)), '["Aki 2026","Natsu 2026"]');
    assert.strictEqual(J(h.records[0].entries.map(e => e.handle + e.pos)), '["ace1","bob2"]');
  });
  t('a record carries the per-rikishi rows, parsed', () =>
    assert.strictEqual(h.records[0].entries[0].active[0].name, 'Ura'));
  t('members come with display names', () => assert.strictEqual(J(h.members.map(m => m.name)), '["Ace Ō","Bob"]'));
  t('an unknown league says so', () => assert.ok(!ctx.leagueHistory('lgNope').ok));
}
{
  const sheets = base(); delete sheets.Champions; delete sheets.KeeperHistory;
  const ctx = makeCtx(sheets);
  const h = ctx.leagueHistory('lgC');
  t('a league with nothing on record is empty, not an error', () =>
    assert.ok(h.ok && h.titles.length === 0 && h.records.length === 0, J(h)));
  t('and reading never creates a sheet', () =>
    assert.ok(!ctx.__store.Champions && !ctx.__store.KeeperHistory));
}

console.log('\nclassic leagues are recorded too');
{
  const ctx = makeCtx(base({ KeeperHistory: [KH] }));
  const res = ctx.snapshotKeeperBasho_('Aki 2026', TIERS, { apply:true });
  const mine = lg => ctx.__store.KeeperHistory.rows.slice(1).filter(r => r[2] === lg);
  t('the basho record now includes a classic league, from its league teams', () => {
    assert.ok(res.written > 0, J(res));
    assert.strictEqual(J(mine('lgC').map(r => r[4] + ' ' + r[6])), '["bob 2","cid 1"]');   // Ura 2 wins, Oho 1
  });
  t('and it agrees with the title the classic league is crowned by', () => {
    const lg = ctx.championScopesFor_('Aki 2026', TIERS).find(s => s.leagueId === 'lgC');
    assert.strictEqual(J(lg.res.winners.map(w => w.handle)), '["bob"]');
    assert.strictEqual(mine('lgC')[0][4], 'bob');
  });
}

console.log('\nfilling a basho in, without touching what is there');
{
  const ctx = makeCtx(base());
  const before = J(ctx.__store.KeeperHistory.rows);
  const dry = ctx.snapshotKeeperBasho_('Aki 2026', TIERS, { fill:true });
  t('a dry run writes nothing and says what it would do', () => {
    assert.ok(dry.dryRun && dry.fill, J(dry));
    assert.strictEqual(J(ctx.__store.KeeperHistory.rows), before);
  });
  t('it would fill the league with no record, and leave the one that has one', () =>
    assert.strictEqual(J(dry.leagues), '["Classic"]'));
  t('a league whose title disagrees with what it scores now is skipped and reported', () => {
    assert.strictEqual(dry.skipped.length, 1);
    assert.strictEqual(dry.skipped[0].league, 'Drifted');
  });
  const res = ctx.snapshotKeeperBasho_('Aki 2026', TIERS, { fill:true, apply:true });
  t('applied, it writes the missing league only', () => {
    assert.ok(res.ok && res.written === 2, J(res));
    const rows = ctx.__store.KeeperHistory.rows.slice(1);
    assert.strictEqual(rows.filter(r => r[2] === 'lgC').length, 2);
    assert.strictEqual(rows.filter(r => r[2] === 'lgX').length, 0);
  });
  t('every row that was already there is untouched', () =>
    assert.strictEqual(J(ctx.__store.KeeperHistory.rows.slice(0, JSON.parse(before).length)), before));
  t('and the history page now shows the filled basho', () =>
    assert.strictEqual(ctx.leagueHistory('lgC').records[0].entries[0].handle, 'bob'));
}

console.log('\nfilling in only what the record can vouch for');
{
  const sheets = base();
  sheets.Leagues = sheets.Leagues.concat([
    ['lgN','Newcomers','bob','2026-10-10','NNN','classic',7,'none','[]',0,'',SCORING,'','{}',0,0],
    ['lgM','Moved','bob','2026-08-30','MMM','classic',7,'none','[]',0,'',SCORING,'','{}',0,0]]);
  sheets.LeagueMembers = sheets.LeagueMembers.concat([['lgN','bob',''], ['lgN','cid',''], ['lgM','bob',''], ['lgM','cid','']]);
  sheets.LeagueTeams = sheets.LeagueTeams.concat([
    ['lgN','bob',JSON.stringify({ a:'Ura' }),'2026-10-12T00:00:00Z'], ['lgN','cid',JSON.stringify({ a:'Oho' }),'2026-10-12T00:00:00Z'],
    ['lgM','bob',JSON.stringify({ a:'Ura' }),'2026-09-20T00:00:00Z'], ['lgM','cid',JSON.stringify({ a:'Oho' }),'2026-10-02T00:00:00Z']]);
  // lgM's title is the one its teams still give (bob 2) — but cid saved a new team after it was awarded
  sheets.Champions = sheets.Champions.concat([['ch7','Aki 2026','league','lgM','Moved','bob',2,'cid',1,2,'2026-09-27T00:00:00Z','','','','']]);
  const ctx = makeCtx(sheets);
  const dry = ctx.snapshotKeeperBasho_('Aki 2026', TIERS, { fill:true });
  t('a league with no title for the basho is left out: it wasn’t there, or had nothing to crown', () => {
    assert.ok(dry.leagues.indexOf('Newcomers') < 0, J(dry));
    assert.ok(!dry.skipped.some(x => x.league === 'Newcomers'), J(dry.skipped));
  });
  t('a league with a team saved after its title was awarded is skipped, naming whose', () => {
    const x = dry.skipped.find(y => y.league === 'Moved');
    assert.ok(x && /cid/.test(x.now) && !/bob/.test(x.now), J(dry.skipped));
    assert.ok(dry.leagues.indexOf('Moved') < 0, J(dry.leagues));
  });
  t('teams saved before the title (or never stamped) are fine', () =>
    assert.ok(dry.leagues.indexOf('Classic') >= 0, J(dry.leagues)));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
