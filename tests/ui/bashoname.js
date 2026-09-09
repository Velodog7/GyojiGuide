/* Every label that names the tournament must come from the schedule.

   The bug: dohyo.html's subnav said "Nagoya 2026" hardcoded in the markup, so
   it advertised the wrong tournament for the whole of Aki — and would have
   again every time a basho turned over. These assertions run the clock forward
   through four points in the year and check the labels follow.

   Note what is deliberately NOT covered: prose describing hand-maintained
   content (the Health watch notes, the Nagoya honours table). Those name one
   specific basho on purpose and must stay put. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};

const AT = {
  'before Aki'      : Date.parse('2026-09-09T12:00:00+09:00'),
  'during Aki'      : Date.parse('2026-09-20T12:00:00+09:00'),
  'between the two' : Date.parse('2026-10-10T12:00:00+09:00'),
  'during Kyushu'   : Date.parse('2026-11-12T12:00:00+09:00'),
};
const EXPECT = {
  'before Aki':'Aki 2026', 'during Aki':'Aki 2026',
  'between the two':'Kyushu 2026', 'during Kyushu':'Kyushu 2026',
};

async function open(b, page, atMs){
  const ctx = await b.newContext({viewport:{width:1280,height:900}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.addInitScript(t => {
    const R = Date; const off = t - R.now();
    class D extends R { constructor(...a){ if(!a.length) super(R.now()+off); else super(...a); }
      static now(){ return R.now()+off; } }
    D.parse = R.parse; D.UTC = R.UTC; window.Date = D;
    try{ localStorage.setItem('fantasy.acct',
      JSON.stringify({handle:'sean',name:'Sean',auth:'h1'})); }catch(e){}
  }, atMs);
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:JSON.stringify({ok:true,users:[],results:[],meta:{basho:'Aki 2026',lastDay:0},
                         leagues:[],threads:[],unread:0,champion:null})}));
  await p.goto('http://127.0.0.1:8902/'+page,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  return {ctx,p,errs};
}

(async ()=>{
  const b = await chromium.launch();

  /* ---- the module itself ---- */
  {
    const {ctx,p} = await open(b,'dohyo.html', AT['before Aki']);
    const api = await p.evaluate(()=>({
      has: !!(window.GyojiGuide && GyojiGuide.basho && GyojiGuide.basho.focusName),
      name: window.GyojiGuide && GyojiGuide.basho && GyojiGuide.basho.focusName() }));
    chk('gg-basho exposes focusName()', api.has, JSON.stringify(api));
    chk('and it names the upcoming basho', api.name==='Aki 2026', api.name);
    await ctx.close();
  }

  /* ---- the simulation page, across the year ---- */
  for (const [label, at] of Object.entries(AT)){
    const {ctx,p,errs} = await open(b,'dohyo.html', at);
    const st = await p.evaluate(()=>({
      brand: (document.getElementById('bashoName')||{}).textContent||'',
      credit: (document.getElementById('creditBasho')||{}).textContent||'',
      stale: /Nagoya 2026/.test(document.body.innerText) }));
    chk('sim subnav, '+label+': '+EXPECT[label], st.brand===EXPECT[label], st.brand);
    chk('sim credit, '+label, st.credit===EXPECT[label], st.credit);
    chk('sim, '+label+': no stale name left on the page', !st.stale, st.stale?'"Nagoya 2026" still visible':'');
    chk('sim, '+label+': no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* ---- the mock-draft modal on analysis ---- */
  for (const label of ['before Aki','during Kyushu']){
    const {ctx,p} = await open(b,'analysis.html', AT[label]);
    const t = await p.evaluate(()=>(document.getElementById('edohyoBasho')||{}).textContent||'');
    chk('"simulate <basho>" on analysis, '+label, t===EXPECT[label], t);
    await ctx.close();
  }

  /* ---- hand-written content must NOT follow the calendar ---- */
  {
    const {ctx,p} = await open(b,'analysis.html', AT['during Kyushu']);
    const health = await p.evaluate(()=>{
      const el=document.querySelector('#v-health .view-sub'); return el?el.textContent:''; });
    chk('the hand-written health notes still say Aki, not Kyushu',
        /Aki 2026/.test(health) && !/Kyushu/.test(health), health.slice(0,80));
    await ctx.close();
  }

  /* ---- fantasy's offline fallback ---- */
  {
    const ctx = await b.newContext({viewport:{width:1280,height:900}});
    const p = await ctx.newPage();
    await p.addInitScript(t => { const R=Date; const off=t-R.now();
      class D extends R { constructor(...a){ if(!a.length) super(R.now()+off); else super(...a); }
        static now(){ return R.now()+off; } }
      D.parse=R.parse; D.UTC=R.UTC; window.Date=D; }, AT['during Kyushu']);
    await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
    await p.route('**script.google.com/**', r=>r.abort());   // backend down
    await p.goto('http://127.0.0.1:8902/fantasy.html',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(4000);
    const t = await p.evaluate(()=>document.body.innerText);
    chk('with the backend down, fantasy does not invent a stale basho',
        !/Aki 2026/.test(t), /Aki 2026/.test(t) ? 'still says Aki during Kyushu' : '');
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
