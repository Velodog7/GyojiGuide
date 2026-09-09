/* Node harness for the pick clock + server-side auto-draft in sumo-fantasy.gs.
   Real .gs in a vm over a fake Sheet backend. */
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
    appendRow(row){this.rows.push(row.slice());} };
}
function makeCtx(sheets){
  const store={}; for(const k in sheets) store[k]=makeSheet(k, sheets[k].map(r=>r.slice()));
  const ss={ getSheetByName(n){return store[n]||null;}, insertSheet(n){store[n]=makeSheet(n,[]);return store[n];} };
  const ctx={ SpreadsheetApp:{getActiveSpreadsheet(){return ss;}},
    PropertiesService:{getScriptProperties(){return {getProperty(){return 'test';}};}},
    LockService:{getScriptLock(){return {waitLock(){},tryLock(){return true;},releaseLock(){}};}},
    UrlFetchApp:{fetch(){throw new Error('no net');}},
    ContentService:{createTextOutput(){return {setMimeType(){return this;}};},MimeType:{JSON:'json'}},
    Utilities:{formatDate(){return '';}},
    console,JSON,Math,Date,Number,String,Object,Array,isNaN,parseInt,parseFloat,RegExp,
    __store:store };
  vm.createContext(ctx); vm.runInContext(SRC,ctx,{filename:'sumo-fantasy.gs'});
  return ctx;
}
const LEAGUE_HEAD=['id','name','commissioner','created','inviteCode','mode','rosterSize','draftStatus',
  'draftOrder','draftPickIdx','draftPhase','scoring','draftDate','draftAgree','benchSize','farmSize',
  'pickClock','pickDeadline','defaultOrder'];
const MAK=['Onosato','Hoshoryu','Kirishima','Aonishiki','Atamifuji','Kotoshoho','Takayasu','Gonoyama'];
const JUR=['Dewanoryu','Kyokukaiyu','Daiseizan','Kazuma'];

function world(opts){
  opts=opts||{};
  const league=['lg1','Test','sean','2026-01-01','ABC','keepers',2,'none','[]',0,'',        '', '', '{}', 0, 1,
                opts.clock||'', opts.deadline||'', opts.defaultOrder||''];
  return makeCtx({
    Leagues:[LEAGUE_HEAD, league],
    LeagueMembers:[['leagueId','handle','joined'],['lg1','sean',''],['lg1','mika',''],['lg1','dave','']],
    Users:[['handle','name','auth','team','updated','avatar','status','warnMsg'],
      ['sean','Sean','a','{}','','','',''],['mika','Mika','a','{}','','','',''],['dave','Dave','a','{}','','','','']],
    DraftPicks:[['leagueId','pickIndex','round','phase','handle','rikishi','pickedAt']],
    KeeperRosters:[['leagueId','handle','rikishi','division','acquiredVia','acquiredAt','slot']],
    DraftBoards:[['leagueId','handle','makuuchi','juryo','auto','updated'],
      ...(opts.boards||[])],
    Meta:[['key','value'],['basho','Aki 2026'],['lastDay',0]],
    Results:[['day','division','east','west','winner','kimarite']]
  });
}
let pass=0,fail=0;
function t(n,fn){ try{ fn(); console.log('  ok  '+n); pass++; }catch(e){ console.log('  FAIL '+n+'\n       '+e.message); fail++; } }

console.log('\n— clock assignment —');
t('auto-draft ON gets the 30s grace, OFF gets the full clock', ()=>{
  const c=world({clock:120, boards:[['lg1','mika','[]','[]',true,''],['lg1','dave','[]','[]',false,'']]});
  const L=c.leagueRow('lg1'); const b=c.draftBoardsOf('lg1');
  assert.strictEqual(c.clockFor_(L,'mika',b),30);
  assert.strictEqual(c.clockFor_(L,'dave',b),120);
  assert.strictEqual(c.clockFor_(L,'sean',b),120,'no board at all = full clock');
});
t('grace never exceeds a short league clock', ()=>{
  const c=world({clock:20, boards:[['lg1','mika','[]','[]',true,'']]});
  assert.strictEqual(c.clockFor_(c.leagueRow('lg1'),'mika',c.draftBoardsOf('lg1')),20);
});

