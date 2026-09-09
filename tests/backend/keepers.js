/* The keeper roll-over: limits, the declaration window, the cut, and the
   hand-off to the supplemental re-draft. Real sumo-fantasy.gs in a Node vm
   over a fake Sheet and a fake sumo-api. */
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

/* a banzuke big enough for 3 members x (4 makuuchi + 3 juryo) with spares */
const MAK = ['Hoshoryu','Onosato','Kirishima','Kotozakura','Atamifuji','Aonishiki','Oho','Yoshinofuji',
  'Kotoshoho','Wakatakakage','Ura','Takayasu','Roga','Abi','Asakoryu','Tobizaru','Gonoyama','Shishi',
  'Daieisho','Hiradoumi','Churanoumi','Oshoma'];
const JUR = ['Dewanoryu','Tokihayate','Kazuma','Sadanoumi','Ryuden','Tomokaze','Kitanowaka','Enho',
  'Kayo','Shirokuma','Hitoshi','Kagayaki'];

function makeCtx(opts){
  opts = opts || {};
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
    UrlFetchApp:{ fetch(url){
      const body=(code,obj)=>({getResponseCode:()=>code, getContentText:()=>JSON.stringify(obj)});
      if (opts.offline) throw new Error('no net');
      const m = url.match(/\/banzuke\/(\w+)/);
      if (m){
        const list = m[1]==='Juryo' ? JUR : MAK;
        const drop = new Set(opts.demoted || []);          // wrestlers who left the top two divisions
        const live = list.filter(n=>!drop.has(n));
        return body(200, { east: live.filter((_,i)=>i%2===0).map(n=>({shikonaEn:n, rank:'x'})),
                           west: live.filter((_,i)=>i%2===1).map(n=>({shikonaEn:n, rank:'x'})) });
      }
      return body(404,{});
    }},
    CacheService:{getScriptCache(){const m={};return {get(k){return m[k]||null;},put(k,v){m[k]=v;},remove(k){delete m[k];}};}},
    ContentService:{createTextOutput(t){return {t,setMimeType(){return this;},getContent(){return t;}};},MimeType:{JSON:'json'}},
    Utilities:{formatDate(){return '';}},
    console,JSON,Math,Date,Number,String,Object,Array,isNaN,parseInt,parseFloat,RegExp,Error,
    __store:store };
  vm.createContext(ctx); vm.runInContext(SRC,ctx,{filename:'sumo-fantasy.gs'});
  ctx.setup();
  return ctx;
}

const AUTH = {sean:'h0', mika:'h1', dave:'h2'};
function ok(r,m){ assert.ok(r && r.ok, m+' :: '+JSON.stringify(r)); return r; }
function no(r,m){ assert.ok(r && !r.ok, m+' — expected refusal, got '+JSON.stringify(r)); return r; }

/* a drafted keeper league: 3 members, 4 Makuuchi (3 active + 1 bench) + 3 farm each */
function league(opts){
  opts = opts || {};
  const c = makeCtx(opts);
  ['sean','mika','dave'].forEach(h => ok(c.register({handle:h,auth:AUTH[h],name:h}),'register '+h));
  const cr = ok(c.createLeague({handle:'sean',auth:AUTH.sean,name:'Stable Wars',mode:'keepers',
    rosterSize:3, benchSize:1, farmSize:3}),'create');
  ok(c.joinLeague({handle:'mika',auth:AUTH.mika,code:cr.inviteCode}),'mika joins');
  ok(c.joinLeague({handle:'dave',auth:AUTH.dave,code:cr.inviteCode}),'dave joins');

  // hand out rosters directly, as a completed draft would have
  const sh = c.__store.KeeperRosters;
  const now = new Date().toISOString();
  const who = ['sean','mika','dave'];
  who.forEach((h,i)=>{
    MAK.slice(i*4,i*4+4).forEach((n,j)=> sh.appendRow([cr.id,h,n,'makuuchi','draft',now, j<3?'active':'bench']));
    JUR.slice(i*3,i*3+3).forEach(n     => sh.appendRow([cr.id,h,n,'juryo','draft',now,'farm']));
  });
  c.sh_('Leagues').getRange(c.leagueRow(cr.id).row, 8).setValue('complete');
  return { c, id: cr.id };
}
/* results so "best by wins" is unambiguous: earlier in MAK/JUR = more wins */
function seedResults(c, weights){
  const sh = c.__store.Results;
  Object.keys(weights).forEach(n=>{
    for (let i=0;i<weights[n];i++) sh.appendRow([1,'Makuuchi',n,'Nobody',n,'yorikiri']);
  });
  // the roll-over happens AFTER the basho, so the day counter must say so —
  // tournamentActive() is (results exist && lastDay < 15)
  c.setMeta_('lastDay', 15);
}
function rosterOf(c,id,h){ const r=c.keeperRostersOf(id)[h]||{makuuchi:[],juryo:[]};
  return { mk:r.makuuchi.slice().sort(), jr:r.juryo.slice().sort() }; }

