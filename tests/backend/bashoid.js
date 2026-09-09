/* Moving BASHO_ID out of the code and into Meta.

   The thing that matters most here is the NON-change: Aki starts in four days
   and the live sheet has no Meta.bashoId, so every one of these paths must
   behave exactly as it did before this existed. */
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
function makeCtx(onFetch){
  const store={}, urls=[];
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
    UrlFetchApp:{fetch(u){ urls.push(u);
      return onFetch ? onFetch(u) : { getResponseCode:()=>404, getContentText:()=>'' }; }},
    CacheService:{getScriptCache(){const m={};return {get(k){return m[k]||null;},put(k,v){m[k]=v;},remove(k){delete m[k];},
      getAll(ks){const o={};ks.forEach(k=>{if(m[k]!=null)o[k]=m[k];});return o;},putAll(o){Object.keys(o).forEach(k=>m[k]=o[k]);}};}},
    ContentService:{createTextOutput(t){return {t,setMimeType(){return this;},getContent(){return t;}};},MimeType:{JSON:'json'}},
    Utilities:{formatDate(){return '';}},
    console,JSON,Math,Date,Number,String,Object,Array,isNaN,parseInt,parseFloat,RegExp,Error,
    __store:store, __urls:urls };
  vm.createContext(ctx); vm.runInContext(SRC,ctx,{filename:'sumo-fantasy.gs'});
  ctx.setup();
  return ctx;
}

let pass=0, fail=0;
function t(n,fn){ try{ fn(); console.log('  ok   '+n); pass++; }
  catch(e){ console.log('  FAIL '+n+'\n         '+e.message); fail++; } }

