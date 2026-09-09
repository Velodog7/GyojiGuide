/* End-to-end league lifecycle over the real sumo-fantasy.gs, run in a Node vm
   against a fake Sheet backend. Starts from an EMPTY spreadsheet and calls
   setup() — the same path a fresh deploy takes. */
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
      setValue(v){while(s.rows.length<r)s.rows.push([]);s.rows[r-1][c-1]=v;},
      getValue(){const row=s.rows[r-1]||[];return row[c-1];} };},
    deleteRow(r){ this.rows.splice(r-1,1); },
    deleteRows(r,n){ this.rows.splice(r-1,n); },
    appendRow(row){this.rows.push(row.slice());} };
}
function makeCtx(){
  const store={};
  const ss={ getSheetByName(n){return store[n]||null;},
             insertSheet(n){store[n]=makeSheet(n,[]);return store[n];},
             getSheets(){return Object.keys(store).map(k=>store[k]);} };
  const props={};
  const ctx={ SpreadsheetApp:{getActiveSpreadsheet(){return ss;}},
    PropertiesService:{getScriptProperties(){return {
      getProperty(k){ if (props[k]!==undefined) return props[k];
        return k==='ADMIN_KEY' ? 'test' : null; }, setProperty(k,v){props[k]=v;},
      deleteProperty(k){delete props[k];} };}},
    LockService:{getScriptLock(){return {waitLock(){},tryLock(){return true;},releaseLock(){}};}},
    UrlFetchApp:{fetch(){throw new Error('no net');}},
    CacheService:{getScriptCache(){const m={};return {get(k){return m[k]||null;},put(k,v){m[k]=v;},remove(k){delete m[k];}};}},
    ContentService:{createTextOutput(t){return {t,setMimeType(){return this;},getContent(){return t;}};},MimeType:{JSON:'json'}},
    Utilities:{formatDate(){return '';}},
    console,JSON,Math,Date,Number,String,Object,Array,isNaN,parseInt,parseFloat,RegExp,Error,
    __store:store };
  vm.createContext(ctx); vm.runInContext(SRC,ctx,{filename:'sumo-fantasy.gs'});
  ctx.setup();
  return ctx;
}

/* Aki-ish pools, big enough for three teams */
const MAK=['Onosato','Hoshoryu','Kotozakura','Aonishiki','Kirishima','Wakatakakage','Takayasu','Atamifuji',
  'Kotoshoho','Gonoyama','Oshoma','Hiradoumi','Ura','Abi','Tamawashi','Churanoumi','Shonannoumi','Onokatsu'];
const JUR=['Dewanoryu','Kyokukaiyu','Daiseizan','Kazuma','Tokihayate','Shishi','Asakoryu','Fujiseiun','Tanji','Nabatame'];

let pass=0,fail=0,failures=[];
function t(n,fn){ try{ fn(); console.log('  ok   '+n); pass++; }
  catch(e){ console.log('  FAIL '+n+'\n         '+e.message); fail++; failures.push(n); } }
function section(s){ console.log('\n— '+s+' —'); }
function ok(r,msg){ assert.ok(r && r.ok, msg+' :: '+JSON.stringify(r)); return r; }
function no(r,msg){ assert.ok(r && !r.ok, msg+' — expected a refusal, got '+JSON.stringify(r)); return r; }

/* a world with three registered users and one keeper league they all joined */
function fresh(opts){
  opts=opts||{};
  const c=makeCtx();
  ok(c.register({handle:'sean',auth:'h1',name:'Sean'}),'register sean');
  ok(c.register({handle:'mika',auth:'h2',name:'Mika'}),'register mika');
  ok(c.register({handle:'dave',auth:'h3',name:'Dave'}),'register dave');
  const cr=ok(c.createLeague({handle:'sean',auth:'h1',name:'Slap Down',mode:'keepers',
    rosterSize:opts.rosterSize||3, benchSize:opts.benchSize||0, farmSize:opts.farmSize||1}),'createLeague');
  ok(c.joinLeague({handle:'mika',auth:'h2',code:cr.inviteCode}),'mika joins');
  ok(c.joinLeague({handle:'dave',auth:'h3',code:cr.inviteCode}),'dave joins');
  return {c, id:cr.id, code:cr.inviteCode};
}
/* run a whole draft to completion, letting the clock auto-pick nothing */
function draftAll(c,id){
  let guard=0;
  for(;;){
    const st=c.draftState(id);
    if (st.league.draftStatus!=='active') break;
    if (++guard>400) throw new Error('draft never completed');
    const who=st.turn.handle;
    const taken={}; c.draftPicksOf(id).forEach(p=>taken[p.rikishi.toLowerCase()]=1);
    const pool=(st.turn.phase==='juryo'?JUR:MAK).filter(n=>!taken[n.toLowerCase()]);
    const r=c.makePick({handle:who,auth:{sean:'h1',mika:'h2',dave:'h3'}[who],id:id,rikishi:pool[0]});
    assert.ok(r.ok,'pick for '+who+': '+JSON.stringify(r));
  }
  return c.leagueRow(id);
}