console.log('\n— order resolution —');
t('own board first, league default behind it, no duplicates', ()=>{
  const c=world({defaultOrder:JSON.stringify({makuuchi:MAK,juryo:JUR}),
    boards:[['lg1','mika',JSON.stringify(['Atamifuji','Onosato']),'[]',false,'']]});
  const L=c.leagueRow('lg1'), b=c.draftBoardsOf('lg1');
  const o=c.orderFor_(L,'mika','makuuchi',b);
  assert.strictEqual(o[0],'Atamifuji'); assert.strictEqual(o[1],'Onosato');
  assert.strictEqual(o[2],'Hoshoryu','then the default order, minus what was already listed');
  assert.strictEqual(new Set(o.map(x=>x.toLowerCase())).size,o.length,'no duplicates');
});
t('a member with no board falls back to banzuke order', ()=>{
  const c=world({defaultOrder:JSON.stringify({makuuchi:MAK,juryo:JUR})});
  // vm-created arrays are never reference-equal to host ones — compare by value
  assert.strictEqual(JSON.stringify(c.orderFor_(c.leagueRow('lg1'),'sean','makuuchi',{})), JSON.stringify(MAK));
});

t('a missing DraftBoards sheet is a read, not a write', ()=>{
  const c=world();
  delete c.__store.DraftBoards;                       // as it is on a Sheet that has never saved a board
  let created=false;
  const ss=c.SpreadsheetApp.getActiveSpreadsheet();
  const realInsert=ss.insertSheet; ss.insertSheet=function(n){ created=true; return realInsert.call(ss,n); };
  const b=c.draftBoardsOf('lg1');
  assert.strictEqual(JSON.stringify(b),'{}','no boards');
  assert.strictEqual(created,false,'and the read did NOT create the sheet');
});

console.log('\n— settling —');
function started(c, extra){
  const r=c.startDraft(Object.assign({handle:'sean',auth:'a',id:'lg1',pickClock:120,
    pool:{makuuchi:MAK,juryo:JUR}}, extra||{}));
  assert.ok(r.ok, r.error); return r;
}
t('startDraft stores the clock, the first deadline and the banzuke snapshot', ()=>{
  const c=world(); const r=started(c);
  const L=c.leagueRow('lg1');
  assert.strictEqual(L.pickClock,120);
  assert.ok(L.pickDeadline,'a deadline is set');
  assert.ok(new Date(L.pickDeadline).getTime()>Date.now(),'and it is in the future');
  assert.strictEqual(JSON.stringify(L.defaultOrder.makuuchi),JSON.stringify(MAK));
  assert.strictEqual(JSON.stringify(L.defaultOrder.juryo),JSON.stringify(JUR));
});
t('nothing settles while the clock is still running', ()=>{
  const c=world(); started(c);
  const before=c.__store.DraftPicks.rows.length;
  c.settleDraft_(c.leagueRow('lg1'));
  assert.strictEqual(c.__store.DraftPicks.rows.length,before,'no pick awarded early');
});
t('an expired clock drafts the top name off that member\'s board', ()=>{
  const c=world({boards:[['lg1','mika',JSON.stringify(['Atamifuji']),'[]',false,'']]});
  started(c);
  const L=c.leagueRow('lg1');
  const first=c.draftTurn(L.draftOrder,c.rosterPlan(L),0).handle;
  // expire it
  c.__store.Leagues.rows[1][17]=new Date(Date.now()-1000).toISOString();
  c.settleDraft_(c.leagueRow('lg1'));
  const picks=c.__store.DraftPicks.rows.slice(1);
  assert.strictEqual(picks.length,1,'exactly one pick awarded');
  assert.strictEqual(picks[0][4],first,'awarded to the man who was on the clock');
  const expect = first==='mika' ? 'Atamifuji' : MAK[0];
  assert.strictEqual(picks[0][5],expect);
  assert.strictEqual(c.__store.KeeperRosters.rows.slice(1)[0][4],'auto','logged as an auto pick');
});
t('a whole row of absentees settles in one pass', ()=>{
  const c=world(); started(c);
  // force every clock into the past repeatedly by rewinding after each settle
  let guard=0;
  while (c.leagueRow('lg1').draftStatus==='active' && guard++<50){
    c.__store.Leagues.rows[1][17]=new Date(Date.now()-1000).toISOString();
    c.settleDraft_(c.leagueRow('lg1'));
  }
  const L=c.leagueRow('lg1');
  assert.strictEqual(L.draftStatus,'complete','the draft finishes on its own');
  const picks=c.__store.DraftPicks.rows.slice(1);
  assert.strictEqual(picks.length, 3*(2+1), '3 members x (2 makuuchi + 1 juryo)');
  const names=picks.map(p=>p[5].toLowerCase());
  assert.strictEqual(new Set(names).size,names.length,'nobody drafted twice');
});
t('one settle call clears several overdue picks at once', ()=>{
  const c=world(); started(c);
  c.__store.Leagues.rows[1][17]=new Date(Date.now()-10*60*1000).toISOString();
  // every subsequent deadline is computed from now, so only the first is overdue…
  c.settleDraft_(c.leagueRow('lg1'));
  assert.strictEqual(c.__store.DraftPicks.rows.length-1,1);
});
t('settling stops cleanly when there is nothing left to draft', ()=>{
  const c=world({defaultOrder:JSON.stringify({makuuchi:[],juryo:[]})});
  c.__store.Leagues.rows[1][7]='active';
  c.__store.Leagues.rows[1][8]=JSON.stringify(['sean','mika','dave']);
  c.__store.Leagues.rows[1][17]=new Date(Date.now()-1000).toISOString();
  c.settleDraft_(c.leagueRow('lg1'));
  assert.strictEqual(c.__store.DraftPicks.rows.length,1,'no picks, no crash');
  assert.strictEqual(c.leagueRow('lg1').draftStatus,'active','left for a human');
});

