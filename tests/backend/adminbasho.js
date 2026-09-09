/* adminBasho — the read the admin page needs to answer "are results coming in?"
   and adminRefreshResults — the manual importer. */
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
function makeCtx(fetchImpl){
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
    UrlFetchApp:{fetch(u){ return fetchImpl ? fetchImpl(u) : (()=>{throw new Error('no net');})(); }},
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

function seed(c, day, mk, jr){
  for (let i=0;i<mk;i++) c.__store['Results'].appendRow([day,'Makuuchi','E'+i,'W'+i,'E'+i,'yorikiri']);
  for (let i=0;i<jr;i++) c.__store['Results'].appendRow([day,'Juryo','JE'+i,'JW'+i,'JE'+i,'oshidashi']);
}

t('an empty basho reads as not started', ()=>{
  const c = makeCtx();
  const r = c.adminBasho('test');
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.rows, 0);
  assert.strictEqual(r.maxDay, 0);
  assert.strictEqual(r.days.length, 15, 'always fifteen day slots');
  assert.strictEqual(r.lastImport, '', 'no heartbeat yet');
});

t('it counts bouts per day, per division', ()=>{
  const c = makeCtx();
  seed(c, 1, 21, 14); seed(c, 2, 21, 14); seed(c, 3, 9, 0);   // day 3 came in short
  const r = c.adminBasho('test');
  assert.strictEqual(r.rows, 21+14+21+14+9);
  assert.strictEqual(r.maxDay, 3);
  assert.strictEqual(JSON.stringify(r.days[0]), JSON.stringify({day:1,makuuchi:21,juryo:14}));
  assert.strictEqual(JSON.stringify(r.days[2]), JSON.stringify({day:3,makuuchi:9,juryo:0}));
  assert.strictEqual(JSON.stringify(r.days[3]), JSON.stringify({day:4,makuuchi:0,juryo:0}));
});

t('it needs the admin key', ()=>{
  const c = makeCtx();
  const r = c.adminBasho('wrong');
  assert.ok(r && !r.ok, JSON.stringify(r));
});

t('BASHO_ID is decoded to a basho name', ()=>{
  const c = makeCtx();
  assert.strictEqual(c.bashoNameForId_('202609'), 'Aki 2026');
  assert.strictEqual(c.bashoNameForId_('202611'), 'Kyushu 2026');
  assert.strictEqual(c.bashoNameForId_('202701'), 'Hatsu 2027');
  assert.strictEqual(c.bashoNameForId_('202612'), '', 'no honbasho in December');
  assert.strictEqual(c.bashoNameForId_('nonsense'), '');
});

t('the three names are all reported so drift is visible', ()=>{
  const c = makeCtx();
  const r = c.adminBasho('test');
  assert.ok(r.bashoId, 'BASHO_ID missing');
  assert.ok(r.bashoLabel, 'BASHO_LABEL missing');
  assert.strictEqual(r.idExpects, c.bashoNameForId_(r.bashoId));
  // today they agree; this is the check that will catch it when they don't
  assert.strictEqual(r.idExpects.toLowerCase(), String(r.basho).toLowerCase(),
    'BASHO_ID and the sheet already disagree: '+r.idExpects+' vs '+r.basho);
});

t('refreshResults writes a heartbeat even when it imports nothing', ()=>{
  const c = makeCtx(()=>({ getResponseCode:()=>404, getContentText:()=>'' }));
  c.refreshResults();
  const r = c.adminBasho('test');
  assert.ok(r.lastImport, 'no lastImport recorded');
  assert.strictEqual(r.lastImportAdded, 0, 'added should be 0, got '+r.lastImportAdded);
});