/* ===================================================================== */
section('setup on an empty spreadsheet');
t('setup() creates every sheet the league code reads', ()=>{
  const c=makeCtx();
  ['Users','Results','Meta','Leagues','LeagueMembers','Messages','LeagueTeams','TeamHistory',
   'Rankings','KeeperRosters','DraftPicks','Trades','Champions','DraftBoards']
    .forEach(n=>assert.ok(c.__store[n],'missing sheet '+n));
  assert.strictEqual(c.readMeta().basho,'Aki 2026','Meta seeds the current basho');
});
t('setup() is idempotent', ()=>{
  const c=makeCtx(); const before=c.__store.Meta.rows.length;
  c.setup(); assert.strictEqual(c.__store.Meta.rows.length,before,'a second setup did not duplicate Meta rows');
});

section('accounts');
t('register / login / duplicate handle', ()=>{
  const c=makeCtx();
  ok(c.register({handle:'sean',auth:'h1',name:'Sean'}),'register');
  no(c.register({handle:'SEAN',auth:'zz',name:'Imposter'}),'handle is case-insensitively taken');
  ok(c.login({handle:'sean',auth:'h1'}),'login');
  no(c.login({handle:'sean',auth:'wrong'}),'wrong PIN');
  no(c.login({handle:'nobody',auth:'h1'}),'unknown handle');
});
t('the reserved admin handle cannot be claimed', ()=>{
  const c=makeCtx();
  no(c.register({handle:'Sumo Slapdown',auth:'x'}),'reserved handle');
});

section('league creation and membership');
t('create, invite-join, and read back', ()=>{
  const {c,id,code}=fresh();
  const d=ok(c.leagueDetail(id,'sean'),'leagueDetail');
  assert.strictEqual(d.members.length,3,'three members');
  assert.strictEqual(d.league.isCommissioner,true);
  assert.strictEqual(d.league.mode,'keepers');
  const inv=ok(c.leagueByInvite(code),'invite lookup');
  assert.strictEqual(inv.league.id,id);
  assert.strictEqual(c.myLeagues('mika').leagues.length,1,'shows up in My Leagues');
});
t('a new league row still answers for the v5 clock columns', ()=>{
  const {c,id}=fresh();
  const L=c.leagueRow(id);
  assert.strictEqual(L.pickClock,c.PICK_CLOCK_DEFAULT,'blank pickClock falls back to the default');
  assert.strictEqual(L.pickDeadline,'');
  assert.strictEqual(L.defaultOrder,null);
});
t('join is idempotent, and non-members are refused', ()=>{
  const {c,id,code}=fresh();
  const again=ok(c.joinLeague({handle:'mika',auth:'h2',code:code}),'re-join');
  assert.strictEqual(again.already,true);
  assert.strictEqual(c.membersOf(id).length,3,'no duplicate member row');
  no(c.agreeDraftDate({handle:'ghost',auth:'nope',id:id}),'unauthenticated');
});
t('only the commissioner can rename / remove / delete', ()=>{
  const {c,id}=fresh();
  no(c.renameLeague({handle:'mika',auth:'h2',id:id,name:'Hijack'}),'rename by a member');
  no(c.removeMember({handle:'mika',auth:'h2',id:id,member:'dave'}),'remove by a member');
  no(c.deleteLeague({handle:'mika',auth:'h2',id:id}),'delete by a member');
  no(c.leaveLeague({handle:'sean',auth:'h1',id:id}),'commissioner cannot leave');
  ok(c.leaveLeague({handle:'dave',auth:'h3',id:id}),'a member can leave');
  assert.strictEqual(c.membersOf(id).length,2);
});

