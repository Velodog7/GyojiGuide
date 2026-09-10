/* Commissioner draft controls (pause / resume / undo / rewind) and the
   stale-league-row guard, over the real .gs in a Node vm.

   THE BUG THIS PINS DOWN. Chanko Boogie, 10 Sept 2026: Gyoji's 5-minute clock
   ran out at pick 22 and the server auto-drafted him FIVE wrestlers, two
   seconds apart (Daieisho, Gonoyama, Takanosho, Oshoma, Asanoyama), then three
   more at pick 27. Each auto-pick skipped the names already taken, so the pick
   log was being read fresh — but the league row was not: every waiting poll
   saw the old cursor and the old, expired deadline, and settled the same turn
   again. unlock_'s flush-before-release was already live and did not stop it.

   The fake Sheet can't reproduce Apps Script's caching, so the stale-row tests
   do it by hand: leagueRow is swapped for one that returns a snapshot taken
   before another "execution" moved the draft on. Against the unfixed file the
   first two tests fail (a second pick lands on the same turn).
*/
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const GS = process.env.GG_GS ||
  require('path').join(__dirname, '..', '..', 'sumo-fantasy.gs');
const SRC = fs.readFileSync(GS,'utf8');

function makeSheet(name, rows){
  return { name, rows,
    getName(){return name;}, getLastRow(){return this.rows.length;},
    getLastColumn(){return this.rows.reduce((m,r)=>Math.max(m,r.length),0);},
    getDataRange(){const s=this;return {getValues(){return s.rows.map(r=>r.slice());}};},
    getRange(r,c,nr,nc){ const s=this; nr=nr||1; nc=nc||1; return {
      getValues(){const o=[];for(let i=0;i<nr;i++){const row=s.rows[r-1+i]||[];o.push(row.slice(c-1,c-1+nc));}return o;},
      setValues(v){for(let i=0;i<nr;i++){while(s.rows.length<r-1+i+1)s.rows.push([]);
        for(let j=0;j<nc;j++)s.rows[r-1+i][c-1+j]=v[i][j];}},
      setValue(v){while(s.rows.length<r)s.rows.push([]);s.rows[r-1][c-1]=v;} };},
    deleteRow(r){ this.rows.splice(r-1,1); },
    deleteRows(r,n){ this.rows.splice(r-1,n); },
    appendRow(row){this.rows.push(row.slice());} };
}
function makeCtx(sheets){
  const store={}; for(const k in sheets) store[k]=makeSheet(k, sheets[k].map(r=>r.slice()));
  const ss={ getSheetByName(n){return store[n]||null;}, insertSheet(n){store[n]=makeSheet(n,[]);return store[n];} };
  const ctx={ SpreadsheetApp:{getActiveSpreadsheet(){return ss;}, flush(){}},
    PropertiesService:{getScriptProperties(){return {getProperty(){return 'test';}};}},
    LockService:{getScriptLock(){return {waitLock(){},tryLock(){return true;},releaseLock(){}};}},
    CacheService:{getScriptCache(){const m={};return {get(k){return m[k]||null;},getAll(){return {};},put(k,v){m[k]=v;},remove(k){delete m[k];}};}},
    UrlFetchApp:{fetch(){throw new Error('no net');}},
    ContentService:{createTextOutput(){return {setMimeType(){return this;}};},MimeType:{JSON:'json'}},
    Utilities:{formatDate(){return '';}},
    console,JSON,Math,Date,Number,String,Object,Array,isNaN,parseInt,parseFloat,RegExp,Error,
    __store:store };
  vm.createContext(ctx); vm.runInContext(SRC,ctx,{filename:'sumo-fantasy.gs'});
  return ctx;
}
const LEAGUE_HEAD=['id','name','commissioner','created','inviteCode','mode','rosterSize','draftStatus',
  'draftOrder','draftPickIdx','draftPhase','scoring','draftDate','draftAgree','benchSize','farmSize',
  'pickClock','pickDeadline','defaultOrder','keepMk','keepJr'];
const MAK=['Onosato','Hoshoryu','Kirishima','Aonishiki','Atamifuji','Kotoshoho','Takayasu','Gonoyama','Daieisho','Oshoma'];
const JUR=['Dewanoryu','Kyokukaiyu','Daiseizan','Kazuma'];

