/* Dismissing a PIN reset request must close it WITHOUT clearing the PIN — the
   case where the person remembers it and says so, and approving would lock them
   out of an account they can still get into. */
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

let pass=0, fail=0;
function t(n,fn){ try{ fn(); console.log('  ok   '+n); pass++; }
  catch(e){ console.log('  FAIL '+n+'\n         '+e.message); fail++; } }

function world(){
  const c = makeCtx();
  c.register({handle:'ann', name:'Ann', auth:'h_ann'});
  c.register({handle:'bo',  name:'Bo',  auth:'h_bo'});
  return c;
}
const authOf = (c,h)=>{
  const v=c.__store['Users'].rows;
  for (let r=1;r<v.length;r++) if (String(v[r][0]).toLowerCase()===h) return v[r][2];
  return null;
};
const statuses = (c,h)=>c.__store['PinResets'].rows.slice(1)
  .filter(r=>String(r[1]).toLowerCase()===h).map(r=>r[4]);
const dmsTo = (c,h)=>(c.__store['DirectMessages'].rows||[])
  .filter(r=>String(r[3]||'').toLowerCase()===h).length;

t('a request shows up as pending', ()=>{
  const c = world();
  assert.ok(c.requestPinReset({handle:'ann'}).ok);
  const list = c.adminPinResets('test');
  assert.strictEqual(list.resets.length, 1, JSON.stringify(list));
  assert.strictEqual(list.resets[0].handle, 'ann');
});

t('dismissing clears it from the queue', ()=>{
  const c = world();
  c.requestPinReset({handle:'ann'});
  const r = c.adminDismissPinReset({adminKey:'test', handle:'ann'});
  assert.ok(r && r.ok, JSON.stringify(r));
  assert.strictEqual(c.adminPinResets('test').resets.length, 0);
});

t('and leaves the PIN working — the whole point', ()=>{
  const c = world();
  c.requestPinReset({handle:'ann'});
  c.adminDismissPinReset({adminKey:'test', handle:'ann'});
  assert.strictEqual(authOf(c,'ann'), 'h_ann', 'the PIN hash was cleared by a dismissal');
  const login = c.login({handle:'ann', auth:'h_ann'});
  assert.ok(login && login.ok, 'she can no longer sign in :: '+JSON.stringify(login));
});

t('approving still clears the PIN', ()=>{
  const c = world();
  c.requestPinReset({handle:'ann'});
  assert.ok(c.adminResetPin({adminKey:'test', handle:'ann'}).ok);
  assert.strictEqual(authOf(c,'ann'), '', 'approve no longer clears the hash');
  assert.strictEqual(c.adminPinResets('test').resets.length, 0);
});

t('the two are told apart in the sheet', ()=>{
  const c = world();
  c.requestPinReset({handle:'ann'}); c.requestPinReset({handle:'bo'});
  c.adminDismissPinReset({adminKey:'test', handle:'ann'});
  c.adminResetPin({adminKey:'test', handle:'bo'});
  // JSON, not deepStrictEqual: arrays built inside the vm are a different realm
  assert.strictEqual(JSON.stringify(statuses(c,'ann')), '["dismissed"]');
  assert.strictEqual(JSON.stringify(statuses(c,'bo')),  '["done"]');
});

t('a dismissal notifies nobody', ()=>{
  const c = world();
  c.requestPinReset({handle:'ann'});
  const before = dmsTo(c,'ann');
  c.adminDismissPinReset({adminKey:'test', handle:'ann'});
  assert.strictEqual(dmsTo(c,'ann'), before, 'a dismissal sent the user a message');
});

t('...while approving still tells them how to get back in', ()=>{
  const c = world();
  c.requestPinReset({handle:'ann'});
  const before = dmsTo(c,'ann');
  c.adminResetPin({adminKey:'test', handle:'ann'});
  assert.ok(dmsTo(c,'ann') > before, 'approve stopped DMing the user');
});

t('she can ask again after a dismissal', ()=>{
  const c = world();
  c.requestPinReset({handle:'ann'});
  c.adminDismissPinReset({adminKey:'test', handle:'ann'});
  const again = c.requestPinReset({handle:'ann'});
  assert.ok(again && again.ok && !again.already, 'the dismissed row still blocks a new request');
  assert.strictEqual(c.adminPinResets('test').resets.length, 1);
});

t('dismissing nothing is refused, not silently ok', ()=>{
  const c = world();
  const r = c.adminDismissPinReset({adminKey:'test', handle:'ann'});
  assert.ok(r && !r.ok, JSON.stringify(r));
});

t('it needs the admin key', ()=>{
  const c = world();
  c.requestPinReset({handle:'ann'});
  const r = c.adminDismissPinReset({adminKey:'wrong', handle:'ann'});
  assert.ok(r && !r.ok, 'a bad admin key got through :: '+JSON.stringify(r));
  assert.strictEqual(c.adminPinResets('test').resets.length, 1, 'it dismissed anyway');
});

t('dismissing one person leaves the other queued', ()=>{
  const c = world();
  c.requestPinReset({handle:'ann'}); c.requestPinReset({handle:'bo'});
  c.adminDismissPinReset({adminKey:'test', handle:'ann'});
  const left = c.adminPinResets('test').resets.map(x=>x.handle);
  assert.strictEqual(JSON.stringify(left), '["bo"]', JSON.stringify(left));
});

console.log('\n'+pass+' passed, '+fail+' failed');
if (fail) process.exit(1);
