/* The Basho tab through the real admin page, in the four states that matter:
   quiet before the basho, running normally, running with a stalled importer,
   and pointed at the wrong tournament. */
const { chromium } = require('playwright');

const T=[]; const chk=(n,ok,x)=>{ T.push(ok); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

function days(spec){                       // spec: {day: [mk, jr]}
  const out=[]; for(let i=1;i<=15;i++){ const s=spec[i]||[0,0];
    out.push({day:i, makuuchi:s[0], juryo:s[1]}); } return out;
}
function payload(over){
  const now = new Date();
  return Object.assign({ ok:true,
    basho:'Aki 2026', lastDay:0, yusho:'', sansho:'', rankedBasho:'', archiveError:'',
    rows:0, maxDay:0, days:days({}),
    lastImport:new Date(now.getTime()-4*60000).toISOString(), lastImportAdded:0,
    serverNow:now.toISOString(),
    bashoId:'202609', bashoLabel:'Aki 2026', idExpects:'Aki 2026' }, over||{});
}

async function open(b, basho, onRefresh){
  const ctx = await b.newContext({viewport:{width:1200,height:1100}, deviceScaleFactor:2});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,130)));
  const sent=[];
  await p.route('**script.google.com/**', r=>{
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    let bd={}; try{ bd=JSON.parse(r.request().postData()||'{}'); }catch(e){}
    sent.push(bd.action);
    if (bd.action==='adminStats') return j({ok:true, counts:{users:71,leagues:3,messages:40},
      pageviews:{total:0,unique:0,last7Total:0,last7Unique:0,byPage:[],byWeek:[],byDay:[],byHour:[],byRegion:[],hasRegionData:false},
      api:{ok:true, code:200, ms:120, when:new Date().toISOString()}});
    if (bd.action==='adminBasho') return j(basho());
    if (bd.action==='adminRefreshResults') return j(onRefresh ? onRefresh() : {ok:true, added:0, rows:0});
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

  /* --- there is a Basho tab at all --- */
  {
    const {ctx,p,errs} = await open(b, ()=>payload({}));
    chk('the Basho tab exists and loads', /Aki 2026/.test(await text(p)), (await text(p)).slice(0,60));
    chk('an empty sheet reads as not started', /not started/.test(await text(p)), '');
    if (errs.length) console.log('   page errors: '+errs[0]);
    await ctx.close();
  }

  /* --- mid-basho, healthy --- */
  {
    const {ctx,p} = await open(b, ()=>payload({ lastDay:3, rows:105,
      days: days({1:[21,14],2:[21,14],3:[21,14]}), lastImportAdded:35 }));
    const t = await text(p);
    chk('shows the day', /day 3 of 15/.test(t), t.slice(0,70));
    chk('shows the row count', /105/.test(t));
    chk('shows when the importer last ran', /min ago|just now/.test(t), (t.match(/Last import run[^A-Z]*/)||[''])[0].slice(0,50));
    const grid = await p.evaluate(()=>({
      cells: document.querySelectorAll('.bs-d').length,
      full: document.querySelectorAll('.bs-d.has').length,
      part: document.querySelectorAll('.bs-d.part').length }));
    chk('fifteen day cells, three filled', grid.cells===15 && grid.full===3 && grid.part===0, JSON.stringify(grid));
    chk('no false alarm while healthy', (await p.evaluate(()=>document.querySelectorAll('.bs-warn').length))===0);
    const el = await p.$('#bashoBody'); if (el) await el.screenshot({path:'/tmp/basho-running.png'});
    await ctx.close();
  }

  /* --- a day that came in short --- */
  {
    const {ctx,p} = await open(b, ()=>payload({ lastDay:2, rows:44, days: days({1:[21,14],2:[9,0]}) }));
    const grid = await p.evaluate(()=>({full:document.querySelectorAll('.bs-d.has').length,
                                        part:document.querySelectorAll('.bs-d.part').length}));
    chk('a partial day is flagged, not counted as complete', grid.full===1 && grid.part===1, JSON.stringify(grid));
    await ctx.close();
  }

  /* --- the importer has stalled --- */
  {
    const stale = new Date(Date.now()-200*60000).toISOString();
    const {ctx,p} = await open(b, ()=>payload({ lastDay:5, rows:175,
      days: days({1:[21,14],2:[21,14],3:[21,14],4:[21,14],5:[21,14]}), lastImport:stale }));
    const t = await text(p);
    chk('a stalled importer raises a warning', /Nothing has been imported for/.test(t), t.slice(-90));
    chk('and points at the trigger', /hourly trigger/.test(t));
    const el = await p.$('#bashoBody'); if (el) await el.screenshot({path:'/tmp/basho-stalled.png'});
    await ctx.close();
  }

  /* --- BASHO_ID left pointing at the previous tournament --- */
  {
    const {ctx,p} = await open(b, ()=>payload({ basho:'Kyushu 2026', lastDay:0, rows:0,
      bashoId:'202609', bashoLabel:'Kyushu 2026', idExpects:'Aki 2026' }));
    const t = await text(p);
    chk('the three-way name check catches the drift', /These disagree/.test(t), t.slice(-110));
    chk('and names both sides', /202609/.test(t) && /Kyushu 2026/.test(t));
    const el = await p.$('#bashoBody'); if (el) await el.screenshot({path:'/tmp/basho-drift.png'});
    await ctx.close();
  }

  /* --- finished but unranked --- */
  {
    const {ctx,p} = await open(b, ()=>payload({ lastDay:15, rows:525, yusho:'Onosato',
      sansho:'Ura, Takayasu', days: days(Object.fromEntries(Array.from({length:15},(_,i)=>[i+1,[21,14]]))) }));
    const t = await text(p);
    chk('a finished basho reads as final', /final/.test(t), t.slice(0,60));
    chk('the yusho and sansho show', /Onosato/.test(t) && /Takayasu/.test(t));
    chk('it nags about Apply ranking', /has not been ranked/.test(t), t.slice(-90));
    await ctx.close();
  }

  /* --- the manual refresh --- */
  {
    let added = 12;
    const {ctx,p,sent} = await open(b, ()=>payload({lastDay:1, rows:35, days:days({1:[21,14]})}),
                                    ()=>({ok:true, added:added, rows:47}));
    sent.length = 0;
    await p.evaluate(()=>document.getElementById('bashoRefreshBtn').click());
    await p.waitForTimeout(2500);
    chk('Refresh now calls the importer', sent.includes('adminRefreshResults'), JSON.stringify(sent));
    chk('and reports what it added', /Imported 12 new bouts/.test(
        await p.evaluate(()=>document.getElementById('bashoMsg').textContent)),
        await p.evaluate(()=>document.getElementById('bashoMsg').textContent));
    chk('then reloads the panel', sent.filter(a=>a==='adminBasho').length>=1, JSON.stringify(sent));

    added = 0;
    await p.evaluate(()=>document.getElementById('bashoRefreshBtn').click());
    await p.waitForTimeout(2500);
    chk('nothing new says so plainly', /Nothing new to import/.test(
        await p.evaluate(()=>document.getElementById('bashoMsg').textContent)));
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close();
  if (bad) process.exit(1);
})();