function world(){
  const league=['lg1','Test','sean','2026-01-01','ABC','keepers',2,'none','[]',0,'','','','{}',1,1,'','','','',''];
  return makeCtx({
    Leagues:[LEAGUE_HEAD, league],
    LeagueMembers:[['leagueId','handle','joined'],['lg1','sean',''],['lg1','mika',''],['lg1','dave','']],
    Users:[['handle','name','auth','team','updated','avatar','status','warnMsg'],
      ['sean','Sean','a','{}','','','',''],['mika','Mika','a','{}','','','',''],['dave','Dave','a','{}','','','','']],
    DraftPicks:[['leagueId','pickIndex','round','phase','handle','rikishi','pickedAt']],
    KeeperRosters:[['leagueId','handle','rikishi','division','acquiredVia','acquiredAt','slot']],
    DraftBoards:[['leagueId','handle','makuuchi','juryo','auto','updated']],
    Trades:[['id','leagueId','fromHandle','toHandle','offer','request','status','createdAt','resolvedAt']],
    Messages:[['id','leagueId','handle','name','body','parentId','created']],
    Meta:[['key','value'],['basho','Aki 2026'],['lastDay',0]],
    Results:[['day','division','east','west','winner','kimarite']]
  });
}
function started(c){
  const r=c.startDraft({handle:'sean',auth:'a',id:'lg1',pickClock:120,pool:{makuuchi:MAK,juryo:JUR}});
  assert.ok(r.ok, r.error); return r;
}
const P = c => c.__store.DraftPicks.rows.slice(1);
const R = c => c.__store.KeeperRosters.rows.slice(1);
const expire = c => { c.__store.Leagues.rows[1][17]=new Date(Date.now()-1000).toISOString(); };
const onClock = c => { const L=c.leagueRow('lg1'); return c.draftTurn(L.draftOrder,c.rosterPlan(L),L.draftPickIdx).handle; };
/* serve `snap` from leagueRow for the next n calls — the stale read */
function staleFor(c, snap, n){
  const real=c.leagueRow; let left=n;
  c.leagueRow=function(id){ if (left-- > 0) return JSON.parse(JSON.stringify(snap)); return real(id); };
  return ()=>{ c.leagueRow=real; };
}
function pickFor(c, who, name){
  const r=c.makePick({handle:who,auth:'a',id:'lg1',rikishi:name}); assert.ok(r.ok, who+' '+name+': '+r.error); return r;
}
function firstFree(c, phase){
  const taken=new Set(P(c).map(p=>p[5].toLowerCase()));
  return (phase==='juryo'?JUR:MAK).find(n=>!taken.has(n.toLowerCase()));
}
function pickNext(c){
  const L=c.leagueRow('lg1'); const tn=c.draftTurn(L.draftOrder,c.rosterPlan(L),L.draftPickIdx);
  return pickFor(c, tn.handle, firstFree(c, tn.phase));
}
function draftToEnd(c){
  for (let g=0; g<40 && c.leagueRow('lg1').draftStatus==='active'; g++) pickNext(c);
}

let pass=0,fail=0;
function t(n,fn){ try{ fn(); console.log('  ok  '+n); pass++; }catch(e){ console.log('  FAIL '+n+'\n       '+e.message); fail++; } }

console.log('\n— stale league row (the Chanko Boogie bug) —');
t('a waiting poll with a stale row does not auto-pick the same turn again', ()=>{
  const c=world(); started(c); expire(c);
  const stale=c.leagueRow('lg1');                  // what the waiting poll read before the lock
  c.draftState('lg1');                             // execution A: settles pick 0, cursor -> 1
  assert.strictEqual(P(c).length,1,'setup: one pick awarded');
  const undo=staleFor(c, stale, 2);                // execution B: both its reads come back stale
  c.draftState('lg1'); undo();
  assert.strictEqual(P(c).length,1,'a second pick landed on the same turn: '+P(c).map(p=>p[1]+':'+p[5]).join(', '));
  assert.strictEqual(R(c).length,1,'and no extra roster row either');
});
t('a pick made against a stale row is refused', ()=>{
  const c=world(); started(c);
  const who=onClock(c);
  const stale=c.leagueRow('lg1');
  pickFor(c, who, 'Kirishima');                    // lands, cursor -> 1
  const undo=staleFor(c, stale, 3);
  const r=c.makePick({handle:who,auth:'a',id:'lg1',rikishi:'Onosato'}); undo();
  assert.ok(!r.ok,'second pick on one turn accepted');
  assert.strictEqual(P(c).length,1);
});
t('a poll whose stale row predates a rewind does not refill the rewound picks', ()=>{
  const c=world(); started(c);
  for (let i=0;i<4;i++) pickNext(c);
  expire(c);
  const stale=c.leagueRow('lg1');                  // cursor 4, clock expired
  c.rewindDraft({handle:'sean',auth:'a',id:'lg1',toPick:1});
  const undo=staleFor(c, stale, 2);
  c.draftState('lg1'); undo();
  assert.strictEqual(P(c).length,1,'a stale poll auto-picked into a rewound draft');
});
t('a normal draft still runs to the end with the guard in place', ()=>{
  const c=world(); started(c); draftToEnd(c);
  assert.strictEqual(c.leagueRow('lg1').draftStatus,'complete');
  assert.strictEqual(P(c).length, 3*(3+1));
});