section('league settings');
t('roster sizes clamp and warn when the pool is too thin', ()=>{
  const {c,id}=fresh();
  const r=ok(c.setLeagueRoster({handle:'sean',auth:'h1',id:id,rosterSize:6,benchSize:2,farmSize:4}),'set roster');
  assert.strictEqual(r.rosterSize,6); assert.strictEqual(r.benchSize,2); assert.strictEqual(r.farmSize,4);
  const w=ok(c.setLeagueRoster({handle:'sean',auth:'h1',id:id,rosterSize:12,benchSize:8,farmSize:10}),'oversized');
  assert.ok(w.warn,'a too-big roster warns the commissioner: '+w.warn);
});
t('scoring round-trips and is clamped', ()=>{
  const {c,id}=fresh();
  const r=ok(c.setLeagueScoring({handle:'sean',auth:'h1',id:id,scoring:{winPoint:99,yusho:3,sansho:0,sanyakuBonus:2}}),'set scoring');
  assert.strictEqual(r.scoring.winPoint,6,'point-per-win is capped at 6');
  assert.strictEqual(r.scoring.yusho,3,'other rules survive');
  assert.strictEqual(c.leagueRow(id).scoring.winPoint,6,'persisted');
  const zero=ok(c.setLeagueScoring({handle:'sean',auth:'h1',id:id,scoring:{winPoint:0,sansho:0}}),'floor');
  assert.strictEqual(zero.scoring.winPoint,1,'a win is always worth at least a point');
});
t('draft date: setting resets agreement, agreeing counts', ()=>{
  const {c,id}=fresh();
  ok(c.setDraftDate({handle:'sean',auth:'h1',id:id,draftDate:'2026-09-10T19:00'}),'set date');
  let d=c.leagueDetail(id,'sean');
  assert.strictEqual(d.league.draftAgreedCount,1,'the commissioner agrees to their own date');
  ok(c.agreeDraftDate({handle:'mika',auth:'h2',id:id}),'mika agrees');
  ok(c.agreeDraftDate({handle:'dave',auth:'h3',id:id}),'dave agrees');
  assert.strictEqual(c.leagueDetail(id,'sean').league.draftAgreedCount,3,'all three');
  ok(c.setDraftDate({handle:'sean',auth:'h1',id:id,draftDate:'2026-09-11T19:00'}),'move the date');
  assert.strictEqual(c.leagueDetail(id,'sean').league.draftAgreedCount,1,'a new date needs fresh sign-off');
  ok(c.agreeDraftDate({handle:'mika',auth:'h2',id:id,agree:false}),'withdraw');
  assert.strictEqual(c.leagueDetail(id,'mika').league.iAgreedDraft,false);
});

section('draft boards set before draft day');
t('a member saves a board; only they can read it back', ()=>{
  const {c,id}=fresh();
  ok(c.saveDraftBoard({handle:'mika',auth:'h2',id:id,makuuchi:['Atamifuji','Onosato'],juryo:['Kazuma'],auto:true}),'save board');
  const mine=c.leagueDetail(id,'mika').members.find(m=>m.handle==='mika');
  assert.ok(mine.draftBoard,'mika sees her own board');
  assert.strictEqual(mine.draftBoard.makuuchi[0],'Atamifuji');
  assert.strictEqual(mine.draftBoard.auto,true);
  const asSean=c.leagueDetail(id,'sean').members.find(m=>m.handle==='mika');
  assert.strictEqual(asSean.draftBoard,null,'sean cannot read mika\'s order');
  assert.strictEqual(asSean.boardSet,true,'but he can see that she set one');
});
t('re-saving replaces rather than appends', ()=>{
  const {c,id}=fresh();
  c.saveDraftBoard({handle:'mika',auth:'h2',id:id,makuuchi:['Onosato'],juryo:[],auto:false});
  c.saveDraftBoard({handle:'mika',auth:'h2',id:id,makuuchi:['Hoshoryu'],juryo:[],auto:true});
  const rows=c.__store.DraftBoards.rows.filter(r=>r[0]===id&&r[1]==='mika');
  assert.strictEqual(rows.length,1,'one row per member');
  assert.strictEqual(c.draftBoardsOf(id).mika.makuuchi[0],'Hoshoryu');
});
t('a non-member cannot save a board into the league', ()=>{
  const {c,id}=fresh();
  ok(c.register({handle:'randy',auth:'h9',name:'Randy'}),'register outsider');
  no(c.saveDraftBoard({handle:'randy',auth:'h9',id:id,makuuchi:['Onosato'],juryo:[],auto:true}),'outsider board');
});