let pass=0, fail=0, failures=[];
function t(n,fn){ try{ fn(); console.log('  ok   '+n); pass++; }
  catch(e){ console.log('  FAIL '+n+'\n         '+e.message); fail++; failures.push(n); } }
function section(s){ console.log('\n— '+s+' —'); }

/* ================================================================= */
section('the setting');
t('defaults to no limit, so existing leagues are untouched', ()=>{
  const {c,id}=league();
  const L=c.leagueRow(id);
  assert.strictEqual(L.keepMk, null); assert.strictEqual(L.keepJr, null);
  assert.strictEqual(c.keeperPlan(L).limited, false);
  assert.strictEqual(c.leagueDetail(id,'sean').league.keepMk, null, 'exposed to the client as null');
});
t('commissioner can set limits AFTER the draft is complete', ()=>{
  const {c,id}=league();
  assert.strictEqual(c.leagueRow(id).draftStatus,'complete');
  const r=ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:2,keepJr:1}),'set');
  assert.strictEqual(r.keepMk,2); assert.strictEqual(r.keepJr,1);
  const L=c.leagueRow(id);
  assert.strictEqual(L.keepMk,2); assert.strictEqual(L.keepJr,1);
});
t('and before one, too', ()=>{
  const c=makeCtx();
  ok(c.register({handle:'sean',auth:AUTH.sean,name:'sean'}),'reg');
  const cr=ok(c.createLeague({handle:'sean',auth:AUTH.sean,name:'L',mode:'keepers',rosterSize:3,benchSize:1,farmSize:3}),'create');
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:cr.id,keepMk:2,keepJr:2}),'set pre-draft');
});
t('0 is a real answer and survives a round trip', ()=>{
  const {c,id}=league();
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:0,keepJr:0}),'zero');
  const L=c.leagueRow(id);
  assert.strictEqual(L.keepMk,0,'0 must not read back as null');
  assert.strictEqual(c.keeperPlan(L).limited,true,'0 is a limit, not an absence of one');
});
t('blank clears the limit back to keep-all', ()=>{
  const {c,id}=league();
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:2,keepJr:1}),'set');
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:'',keepJr:''}),'clear');
  assert.strictEqual(c.leagueRow(id).keepMk,null);
});
t('clamped to the roster, never above it', ()=>{
  const {c,id}=league();
  const r=ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:99,keepJr:99}),'huge');
  assert.strictEqual(r.keepMk,4,'makuuchi cap = active+bench');
  assert.strictEqual(r.keepJr,3,'juryo cap = farm');
});
t('only the commissioner, only keeper leagues', ()=>{
  const {c,id}=league();
  no(c.setLeagueKeepers({handle:'mika',auth:AUTH.mika,id:id,keepMk:2}),'non-commissioner');
  const c2=makeCtx();
  ok(c2.register({handle:'sean',auth:AUTH.sean,name:'s'}),'reg');
  const cl=ok(c2.createLeague({handle:'sean',auth:AUTH.sean,name:'C',mode:'classic'}),'classic');
  no(c2.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:cl.id,keepMk:2}),'classic league');
});

