/* A profile must send you back where you came from.

   Two doors open a profile — the Rikishi tab's directory and the Banzuke
   tab's scout cards — and a single hard-coded "back" would make one of those
   journeys lose its place every time. So the assertion is a ROUND TRIP from
   each door, not merely that a back link exists. */
const { chromium } = require('playwright');
const LIVE = require('/tmp/livebanzuke.json');
const CAREER = require('/tmp/career-hoshoryu.json');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};

async function page(b){
  const ctx = await b.newContext({viewport:{width:1280,height:1000}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.route('**sumo-api.com/**', r=>{
    const u=r.request().url(); const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if(/banzuke\/Makuuchi/i.test(u)) return j(LIVE.mak);
    if(/banzuke\/Juryo/i.test(u))    return j(LIVE.jur);
    if(/\/matches$/.test(u))         return j(CAREER.matches);
    if(/ranks=true/.test(u))         return j(CAREER.profile);
    return j({});
  });
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));
  return {ctx,p,errs};
}
const settle = p => p.waitForTimeout(4500);

(async ()=>{
  const b = await chromium.launch();

  /* ---- the tab itself ---- */
  { const {ctx,p,errs} = await page(b);
    await p.goto('http://127.0.0.1:8902/analysis.html',{waitUntil:'domcontentloaded'});
    await settle(p);
    const labs = await p.evaluate(()=>[...document.querySelectorAll('.tab .tab-lab')].map(e=>e.textContent));
    chk('Rikishi is a tab, next to Banzuke',
        labs[0]==='Banzuke' && labs[1]==='Rikishi', JSON.stringify(labs));
    await p.click('#tab-rikishi');
    await p.waitForTimeout(700);
    const r = await p.evaluate(()=>({
      n:document.querySelectorAll('#rkDir .rkd').length,
      hash:location.hash,
      onlyOneVisible:[...document.querySelectorAll('.view.on')].map(e=>e.id) }));
    chk('it lists the whole banzuke', r.n===70, r.n+' entries');
    chk('and is the only view showing', JSON.stringify(r.onlyOneVisible)==='["v-rikishi"]', JSON.stringify(r.onlyOneVisible));
    chk('the tab is deep-linkable', r.hash==='#rikishi', r.hash);
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close(); }

  /* ---- door 1: the Rikishi tab ---- */
  { const {ctx,p,errs} = await page(b);
    await p.goto('http://127.0.0.1:8902/analysis.html#rikishi',{waitUntil:'domcontentloaded'});
    await settle(p);
    chk('a #rikishi link opens on that tab',
        (await p.evaluate(()=>document.getElementById('tab-rikishi').getAttribute('aria-selected')))==='true');
    const name = await p.evaluate(()=>document.querySelector('#rkDir .rkd .rkd__n').textContent);
    await p.click('#rkDir .rkd');
    await p.waitForTimeout(3000);
    chk('a card opens that man’s profile',
        (await p.evaluate(()=>(document.querySelector('.hero__name')||{}).textContent))===name,
        name);
    const back = await p.evaluate(()=>({t:document.querySelector('.back').textContent, h:document.querySelector('.back').getAttribute('href')}));
    chk('back is labelled for where you came from', /All rikishi/.test(back.t), back.t);
    await p.click('.back');
    await settle(p);
    chk('and lands back on the Rikishi tab',
        (await p.evaluate(()=>document.getElementById('tab-rikishi').getAttribute('aria-selected')))==='true',
        await p.evaluate(()=>location.hash));
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close(); }

  /* ---- door 2: the Banzuke tab ---- */
  { const {ctx,p,errs} = await page(b);
    await p.goto('http://127.0.0.1:8902/analysis.html',{waitUntil:'domcontentloaded'});
    await settle(p);
    await p.click('.act.profile');
    await p.waitForTimeout(3000);
    const back = await p.evaluate(()=>({t:document.querySelector('.back').textContent, h:document.querySelector('.back').getAttribute('href')}));
    chk('from Banzuke, back says Banzuke', /Banzuke/.test(back.t), back.t);
    await p.click('.back');
    await settle(p);
    chk('and lands back on the Banzuke tab',
        (await p.evaluate(()=>document.getElementById('tab-browse').getAttribute('aria-selected')))==='true',
        await p.evaluate(()=>location.hash));
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close(); }

  /* ---- the old bare URL still goes somewhere sensible ---- */
  { const {ctx,p} = await page(b);
    await p.goto('http://127.0.0.1:8902/rikishi.html',{waitUntil:'domcontentloaded'});
    await settle(p);
    chk('a bare rikishi.html redirects to the directory tab',
        /analysis\.html#rikishi$/.test(p.url()), p.url());
    await ctx.close(); }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
