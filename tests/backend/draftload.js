/* Draft-room load and the tripwire, over the real .gs in a Node vm.

   On 10 Sept the Chanko Boogie room crawled and then looked dead ("seems to be
   slowing down to process picks", "did draft just crash?"). Every member polled
   draftState every 4s — every 1.2s near a deadline — and each poll read six
   sheets, the whole Messages sheet among them, and could sit up to 15s waiting
   for the lock. This suite pins down the fixes:

     - the board part of draftState is a short-lived shared snapshot, busted by
       every write that changes it, and never served when there is work to do;
     - presence and the server clock are never served from the snapshot;
     - the lock wait on a poll is short;
     - the chat tail is read from the bottom of the sheet, not the whole sheet;
     - THE TRIPWIRE: a pick log with a doubled turn or a doubled wrestler
       pauses the draft by itself, blocks further picks, and names the pick to
       rewind to.

   The fake cache here honours expiry and is shared across calls, like the real
   one — the other suites' fakes make a fresh map per call, which quietly turns
   the snapshot off.
*/
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const GS = process.env.GG_GS ||
  require('path').join(__dirname, '..', '..', 'sumo-fantasy.gs');
const SRC = fs.readFileSync(GS,'utf8');

const READS = { n:0, byName:{} };
function countRead(name){ READS.n++; READS.byName[name]=(READS.byName[name]||0)+1; }
function makeSheet(name, rows){
  return { name, rows,
    getName(){return name;}, getLastRow(){return this.rows.length;},
    getLastColumn(){return this.rows.reduce((m,r)=>Math.max(m,r.length),0);},
    getDataRange(){const s=this;return {getValues(){countRead(name+':all');return s.rows.map(r=>r.slice());}};},
    getRange(r,c,nr,nc){ const s=this; nr=nr||1; nc=nc||1; return {
      getValues(){countRead(name);const o=[];for(let i=0;i<nr;i++){const row=s.rows[r-1+i]||[];o.push(row.slice(c-1,c-1+nc));}return o;},
      setValues(v){for(let i=0;i<nr;i++){while(s.rows.length<r-1+i+1)s.rows.push([]);
        for(let j=0;j<nc;j++)s.rows[r-1+i][c-1+j]=v[i][j];}},
      setValue(v){while(s.rows.length<r)s.rows.push([]);s.rows[r-1][c-1]=v;} };},
    deleteRow(r){ this.rows.splice(r-1,1); },
    deleteRows(r,n){ this.rows.splice(r-1,n); },
    appendRow(row){this.rows.push(row.slice());} };
}
function makeCache(){
  const m={};                                        // key -> [value, expiresAt]
  const live=k=>m[k] && (m[k][1]===0 || m[k][1]>Date.now()) ? m[k][0] : null;
  return { m,
    get(k){ return live(k); },
    getAll(ks){ const o={}; ks.forEach(k=>{ const v=live(k); if(v!=null) o[k]=v; }); return o; },
    put(k,v,ttl){ m[k]=[String(v), ttl ? Date.now()+ttl*1000 : 0]; },
    remove(k){ delete m[k]; } };
}
function makeCtx(sheets){
  const store={}; for(const k in sheets) store[k]=makeSheet(k, sheets[k].map(r=>r.slice()));
  const ss={ getSheetByName(n){return store[n]||null;}, insertSheet(n){store[n]=makeSheet(n,[]);return store[n];} };
  const cache=makeCache(), locks={ waits:[] };
  const ctx={ SpreadsheetApp:{getActiveSpreadsheet(){return ss;}, flush(){}},
    PropertiesService:{getScriptProperties(){return {getProperty(){return 'test';}};}},
    LockService:{getScriptLock(){return {waitLock(ms){locks.waits.push(ms);},tryLock(ms){locks.waits.push(ms);return true;},releaseLock(){}};}},
    CacheService:{getScriptCache(){return cache;}},
    UrlFetchApp:{fetch(){throw new Error('no net');}},
    ContentService:{createTextOutput(){return {setMimeType(){return this;}};},MimeType:{JSON:'json'}},
    Utilities:{formatDate(){return '';}},
    console,JSON,Math,Date,Number,String,Object,Array,isNaN,parseInt,parseFloat,RegExp,Error,
    __store:store, __cache:cache, __locks:locks };
  vm.createContext(ctx); vm.runInContext(SRC,ctx,{filename:'sumo-fantasy.gs'});
  return ctx;
}
const LEAGUE_HEAD=['id','name','commissioner','created','inviteCode','mode','rosterSize','draftStatus',
  'draftOrder','draftPickIdx','draftPhase','scoring','draftDate','draftAgree','benchSize','farmSize',
  'pickClock','pickDeadline','defaultOrder','keepMk','keepJr'];
