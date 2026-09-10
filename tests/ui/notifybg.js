/* The background tab, which is the whole point of the OS bridge.

   The nav poll parked itself whenever the tab was hidden. That is right for
   most people — a background tab that can only ever raise a toast when you come
   back has no reason to spend an Apps Script request. But it silently defeated
   the feature shipped beside it: detection only ever ran while the tab was
   visible, so push() never once saw a hidden tab, and the browser notification
   the opt-in row promises could not fire for mail or for a new day's results.

   So the opt-in is now the gate. Opted out: parks, exactly as before, nothing
   spent. Opted in: keeps looking, four times slower.

   Cadence is asserted by watching what the page ARMS rather than by waiting
   three minutes for it — the scheduled delay is the thing under test, and a
   test that sleeps for the real interval would take longer than the feature. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};

async function open(b, opts){
  opts = opts || {};
  const ctx = await b.newContext({viewport:{width:1280,height:900}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  let unread = opts.unread || 0, lastDay = opts.lastDay || 0;
  const counts = { whatsNew:0 };

  await p.addInitScript((o)=>{
    window.__os = { made:[] };
    function FakeNotification(title, opt){
      window.__os.made.push({title, body:(opt||{}).body||''});
      this.close=function(){};
    }
    FakeNotification.requestPermission = function(){ return Promise.resolve('granted'); };
    Object.defineProperty(FakeNotification,'permission',{value:o.perm,configurable:true});
    window.Notification = FakeNotification;

    /* record the long timers the page arms, and let the test fire one */
    window.__timers = [];
    var realST = window.setTimeout;
    window.setTimeout = function(fn, ms){
      if (ms >= 30000) window.__timers.push({ms:ms, fn:fn});
      return realST.apply(window, arguments);
    };
    window.__armed = function(){ return window.__timers.map(function(t){return t.ms;}); };
    window.__fireLast = function(){
      var t = window.__timers[window.__timers.length-1];
      if (t) t.fn();
    };

    try{
      localStorage.setItem('fantasy.acct', JSON.stringify({handle:'sean',name:'Sean',auth:'h1'}));
      if (o.optIn) localStorage.setItem('gg.notify.os','1');
    }catch(e){}
    window.__hide = function(v){
      Object.defineProperty(document,'visibilityState',{value:v?'hidden':'visible',configurable:true});
      document.dispatchEvent(new Event('visibilitychange'));
    };
  }, {perm: opts.perm||'granted', optIn: !!opts.optIn});

  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const url = r.request().url();
    const j = o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (/action=whatsNew/.test(url)) { counts.whatsNew++;
      return j({ok:true, unread, basho:'Aki 2026', lastDay, lastImport:'', serverNow:new Date().toISOString()}); }
    return j({ok:true, users:[], results:[], meta:{basho:'Aki 2026',lastDay}, unread});
  });
  await p.goto('http://127.0.0.1:8902/index.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2500);
  return {ctx, p, errs, counts,
    hide: v => p.evaluate(v=>window.__hide(v), v),
    armed: () => p.evaluate(()=>window.__armed()),
    fireLast: () => p.evaluate(()=>window.__fireLast()),
    setUnread: n => { unread = n; },
    setDay: d => { lastDay = d; }};
}
const osMade = p => p.evaluate(()=>window.__os.made.map(m=>m.title));
const toasts = p => p.evaluate(()=>[...document.querySelectorAll('.ggn-toast')]
  .map(e=>e.querySelector('.ggn-toast__t').textContent));