section('the declaration window');
t('needs a limit before it will open', ()=>{
  const {c,id}=league();
  no(c.openKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'no limit set');
});
t('opens, and members can declare', ()=>{
  const {c,id}=league();
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:2,keepJr:1}),'set');
  ok(c.openKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'open');
  assert.strictEqual(c.leagueRow(id).draftStatus,'keepers');
  const st=c.keeperState(id,'sean');
  assert.strictEqual(st.open,true);
  assert.strictEqual(st.mine.makuuchi.length,4);
  assert.strictEqual(st.waiting,3,'nobody has declared yet');
  ok(c.declareKeepers({handle:'sean',auth:AUTH.sean,id:id,keep:[MAK[0],MAK[1],JUR[0]]}),'declare');
  assert.strictEqual(c.keeperState(id,'sean').waiting,2);
});
t('over-declaring is refused, per division', ()=>{
  const {c,id}=league();
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:2,keepJr:1}),'set');
  ok(c.openKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'open');
  no(c.declareKeepers({handle:'sean',auth:AUTH.sean,id:id,keep:[MAK[0],MAK[1],MAK[2]]}),'3 in makuuchi');
  no(c.declareKeepers({handle:'sean',auth:AUTH.sean,id:id,keep:[JUR[0],JUR[1]]}),'2 in juryo');
});
t('you cannot keep someone else’s wrestler', ()=>{
  const {c,id}=league();
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:2,keepJr:1}),'set');
  ok(c.openKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'open');
  no(c.declareKeepers({handle:'sean',auth:AUTH.sean,id:id,keep:[MAK[4]]}),'mika owns that one');
});
t('re-declaring replaces rather than accumulates', ()=>{
  const {c,id}=league();
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:2,keepJr:1}),'set');
  ok(c.openKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'open');
  ok(c.declareKeepers({handle:'sean',auth:AUTH.sean,id:id,keep:[MAK[0],MAK[1]]}),'first');
  ok(c.declareKeepers({handle:'sean',auth:AUTH.sean,id:id,keep:[MAK[2]]}),'second');
  const rows=c.__store.KeeperKeeps.rows.slice(1).filter(r=>String(r[1]).toLowerCase()==='sean');
  assert.strictEqual(rows.length,1,'got '+rows.length+' rows, should be just the newest declaration');
  assert.strictEqual(rows[0][2],MAK[2]);
});
t('declarations are closed outside the window', ()=>{
  const {c,id}=league();
  no(c.declareKeepers({handle:'sean',auth:AUTH.sean,id:id,keep:[MAK[0]]}),'window not open');
});

section('the cut');
t('keeps what you declared and releases the rest', ()=>{
  const {c,id}=league();
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:2,keepJr:1}),'set');
  ok(c.openKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'open');
  ok(c.declareKeepers({handle:'sean',auth:AUTH.sean,id:id,keep:[MAK[2],MAK[3],JUR[2]]}),'sean picks his 2+1');
  ok(c.closeKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'close');
  const r=rosterOf(c,id,'sean');
  assert.ok(r.mk.indexOf(MAK[2])>=0 && r.mk.indexOf(MAK[3])>=0, 'kept the declared two: '+r.mk);
  assert.ok(r.jr.indexOf(JUR[2])>=0, 'kept the declared farm hand');
});
t('a member who never declares auto-keeps his best by wins', ()=>{
  const {c,id}=league();
  // mika owns MAK[4..7]; give MAK[6] and MAK[5] the wins
  seedResults(c, { [MAK[6]]:11, [MAK[5]]:9, [MAK[4]]:3, [MAK[7]]:1, [JUR[4]]:10, [JUR[3]]:2, [JUR[5]]:1 });
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:2,keepJr:1}),'set');
  ok(c.openKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'open');
  ok(c.closeKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'close with nobody declared');
  const r=rosterOf(c,id,'mika');
  assert.strictEqual(JSON.stringify(r.mk.slice().sort()), JSON.stringify([MAK[5],MAK[6]].sort()), 'kept the two winningest, got '+r.mk);
  assert.strictEqual(JSON.stringify(r.jr), JSON.stringify([JUR[4]]), 'kept the winningest farm hand, got '+r.jr);
});
t('the released wrestlers land back in the re-draft pool', ()=>{
  const {c,id}=league();
  seedResults(c, { [MAK[0]]:12, [MAK[1]]:10 });
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:1,keepJr:0}),'set');
  ok(c.openKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'open');
  const res=ok(c.closeKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'close');
  assert.strictEqual(c.leagueRow(id).draftStatus,'redraft','should hand straight over to the re-draft');
  const pool=c.redraftPool_(id).map(x=>x.name);
  assert.ok(pool.indexOf(MAK[1])>=0, 'a released Makuuchi wrestler must be draftable again');
  assert.ok(pool.indexOf(JUR[0])>=0, 'the whole farm was released (keepJr 0) so it must be in the pool');
  assert.ok(res.released.length>0, 'the close reports what it released');
});
t('keepJr 0 empties the farm; keepMk 0 empties Makuuchi', ()=>{
  const {c,id}=league();
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:0,keepJr:0}),'set');
  ok(c.openKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'open');
  ok(c.closeKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'close');
  ['sean','mika','dave'].forEach(h=>{
    const r=rosterOf(c,id,h);
    assert.strictEqual(r.mk.length,0,h+' should hold nobody: '+r.mk);
    assert.strictEqual(r.jr.length,0,h+' farm should be empty: '+r.jr);
  });
});
t('a limit in one division only leaves the other alone', ()=>{
  const {c,id}=league();
  seedResults(c, { [MAK[0]]:12 });
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:1,keepJr:''}),'makuuchi only');
  ok(c.openKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'open');
  ok(c.closeKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'close');
  const r=rosterOf(c,id,'sean');
  assert.strictEqual(r.mk.length,1,'makuuchi cut to 1');
  assert.strictEqual(r.jr.length,3,'farm untouched, got '+r.jr.length);
});
t('declaring fewer than the limit keeps only those', ()=>{
  const {c,id}=league();
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:3,keepJr:2}),'set');
  ok(c.openKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'open');
  ok(c.declareKeepers({handle:'sean',auth:AUTH.sean,id:id,keep:[MAK[0]]}),'keep just one');
  ok(c.closeKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'close');
  const r=rosterOf(c,id,'sean');
  assert.strictEqual(JSON.stringify(r.mk), JSON.stringify([MAK[0]]), 'got '+r.mk);
  assert.strictEqual(r.jr.length,0,'declared no farm hands, so none kept');
});