section('starting the draft');
t('classic leagues, solo leagues and non-commissioners are refused', ()=>{
  const {c,id}=fresh();
  no(c.startDraft({handle:'mika',auth:'h2',id:id,pool:{makuuchi:MAK,juryo:JUR}}),'not the commissioner');
  ok(c.setLeagueMode({handle:'sean',auth:'h1',id:id,mode:'classic'}),'to classic');
  no(c.startDraft({handle:'sean',auth:'h1',id:id,pool:{makuuchi:MAK,juryo:JUR}}),'classic mode');
});
t('startDraft snapshots the pool, sets the clock and the first deadline', ()=>{
  const {c,id}=fresh();
  const r=ok(c.startDraft({handle:'sean',auth:'h1',id:id,pickClock:90,pool:{makuuchi:MAK,juryo:JUR}}),'start');
  assert.strictEqual(r.order.length,3,'every member is in the order');
  assert.strictEqual(r.pickClock,90);
  const L=c.leagueRow(id);
  assert.strictEqual(L.draftStatus,'active');
  assert.ok(new Date(L.pickDeadline).getTime()>Date.now(),'deadline in the future');
  assert.strictEqual(JSON.stringify(L.defaultOrder.makuuchi),JSON.stringify(MAK),'banzuke snapshot stored');
  no(c.startDraft({handle:'sean',auth:'h1',id:id,pool:{makuuchi:MAK,juryo:JUR}}),'double start');
  no(c.setLeagueRoster({handle:'sean',auth:'h1',id:id,rosterSize:5}),'roster locked mid-draft');
});

section('drafting');
t('a full snake draft completes and fills every roster', ()=>{
  const {c,id}=fresh({rosterSize:3,benchSize:0,farmSize:1});
  ok(c.startDraft({handle:'sean',auth:'h1',id:id,pickClock:3600,pool:{makuuchi:MAK,juryo:JUR}}),'start');
  const L=draftAll(c,id);
  assert.strictEqual(L.draftStatus,'complete','draft completed');
  const ros=c.keeperRostersOf(id);
  ['sean','mika','dave'].forEach(h=>{
    assert.strictEqual(ros[h].makuuchi.length,3,h+' has 3 Makuuchi');
    assert.strictEqual(ros[h].juryo.length,1,h+' has 1 Juryo');
  });
  const all=c.draftPicksOf(id).map(p=>p.rikishi.toLowerCase());
  assert.strictEqual(new Set(all).size,all.length,'nobody was drafted twice');
});
t('the draft snakes: round 2 reverses round 1', ()=>{
  const {c,id}=fresh({rosterSize:3,farmSize:1});
  const r=ok(c.startDraft({handle:'sean',auth:'h1',id:id,pickClock:3600,pool:{makuuchi:MAK,juryo:JUR}}),'start');
  draftAll(c,id);
  const picks=c.draftPicksOf(id).filter(p=>p.phase==='makuuchi').sort((a,b)=>a.pickIndex-b.pickIndex);
  const r1=picks.slice(0,3).map(p=>p.handle), r2=picks.slice(3,6).map(p=>p.handle);
  assert.strictEqual(JSON.stringify(r1),JSON.stringify(r.order),'round 1 is the draft order');
  assert.strictEqual(JSON.stringify(r2),JSON.stringify(r.order.slice().reverse()),'round 2 snakes back');
});
t('out-of-turn, duplicate and unauthenticated picks are refused', ()=>{
  const {c,id}=fresh({rosterSize:2,farmSize:1});
  ok(c.startDraft({handle:'sean',auth:'h1',id:id,pickClock:3600,pool:{makuuchi:MAK,juryo:JUR}}),'start');
  const onClock=c.draftState(id).turn.handle;
  const other=['sean','mika','dave'].find(h=>h!==onClock);
  const auth={sean:'h1',mika:'h2',dave:'h3'};
  no(c.makePick({handle:other,auth:auth[other],id:id,rikishi:'Onosato'}),'out of turn');
  no(c.makePick({handle:onClock,auth:'bogus',id:id,rikishi:'Onosato'}),'bad auth');
  ok(c.makePick({handle:onClock,auth:auth[onClock],id:id,rikishi:'Onosato'}),'legit pick');
  const next=c.draftState(id).turn.handle;
  no(c.makePick({handle:next,auth:auth[next],id:id,rikishi:'onosato'}),'already drafted (case-insensitive)');
});
t('an expired clock auto-picks from the absent member\'s own board', ()=>{
  const {c,id}=fresh({rosterSize:2,farmSize:1});
  ok(c.saveDraftBoard({handle:'mika',auth:'h2',id:id,makuuchi:['Tamawashi'],juryo:[],auto:false}),'mika board');
  ok(c.saveDraftBoard({handle:'dave',auth:'h3',id:id,makuuchi:['Ura'],juryo:[],auto:false}),'dave board');
  ok(c.saveDraftBoard({handle:'sean',auth:'h1',id:id,makuuchi:['Abi'],juryo:[],auto:false}),'sean board');
  ok(c.startDraft({handle:'sean',auth:'h1',id:id,pickClock:60,pool:{makuuchi:MAK,juryo:JUR}}),'start');
  const who=c.draftState(id).turn.handle;
  // rewind the deadline into the past, as if the pick window had elapsed
  const L=c.leagueRow(id);
  c.__store.Leagues.getRange(L.row,18).setValue(new Date(Date.now()-1000).toISOString());
  const st=c.draftState(id);
  const picks=c.draftPicksOf(id);
  assert.ok(picks.length>=1,'a pick was awarded');
  assert.strictEqual(picks[0].handle,who,'to the member who was on the clock');
  assert.strictEqual(picks[0].rikishi,{mika:'Tamawashi',dave:'Ura',sean:'Abi'}[who],'off their own board');
  assert.notStrictEqual(st.turn.handle,who,'and the clock moved on');
});
t('a member with no board auto-picks off the banzuke snapshot', ()=>{
  const {c,id}=fresh({rosterSize:2,farmSize:1});
  ok(c.startDraft({handle:'sean',auth:'h1',id:id,pickClock:60,pool:{makuuchi:MAK,juryo:JUR}}),'start');
  const L=c.leagueRow(id);
  c.__store.Leagues.getRange(L.row,18).setValue(new Date(Date.now()-1000).toISOString());
  c.draftState(id);
  assert.strictEqual(c.draftPicksOf(id)[0].rikishi,MAK[0],'took the top of the banzuke');
});
t('a wholly abandoned draft still fills every roster, one clock at a time', ()=>{
  const {c,id}=fresh({rosterSize:2,farmSize:1});
  ok(c.startDraft({handle:'sean',auth:'h1',id:id,pickClock:60,pool:{makuuchi:MAK,juryo:JUR}}),'start');
  const L=c.leagueRow(id);
  c.__store.Leagues.getRange(L.row,18).setValue(new Date(Date.now()-1000).toISOString());
  let guard=0, st=c.draftState(id);
  while (st.league.draftStatus==='active'){
    if (++guard>60) throw new Error('an abandoned draft never finished');
    const L2=c.leagueRow(id);
    c.__store.Leagues.getRange(L2.row,18).setValue(new Date(Date.now()-1000).toISOString());
    st=c.draftState(id);
  }
  assert.strictEqual(st.league.draftStatus,'complete','everyone timed out and the draft finished');
  const ros=c.keeperRostersOf(id);
  ['sean','mika','dave'].forEach(h=>{
    assert.strictEqual(ros[h].makuuchi.length,2,h+' still got a full Makuuchi roster');
    assert.strictEqual(ros[h].juryo.length,1,h+' still got a farm pick');
  });
  const all=c.draftPicksOf(id).map(p=>p.rikishi.toLowerCase());
  assert.strictEqual(new Set(all).size,all.length,'no duplicates in the auto-drafted rosters');
});

