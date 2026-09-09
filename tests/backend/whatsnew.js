/* whatsNew: the single poll every open tab makes. It must stay cheap — this
   runs all day on every tab and shares a quota with the hourly importer — and
   it must answer sensibly when signed out. */
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const GS = process.env.GG_GS ||
  require('path').join(__dirname, '..', '..', 'sumo-fantasy.gs');
const SRC = fs.readFileSync(GS,'utf8');

function makeSheet(name, rows){
  return { name, rows, reads:0,
    getName(){return name;}, getLastRow(){return this.rows.length;},
    getLastColumn(){return this.rows.reduce((m,r)=>Math.max(m,r.length),0);},
    getDataRange(){const s=this;s.reads++;return {getValues(){return s.rows.map(r=>r.slice());}};},
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
      getProperty(k){ if(props[k]!==undefined) return props[k]; return k==='ADMIN_KEY'?'test':null; },
      setProperty(k,v){props[k]=v;}, deleteProperty(k){delete props[k];} };}},
    LockService:{getScriptLock(){return {waitLock(){},tryLock(){return true;},releaseLock(){}};}},
    UrlFetchApp:{fetch(){throw new Error('no net');}},
    CacheService:{getScriptCache(){const m={};return {get(k){return m[k]||null;},put(k,v){m[k]=v;},
      remove(k){delete m[k];},getAll(ks){const o={};ks.forEach(k=>{if(m[k]!=null)o[k]=m[k];});return o;},
      putAll(o){Object.keys(o).forEach(k=>m[k]=o[k]);}};}},
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

t('it answers with the basho half even when signed out', ()=>{
  const c = world();
  const r = c.whatsNew('');
  assert.ok(r.ok);
  assert.strictEqual(r.unread, 0);
  assert.strictEqual(r.basho, 'Aki 2026');
  assert.strictEqual(r.lastDay, 0);
});

t('an unknown handle is not an error either', ()=>{
  const c = world();
  const r = c.whatsNew('nobody-at-all');
  assert.ok(r.ok);
  assert.strictEqual(r.unread, 0);
});

t('it carries the unread count', ()=>{
  /* register() sends a welcome DM, so a fresh account is not at zero — count
     the DELTA, which is what the notifier actually diffs on anyway */
  const c = world();
  const base = c.whatsNew('ann').unread;
  const boBase = c.whatsNew('bo').unread;
  c.dmSend({handle:'bo', auth:'h_bo', to:'ann', body:'hello'});
  c.dmSend({handle:'bo', auth:'h_bo', to:'ann', body:'again'});
  assert.strictEqual(c.whatsNew('ann').unread - base, 2);
  assert.strictEqual(c.whatsNew('bo').unread - boBase, 0, 'the sender gains nothing');
});

t('and agrees with dmUnread exactly', ()=>{
  const c = world();
  c.dmSend({handle:'bo', auth:'h_bo', to:'ann', body:'x'});
  assert.strictEqual(c.whatsNew('ann').unread, c.dmUnread('ann').unread);
});

t('it reports the day and the import stamp', ()=>{
  const c = world();
  c.setMeta_('lastDay', 3);
  c.setMeta_('lastImport', '2026-09-15T09:16:52.000Z');
  const r = c.whatsNew('ann');
  assert.strictEqual(r.lastDay, 3);
  assert.strictEqual(r.lastImport, '2026-09-15T09:16:52.000Z');
  assert.strictEqual(r.basho, 'Aki 2026');
});

t('lastDay always comes back a number, never a blank string', ()=>{
  const c = world();
  const r = c.whatsNew('ann');
  assert.strictEqual(typeof r.lastDay, 'number');
  assert.strictEqual(r.lastDay, 0);
});

t('it never reads Results or Users', ()=>{
  /* this runs on every open tab all day; it must not grow with the sheet */
  const c = world();
  for (const k of Object.keys(c.__store)) c.__store[k].reads = 0;
  c.whatsNew('ann');
  const touched = Object.keys(c.__store).filter(k=>c.__store[k].reads > 0);
  assert.ok(!touched.includes('Results'), 'read Results: '+touched.join(','));
  assert.ok(!touched.includes('Users'),   'read Users: '+touched.join(','));
});

t('a missing Meta sheet does not throw', ()=>{
  const c = world();
  delete c.__store['Meta'];
  const r = c.whatsNew('ann');
  assert.ok(r.ok, JSON.stringify(r));
});

t('a missing DMs sheet does not throw either', ()=>{
  const c = world();
  delete c.__store['DirectMessages'];
  const r = c.whatsNew('ann');
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.unread, 0);
});

t('the old dmUnread route still works for tabs opened before the deploy', ()=>{
  const c = world();
  const base = c.dmUnread('ann').unread;
  c.dmSend({handle:'bo', auth:'h_bo', to:'ann', body:'x'});
  const r = c.dmUnread('ann');
  assert.ok(r.ok && r.unread === base + 1, JSON.stringify(r));
});

t('the version was bumped', ()=>{
  const c = world();
  assert.strictEqual(c.BACKEND_VERSION, '2026-09-09-whatsnew');
});

console.log('\n'+pass+' passed, '+fail+' failed');
if (fail) process.exit(1);