console.log('\n— pause / resume —');
t('only the commissioner can pause', ()=>{
  const c=world(); started(c);
  const r=c.pauseDraft({handle:'mika',auth:'a',id:'lg1'});
  assert.ok(!r.ok && /commissioner/i.test(r.error), JSON.stringify(r));
  assert.ok(!c.pauseDraft({handle:'sean',auth:'WRONG',id:'lg1'}).ok,'bad auth refused');
});
t('pause freezes the clock: no timeout pick, no manual pick', ()=>{
  const c=world(); started(c);
  const r=c.pauseDraft({handle:'sean',auth:'a',id:'lg1'});
  assert.ok(r.ok && r.paused, JSON.stringify(r));
  assert.ok(r.left>100 && r.left<=120, 'time left parked: '+r.left);
  expire(c);                                        // even if a deadline were somehow in the past
  c.draftState('lg1');
  assert.strictEqual(P(c).length,0,'a paused draft auto-picked');
  const m=c.makePick({handle:onClock(c),auth:'a',id:'lg1',rikishi:'Onosato'});
  assert.ok(!m.ok && /paused/i.test(m.error), JSON.stringify(m));
  const s=c.draftState('lg1');
  assert.strictEqual(s.paused,true); assert.strictEqual(s.deadline,'');
  assert.ok(s.pausedLeft>0); assert.strictEqual(s.league.commissioner,'sean');
});
t('pausing an already-expired clock awards that pick first', ()=>{
  const c=world(); started(c); expire(c);
  c.pauseDraft({handle:'sean',auth:'a',id:'lg1'});
  assert.strictEqual(P(c).length,1,'the owed pick was not awarded');
  assert.ok(c.leagueRow('lg1').draftPaused!=null,'and the draft is paused after it');
});
t('resume puts the parked time back on the clock', ()=>{
  const c=world(); started(c);
  c.pauseDraft({handle:'sean',auth:'a',id:'lg1'});
  c.__store.Leagues.rows[1][21]=45000;              // 45s were left
  const r=c.resumeDraft({handle:'sean',auth:'a',id:'lg1'});
  assert.ok(r.ok && !r.paused, JSON.stringify(r));
  const left=(new Date(r.deadline).getTime()-Date.now())/1000;
  assert.ok(left>43 && left<=45,'deadline ~45s out, got '+left);
  assert.strictEqual(c.leagueRow('lg1').draftPaused,null);
  pickFor(c, onClock(c), 'Onosato');               // and picking works again
});
t('pause and resume are idempotent', ()=>{
  const c=world(); started(c);
  assert.ok(c.resumeDraft({handle:'sean',auth:'a',id:'lg1'}).ok,'resume while running is a no-op');
  const a=c.pauseDraft({handle:'sean',auth:'a',id:'lg1'}), b=c.pauseDraft({handle:'sean',auth:'a',id:'lg1'});
  assert.ok(a.ok && b.ok); assert.strictEqual(a.left,b.left);
});
t('the first pause gives the Leagues sheet its draftPaused header', ()=>{
  const c=world(); started(c); c.pauseDraft({handle:'sean',auth:'a',id:'lg1'});
  assert.strictEqual(c.__store.Leagues.rows[0][21],'draftPaused');
});

