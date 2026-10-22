/* The switch between Apps Script and Supabase, over the real sumo-fantasy.gs.

   With the Script Property __FORWARD_TO set, the Apps Script copy must pass
   every request through untouched (that is what freezes the Sheet at
   cutover) and must never pass on a request that was already forwarded, or
   the two sides could bounce one request between them forever. The hourly
   importer must stand down too, or it would write to the frozen Sheet. */
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const GS = process.env.GG_GS || require('path').join(__dirname, '..', '..', 'sumo-fantasy.gs');
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
    appendRow(row){this.rows.push(row.slice());} };
}
function makeCtx(props){
  const store={}, fetches=[];
  const ss={ getSheetByName(n){return store[n]||null;}, insertSheet(n){store[n]=makeSheet(n,[]);return store[n];} };
  const ctx={ SpreadsheetApp:{getActiveSpreadsheet(){return ss;}, flush(){}},
    PropertiesService:{getScriptProperties(){return {
      getProperty(k){ return props[k]!==undefined ? props[k] : (k==='ADMIN_KEY' ? 'test' : null); },
      setProperty(k,v){props[k]=v;}, deleteProperty(k){delete props[k];} };}},
    LockService:{getScriptLock(){return {waitLock(){},tryLock(){return true;},releaseLock(){}};}},
    UrlFetchApp:{fetch(url, p){ fetches.push({url, p:p||{}});
      return { getResponseCode(){return 200;}, getContentText(){ return '{"ok":true,"from":"supabase","url":'+JSON.stringify(url)+'}'; } }; }},
    CacheService:{getScriptCache(){const m={};return {get(k){return m[k]||null;},put(k,v){m[k]=v;},remove(k){delete m[k];}};}},
    ContentService:{createTextOutput(t){return {t,setMimeType(){return this;},getContent(){return t;}};},MimeType:{JSON:'json'}},
    Utilities:{formatDate(){return '';}},
    console,JSON,Math,Date,Number,String,Object,Array,isNaN,parseInt,parseFloat,RegExp,Error,
    __store:store, __fetches:fetches };
  vm.createContext(ctx); vm.runInContext(SRC,ctx,{filename:'sumo-fantasy.gs'});
  ctx.setup();
  return ctx;
}

let pass=0,fail=0;
function t(n,fn){ try{ fn(); console.log('  ok   '+n); pass++; }
  catch(e){ console.log('  FAIL '+n+'\n         '+e.message); fail++; } }
const TARGET='https://example.supabase.co/functions/v1/api';
const getE=(params, qs)=>({ parameter: params, queryString: qs });

console.log('\n— the switch —');
t('switch off: Apps Script answers, nothing is fetched', ()=>{
  const c=makeCtx({});
  const r=JSON.parse(c.doGet(getE({action:'version'},'action=version')).getContent());
  assert.strictEqual(r.version.length>0, true);
  assert.strictEqual(c.__fetches.length, 0);
});
t('switch on: a GET goes through with its query string and gg_fwd=1, and its answer comes back verbatim', ()=>{
  const c=makeCtx({__FORWARD_TO:TARGET});
  const out=c.doGet(getE({action:'league', id:'lg1', handle:'sean'},'action=league&id=lg1&handle=sean')).getContent();
  assert.strictEqual(c.__fetches.length, 1);
  assert.strictEqual(c.__fetches[0].url, TARGET+'?action=league&id=lg1&handle=sean&gg_fwd=1');
  assert.deepStrictEqual(JSON.parse(out), { ok:true, from:'supabase', url:TARGET+'?action=league&id=lg1&handle=sean&gg_fwd=1' });
});
t('switch on: a bare GET (no query string) still forwards', ()=>{
  const c=makeCtx({__FORWARD_TO:TARGET});
  c.doGet(getE({}, null));
  assert.strictEqual(c.__fetches[0].url, TARGET+'?gg_fwd=1');
});
t('switch on: a POST goes through with its body untouched, as text/plain', ()=>{
  const c=makeCtx({__FORWARD_TO:TARGET});
  const body=JSON.stringify({action:'makePick', handle:'sean', auth:'h1', id:'lg1', rikishi:'Ura — 宇良'});
  const out=JSON.parse(c.doPost({ parameter:{}, postData:{ contents: body } }).getContent());
  assert.strictEqual(out.from, 'supabase');
  const f=c.__fetches[0];
  assert.strictEqual(f.url, TARGET+'?gg_fwd=1');
  assert.strictEqual(f.p.method, 'post');
  assert.strictEqual(f.p.payload, body);
  assert.ok(/text\/plain/.test(f.p.contentType));
  assert.strictEqual(f.p.muteHttpExceptions, true);
});
t('a request that was already forwarded is answered here, never sent on (no ping-pong)', ()=>{
  const c=makeCtx({__FORWARD_TO:TARGET});
  const r=JSON.parse(c.doGet(getE({action:'version', gg_fwd:'1'},'action=version&gg_fwd=1')).getContent());
  assert.ok(r.version, 'answered locally');
  JSON.parse(c.doPost({ parameter:{gg_fwd:'1'}, postData:{ contents: '{"action":"nonsense"}' } }).getContent());
  assert.strictEqual(c.__fetches.length, 0);
});
t('a blank or whitespace property is "off"', ()=>{
  const c=makeCtx({__FORWARD_TO:'   '});
  c.doGet(getE({action:'version'},'action=version'));
  assert.strictEqual(c.__fetches.length, 0);
});
t('switch on: the hourly importer stands down, so the frozen Sheet stays frozen', ()=>{
  const c=makeCtx({__FORWARD_TO:TARGET});
  const meta=JSON.stringify(c.__store.Meta.rows), results=c.__store.Results.rows.length;
  c.refreshResults();
  assert.strictEqual(c.__fetches.length, 0, 'no sumo-api calls');
  assert.strictEqual(JSON.stringify(c.__store.Meta.rows), meta, 'no heartbeat written');
  assert.strictEqual(c.__store.Results.rows.length, results);
});
t('switch off: the importer runs as before', ()=>{
  const c=makeCtx({});
  c.refreshResults();
  assert.ok(c.__fetches.length >= 30, 'it asked sumo-api for every day and division');
});

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