(async ()=>{
  const b = await chromium.launch();

  /* ---- opted OUT: parks, exactly as before ---- */
  {
    const {ctx,p,counts,hide,errs} = await open(b,{optIn:false, perm:'default'});
    chk('the poll runs while you are looking at the page', counts.whatsNew >= 1, counts.whatsNew+' calls');
    await hide(true);
    const mark = counts.whatsNew;
    await p.waitForTimeout(4000);
    chk('opted out, a hidden tab spends nothing', counts.whatsNew === mark,
        (counts.whatsNew-mark)+' requests while hidden');
    await hide(false);
    await p.waitForTimeout(1200);
    chk('and it picks straight back up on return', counts.whatsNew > mark,
        (counts.whatsNew-mark)+' after return');
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* ---- opted IN: keeps looking, slower ---- */
  {
    const {ctx,p,counts,hide,armed,errs} = await open(b,{optIn:true, perm:'granted'});
    const visible = await armed();
    chk('a visible tab re-checks every 45s', visible.includes(45000), JSON.stringify(visible));

    const mark = counts.whatsNew;
    await hide(true);
    await p.waitForTimeout(1200);
    chk('switching away does not itself cost a request', counts.whatsNew === mark,
        (counts.whatsNew-mark)+' spent on the tab switch');

    const after = await armed();
    chk('but the loop is still armed, at the slower cadence',
        after[after.length-1] === 180000, JSON.stringify(after.slice(-3)));
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* ---- the point of all of it: mail arriving in a background tab ---- */
  {
    const {ctx,p,hide,fireLast,setUnread} = await open(b,{optIn:true, perm:'granted', unread:0});
    await p.waitForTimeout(800);               // baseline seeded at 0
    await hide(true);
    setUnread(3);                              // three messages while you're away
    await fireLast();                          // the hidden-cadence poll comes due
    await p.waitForTimeout(1500);
    const made = await osMade(p);
    chk('a message arriving in a hidden tab reaches the OS',
        made.some(t=>/message/i.test(t)), JSON.stringify(made));
    chk('and did not also raise a toast behind your back',
        (await toasts(p)).length===0, JSON.stringify(await toasts(p)));
    await ctx.close();
  }

  /* ---- the same for a day landing, which is the Sunday case ---- */
  {
    const {ctx,p,hide,fireLast,setDay} = await open(b,{optIn:true, perm:'granted', lastDay:0});
    await p.waitForTimeout(800);
    await hide(true);
    setDay(1);                                 // the importer writes day 1
    await fireLast();
    await p.waitForTimeout(1500);
    const made = await osMade(p);
    chk('day 1 landing in a hidden tab reaches the OS',
        made.some(t=>/day 1/i.test(t)), JSON.stringify(made));
    await ctx.close();
  }

  /* ---- and the ordinary case: day 1 while you ARE looking at the page ---- */
  {
    const {ctx,p,setDay} = await open(b,{optIn:false, perm:'default', lastDay:0});
    await p.waitForTimeout(1200);              // seeded at 0, silent
    chk('opening before the basho announces nothing', (await toasts(p)).length===0,
        JSON.stringify(await toasts(p)));
    setDay(1);
    await p.evaluate(()=>{ document.dispatchEvent(new Event('visibilitychange')); });
    await p.waitForTimeout(1500);
    const t = await toasts(p);
    chk('day 1 raises a toast on a visible tab', t.some(x=>/Day 1/.test(x)), JSON.stringify(t));
    chk('and nothing went to the OS while you were looking', (await osMade(p)).length===0);
    await ctx.close();
  }

  /* ---- opted in but the browser said no: park like everyone else ---- */
  {
    const {ctx,p,counts,hide,armed} = await open(b,{optIn:true, perm:'denied'});
    await hide(true);
    const mark = counts.whatsNew;
    await p.waitForTimeout(4000);
    const a = await armed();
    chk('a blocked origin parks rather than polling', counts.whatsNew === mark,
        (counts.whatsNew-mark)+' requests spent with permission denied');
    chk('and arms nothing at the hidden cadence', !a.includes(180000), JSON.stringify(a));
    await ctx.close();
  }

  /* ---- nothing changed for a signed-out reader ---- */
  {
    const ctx = await (await b).newContext();
    const p = await ctx.newPage();
    let hits = 0;
    await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
    await p.route('**script.google.com/**', r=>{ if(/whatsNew/.test(r.request().url())) hits++;
      r.fulfill({contentType:'application/json',body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}); });
    await p.goto('http://127.0.0.1:8902/index.html',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(3000);
    chk('signed out, the nav never polls at all', hits===0, hits+' calls');
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