const MAK=['Onosato','Hoshoryu','Kirishima','Aonishiki','Atamifuji','Kotoshoho','Takayasu','Gonoyama','Daieisho','Oshoma'];
const JUR=['Dewanoryu','Kyokukaiyu','Daiseizan','Kazuma'];
function world(extraMsgs){
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
    Messages:[['id','leagueId','handle','name','body','parentId','created']].concat(extraMsgs||[]),
    Meta:[['key','value'],['basho','Aki 2026'],['lastDay',0]],
    Results:[['day','division','east','west','winner','kimarite']]
  });
}
function started(c){
  const r=c.startDraft({handle:'sean',auth:'a',id:'lg1',pickClock:120,pool:{makuuchi:MAK,juryo:JUR}});
  assert.ok(r.ok, r.error); return r;
}
const P = c => c.__store.DraftPicks.rows.slice(1);
const onClock = c => { const L=c.leagueRow('lg1'); return c.draftTurn(L.draftOrder,c.rosterPlan(L),L.draftPickIdx).handle; };
function pickNext(c){
  const L=c.leagueRow('lg1'); const tn=c.draftTurn(L.draftOrder,c.rosterPlan(L),L.draftPickIdx);
  const taken=new Set(P(c).map(p=>p[5].toLowerCase()));
  const name=(tn.phase==='juryo'?JUR:MAK).find(n=>!taken.has(n.toLowerCase()));
  const r=c.makePick({handle:tn.handle,auth:'a',id:'lg1',rikishi:name}); assert.ok(r.ok, r.error); return r;
}
function reads(fn){ READS.n=0; READS.byName={}; fn(); return { n:READS.n, by:Object.assign({},READS.byName) }; }

let pass=0,fail=0;
function t(n,fn){ try{ fn(); console.log('  ok  '+n); pass++; }catch(e){ console.log('  FAIL '+n+'\n       '+e.message); fail++; } }

console.log('\n— the shared snapshot —');
t('a second poll inside the window reads no sheets', ()=>{
  const c=world(); started(c);
  c.draftState('lg1','sean');
  const r=reads(()=>c.draftState('lg1','mika'));
  assert.strictEqual(r.n, 0, 'the second poll read: '+JSON.stringify(r.by));
});
t('presence and the server clock are never served stale', ()=>{
  const c=world(); started(c);
  c.draftState('lg1','sean');
  const s=c.draftState('lg1','mika');                // served from the snapshot
  assert.ok(s.presence.sean!=null && s.presence.mika!=null, JSON.stringify(s.presence));
  assert.ok(Math.abs(new Date(s.serverNow).getTime()-Date.now())<1000);
});
t('a pick shows on the very next poll', ()=>{
  const c=world(); started(c);
  c.draftState('lg1','sean');
  pickNext(c);
  const s=c.draftState('lg1','sean');
  assert.strictEqual(s.picks.length,1,'the snapshot hid the pick');
  assert.strictEqual(s.turn.pickIdx,1);
});
t('a chat post shows on the very next poll', ()=>{
  const c=world(); started(c);
  c.draftState('lg1','sean');
  c.postMessage({handle:'mika',auth:'a',id:'lg1',body:'taking Ura'});
  assert.strictEqual(c.draftState('lg1','sean').chat.length,1);
});
t('pause, resume, rewind and a restart time all show on the very next poll', ()=>{
  const c=world(); started(c); pickNext(c);
  c.draftState('lg1');
  c.pauseDraft({handle:'sean',auth:'a',id:'lg1'});
  assert.strictEqual(c.draftState('lg1').paused,true,'pause');
  c.setDraftDate({handle:'sean',auth:'a',id:'lg1',draftDate:'2026-09-12T23:00:00.000Z'});
  assert.strictEqual(c.draftState('lg1').restartAt,'2026-09-12T23:00:00.000Z','restart time');
  c.agreeDraftDate({handle:'mika',auth:'a',id:'lg1',agree:true});
  assert.ok(c.draftState('lg1').restartAgreed.includes('mika'),'agreement');
  c.resumeDraft({handle:'sean',auth:'a',id:'lg1'});
  assert.strictEqual(c.draftState('lg1').paused,false,'resume');
  c.rewindDraft({handle:'sean',auth:'a',id:'lg1',toPick:0});
  assert.strictEqual(c.draftState('lg1').picks.length,0,'rewind');
});
t('an expired clock is never answered from the snapshot', ()=>{
  const c=world(); started(c);
  c.draftState('lg1');
  /* time passes: the stored deadline and the snapshot's copy of it both lapse */
  const past=new Date(Date.now()-1000).toISOString();
  c.__store.Leagues.rows[1][17]=past;
  const k='ds:lg1', snap=JSON.parse(c.__cache.get(k)); snap.core.deadline=past;
  c.__cache.put(k, JSON.stringify(snap), 3);
  c.draftState('lg1');
  assert.strictEqual(P(c).length,1,'the overdue pick was not settled');
});
t('a slow poll never stores a snapshot from before a write', ()=>{
  const c=world(); started(c);
  const real=c.draftPicksOf; let once=true;
  c.draftPicksOf=function(id){ const out=real(id); if(once){ once=false; c.dsBust_('lg1'); } return out; };
  c.draftState('lg1');
  c.draftPicksOf=real;
  assert.strictEqual(c.__cache.get('ds:lg1'),null,'a snapshot outlived a write made during the read');
});
t('the snapshot expires on its own', ()=>{
  const c=world(); started(c);
  c.draftState('lg1');
  const e=c.__cache.m['ds:lg1'];
  assert.ok(e && e[1]>Date.now() && e[1]<=Date.now()+c.DS_CACHE_S*1000, 'no short expiry on the snapshot');
});