section('after the draft');
function drafted(opts){
  const w=fresh(opts||{rosterSize:3,benchSize:1,farmSize:1});
  ok(w.c.startDraft({handle:'sean',auth:'h1',id:w.id,pickClock:3600,pool:{makuuchi:MAK,juryo:JUR}}),'start');
  draftAll(w.c,w.id);
  return w;
}
t('drafted Makuuchi start active; setActive respects the cap', ()=>{
  const {c,id}=drafted({rosterSize:3,benchSize:1,farmSize:1});
  const ros=c.keeperRostersOf(id);
  assert.strictEqual(ros.sean.makuuchi.length,4,'3 active + 1 bench drafted');
  assert.strictEqual(ros.sean.active.length,3,'the draft benches the 4th pick rather than starting it');
  no(c.setActive({handle:'sean',auth:'h1',id:id,active:ros.sean.makuuchi}),'starting 4 with a cap of 3');
  ok(c.setActive({handle:'sean',auth:'h1',id:id,active:ros.sean.makuuchi.slice(0,3)}),'starting 3');
  assert.strictEqual(c.keeperRostersOf(id).sean.active.length,3,'lineup stored');
});
t('trades move ownership both ways and only the recipient can accept', ()=>{
  const {c,id}=drafted();
  const ros=c.keeperRostersOf(id);
  const mine=ros.sean.makuuchi[0], hers=ros.mika.makuuchi[0];
  no(c.proposeTrade({handle:'sean',auth:'h1',id:id,toHandle:'mika',offer:[hers],request:[mine]}),'offering what you do not own');
  const tr=ok(c.proposeTrade({handle:'sean',auth:'h1',id:id,toHandle:'mika',offer:[mine],request:[hers]}),'propose');
  no(c.respondTrade({handle:'dave',auth:'h3',tradeId:tr.id,accept:true}),'a third party accepting');
  no(c.respondTrade({handle:'sean',auth:'h1',tradeId:tr.id,accept:true}),'the proposer accepting his own');
  ok(c.respondTrade({handle:'mika',auth:'h2',tradeId:tr.id,accept:true}),'mika accepts');
  const after=c.keeperRostersOf(id);
  assert.ok(after.mika.makuuchi.includes(mine),'mika got sean\'s man');
  assert.ok(after.sean.makuuchi.includes(hers),'sean got mika\'s');
  no(c.respondTrade({handle:'mika',auth:'h2',tradeId:tr.id,accept:true}),'accepting twice');
});
t('add/drop swaps an unowned rikishi in', ()=>{
  const {c,id}=drafted();
  const ros=c.keeperRostersOf(id);
  const drop=ros.sean.makuuchi[0];
  const owned={}; Object.keys(ros).forEach(h=>ros[h].makuuchi.forEach(n=>owned[n.toLowerCase()]=1));
  const add=MAK.find(n=>!owned[n.toLowerCase()]);
  no(c.addDrop({handle:'mika',auth:'h2',id:id,drop:drop,add:add}),'dropping someone else\'s man');
  no(c.addDrop({handle:'sean',auth:'h1',id:id,drop:drop,add:ros.mika.makuuchi[0]}),'adding an owned man');
  ok(c.addDrop({handle:'sean',auth:'h1',id:id,drop:drop,add:add}),'legit waiver');
  const after=c.keeperRostersOf(id);
  assert.ok(!after.sean.makuuchi.includes(drop),'dropped');
  assert.ok(after.sean.makuuchi.includes(add),'added');
});
t('the tournament locks lineups, trades and waivers', ()=>{
  const {c,id}=drafted();
  const ros=c.keeperRostersOf(id);
  c.__store.Results.appendRow([1,'Makuuchi','Onosato','Hoshoryu','Onosato','yorikiri']);
  assert.strictEqual(c.tournamentActive(),true,'a day-1 result opens the tournament');
  no(c.setActive({handle:'sean',auth:'h1',id:id,active:ros.sean.makuuchi.slice(0,3)}),'lineup locked');
  no(c.proposeTrade({handle:'sean',auth:'h1',id:id,toHandle:'mika',offer:[ros.sean.makuuchi[0]],request:[]}),'trade locked');
  no(c.addDrop({handle:'sean',auth:'h1',id:id,drop:ros.sean.makuuchi[0],add:'Nobody'}),'waiver locked');
  // day 15 closes it again
  const meta=c.__store.Meta;
  for(let r=1;r<meta.rows.length;r++) if(meta.rows[r][0]==='lastDay') meta.rows[r][1]=15;
  assert.strictEqual(c.tournamentActive(),false,'day 15 reopens the offseason');
  ok(c.setActive({handle:'sean',auth:'h1',id:id,active:ros.sean.makuuchi.slice(0,3)}),'lineup unlocked again');
});

