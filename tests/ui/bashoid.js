/* The Basho panel once the basho id lives on the sheet: it has to say which of
   the two places the importer is actually reading, and give advice that matches.
   And starting a new basho has to report the id it set -- or admit it couldn't. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{ T.push(ok); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

function days(){ const o=[]; for(let i=1;i<=15;i++) o.push({day:i,makuuchi:0,juryo:0}); return o; }
function payload(over){
  const now=new Date();
  return Object.assign({ ok:true,
    basho:'Aki 2026', lastDay:0, yusho:'', sansho:'', rankedBasho:'', archiveError:'',
    rows:0, maxDay:0, days:days(),
    lastImport:new Date(now.getTime()-4*60000).toISOString(), lastImportAdded:0,
    serverNow:now.toISOString(),
    bashoId:'202609', bashoIdSource:'code', bashoLabel:'Aki 2026', idExpects:'Aki 2026' }, over||{});
}

async function open(b, basho, onReset){
  const ctx = await b.newContext({viewport:{width:1200,height:1100}, deviceScaleFactor:2});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,130)));
  const sent=[];
  await p.route('**script.google.com/**', r=>{
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    let bd={}; try{ bd=JSON.parse(r.request().postData()||'{}'); }catch(e){}
    sent.push(bd);
    if (bd.action==='adminStats') return j({ok:true, counts:{users:71,leagues:3,messages:40},
      pageviews:{total:0,unique:0,last7Total:0,last7Unique:0,byPage:[],byWeek:[],byDay:[],byHour:[],byRegion:[],hasRegionData:false},
      api:{ok:true, code:200, ms:120, when:new Date().toISOString()}});
    if (bd.action==='adminBasho') return j(basho());
    if (bd.action==='adminResetBasho') return j(onReset ? onReset(bd) : {ok:true});
    if (bd.action==='adminRefreshResults') return j({ok:true, added:0, rows:0});
    return j({ok:true});
  });
  await p.goto('http://127.0.0.1:8902/admin.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1800);
  await p.fill('#gateKey','test'); await p.click('#gateGo');
  await p.waitForTimeout(2500);
  await p.evaluate(()=>{ const x=document.getElementById('tab-basho'); if(x) x.click(); });
  await p.waitForTimeout(2500);
  return {ctx,p,errs,sent};
}
const text = p => p.evaluate(()=>document.getElementById('bashoBody').innerText.replace(/\s+/g,' '));

(async ()=>{
  const b = await chromium.launch();

  /* --- today: no Meta key, the code constant is in force --- */
  {
    const {ctx,p,errs} = await open(b, ()=>payload({}));
    const t = await text(p);
    chk('the panel names the id that drives the import', /Basho id \(drives the import\)/.test(t) && /202609/.test(t), t.slice(0,120));
    chk('and says it is coming from the code', /Set by the BASHO_ID constant in the code/.test(t), t.slice(0,200));
    chk('with no warning, because nothing disagrees', !/These disagree/.test(t), t.slice(0,120));
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* --- after a Start a new basho: the sheet is in force --- */
  {
    const {ctx,p} = await open(b, ()=>payload({basho:'Kyushu 2026', bashoId:'202611',
      bashoIdSource:'sheet', idExpects:'Kyushu 2026'}));
    const t = await text(p);
    chk('the sheet value is shown when it is set', /202611 · Kyushu 2026/.test(t), t.slice(0,140));
    chk('and it says a new basho set it', /Set by Start a new basho \(Meta.bashoId\)/.test(t), t.slice(0,220));
    chk('BASHO_LABEL being stale is no longer a disagreement worth flagging alone',
        !/These disagree/.test(t) || /BASHO_LABEL/.test(t), t.slice(0,200));
    await ctx.close();
  }

  /* --- drift, with the id coming from the sheet: fix it on the sheet --- */
  {
    const {ctx,p} = await open(b, ()=>payload({basho:'Aki 2026', bashoId:'202611',
      bashoIdSource:'sheet', idExpects:'Kyushu 2026'}));
    const t = await text(p);
    chk('a mismatch is still caught', /These disagree/.test(t), t.slice(0,80));
    chk('and names both sides', /202611/.test(t) && /Kyushu 2026/.test(t) && /sheet says Aki 2026/.test(t), t.slice(-260));
    chk('the advice points at the sheet, not a redeploy',
        /start the basho again|edit Meta.bashoId/.test(t) && !/redeploy/.test(t), t.slice(-260));
    await ctx.close();
  }

  /* --- drift with the id still from the code: the old advice, plus the way out --- */
  {
    const {ctx,p} = await open(b, ()=>payload({basho:'Kyushu 2026', bashoId:'202609',
      bashoIdSource:'code', idExpects:'Aki 2026'}));
    const t = await text(p);
    chk('a code-side mismatch is caught too', /These disagree/.test(t), t.slice(0,80));
    chk('and it offers the new fix first', /start a new basho to set it/.test(t), t.slice(-260));
    chk('while still naming the old one', /BASHO_ID in sumo-fantasy.gs and redeploy/.test(t), t.slice(-200));
    await ctx.close();
  }

  /* --- Start a new basho reports the id it set --- */
  {
    const {ctx,p} = await open(b, ()=>payload({}),
      bd => ({ok:true, basho:bd.basho, previous:'Aki 2026', clearedRows:525,
              bashoId:'202611', bashoIdDerived:true}));
    await p.evaluate(()=>{ const x=document.getElementById('tab-danger')||document.getElementById('tab-lifecycle'); if(x)x.click(); });
    await p.waitForTimeout(600);
    await p.evaluate(()=>{ window.confirm = () => true; });
    const ok = await p.evaluate(()=>{
      const i=document.getElementById('newBashoName'); if(!i) return false;
      i.value='Kyushu 2026';
      const btn=document.getElementById('newBashoBtn'); if(!btn) return false;
      btn.click(); return true; });
    chk('the new-basho control is reachable', ok);
    await p.waitForTimeout(2500);
    let m = await p.evaluate(()=>(document.getElementById('newBashoMsg')||{}).textContent||'');
    chk('it says which basho the importer moved to', /Importer set to 202611/.test(m), m);
    chk('and still reports the clear', /cleared 525 result rows/.test(m), m);
    await ctx.close();
  }

  /* --- ...and warns loudly when it could not --- */
  {
    const {ctx,p} = await open(b, ()=>payload({}),
      bd => ({ok:true, basho:bd.basho, previous:'Aki 2026', clearedRows:525,
              bashoId:'202609', bashoIdDerived:false}));
    await p.evaluate(()=>{ const x=document.getElementById('tab-danger')||document.getElementById('tab-lifecycle'); if(x)x.click(); });
    await p.waitForTimeout(600);
    await p.evaluate(()=>{ window.confirm = () => true; });
    await p.evaluate(()=>{ const i=document.getElementById('newBashoName'); i.value='Jungyo special';
      document.getElementById('newBashoBtn').click(); });
    await p.waitForTimeout(2500);
    const r = await p.evaluate(()=>{ const m=document.getElementById('newBashoMsg');
      return {t:m.textContent, c:m.style.color}; });
    chk('an unreadable name is called out', /Couldn’t read a basho id|Couldn't read a basho id/.test(r.t), r.t);
    chk('it says where the importer is still pointed', /still on 202609/.test(r.t), r.t);
    chk('and it is not dressed up as success', r.c !== '' && !/^rgb\(95, 208, 138\)$/.test(r.c), JSON.stringify(r.c));
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close();
  if (bad) process.exit(1);
})();