const idsFetched = c => [...new Set(c.__urls
  .map(u => (String(u).match(/\/api\/basho\/(\d{6})\//)||[])[1]).filter(Boolean))];

/* ---------- the non-change: a sheet with no Meta.bashoId ---------- */

t('with no Meta key it falls back to the code constant', ()=>{
  const c = makeCtx();
  assert.strictEqual(c.bashoId_(), c.BASHO_ID);
  assert.strictEqual(c.bashoId_(), '202609', 'the constant should still be Aki');
});

t('...and the importer asks for exactly that basho', ()=>{
  const c = makeCtx();
  c.refreshResults();
  assert.strictEqual(JSON.stringify(idsFetched(c)), '["202609"]', JSON.stringify(idsFetched(c)));
});

t('...and the banzuke fetchers do too', ()=>{
  const c = makeCtx();
  try { c.fetchBanzukeNames(); } catch(e){}
  try { c.fetchBanzukeTiers_(); } catch(e){}
  assert.strictEqual(JSON.stringify(idsFetched(c)), '["202609"]', JSON.stringify(idsFetched(c)));
});

t('...and the admin panel reports it as coming from the code', ()=>{
  const c = makeCtx();
  const r = c.adminBasho('test');
  assert.strictEqual(r.bashoId, '202609');
  assert.strictEqual(r.bashoIdSource, 'code');
  assert.strictEqual(r.idExpects, 'Aki 2026');
});

/* ---------- the sheet wins once it has a value ---------- */

t('a well-formed Meta.bashoId overrides the constant', ()=>{
  const c = makeCtx();
  c.__store['Meta'].appendRow(['bashoId','202611']);
  assert.strictEqual(c.bashoId_(), '202611');
  const r = c.adminBasho('test');
  assert.strictEqual(r.bashoIdSource, 'sheet');
  assert.strictEqual(r.idExpects, 'Kyushu 2026');
});

t('and the importer follows it', ()=>{
  const c = makeCtx();
  c.__store['Meta'].appendRow(['bashoId','202611']);
  c.refreshResults();
  assert.strictEqual(JSON.stringify(idsFetched(c)), '["202611"]', JSON.stringify(idsFetched(c)));
});

t('junk in Meta is ignored rather than fetched', ()=>{
  ['', '  ', 'Kyushu', '2026', '20261', '2026111', 'abcdef'].forEach(bad=>{
    const c = makeCtx();
    c.__store['Meta'].appendRow(['bashoId', bad]);
    assert.strictEqual(c.bashoId_(), '202609', 'accepted junk: '+JSON.stringify(bad));
  });
});

/* ---------- the id is derived from the label, not typed twice ---------- */

t('the label parses to an id', ()=>{
  const c = makeCtx();
  assert.strictEqual(c.bashoIdForName_('Kyushu 2026'), '202611');
  assert.strictEqual(c.bashoIdForName_('Hatsu 2027'),  '202701');
  assert.strictEqual(c.bashoIdForName_('haru 2027'),   '202703');
  assert.strictEqual(c.bashoIdForName_('  Natsu 2027  '), '202705');
  assert.strictEqual(c.bashoIdForName_('Nagoya 2026'), '202607');
  assert.strictEqual(c.bashoIdForName_('Aki 2026'),    '202609');
});

t('and refuses anything it cannot read', ()=>{
  const c = makeCtx();
  ['', 'Kyushu', '2026', 'Kyushu 26', 'Aki 2026 (test)', 'Basho 2026', 'Kyushu two thousand']
    .forEach(bad=>assert.strictEqual(c.bashoIdForName_(bad), '', 'accepted: '+JSON.stringify(bad)));
});

t('round-trips against the decoder', ()=>{
  const c = makeCtx();
  ['Hatsu 2027','Haru 2027','Natsu 2027','Nagoya 2027','Aki 2027','Kyushu 2027'].forEach(n=>{
    assert.strictEqual(c.bashoNameForId_(c.bashoIdForName_(n)), n, n);
  });
});

/* ---------- Start a new basho moves the importer ---------- */

function ready(c){                       // a finished, ranked basho
  c.__store['Results'].appendRow([15,'Makuuchi','A','B','A','yorikiri']);
  c.__store['Meta'].appendRow(['rankedBasho', c.readMeta().basho]);
}

t('starting a new basho sets the id from the name', ()=>{
  const c = makeCtx(); ready(c);
  const r = c.adminResetBasho({adminKey:'test', basho:'Kyushu 2026'});
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.bashoId, '202611', JSON.stringify(r));
  assert.strictEqual(r.bashoIdDerived, true);
  assert.strictEqual(c.bashoId_(), '202611', 'the resolver did not pick it up');
  assert.strictEqual(c.readMeta().basho, 'Kyushu 2026');
});

t('and the importer immediately asks for the new one', ()=>{
  const c = makeCtx(); ready(c);
  c.adminResetBasho({adminKey:'test', basho:'Kyushu 2026'});
  c.__urls.length = 0;
  c.refreshResults();
  assert.strictEqual(JSON.stringify(idsFetched(c)), '["202611"]', JSON.stringify(idsFetched(c)));
});

t('an unreadable name leaves the id alone and says so', ()=>{
  const c = makeCtx(); ready(c);
  const r = c.adminResetBasho({adminKey:'test', basho:'Jungyo special'});
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.bashoIdDerived, false, 'claimed to derive an id it could not');
  assert.strictEqual(c.bashoId_(), '202609', 'it moved the importer anyway');
  assert.strictEqual(r.bashoId, '202609', 'should report the id still in force');
});

t('the label and the id cannot disagree after a normal reset', ()=>{
  const c = makeCtx(); ready(c);
  c.adminResetBasho({adminKey:'test', basho:'Kyushu 2026'});
  const r = c.adminBasho('test');
  assert.strictEqual(r.idExpects, r.basho, r.idExpects+' vs '+r.basho);
  assert.strictEqual(r.bashoIdSource, 'sheet');
});

t('a hand-edited mismatch is still detectable', ()=>{
  const c = makeCtx();
  c.__store['Meta'].appendRow(['bashoId','202611']);      // Kyushu id...
  const r = c.adminBasho('test');                          // ...but Meta.basho is still Aki
  assert.strictEqual(r.idExpects, 'Kyushu 2026');
  assert.strictEqual(r.basho, 'Aki 2026');
  assert.notStrictEqual(r.idExpects, r.basho, 'the panel would have nothing to warn about');
});

t('nothing else about starting a basho changed', ()=>{
  const c = makeCtx(); ready(c);
  const before = c.__store['Results'].rows.length;
  assert.ok(before > 1);
  const r = c.adminResetBasho({adminKey:'test', basho:'Kyushu 2026'});
  assert.strictEqual(c.__store['Results'].rows.length, 1, 'results were not cleared');
  assert.strictEqual(Number(c.readMeta().lastDay), 0);
  assert.strictEqual(c.readMeta().yusho, '');
  assert.strictEqual(r.clearedRows, before - 1);
});

t('it still refuses an unranked basho without force', ()=>{
  const c = makeCtx();
  c.__store['Results'].appendRow([15,'Makuuchi','A','B','A','yorikiri']);
  const r = c.adminResetBasho({adminKey:'test', basho:'Kyushu 2026'});
  assert.ok(r && !r.ok && r.needsRanking, JSON.stringify(r));
  assert.strictEqual(c.bashoId_(), '202609', 'a refused reset moved the importer');
});

console.log('\n'+pass+' passed, '+fail+' failed');
if (fail) process.exit(1);