section('archiving, standings and champions');
t('archiveTeam upserts on (handle, basho) and feeds history', ()=>{
  const {c}=fresh();
  ok(c.archiveTeam({handle:'sean',auth:'h1',basho:'Aki 2026',team:{a:1},score:40,wins:30}),'archive');
  ok(c.archiveTeam({handle:'sean',auth:'h1',basho:'Aki 2026',team:{a:2},score:44,wins:33}),'re-archive');
  const h=c.myHistory('sean');
  assert.strictEqual(h.length,1,'one row per basho');
  assert.strictEqual(h[0].wins,33,'updated in place');
});
t('keeperStandings orders members worst-first for the next draft', ()=>{
  const {c,id}=drafted();
  const ros=c.keeperRostersOf(id);
  // give sean's actives some wins, dave's none
  ros.sean.active.slice(0,3).forEach((n,i)=>c.__store.Results.appendRow([i+1,'Makuuchi',n,'Nobody',n,'yorikiri']));
  const st=c.keeperStandings(id);
  assert.strictEqual(st.length,3,'every member is ranked');
  assert.strictEqual(st[st.length-1],'sean','the winningest team picks last');
});
t('champions are awarded once and are idempotent', ()=>{
  const {c,id}=drafted();
  ok(c.archiveTeam({handle:'sean',auth:'h1',basho:'Aki 2026',team:{Onosato:1},score:60,wins:12}),'archive sean');
  ok(c.archiveTeam({handle:'mika',auth:'h2',basho:'Aki 2026',team:{Hoshoryu:1},score:30,wins:6}),'archive mika');
  const r1=c.applyBashoRanking('Aki 2026',{});
  assert.ok(r1.ok,'first ranking run: '+JSON.stringify(r1));
  const n=c.__store.Champions.rows.length;
  const r2=c.applyBashoRanking('Aki 2026',{});
  assert.strictEqual(r2.already,true,'second run is a no-op');
  assert.strictEqual(c.__store.Champions.rows.length,n,'no duplicate trophies');
});