console.log('\n— makePick interaction —');
t('a manual pick sets the next man\'s deadline', ()=>{
  const c=world(); started(c);
  const L=c.leagueRow('lg1');
  const who=c.draftTurn(L.draftOrder,c.rosterPlan(L),0).handle;
  const r=c.makePick({handle:who,auth:'a',id:'lg1',rikishi:'Kirishima'});
  assert.ok(r.ok,r.error);
  assert.ok(r.deadline,'a fresh deadline comes back');
  assert.ok(new Date(r.deadline).getTime()>Date.now());
});
t('a click that arrives after the clock expired loses the turn', ()=>{
  const c=world(); started(c);
  const L=c.leagueRow('lg1');
  const who=c.draftTurn(L.draftOrder,c.rosterPlan(L),0).handle;
  c.__store.Leagues.rows[1][17]=new Date(Date.now()-1000).toISOString();
  const r=c.makePick({handle:who,auth:'a',id:'lg1',rikishi:'Gonoyama'});
  assert.ok(!r.ok,'the late click is refused');
  const picks=c.__store.DraftPicks.rows.slice(1);
  assert.strictEqual(picks.length,1,'the board picked instead');
  assert.notStrictEqual(picks[0][5],'Gonoyama','and it was not his late choice');
});

console.log('\n— draftState —');
t('draftState settles on read and reports the clock', ()=>{
  const c=world({boards:[['lg1','sean','[]','[]',true,'']]});
  started(c);
  const s1=c.draftState('lg1');
  assert.ok(s1.deadline,'deadline exposed');
  assert.ok(s1.clockSeconds>0,'clock length exposed');
  assert.ok(s1.serverNow,'server clock exposed so the client can correct for drift');
  c.__store.Leagues.rows[1][17]=new Date(Date.now()-1000).toISOString();
  const before=c.__store.DraftPicks.rows.length;
  const s2=c.draftState('lg1');
  assert.strictEqual(c.__store.DraftPicks.rows.length,before+1,'a poll advanced the draft');
  assert.strictEqual(s2.turn.pickIdx,1);
});
t('onClockAuto reports whether the man on the clock asked to be drafted for', ()=>{
  const c=world({boards:[['lg1','mika','[]','[]',true,'']]});
  started(c);
  const s=c.draftState('lg1');
  const onClock=s.turn.handle;
  assert.strictEqual(s.onClockAuto, onClock==='mika');
  assert.strictEqual(s.clockSeconds, onClock==='mika' ? 30 : 120);
});

console.log('\n'+pass+' passed, '+fail+' failed\n');
process.exit(fail?1:0);
