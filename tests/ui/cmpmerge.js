/* Compare and Analytics were two tabs answering one question at two widths.
   Merging them is only a win if NOTHING that worked in either view stopped
   working — so these assert both halves still function, that the tab count
   actually dropped, and that links people already hold still land somewhere
   sensible. */
const { chromium } = require('playwright');
const LIVE = require('/tmp/livebanzuke.json');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};

async function open(b, hash){
  const ctx = await b.newContext({viewport:{width:1280,height:1000}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.route('**sumo-api.com/**', r=>{
    const u=r.request().url(); const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if(/banzuke\/Makuuchi/i.test(u)) return j(LIVE.mak);
    if(/banzuke\/Juryo/i.test(u))    return j(LIVE.jur);
    return j({});
  });
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));
  await p.goto('http://127.0.0.1:8902/analysis.html'+(hash||''),{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5000);
  return {ctx,p,errs};
}

(async ()=>{
  const b = await chromium.launch();

  { const {ctx,p,errs} = await open(b);
    const labs = await p.evaluate(()=>[...document.querySelectorAll('.tab .tab-lab')].map(e=>e.textContent));
    chk('there is one fewer tab, and no Analytics',
        labs.length===6 && labs.indexOf('Analytics')<0, JSON.stringify(labs));
    chk('Compare survived', labs.indexOf('Compare')>=0, JSON.stringify(labs));
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close(); }

  /* both halves must still do their job */
  { const {ctx,p,errs} = await open(b, '#compare');
    const picked = await p.evaluate(()=>({
      modes:[...document.querySelectorAll('.cmp-modes button')].map(x=>x.textContent),
      on:[...document.querySelectorAll('.cmp-modes button.on')].map(x=>x.textContent),
      pickedVisible: !document.getElementById('cmpPicked').hidden,
      fieldVisible: !document.getElementById('cmpField').hidden,
      addControl: !!document.getElementById('cmpAdd') }));
    chk('the tab offers both modes', JSON.stringify(picked.modes)==='["Selected","Whole field"]',
        JSON.stringify(picked.modes));
    chk('it opens on Selected', JSON.stringify(picked.on)==='["Selected"]' && picked.pickedVisible && !picked.fieldVisible,
        JSON.stringify(picked));
    chk('the old Compare still works — add-wrestler is there', picked.addControl);

    await p.click('.cmp-modes button[data-m="field"]');
    await p.waitForTimeout(1200);
    const field = await p.evaluate(()=>({
      fieldVisible: !document.getElementById('cmpField').hidden,
      pickedVisible: !document.getElementById('cmpPicked').hidden,
      rows: document.querySelectorAll('#anBody tr').length,
      scope: document.querySelectorAll('#anScope .an-sc').length,
      toggle: document.querySelectorAll('#anToggle button').length }));
    chk('Whole field renders the analytics table', field.rows>=70, field.rows+' rows');
    chk('with its scope and list/graph controls intact',
        field.scope===3 && field.toggle===2, JSON.stringify(field));
    chk('and only one mode is on screen at a time',
        field.fieldVisible && !field.pickedVisible, JSON.stringify(field));
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close(); }

  /* the graph half of Analytics was a separate control set — prove it survived */
  { const {ctx,p,errs} = await open(b, '#analytics');
    const legacy = await p.evaluate(()=>({
      tab:[...document.querySelectorAll('.tab')].filter(t=>t.getAttribute('aria-selected')==='true').map(t=>t.id),
      field: !document.getElementById('cmpField').hidden }));
    chk('an existing #analytics link still lands on the field view',
        JSON.stringify(legacy.tab)==='["tab-compare"]' && legacy.field, JSON.stringify(legacy));

    await p.click('#anToggle button[data-v="graph"]');
    await p.waitForTimeout(1200);
    const graph = await p.evaluate(()=>({
      gopts: document.getElementById('anGopts').style.display !== 'none',
      body: (document.getElementById('anBody')||{}).innerHTML.length }));
    chk('the graph mode still opens its options', graph.gopts, JSON.stringify(graph));
    chk('and draws something', graph.body>200, graph.body+' chars');
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close(); }

  { const {ctx,p} = await open(b, '#compare');
    const copy = await p.evaluate(()=>document.getElementById('cmpBody').textContent);
    chk('the empty state names a tab that exists',
        !/Browse/.test(copy), copy.slice(0,80));
    await ctx.close(); }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
