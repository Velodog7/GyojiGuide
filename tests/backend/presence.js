/* Presence and the draft-room chat, both carried on the draftState poll. */
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
/* a cache that can be aged, so a TTL can actually be tested */
function makeCache(){
  const m={};
  return { store:m,
    get(k){ return m[k]==null?null:m[k]; },
    put(k,v){ m[k]=String(v); },
    remove(k){ delete m[k]; },
    getAll(ks){ const o={}; ks.forEach(k=>{ if(m[k]!=null) o[k]=m[k]; }); return o; },
    putAll(o){ Object.keys(o).forEach(k=>m[k]=String(o[k])); } };
}
function makeCtx(){
  const store={}, cache=makeCache();
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
    CacheService:{getScriptCache(){return cache;}},
    ContentService:{createTextOutput(t){return {t,setMimeType(){return this;},getContent(){return t;}};},MimeType:{JSON:'json'}},
    Utilities:{formatDate(){return '';}},
    console,JSON,Math,Date,Number,String,Object,Array,isNaN,parseInt,parseFloat,RegExp,Error,
    __store:store, __cache:cache };
  vm.createContext(ctx); vm.runInContext(SRC,ctx,{filename:'sumo-fantasy.gs'});
  ctx.setup();
  return ctx;
}

let pass=0, fail=0;
function t(n,fn){ try{ fn(); console.log('  ok   '+n); pass++; }
  catch(e){ console.log('  FAIL '+n+'\n         '+e.message+'\n'+String(e.stack).split('\n').slice(1,4).join('\n')); fail++; } }

function world(){
  const c = makeCtx();
  ['ann','bo','cy'].forEach(h=>c.register({handle:h, name:h.toUpperCase(), auth:'h_'+h}));
  const lg = c.createLeague({handle:'ann',auth:'h_ann',name:'Race',mode:'keepers',rosterSize:2});
  const L = lg.league || lg;
  c.joinLeague({handle:'bo',auth:'h_bo',code:L.inviteCode});
  c.joinLeague({handle:'cy',auth:'h_cy',code:L.inviteCode});
  return {c, id:L.id};
}
/* wind a cached presence stamp back in time */
function age(c, id, handle, seconds){
  const k = c.presenceKey_(id, handle);
  c.__cache.store[k] = String(Number(c.__cache.store[k]) - seconds*1000);
}

t('the members are reported with the state', ()=>{
  const {c,id} = world();
  const r = c.draftState(id);
  assert.strictEqual((r.members||[]).length, 3, JSON.stringify(r.members));
  assert.ok(r.members.every(m=>m.handle && m.name), JSON.stringify(r.members));
});

t('nobody is present until somebody polls', ()=>{
  const {c,id} = world();
  const r = c.draftState(id);
  assert.strictEqual(JSON.stringify(r.presence), '{"ann":null,"bo":null,"cy":null}', JSON.stringify(r.presence));
});

t('polling marks you present', ()=>{
  const {c,id} = world();
  c.draftState(id, 'bo');
  const r = c.draftState(id, 'bo');
  assert.ok(r.presence.bo != null && r.presence.bo < 5, JSON.stringify(r.presence));
  assert.strictEqual(r.presence.ann, null, 'ann was never here');
});

t('it reports seconds since, not a boolean', ()=>{
  const {c,id} = world();
  c.draftState(id, 'bo');
  age(c, id, 'bo', 120);
  const r = c.draftState(id, 'cy');
  assert.ok(r.presence.bo >= 118 && r.presence.bo <= 122, 'got '+r.presence.bo);
});

t('a non-member cannot appear in the room', ()=>{
  const {c,id} = world();
  c.register({handle:'zed', name:'Zed', auth:'h_zed'});
  const r = c.draftState(id, 'zed');
  assert.ok(!('zed' in r.presence), 'a stranger got into the presence map');
  assert.strictEqual(Object.keys(r.presence).length, 3);
});

t('an unknown handle is ignored rather than recorded', ()=>{
  const {c,id} = world();
  const r = c.draftState(id, 'nobody-at-all');
  assert.strictEqual(Object.keys(r.presence).length, 3);
  assert.ok(Object.values(r.presence).every(v=>v===null), JSON.stringify(r.presence));
});

t('presence never touches the sheet', ()=>{
  const {c,id} = world();
  const before = JSON.stringify(Object.keys(c.__store).map(k=>[k, c.__store[k].rows.length]));
  for (let i=0;i<10;i++) c.draftState(id, 'ann');
  const after = JSON.stringify(Object.keys(c.__store).map(k=>[k, c.__store[k].rows.length]));
  assert.strictEqual(before, after, 'ten polls wrote rows to the spreadsheet');
});

t('the chat comes back with the state', ()=>{
  const {c,id} = world();
  c.postMessage({handle:'ann', auth:'h_ann', id:id, body:'good luck everyone'});
  c.postMessage({handle:'bo',  auth:'h_bo',  id:id, body:'taking Ura first'});
  const r = c.draftState(id, 'ann');
  assert.strictEqual((r.chat||[]).length, 2, JSON.stringify(r.chat));
  assert.strictEqual(r.chat[0].body, 'good luck everyone');
  assert.strictEqual(r.chat[1].handle, 'bo');
  assert.ok(r.chat[1].name, 'the display name should ride along');
});

t('it is the league board, not a separate channel', ()=>{
  const {c,id} = world();
  c.postMessage({handle:'ann', auth:'h_ann', id:id, body:'from the draft room'});
  const board = c.leagueDetail(id, 'ann').messages || [];
  assert.ok(board.some(m=>m.body==='from the draft room'),
    'a draft-room post did not reach the league board');
});

t('only the last 40 ride along', ()=>{
  const {c,id} = world();
  for (let i=0;i<55;i++) c.postMessage({handle:'ann', auth:'h_ann', id:id, body:'msg '+i});
  const r = c.draftState(id, 'ann');
  assert.strictEqual(r.chat.length, 40, r.chat.length+' messages');
  assert.strictEqual(r.chat[0].body, 'msg 15', r.chat[0].body);
  assert.strictEqual(r.chat[39].body, 'msg 54', r.chat[39].body);
});

t('a non-member still cannot post', ()=>{
  const {c,id} = world();
  c.register({handle:'zed', name:'Zed', auth:'h_zed'});
  const r = c.postMessage({handle:'zed', auth:'h_zed', id:id, body:'let me in'});
  assert.ok(r && !r.ok, JSON.stringify(r));
});

t('the draft itself is unchanged by any of this', ()=>{
  const {c,id} = world();
  c.startDraft({handle:'ann', auth:'h_ann', id:id});
  const st = c.draftState(id, 'ann');
  assert.strictEqual(st.league.draftStatus, 'active');
  assert.ok(st.turn && st.turn.handle, JSON.stringify(st.turn));
  const first = st.turn.handle;
  const pick = c.makePick({handle:first, auth:'h_'+first, id:id, rikishi:'Onosato'});
  assert.ok(pick && pick.ok, JSON.stringify(pick));
  const after = c.draftState(id, first);
  assert.strictEqual((after.pickedNames||[]).length, 1);
  assert.ok(after.presence[first] != null, 'the picker should be present');
});

console.log('\n'+pass+' passed, '+fail+' failed');
if (fail) process.exit(1);