console.log('\n— lock waits and the chat tail —');
t('a poll waits only a moment for the lock', ()=>{
  const body=SRC.slice(SRC.indexOf('function draftState('), SRC.indexOf('function draftStateFinish_('));
  const waits=(body.match(/tryLock\((\d+)\)/g)||[]).map(x=>+x.match(/\d+/)[0]);
  assert.ok(waits.length>0,'no tryLock found');
  assert.ok(waits.every(w=>w<=2000),'draftState waits '+waits.join(', ')+'ms');
  assert.ok(!/waitLock/.test(body),'draftState must never block on waitLock');
});
t('the chat tail never reads the whole Messages sheet', ()=>{
  const other=[]; for(let i=0;i<2500;i++) other.push(['o'+i,'lgX','zed','Zed','noise '+i,'','']);
  const mine=[]; for(let i=0;i<55;i++) mine.push(['m'+i,'lg1','mika','Mika','msg '+i,'','']);
  const mixed=[]; for(let i=0;i<55;i++){ mixed.push(mine[i]); mixed.push(other[i]); }
  const c=world(other.slice(55).concat(mixed)); started(c);
  const r=reads(()=>c.draftState('lg1'));
  assert.ok(!r.by['Messages:all'],'read the whole Messages sheet');
  const s=c.draftState('lg1');
  assert.strictEqual(s.chat.length,40);
  assert.strictEqual(s.chat[0].body,'msg 15'); assert.strictEqual(s.chat[39].body,'msg 54');
});

console.log('\n— the tripwire —');
function doubled(c){
  started(c); pickNext(c); pickNext(c);
  const who=onClock(c);
  /* what 10 Sept looked like: two picks logged against the same turn */
  c.__store.DraftPicks.rows.push(['lg1',2,1,'makuuchi',who,'Daieisho','x'],['lg1',2,1,'makuuchi',who,'Oshoma','x']);
  c.__store.KeeperRosters.rows.push(['lg1',who,'Daieisho','makuuchi','auto','x','active'],['lg1',who,'Oshoma','makuuchi','auto','x','active']);
  c.__store.Leagues.rows[1][9]=3;   // the cursor moved on past them
  c.dsBust_('lg1');
  return who;
}
t('a doubled turn pauses the draft by itself and says where to rewind to', ()=>{
  const c=world(); doubled(c);
  const s=c.draftState('lg1');
  assert.strictEqual(s.paused,true,'the draft kept running on a broken log');
  assert.ok(s.alert,'no alert');
  assert.strictEqual(s.alert.turns.length,1); assert.strictEqual(s.alert.turns[0].pick,2);
  assert.deepStrictEqual([...s.alert.turns[0].names],['Daieisho','Oshoma']);
  assert.strictEqual(s.alert.fixFrom,2);
});
t('a wrestler drafted twice trips it too, and the fix keeps the first', ()=>{
  const c=world(); started(c); pickNext(c); pickNext(c);
  const first=P(c)[0][5];
  c.__store.DraftPicks.rows.push(['lg1',2,1,'makuuchi',onClock(c),first,'x']);
  c.__store.Leagues.rows[1][9]=3; c.dsBust_('lg1');
  const s=c.draftState('lg1');
  assert.strictEqual(s.paused,true);
  assert.strictEqual(s.alert.names[0].name,first);
  assert.strictEqual(s.alert.fixFrom,2,'rewind from the second copy, not the first');
});
t('nothing is auto-drafted and no pick is accepted onto a broken log', ()=>{
  const c=world(); doubled(c);
  c.__store.Leagues.rows[1][17]=new Date(Date.now()-1000).toISOString();   // clock also expired
  const before=P(c).length;
  c.settleDraft_(c.leagueRow('lg1'));
  assert.strictEqual(P(c).length,before,'settle drafted onto a broken log');
  c.__store.Leagues.rows[1][21]='';                // even if somebody un-paused it by hand
  const r=c.makePick({handle:onClock(c),auth:'a',id:'lg1',rikishi:'Takayasu'});
  assert.ok(!r.ok,'a pick was accepted onto a broken log');
});
t('rewinding to the named pick clears the alarm', ()=>{
  const c=world(); doubled(c);
  const s=c.draftState('lg1');
  const r=c.rewindDraft({handle:'sean',auth:'a',id:'lg1',toPick:s.alert.fixFrom});
  assert.ok(r.ok, r.error);
  const after=c.draftState('lg1');
  assert.strictEqual(after.alert,null,'still alarmed after the fix');
  assert.strictEqual(after.picks.length,2);
});
t('a healthy draft never trips it', ()=>{
  const c=world(); started(c);
  for(let i=0;i<8 && c.leagueRow('lg1').draftStatus==='active';i++){ pickNext(c); assert.strictEqual(c.draftState('lg1').alert,null); }
});

console.log('\n'+pass+' passed, '+fail+' failed\n');
process.exit(fail?1:0);
