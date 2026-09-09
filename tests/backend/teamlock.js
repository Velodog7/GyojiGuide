/* The public seven-band team must be frozen for the whole of a basho.

   It is scored across all fifteen days, so a team edited on day 13 would be
   retroactively credited with the first twelve — and the leaderboard, the
   champion, the all-time ranking and the basho archive are all computed from
   it. The lock window is "result rows exist", which runs from day 1 until the
   admin's *New basho* clears them; that also covers the gap between day 15 and
   the archive, where an edit would be the thing that got archived. */
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
  const ctx={ SpreadsheetApp:{getActiveSpreadsheet(){return ss;}, flush(){}},
    PropertiesService:{getScriptProperties(){return {
      getProperty(k){ if (props[k]!==undefined) return props[k];
        return k==='ADMIN_KEY' ? 'test' : null; }, setProperty(k,v){props[k]=v;},
      deleteProperty(k){delete props[k];} };}},
    LockService:{getScriptLock(){return {waitLock(){},tryLock(){return true;},releaseLock(){}};}},
    UrlFetchApp:{fetch(){throw new Error('no net');}},
    CacheService:{getScriptCache(){const m={};return {get(k){return m[k]||null;},put(k,v){m[k]=v;},remove(k){delete m[k];},
      getAll(ks){const o={};ks.forEach(k=>{if(m[k]!=null)o[k]=m[k];});return o;},putAll(o){Object.keys(o).forEach(k=>m[k]=o[k]);}};}},
    ContentService:{createTextOutput(t){return {t,setMimeType(){return this;},getContent(){return t;}};},MimeType:{JSON:'json'}},
    Utilities:{formatDate(){return '';}},
    console,JSON,Math,Date,Number,String,Object,Array,isNaN,parseInt,parseFloat,RegExp,Error,
    __store:store };
  vm.createContext(ctx); vm.runInContext(SRC,ctx,{filename:'sumo-fantasy.gs'});
  ctx.setup();
  return ctx;
}

const TEAM_A = { sanyaku:'Onosato', m1:'Kotoshoho', m5:'Ura', m9:'Roga',
                 m13:'Asakoryu', any:'Kirishima', juryo:'Dewanoryu' };
const TEAM_B = { sanyaku:'Hoshoryu', m1:'Kotoeiho', m5:'Oshoma', m9:'Shishi',
                 m13:'Abi', any:'Takayasu', juryo:'Kazuma' };

let pass=0, fail=0;
function t(n,fn){ try{ fn(); console.log('  ok   '+n); pass++; }
  catch(e){ console.log('  FAIL '+n+'\n         '+e.message); fail++; } }

function world(){
  const c = makeCtx();
  c.register({handle:'ann', name:'Ann', auth:'h_ann'});
  c.saveTeam({handle:'ann', auth:'h_ann', team:TEAM_A});
  return c;
}
const teamOf = (c,h)=>{
  const v = c.__store['Users'].rows;
  for (let r=1;r<v.length;r++) if (String(v[r][0]).toLowerCase()===h) return JSON.parse(v[r][3]||'{}');
  return null;
};
function addResult(c, day){
  c.__store['Results'].appendRow([day,'makuuchi','Onosato','Hoshoryu','Onosato','yorikiri']);
}

t('before the basho a team saves normally', ()=>{
  const c = world();
  const r = c.saveTeam({handle:'ann', auth:'h_ann', team:TEAM_B});
  assert.ok(r && r.ok, JSON.stringify(r));
  assert.strictEqual(teamOf(c,'ann').sanyaku, 'Hoshoryu');
});

t('the first result row locks it', ()=>{
  const c = world();
  addResult(c, 1);
  const r = c.saveTeam({handle:'ann', auth:'h_ann', team:TEAM_B});
  assert.ok(r && !r.ok, 'the save was accepted mid-basho :: '+JSON.stringify(r));
  assert.ok(r.locked, 'refusal is not flagged as a lock: '+JSON.stringify(r));
  assert.ok(/locked/i.test(r.error||''), 'unhelpful error: '+r.error);
});

t('and the stored team is untouched', ()=>{
  const c = world();
  addResult(c, 1);
  c.saveTeam({handle:'ann', auth:'h_ann', team:TEAM_B});
  assert.strictEqual(teamOf(c,'ann').sanyaku, 'Onosato', 'the team was rewritten anyway');
});

t('day 13 — the case in the report — is refused', ()=>{
  const c = world();
  for (let d=1; d<=13; d++) addResult(c, d);
  const r = c.saveTeam({handle:'ann', auth:'h_ann', team:TEAM_B});
  assert.ok(r && !r.ok, JSON.stringify(r));
  assert.strictEqual(teamOf(c,'ann').sanyaku, 'Onosato');
});

t('still locked after day 15, before the archive runs', ()=>{
  const c = world();
  for (let d=1; d<=15; d++) addResult(c, d);
  c.__store['Meta'].appendRow(['lastDay', 15]);
  const r = c.saveTeam({handle:'ann', auth:'h_ann', team:TEAM_B});
  assert.ok(r && !r.ok, 'a finished basho let the team move :: '+JSON.stringify(r));
});

t('New basho clears the results and unlocks it', ()=>{
  const c = world();
  for (let d=1; d<=15; d++) addResult(c, d);
  c.__store['Meta'].appendRow(['rankedBasho', c.readMeta().basho]);
  const reset = c.adminResetBasho({adminKey:'test', basho:'Kyushu 2026', force:true});
  assert.ok(reset && reset.ok, 'reset failed :: '+JSON.stringify(reset));
  const r = c.saveTeam({handle:'ann', auth:'h_ann', team:TEAM_B});
  assert.ok(r && r.ok, 'still locked after New basho :: '+JSON.stringify(r));
  assert.strictEqual(teamOf(c,'ann').sanyaku, 'Hoshoryu');
});

t('a wrong PIN is still refused before the lock is even considered', ()=>{
  const c = world();
  addResult(c, 1);
  const r = c.saveTeam({handle:'ann', auth:'WRONG', team:TEAM_B});
  assert.ok(r && !r.ok);
  assert.ok(/authoris/i.test(r.error||''), 'lock message leaked over the auth error: '+r.error);
});

t('the lock does not touch league teams', ()=>{
  const c = world();
  addResult(c, 1);
  // saveLeagueTeam has its own tournamentActive() guard; it must not have been
  // collaterally broken by the new one
  assert.strictEqual(typeof c.saveLeagueTeam, 'function');
  assert.ok(c.teamsLocked_(), 'teamsLocked_ should be true with results present');
  assert.ok(c.tournamentActive(), 'tournamentActive should still be true mid-basho');
});

console.log('\n'+pass+' passed, '+fail+' failed');
if (fail) process.exit(1);