section('leagues with no limit behave exactly as before');
t('the re-draft still runs straight through', ()=>{
  const {c,id}=league({ demoted:[MAK[1]] });
  const r=ok(c.openSupplementalDraft({handle:'sean',auth:AUTH.sean,id:id}),'open redraft');
  assert.strictEqual(c.leagueRow(id).draftStatus,'redraft');
  assert.ok(r.released.indexOf(MAK[1])>=0,'still releases anyone who left the top two divisions');
  assert.strictEqual(rosterOf(c,id,'mika').mk.length,4,'everyone else is kept, as before');
});
t('with a limit set, the re-draft points at the keeper window instead', ()=>{
  const {c,id}=league();
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:2,keepJr:1}),'set');
  const r=no(c.openSupplementalDraft({handle:'sean',auth:AUTH.sean,id:id}),'refused');
  assert.ok(r.needsKeepers,'flagged so the UI can route the commissioner');
});

section('guards');
t('limits are locked once the roll-over is under way', ()=>{
  const {c,id}=league();
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:2,keepJr:1}),'set');
  ok(c.openKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'open');
  no(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:4,keepJr:3}),'mid-window');
});
t('only the commissioner opens or closes the window', ()=>{
  const {c,id}=league();
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:2,keepJr:1}),'set');
  no(c.openKeeperWindow({handle:'mika',auth:AUTH.mika,id:id}),'member opening');
  ok(c.openKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'open');
  no(c.closeKeeperWindow({handle:'mika',auth:AUTH.mika,id:id}),'member closing');
});
t('the window will not open during a tournament', ()=>{
  const {c,id}=league();
  seedResults(c,{ [MAK[0]]:1 });
  c.setMeta_('lastDay', 6);                      // day 6 of 15: the basho is still running
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:2,keepJr:1}),'set');
  no(c.openKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'mid-basho');
});
t('deleting the league takes its declarations with it', ()=>{
  const {c,id}=league();
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:2,keepJr:1}),'set');
  ok(c.openKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'open');
  ok(c.declareKeepers({handle:'sean',auth:AUTH.sean,id:id,keep:[MAK[0]]}),'declare');
  ok(c.deleteLeague({handle:'sean',auth:AUTH.sean,id:id}),'delete');
  assert.strictEqual(c.__store.KeeperKeeps.rows.slice(1).filter(r=>String(r[0])===String(id)).length,0);
});
t('closing twice is refused rather than cutting twice', ()=>{
  const {c,id}=league();
  ok(c.setLeagueKeepers({handle:'sean',auth:AUTH.sean,id:id,keepMk:2,keepJr:1}),'set');
  ok(c.openKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'open');
  ok(c.closeKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'close');
  no(c.closeKeeperWindow({handle:'sean',auth:AUTH.sean,id:id}),'second close');
});
t('setup() creates the declarations sheet', ()=>{
  const c=makeCtx();
  assert.ok(c.__store.KeeperKeeps,'KeeperKeeps missing');
  c.setup();
  assert.strictEqual(c.__store.KeeperKeeps.rows.length,1,'a second setup duplicated the header');
});

console.log('\n'+pass+' passed, '+fail+' failed');
if (fail){ console.log('failing: '+failures.join(', ')); process.exit(1); }