section('edge cases that only bite on draft day / mid-basho');
t('a waiver add does not sneak an extra man into the starting lineup', ()=>{
  const {c,id}=drafted({rosterSize:3,benchSize:1,farmSize:1});
  const ros=c.keeperRostersOf(id);
  ok(c.setActive({handle:'sean',auth:'h1',id:id,active:ros.sean.active.slice(0,3)}),'set a legal lineup');
  const before=c.keeperRostersOf(id).sean.active.length;
  const owned={}; Object.keys(ros).forEach(h=>ros[h].makuuchi.forEach(n=>owned[n.toLowerCase()]=1));
  const add=MAK.find(n=>!owned[n.toLowerCase()]);
  ok(c.addDrop({handle:'sean',auth:'h1',id:id,drop:ros.sean.active[0],add:add}),'waiver');
  const after=c.keeperRostersOf(id).sean.active;
  assert.strictEqual(after.length,before,'still '+before+' starters, got '+after.length+' ('+after.join(', ')+')');
});
t('a member cannot be dropped out of a draft that is already running', ()=>{
  const {c,id}=fresh({rosterSize:2,farmSize:1});
  ok(c.startDraft({handle:'sean',auth:'h1',id:id,pickClock:3600,pool:{makuuchi:MAK,juryo:JUR}}),'start');
  const victim=c.leagueRow(id).draftOrder.find(h=>h!=='sean');
  const r=c.removeMember({handle:'sean',auth:'h1',id:id,member:victim});
  if (r.ok){
    const L=c.leagueRow(id);
    assert.ok(!L.draftOrder.includes(victim),
      'removed '+victim+' but the draft order still calls on them: '+JSON.stringify(L.draftOrder));
  }
});
t('a member cannot walk out of a draft that is already running', ()=>{
  const {c,id}=fresh({rosterSize:2,farmSize:1});
  ok(c.startDraft({handle:'sean',auth:'h1',id:id,pickClock:3600,pool:{makuuchi:MAK,juryo:JUR}}),'start');
  const r=c.leaveLeague({handle:'mika',auth:'h2',id:id});
  if (r.ok){
    const L=c.leagueRow(id);
    assert.ok(!L.draftOrder.includes('mika'),
      'mika left mid-draft but is still in the order: '+JSON.stringify(L.draftOrder));
  }
});
t('the auto-drafter never hands out a rikishi someone already owns', ()=>{
  const {c,id}=fresh({rosterSize:3,farmSize:1});
  // everyone's board leads with the same man
  ['sean','mika','dave'].forEach((h,i)=>c.saveDraftBoard({handle:h,auth:['h1','h2','h3'][i],id:id,
    makuuchi:['Onosato','Hoshoryu'],juryo:['Kazuma'],auto:true}));
  ok(c.startDraft({handle:'sean',auth:'h1',id:id,pickClock:30,pool:{makuuchi:MAK,juryo:JUR}}),'start');
  let guard=0, st=c.draftState(id);
  while (st.league.draftStatus==='active'){
    if (++guard>60) throw new Error('never finished');
    const L=c.leagueRow(id);
    c.__store.Leagues.getRange(L.row,18).setValue(new Date(Date.now()-1000).toISOString());
    st=c.draftState(id);
  }
  const all=c.draftPicksOf(id).map(p=>p.rikishi.toLowerCase());
  assert.strictEqual(new Set(all).size,all.length,'identical boards still produced unique picks');
});
t('a draft started before the clock shipped still runs (blank v5 columns)', ()=>{
  const {c,id}=fresh({rosterSize:2,farmSize:1});
  ok(c.startDraft({handle:'sean',auth:'h1',id:id,pickClock:3600,pool:{makuuchi:MAK,juryo:JUR}}),'start');
  const L=c.leagueRow(id);
  // wipe the three v5 columns, as they are on a league that was mid-draft at the deploy
  c.__store.Leagues.getRange(L.row,17,1,3).setValues([['','','']]);
  const st=c.draftState(id);
  assert.strictEqual(st.league.draftStatus,'active','still readable');
  assert.ok(st.turn.handle,'someone is still on the clock');
  assert.strictEqual(st.deadline,'','no deadline, so nothing auto-fires');
  const who=st.turn.handle;
  ok(c.makePick({handle:who,auth:{sean:'h1',mika:'h2',dave:'h3'}[who],id:id,rikishi:'Onosato'}),'manual picks still work');
  assert.ok(c.leagueRow(id).pickDeadline,'and the clock starts from the next pick');
});
t('the draft stops short rather than overdrafting a thin pool', ()=>{
  const {c,id}=fresh({rosterSize:12,benchSize:8,farmSize:10});
  ok(c.setLeagueRoster({handle:'sean',auth:'h1',id:id,rosterSize:12,benchSize:8,farmSize:10}),'ask for a huge roster');
  const r=ok(c.startDraft({handle:'sean',auth:'h1',id:id,pickClock:3600,pool:{makuuchi:MAK,juryo:JUR}}),'start');
  assert.ok(r.rosterSize+r.benchSize<=Math.floor(42/3),'Makuuchi roster clamped to the pool: '+JSON.stringify(r));
  assert.ok(r.farmSize<=Math.floor(28/3),'farm clamped to the pool: '+r.farmSize);
});

