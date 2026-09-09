/* The seven-picks-in-one-turn bug.

   The real cause is an Apps Script runtime behaviour: spreadsheet writes are
   buffered and only committed when the EXECUTION ends, which is after
   finally{} has released the script lock. A second request could take the lock
   and read the row the first one had already written but not yet committed.
   That buffering cannot be reproduced in a Node vm — the fake Sheet writes
   land immediately — so this file tests the two things that CAN be checked
   offline:

     1. structurally, that every lock in the file is released through unlock_,
        and that unlock_ flushes BEFORE it releases (order matters: flushing
        after the release fixes nothing);
     2. functionally, that makePick's turn guard refuses a second pick from the
        same member once the cursor has moved.

   Together those are the fix. (1) makes the guard in (2) read committed state.
*/
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const GS = process.env.GG_GS ||
  require('path').join(__dirname, '..', '..', 'sumo-fantasy.gs');
const PATH=GS;
const SRC = fs.readFileSync(PATH,'utf8');

let pass=0, fail=0;
function t(n,fn){ try{ fn(); console.log('  ok   '+n); pass++; }
  catch(e){ console.log('  FAIL '+n+'\n         '+e.message); fail++; } }

/* ---------- 1. structural ---------- */

t('no lock is released without going through unlock_', ()=>{
  // strip the helper itself, then nothing else may call releaseLock directly
  const body = SRC.replace(/function unlock_\(lock\)\{[\s\S]*?\n\}/, '');
  const stray = body.split('\n').map((l,i)=>[i+1,l])
    .filter(([n,l])=>/releaseLock\s*\(/.test(l));
  assert.strictEqual(stray.length, 0,
    'raw releaseLock at line(s) ' + stray.map(x=>x[0]).join(', '));
});

t('every lock taken is a lock released', ()=>{
  const taken = (SRC.match(/getScriptLock\(\)/g)||[]).length;
  // don't count the helper's own signature, `function unlock_(lock){`
  const freed = (SRC.match(/(?<!function )unlock_\((?:lock|lock0)\)/g)||[]).length;
  assert.strictEqual(taken, freed, taken+' locks taken but '+freed+' released');
});

t('unlock_ flushes before it releases, not after', ()=>{
  const m = SRC.match(/function unlock_\(lock\)\{[\s\S]*?\n\}/);
  assert.ok(m, 'unlock_ not found');
  const f = m[0].indexOf('SpreadsheetApp.flush');
  const r = m[0].indexOf('releaseLock');
  assert.ok(f >= 0, 'unlock_ never flushes');
  assert.ok(r >= 0, 'unlock_ never releases');
  assert.ok(f < r, 'flush() must run while the lock is still held');
});

/* ---------- 2. functional, over the real .gs ---------- */

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

/* the trace records what the script does with the lock, in order */
function makeCtx(trace){
  const store={};
  const ss={ getSheetByName(n){return store[n]||null;},
             insertSheet(n){store[n]=makeSheet(n,[]);return store[n];},
             getSheets(){return Object.keys(store).map(k=>store[k]);} };
  const props={};
  const ctx={ SpreadsheetApp:{ getActiveSpreadsheet(){return ss;},
                               flush(){ trace.push('flush'); } },
    PropertiesService:{getScriptProperties(){return {
      getProperty(k){ if (props[k]!==undefined) return props[k];
        return k==='ADMIN_KEY' ? 'test' : null; }, setProperty(k,v){props[k]=v;},
      deleteProperty(k){delete props[k];} };}},
    LockService:{getScriptLock(){return {
      waitLock(){ trace.push('lock'); }, tryLock(){ trace.push('lock'); return true; },
      releaseLock(){ trace.push('unlock'); } };}},
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

const MAK=['Onosato','Hoshoryu','Kotozakura','Aonishiki','Kirishima','Wakatakakage','Takayasu','Atamifuji',
  'Kotoshoho','Gonoyama','Oshoma','Hiradoumi','Ura','Abi','Tamawashi','Churanoumi'];
const JUR=['Dewanoryu','Kyokukaiyu','Daiseizan','Kazuma','Tokihayate','Shishi','Asakoryu','Fujiseiun'];

function world(trace){
  const c = makeCtx(trace);
  // a banzuke the draft can draw from
  const bz = c.__store['Rankings'];
  c.__RK = {};
  MAK.forEach(n=>c.__RK[n]='makuuchi'); JUR.forEach(n=>c.__RK[n]='juryo');
  // the .gs asks the live API for divisions; feed it from the fake instead
  c.fetchBanzukeTiers_ = function(){ return c.__RK; };
  c.rikishiDivision_ = function(n){ return c.__RK[n] || ''; };

  ['ann','bo','cy'].forEach(h=>c.register({handle:h,name:h,auth:'h_'+h}));
  const lg = c.createLeague({handle:'ann',auth:'h_ann',name:'Race',mode:'keepers',rosterSize:2});
  const id = lg.league ? lg.league.id : lg.id;
  const code = (lg.league||lg).inviteCode;
  c.joinLeague({handle:'bo',auth:'h_bo',code:code});
  c.joinLeague({handle:'cy',auth:'h_cy',code:code});
  return {c, id};
}

t('a second pick in the same turn is refused', ()=>{
  const trace=[]; const {c,id} = world(trace);
  const start = c.startDraft({handle:'ann',auth:'h_ann',id:id});
  assert.ok(start && start.ok, 'draft did not start :: '+JSON.stringify(start));
  const st = c.draftState(id, 'ann');
  const first = st.turn.handle;                       // whoever is genuinely on the clock
  const auth = 'h_' + first;
  const a = c.makePick({handle:first, auth:auth, id:id, rikishi:MAK[0]});
  assert.ok(a && a.ok, 'the legitimate pick was refused :: '+JSON.stringify(a));
  const b = c.makePick({handle:first, auth:auth, id:id, rikishi:MAK[1]});
  assert.ok(b && !b.ok, 'a SECOND pick in the same turn was accepted :: '+JSON.stringify(b));
  assert.ok(/not your turn/i.test(b.error||''), 'wrong refusal: '+b.error);
});

t('seven rapid picks land exactly one', ()=>{
  const trace=[]; const {c,id} = world(trace);
  c.startDraft({handle:'ann',auth:'h_ann',id:id});
  const first = c.draftState(id,'ann').turn.handle;
  let taken = 0;
  for (let i=0;i<7;i++){
    const r = c.makePick({handle:first, auth:'h_'+first, id:id, rikishi:MAK[i]});
    if (r && r.ok) taken++;
  }
  assert.strictEqual(taken, 1, taken+' of 7 rapid picks were accepted');
});

t('the pick flushes while it still holds the lock', ()=>{
  const trace=[]; const {c,id} = world(trace);
  c.startDraft({handle:'ann',auth:'h_ann',id:id});
  const first = c.draftState(id,'ann').turn.handle;
  trace.length = 0;
  c.makePick({handle:first, auth:'h_'+first, id:id, rikishi:MAK[0]});
  const seq = trace.join(',');
  assert.ok(/lock,.*flush,unlock/.test(seq) || /lock,flush,unlock/.test(seq),
    'expected lock … flush, unlock — got: ' + seq);
});

t('the draft still completes normally end to end', ()=>{
  const trace=[]; const {c,id} = world(trace);
  c.startDraft({handle:'ann',auth:'h_ann',id:id});
  let guard = 0;
  for(;;){
    const st = c.draftState(id,'ann');
    if (!st.turn || st.turn.phase === 'done') break;
    if (st.league.draftStatus !== 'active') break;
    const h = st.turn.handle;
    const pool = (st.turn.phase === 'juryo' ? JUR : MAK)
      .filter(n=>!(st.pickedNames||[]).some(p=>p.toLowerCase()===n.toLowerCase()));
    const r = c.makePick({handle:h, auth:'h_'+h, id:id, rikishi:pool[0]});
    assert.ok(r && r.ok, 'pick refused mid-draft :: '+JSON.stringify(r));
    if (++guard > 200) throw new Error('draft never finished');
  }
  const end = c.draftState(id,'ann');
  assert.strictEqual(end.league.draftStatus, 'complete', 'draft did not complete');
});

console.log('\n'+pass+' passed, '+fail+' failed');
if (fail) process.exit(1);
