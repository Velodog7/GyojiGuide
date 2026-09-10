
/* Renaming yourself during a basho.

   The account panel saved the display name with `save`, which writes the name
   and the team in one row write — so from day 1 a rename was refused, with a
   message about locked teams that had nothing to do with what was asked. A
   name is not a team. `saveName` writes the name column only.

   The assertions that matter are the ones about what it must NOT touch: the
   team, its updated stamp, and anyone else's row. */
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

let pass=0, fail=0;
function t(n,fn){ try{ fn(); console.log('  ok   '+n); pass++; }
  catch(e){ console.log('  FAIL '+n+'\n         '+e.message); fail++; } }

function world(){
  const c = makeCtx();
  c.register({handle:'ann', name:'Ann', auth:'h_ann'});
  c.saveTeam({handle:'ann', auth:'h_ann', team:TEAM_A});
  c.register({handle:'bo', name:'Bo', auth:'h_bo'});
  return c;
}
const row = (c,h)=>{
  const v = c.__store['Users'].rows;
  for (let r=1;r<v.length;r++) if (String(v[r][0]).toLowerCase()===h) return v[r];
  return null;
};
const nameOf = (c,h)=>String(row(c,h)[1]||'');
const teamOf = (c,h)=>JSON.parse(row(c,h)[3]||'{}');
const stampOf = (c,h)=>String(row(c,h)[4]||'');
function addResult(c, day){
  c.__store['Results'].appendRow([day,'makuuchi','Onosato','Hoshoryu','Onosato','yorikiri']);
}

t('a rename works before the basho', ()=>{
  const c = world();
  const r = c.saveName({handle:'ann', auth:'h_ann', name:'Ann from Osaka'});
  assert.ok(r && r.ok, JSON.stringify(r));
  assert.strictEqual(nameOf(c,'ann'), 'Ann from Osaka');
});

t('and — the whole point — it still works on day 13', ()=>{
  const c = world();
  addResult(c, 13);
  const r = c.saveName({handle:'ann', auth:'h_ann', name:'Ann from Osaka'});
  assert.ok(r && r.ok, 'a rename was refused mid-basho :: '+JSON.stringify(r));
  assert.strictEqual(nameOf(c,'ann'), 'Ann from Osaka');
});

t('the team is not touched by a rename', ()=>{
  const c = world();
  addResult(c, 5);
  c.saveName({handle:'ann', auth:'h_ann', name:'Ann from Osaka'});
  assert.strictEqual(teamOf(c,'ann').sanyaku, 'Onosato', 'the team moved');
  assert.strictEqual(Object.keys(teamOf(c,'ann')).length, 7, 'bands were lost');
});

t('nor is the team-updated stamp', ()=>{
  const c = world();
  const before = stampOf(c,'ann');
  c.saveName({handle:'ann', auth:'h_ann', name:'Ann from Osaka'});
  assert.strictEqual(stampOf(c,'ann'), before, 'a rename moved the team stamp');
});

t('the team lock itself is unchanged — saving a team on day 13 is still refused', ()=>{
  const c = world();
  addResult(c, 13);
  const r = c.saveTeam({handle:'ann', auth:'h_ann',
    team:{sanyaku:'Hoshoryu',m1:'Abi',m5:'Ura',m9:'Roga',m13:'Asakoryu',any:'Takayasu',juryo:'Kazuma'}});
  assert.ok(r && !r.ok && r.locked, 'the lock was weakened :: '+JSON.stringify(r));
});

t('a wrong PIN cannot rename you', ()=>{
  const c = world();
  const r = c.saveName({handle:'ann', auth:'WRONG', name:'Not Ann'});
  assert.ok(r && !r.ok, 'renamed without the PIN');
  assert.ok(/authoris/i.test(r.error||''), 'wrong error: '+r.error);
  assert.strictEqual(nameOf(c,'ann'), 'Ann');
});

t('and cannot rename somebody else', ()=>{
  const c = world();
  const r = c.saveName({handle:'bo', auth:'h_ann', name:'Pwned'});
  assert.ok(r && !r.ok, 'renamed another account');
  assert.strictEqual(nameOf(c,'bo'), 'Bo');
});

t('an empty name is refused rather than blanking the row', ()=>{
  const c = world();
  const r = c.saveName({handle:'ann', auth:'h_ann', name:'   '});
  assert.ok(r && !r.ok, JSON.stringify(r));
  assert.strictEqual(nameOf(c,'ann'), 'Ann');
});

t('an unknown handle is refused', ()=>{
  const c = world();
  const r = c.saveName({handle:'nobody', auth:'x', name:'Ghost'});
  assert.ok(r && !r.ok, JSON.stringify(r));
});

t('a long name is trimmed, not rejected', ()=>{
  const c = world();
  const r = c.saveName({handle:'ann', auth:'h_ann', name:'x'.repeat(200)});
  assert.ok(r && r.ok, JSON.stringify(r));
  assert.strictEqual(nameOf(c,'ann').length, 60);
});

t('it is routed on doPost', ()=>{
  const c = world();
  const res = c.doPost({postData:{contents:JSON.stringify(
    {action:'saveName', handle:'ann', auth:'h_ann', name:'Routed'})}});
  const j = JSON.parse(res.getContent());
  assert.ok(j.ok, JSON.stringify(j));
  assert.strictEqual(nameOf(c,'ann'), 'Routed');
});

console.log('\n'+pass+' passed, '+fail+' failed');
if (fail) process.exit(1);