section('rolling the sheet over to a new basho');
t('the reset refuses until the finished basho has been ranked', ()=>{
  const c=makeCtx();
  c.__store.Results.appendRow([15,'Makuuchi','Onosato','Hoshoryu','Onosato','yorikiri']);
  c.setMeta_('basho','Nagoya 2026'); c.setMeta_('lastDay',15);
  const r=c.adminResetBasho({adminKey:'test',basho:'Aki 2026'});
  assert.strictEqual(r.ok,false,'refused');
  assert.strictEqual(r.needsRanking,true,'and says why: '+r.error);
  assert.strictEqual(c.__store.Results.rows.length,2,'nothing was cleared');
});
t('once ranked, the reset clears Results and every Meta row that carries over', ()=>{
  const c=makeCtx();
  for(let d=1;d<=15;d++) c.__store.Results.appendRow([d,'Makuuchi','Onosato','Hoshoryu','Onosato','yorikiri']);
  c.setMeta_('basho','Nagoya 2026'); c.setMeta_('lastDay',15);
  c.setMeta_('yusho','Onosato'); c.setMeta_('sansho','Aonishiki, Kotoshoho');
  c.setMeta_('rankedBasho','Nagoya 2026');
  const r=c.adminResetBasho({adminKey:'test',basho:'Aki 2026'});
  assert.ok(r.ok,JSON.stringify(r));
  assert.strictEqual(r.clearedRows,15);
  assert.strictEqual(c.__store.Results.rows.length,1,'header only');
  const m=c.readMeta();
  assert.strictEqual(m.basho,'Aki 2026');
  assert.strictEqual(Number(m.lastDay),0);
  assert.strictEqual(String(m.yusho),'','last basho\'s champion no longer pays out');
  assert.strictEqual(String(m.sansho),'');
  assert.strictEqual(c.tournamentActive(),false,'and the offseason is open again');
});
t('force skips the ranking guard', ()=>{
  const c=makeCtx();
  c.__store.Results.appendRow([15,'Makuuchi','Onosato','Hoshoryu','Onosato','yorikiri']);
  c.setMeta_('basho','Nagoya 2026');
  const r=c.adminResetBasho({adminKey:'test',basho:'Aki 2026',force:true});
  assert.ok(r.ok,JSON.stringify(r));
  assert.strictEqual(c.__store.Results.rows.length,1);
});
t('a bad admin key gets nowhere near the sheet', ()=>{
  const c=makeCtx();
  c.__store.Results.appendRow([15,'Makuuchi','Onosato','Hoshoryu','Onosato','yorikiri']);
  const r=c.adminResetBasho({adminKey:'nope',basho:'Aki 2026',force:true});
  assert.strictEqual(r.ok,false);
  assert.strictEqual(c.__store.Results.rows.length,2,'untouched');
});

section('deletion cascades');
t('deleting a league leaves nothing orphaned', ()=>{
  const {c,id}=drafted();
  c.saveDraftBoard({handle:'mika',auth:'h2',id:id,makuuchi:['Onosato'],juryo:[],auto:true});
  c.postMessage({handle:'sean',auth:'h1',id:id,body:'hello'});
  ok(c.deleteLeague({handle:'sean',auth:'h1',id:id}),'delete');
  assert.strictEqual(c.leagueRow(id),null,'league gone');
  ['LeagueMembers','KeeperRosters','DraftPicks','Messages','LeagueTeams','Trades','DraftBoards'].forEach(n=>{
    const left=c.__store[n].rows.slice(1).filter(r=>String(r[n==='Messages'?1:0])===id);
    assert.strictEqual(left.length,0,n+' still holds '+left.length+' orphaned row(s)');
  });
});

console.log('\n'+pass+' passed, '+fail+' failed');
if (fail) { console.log('failures: '+failures.join(' | ')); process.exit(1); }