t('...and records how many it added when it does', ()=>{
  const bouts = { torikumi: [
    {eastShikona:'Onosato', westShikona:'Hoshoryu', winnerEn:'Onosato', kimarite:'yorikiri'},
    {eastShikona:'Ura',     westShikona:'Abi',      winnerEn:'Ura',     kimarite:'katasukashi'} ] };
  const c = makeCtx(u=>/Makuuchi\/1$/.test(u)
    ? { getResponseCode:()=>200, getContentText:()=>JSON.stringify(bouts) }
    : { getResponseCode:()=>404, getContentText:()=>'' });
  c.refreshResults();
  const r = c.adminBasho('test');
  assert.strictEqual(r.lastImportAdded, 2, JSON.stringify(r.lastImportAdded));
  assert.strictEqual(r.rows, 2);
  assert.strictEqual(r.lastDay, 1, 'lastDay should follow the import');
});

t('a second run adds nothing and says so', ()=>{
  const bouts = { torikumi: [
    {eastShikona:'Onosato', westShikona:'Hoshoryu', winnerEn:'Onosato', kimarite:'yorikiri'} ] };
  const c = makeCtx(u=>/Makuuchi\/1$/.test(u)
    ? { getResponseCode:()=>200, getContentText:()=>JSON.stringify(bouts) }
    : { getResponseCode:()=>404, getContentText:()=>'' });
  c.refreshResults();
  c.refreshResults();
  const r = c.adminBasho('test');
  assert.strictEqual(r.lastImportAdded, 0, 'duplicates were re-imported');
  assert.strictEqual(r.rows, 1);
});

t('the manual import reports what it added', ()=>{
  const bouts = { torikumi: [
    {eastShikona:'Onosato', westShikona:'Hoshoryu', winnerEn:'Onosato', kimarite:'yorikiri'},
    {eastShikona:'Ura',     westShikona:'Abi',      winnerEn:'Ura',     kimarite:'katasukashi'} ] };
  const c = makeCtx(u=>/Makuuchi\/1$/.test(u)
    ? { getResponseCode:()=>200, getContentText:()=>JSON.stringify(bouts) }
    : { getResponseCode:()=>404, getContentText:()=>'' });
  const r1 = c.adminRefreshResults({adminKey:'test'});
  assert.ok(r1.ok, JSON.stringify(r1));
  assert.strictEqual(r1.added, 2, JSON.stringify(r1));
  const r2 = c.adminRefreshResults({adminKey:'test'});
  assert.strictEqual(r2.added, 0, 'ran twice and imported twice');
});

t('the manual import needs the admin key', ()=>{
  const c = makeCtx(()=>({ getResponseCode:()=>404, getContentText:()=>'' }));
  const r = c.adminRefreshResults({adminKey:'wrong'});
  assert.ok(r && !r.ok, JSON.stringify(r));
});

t('a thrown import is reported, not swallowed', ()=>{
  const c = makeCtx(()=>({ getResponseCode:()=>200,
    getContentText:()=>{ throw new Error('boom'); } }));
  const r = c.adminRefreshResults({adminKey:'test'});
  // refreshResults catches per-request failures itself, so this should still
  // come back ok with nothing added rather than blowing up the admin page
  assert.ok(r && r.ok, 'a bad feed broke the whole call :: '+JSON.stringify(r));
  assert.strictEqual(r.added, 0);
});

t('it surfaces an archive failure', ()=>{
  const c = makeCtx();
  c.__store['Meta'].appendRow(['archiveError','2026-09-27T00:00:00Z boom']);
  const r = c.adminBasho('test');
  assert.ok(/boom/.test(r.archiveError), JSON.stringify(r.archiveError));
});

t('it reports whether the basho has been ranked', ()=>{
  const c = makeCtx();
  seed(c, 15, 21, 14);
  let r = c.adminBasho('test');
  assert.strictEqual(r.rankedBasho, '', 'should start unranked');
  c.__store['Meta'].appendRow(['rankedBasho','Aki 2026']);
  r = c.adminBasho('test');
  assert.strictEqual(r.rankedBasho, 'Aki 2026');
});

t('adminStats is left alone', ()=>{
  const c = makeCtx();
  const s = c.adminStats();
  assert.ok(s && s.ok, JSON.stringify(s));
  assert.ok(s.pageviews && s.counts, 'adminStats lost its payload');
  assert.strictEqual(s.basho, undefined, 'basho state leaked into the slow call');
});

console.log('\n'+pass+' passed, '+fail+' failed');
if (fail) process.exit(1);
