/* The welcome card must fit without the card scrolling internally, in every
   state the ticker can be in — including hidden, where a stale margin used to
   leave a hole under the logo. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};
const AKI_OPENS = Date.parse('2026-09-13T00:00:00+09:00');

async function look(b,w,h,atMs,tag){
  const ctx=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:2});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,120)));
  if (atMs) await p.addInitScript(t=>{ const R=Date; const o=t-R.now();
    class D extends R{ constructor(...a){ if(!a.length) super(R.now()+o); else super(...a);}
      static now(){return R.now()+o;} } D.parse=R.parse; D.UTC=R.UTC; window.Date=D; }, atMs);
  await p.route('**script.google.com/**',r=>r.fulfill({contentType:'application/json',body:'{"ok":true,"standings":[]}'}));
  await p.route('**sumo-api.com/**',r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.goto('http://127.0.0.1:8902/index.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  const m=await p.evaluate(()=>{
    const c=document.getElementById('bzCard'), s=document.getElementById('bzStrip'),
          logo=document.querySelector('.bz-logo'), intro=document.querySelector('.bz-intro');
    const gap = s && !s.hidden && logo
      ? Math.round(s.getBoundingClientRect().top - logo.getBoundingClientRect().bottom) : null;
    const holeIfHidden = (s && s.hidden && logo && intro)
      ? Math.round(intro.getBoundingClientRect().top - logo.getBoundingClientRect().bottom) : null;
    return { over: c.scrollHeight - c.clientHeight, h:c.scrollHeight,
      stripHidden: s.hidden, live: s.classList.contains('is-live'),
      text: s.innerText.replace(/\s+/g,' ').trim(),
      afterLogo: gap, holeIfHidden,
      order: [...document.querySelector('.bz-welcome').children].map(e=>e.className.split(' ')[0]),
      belowFold: Math.round(c.getBoundingClientRect().bottom - window.innerHeight) };
  });
  return {ctx,p,m,errs,tag};
}

(async()=>{
  const b=await chromium.launch();
  for (const [w,h,label] of [[1280,800,'1280x800'],[1280,720,'1280x720'],[1440,900,'1440x900'],[390,844,'390x844']]){
    const {ctx,m,errs}=await look(b,w,h,null,label);
    chk(label+': the card does not scroll inside itself', m.over<=0, 'over by '+m.over+'px (h='+m.h+')');
    /* Diagnostic, not an assertion. Whether the card clears the fold depends on
       the logo height and the nav offset — design choices, not correctness. The
       invariant worth guarding is the one above: the card must never grow its
       own scrollbar, which is what made the ticker feel buried. */
    console.log('         ('+label+' clears the fold by '+(-m.belowFold)+'px)');
    chk(label+': no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }
  {
    const {ctx,m}=await look(b,1280,800,null,'order');
    /* an sr-only <h1> sits between the strip and the intro; it is invisible,
       so the test asserts the two visible neighbours, not a literal triple */
    chk('the ticker sits under the logo',
        m.order[0]==='bz-logo' && m.order[1]==='bz-strip',
        JSON.stringify(m.order));
    chk('with the card’s own spacing, not a bespoke margin', m.afterLogo>=10 && m.afterLogo<=20, m.afterLogo+'px under the logo');
    await ctx.close();
  }
  {   /* day 1: the pulsing live state, which is what this is all for */
    const {ctx,m}=await look(b,1280,800,AKI_OPENS+6*3600000,'live');
    chk('during a basho it goes live', m.live && /Day 1 of 15/.test(m.text), m.text);
    chk('and the card still fits', m.over<=0, 'over by '+m.over+'px');
    await ctx.close();
  }
  {   /* the idle state: schedule exhausted, strip hides */
    const {ctx,p}=await look(b,1280,800,null,'hidden');
    await p.evaluate(()=>{ document.getElementById('bzStrip').hidden = true; });
    await p.waitForTimeout(300);
    const m=await p.evaluate(()=>{
      const logo=document.querySelector('.bz-logo'), intro=document.querySelector('.bz-intro');
      return Math.round(intro.getBoundingClientRect().top - logo.getBoundingClientRect().bottom); });
    chk('hiding the ticker leaves no hole under the logo', m>=10 && m<=20, m+'px');
    await ctx.close();
  }
  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if(bad) process.exit(1);
})();
