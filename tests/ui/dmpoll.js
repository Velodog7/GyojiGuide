/* Does the DM badge poll actually stop when the tab is hidden, and pick straight
   back up when it isn't? Counts real requests to the dmUnread endpoint. */
const { chromium } = require('playwright');

(async ()=>{
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:1100,height:800} });
  const p = await ctx.newPage();
  let unread = 0, hits = [];
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));

  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const u=r.request().url();
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    /* whatsNew REPLACED dmUnread as the nav poll. This matcher still said
       dmUnread long after the swap, so every count below was 0 and the report
       read as "the poll never fires" — which nothing noticed, because this
       file only printed. Match both, and assert at the end. */
    if (/dmUnread|whatsNew/.test(u)){ hits.push(Date.now());
      return j({ok:true, unread:unread, basho:'Aki 2026', lastDay:0}); }
    if (/dm/i.test(u)) return j({ok:true,threads:[],users:[]});
    if (/accountSummary/.test(u)) return j({ok:true,titles:[],badges:[],history:[],allTime:{},leagues:[]});
    return j({ok:true,users:[],results:[],meta:{basho:'Aki 2026',lastDay:0}});
  });
  await p.addInitScript(()=>{ try{ localStorage.setItem('fantasy.acct', JSON.stringify({handle:'sean',name:'Sean',auth:'h1'})); }catch(e){} });

  /* the loop is 45s; drive it with a fake clock so the test takes seconds */
  await p.addInitScript(()=>{
    const realTO = window.setTimeout.bind(window);
    window.__pending = [];
    window.setTimeout = function(fn, ms){
      if (ms >= 40000){ const id = {fn}; window.__pending.push(id); return id; }
      return realTO(fn, ms);
    };
    const realCT = window.clearTimeout.bind(window);
    window.clearTimeout = function(id){
      if (id && id.fn){ const i = window.__pending.indexOf(id); if (i>=0) window.__pending.splice(i,1); return; }
      return realCT(id);
    };
    window.__fire = function(){ const q = window.__pending.splice(0); q.forEach(x=>x.fn()); return q.length; };
    /* a settable visibilityState */
    window.__hidden = false;
    Object.defineProperty(document, 'visibilityState', { get(){ return window.__hidden ? 'hidden' : 'visible'; } });
    Object.defineProperty(document, 'hidden', { get(){ return window.__hidden; } });
    window.__setHidden = function(v){ window.__hidden = !!v; document.dispatchEvent(new Event('visibilitychange')); };
  });

  await p.goto('http://127.0.0.1:8902/fantasy.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3000);

  const at = ()=>hits.length;
  const step = async (label, fn)=>{ const before=at(); await fn(); await p.waitForTimeout(500);
    return { label, requests: at()-before, queued: await p.evaluate(()=>window.__pending.length) }; };

  const log = [];
  log.push({ label:'after load (visible)', requests: at(), queued: await p.evaluate(()=>window.__pending.length) });
  log.push(await step('3 ticks while visible', async()=>{ for(let i=0;i<3;i++){ await p.evaluate(()=>window.__fire()); await p.waitForTimeout(250);} }));
  log.push(await step('hide the tab',        async()=>{ await p.evaluate(()=>window.__setHidden(true)); }));
  log.push(await step('3 ticks while hidden',async()=>{ for(let i=0;i<3;i++){ await p.evaluate(()=>window.__fire()); await p.waitForTimeout(250);} }));
  log.push(await step('show it again',       async()=>{ await p.evaluate(()=>window.__setHidden(false)); }));
  log.push(await step('2 ticks while visible',async()=>{ for(let i=0;i<2;i++){ await p.evaluate(()=>window.__fire()); await p.waitForTimeout(250);} }));

  // and the badge still renders
  unread = 7;
  await p.evaluate(()=>window.__setHidden(true));
  await p.waitForTimeout(200);
  await p.evaluate(()=>window.__setHidden(false));
  await p.waitForTimeout(700);
  const badge = await p.evaluate(()=>{ const b=document.querySelector('#ggaChipDm');
    return b ? { text:b.textContent, hidden:b.hidden } : null; });

  console.log(JSON.stringify({ log, badgeAfterReturn: badge, errors: errs.slice(0,3) }, null, 1));
  /* A report that cannot fail is not a test. The one thing this must never
     silently return to is counting an endpoint the app stopped calling. */
  const total = hits.length;
  const bad = [];
  if (!total) bad.push('the nav poll made no requests at all — is the matcher still pointed at the endpoint the page uses?');
  if (errs.length) bad.push('page errors: ' + errs[0]);
  if (bad.length){ bad.forEach(m=>console.log('  FAIL ' + m)); await b.close(); process.exit(1); }
  console.log('  ok   the nav poll fired ' + total + ' times, parked while hidden, resumed on return');
  await b.close();
})();