console.log('\n— undo / rewind —');
t('undo removes the last pick and its roster row, and leaves the draft paused', ()=>{
  const c=world(); started(c);
  const a=onClock(c); pickFor(c,a,'Onosato');
  const b=onClock(c); pickFor(c,b,'Hoshoryu');
  const r=c.rewindDraft({handle:'sean',auth:'a',id:'lg1'});
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.removed,1); assert.strictEqual(r.toPick,1);
  assert.deepStrictEqual(P(c).map(p=>p[5]),['Onosato']);
  assert.deepStrictEqual(R(c).map(p=>p[2]),['Onosato']);
  const L=c.leagueRow('lg1');
  assert.strictEqual(L.draftPickIdx,1); assert.ok(L.draftPaused>0,'paused with a clock parked');
  assert.strictEqual(onClock(c), b, 'the same member is back on the clock');
  c.resumeDraft({handle:'sean',auth:'a',id:'lg1'});
  pickFor(c, b, 'Kirishima');
});
t('only the commissioner can rewind', ()=>{
  const c=world(); started(c); pickFor(c,onClock(c),'Onosato');
  const r=c.rewindDraft({handle:'mika',auth:'a',id:'lg1'});
  assert.ok(!r.ok); assert.strictEqual(P(c).length,1);
});
t('rewind to a round clears every later pick, duplicates included', ()=>{
  const c=world(); started(c);
  for (let i=0;i<5;i++) pickNext(c);
  /* plant a Chanko-Boogie-style duplicate: two extra picks logged at index 4 */
  const who=P(c)[4][4];
  c.__store.DraftPicks.rows.push(['lg1',4,2,'makuuchi',who,'Daieisho','x'],['lg1',4,2,'makuuchi',who,'Oshoma','x']);
  c.__store.KeeperRosters.rows.push(['lg1',who,'Daieisho','makuuchi','auto','x','bench'],['lg1',who,'Oshoma','makuuchi','auto','x','bench']);
  const keep=P(c).slice(0,3).map(p=>p[5]);
  const r=c.rewindDraft({handle:'sean',auth:'a',id:'lg1',toPick:3});   // start of round 2 with 3 teams
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.removed,4,'picks 3, 4 and both duplicates');
  assert.deepStrictEqual(P(c).map(p=>p[5]), keep);
  assert.deepStrictEqual(R(c).map(p=>p[2]).sort(), keep.slice().sort(),'roster rows match the surviving picks');
  assert.strictEqual(c.leagueRow('lg1').draftPickIdx,3);
  assert.strictEqual(r.turn.round,2);
});
t('rewind never touches another league\'s picks', ()=>{
  const c=world(); started(c); pickFor(c,onClock(c),'Onosato');
  c.__store.DraftPicks.rows.push(['lg2',0,1,'makuuchi','zed','Onosato','x']);
  c.__store.KeeperRosters.rows.push(['lg2','zed','Onosato','makuuchi','draft','x','active']);
  c.rewindDraft({handle:'sean',auth:'a',id:'lg1',toPick:0});
  assert.strictEqual(P(c).length,1); assert.strictEqual(P(c)[0][0],'lg2');
  assert.strictEqual(R(c).length,1); assert.strictEqual(R(c)[0][0],'lg2');
});
t('an out-of-range pick is refused', ()=>{
  const c=world(); started(c); pickFor(c,onClock(c),'Onosato');
  assert.ok(!c.rewindDraft({handle:'sean',auth:'a',id:'lg1',toPick:5}).ok);
  assert.ok(!c.rewindDraft({handle:'sean',auth:'a',id:'lg1',toPick:-1}).ok);
  assert.strictEqual(P(c).length,1);
});
t('undoing the final pick reopens a finished draft', ()=>{
  const c=world(); started(c); draftToEnd(c);
  assert.strictEqual(c.leagueRow('lg1').draftStatus,'complete');
  const r=c.rewindDraft({handle:'sean',auth:'a',id:'lg1'});
  assert.ok(r.ok, r.error);
  assert.strictEqual(c.leagueRow('lg1').draftStatus,'active');
  assert.strictEqual(c.draftState('lg1').paused,true);
});
t('a finished draft with trades since cannot be reopened', ()=>{
  const c=world(); started(c); draftToEnd(c);
  c.__store.Trades.rows.push(['tr1','lg1','sean','mika','[]','[]','accepted','','']);
  const r=c.rewindDraft({handle:'sean',auth:'a',id:'lg1'});
  assert.ok(!r.ok && /trade/i.test(r.error), JSON.stringify(r));
  assert.strictEqual(c.leagueRow('lg1').draftStatus,'complete');
});
t('the rewound draft runs to completion again', ()=>{
  const c=world(); started(c);
  for (let i=0;i<6;i++) pickNext(c);
  c.rewindDraft({handle:'sean',auth:'a',id:'lg1',toPick:2});
  c.resumeDraft({handle:'sean',auth:'a',id:'lg1'});
  draftToEnd(c);
  assert.strictEqual(c.leagueRow('lg1').draftStatus,'complete');
  const names=P(c).map(p=>p[5].toLowerCase());
  assert.strictEqual(names.length, 12); assert.strictEqual(new Set(names).size, 12,'nobody drafted twice');
  const idx=P(c).map(p=>Number(p[1])).sort((a,b)=>a-b);
  assert.deepStrictEqual(idx, [...Array(12).keys()], 'pick indexes run 0..11 with no gaps or repeats');
});

console.log('\n'+pass+' passed, '+fail+' failed\n');
process.exit(fail?1:0);
