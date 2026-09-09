/* Notifications: toasts, the opt-in OS bridge, and — the part that actually
   matters — announcing CHANGES rather than state.

   The failure everyone builds first is announcing on arrival: open the page
   with nine unread and get nine toasts, reload and get them again. So most of
   these assertions are about silence.

   Notification is stubbed before any page script runs; headless Chromium won't
   grant a real permission and a real one gives nothing to assert against. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};

async function open(b, opts){
  opts = opts || {};
  const ctx = await b.newContext({viewport:{width:1280,height:900}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.addInitScript((o)=>{
    window.__os = { made:[], permission:o.perm, asked:0 };
    function FakeNotification(title, opt){
      window.__os.made.push({title, body:(opt||{}).body||'', tag:(opt||{}).tag||''});
      this.close = function(){};
    }
    FakeNotification.requestPermission = function(){
      window.__os.asked++;
      window.__os.permission = o.grant || 'denied';
      Object.defineProperty(FakeNotification,'permission',{value:window.__os.permission,configurable:true});
      return Promise.resolve(window.__os.permission);
    };
    Object.defineProperty(FakeNotification,'permission',{value:o.perm,configurable:true});
    if (o.perm !== 'unsupported') window.Notification = FakeNotification;
    else { try { delete window.Notification; } catch(e){} }
    try{
      localStorage.setItem('fantasy.acct', JSON.stringify({handle:'sean',name:'Sean',auth:'h1'}));
      if (o.optIn) localStorage.setItem('gg.notify.os','1');
    }catch(e){}
  }, {perm: opts.perm || 'default', grant: opts.grant, optIn: opts.optIn});
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0},"unread":0}'}));
  await p.goto('http://127.0.0.1:8902/'+(opts.page||'index.html'),{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2500);
  return {ctx,p,errs};
}
const toasts = p => p.evaluate(()=>[...document.querySelectorAll('.ggn-toast')]
  .map(e=>e.querySelector('.ggn-toast__t').textContent));
const osMade = p => p.evaluate(()=>window.__os.made.map(m=>m.title));

(async ()=>{
  const b = await chromium.launch();

  /* ---- the module is present and quiet ---- */
  {
    const {ctx,p,errs} = await open(b);
    const api = await p.evaluate(()=>({
      has: !!(window.GyojiGuide && GyojiGuide.notify),
      fns: window.GyojiGuide && GyojiGuide.notify
        ? ['push','changed','rose','askOS','osWanted','osPermission'].filter(k=>typeof GyojiGuide.notify[k]==='function').length : 0 }));
    chk('gg-notify loads', api.has);
    chk('and exposes its interface', api.fns===6, api.fns+'/6');
    chk('nothing is announced just by loading', (await toasts(p)).length===0, JSON.stringify(await toasts(p)));
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* ---- change detection: the whole point ---- */
  {
    const {ctx,p} = await open(b);
    const r = await p.evaluate(()=>{
      const N = GyojiGuide.notify; N.forget();
      const out = {};
      out.firstIsSilent   = N.rose('dm', 9);      // arriving with 9 unread
      out.sameIsSilent    = N.rose('dm', 9);
      out.riseSpeaks      = N.rose('dm', 10);
      out.fallIsSilent    = N.rose('dm', 2);      // you read them
      out.riseAgainSpeaks = N.rose('dm', 3);
      return out;
    });
    chk('arriving with a backlog says nothing', r.firstIsSilent===false, String(r.firstIsSilent));
    chk('an unchanged count says nothing', r.sameIsSilent===false);
    chk('a rise is announced', r.riseSpeaks===true);
    chk('reading your mail is not an event', r.fallIsSilent===false);
    chk('and it can rise again afterwards', r.riseAgainSpeaks===true);
    await ctx.close();
  }

  /* ---- the baseline survives a reload ----
     Uses a key the app itself does not own. The live nav poll rewrites the
     real "dm" baseline from the server on every load — which is correct, and
     is exactly why this has to be measured on a key nothing else touches. */
  {
    const {ctx,p} = await open(b);
    await p.evaluate(()=>{ const N=GyojiGuide.notify; N.forget(); N.rose('probe', 4); });
    await p.reload({waitUntil:'domcontentloaded'});
    await p.waitForTimeout(1500);
    const r = await p.evaluate(()=>({
      same: GyojiGuide.notify.rose('probe', 4),
      higher: GyojiGuide.notify.rose('probe', 5) }));
    chk('a reload does not re-announce what you already saw', r.same===false, String(r.same));
    chk('but something new since the reload still speaks', r.higher===true, String(r.higher));
    await ctx.close();
  }

  /* ---- and the real dm baseline tracks the server, not the page ---- */
  {
    const {ctx,p} = await open(b);
    await p.waitForTimeout(1200);
    const seeded = await p.evaluate(()=>{
      const all = JSON.parse(localStorage.getItem('gg.notify.seen')||'{}');
      return all['sean|dm'];
    });
    chk('the poll seeds the unread baseline from the server on load', seeded===0,
        'baseline '+JSON.stringify(seeded));
    await ctx.close();
  }

  /* ---- baselines are per account ---- */
  {
    const {ctx,p} = await open(b);
    const r = await p.evaluate(()=>{
      const N = GyojiGuide.notify; N.forget();
      N.rose('dm', 5);                                  // seeds for sean
      GG_TEST_SWITCH('someone-else');
      const firstForOther = N.rose('dm', 5);            // must be a fresh seed
      GG_TEST_SWITCH('sean');
      const backToMine = N.rose('dm', 5);               // unchanged for sean
      return { firstForOther, backToMine };
      function GG_TEST_SWITCH(h){
        GyojiGuide.account.set
          ? GyojiGuide.account.set({handle:h,name:h,auth:'x'})
          : localStorage.setItem('fantasy.acct', JSON.stringify({handle:h,name:h,auth:'x'}));
      }
    });
    chk('signing in as someone else starts clean', r.firstForOther===false, String(r.firstForOther));
    chk('and does not disturb your own baseline', r.backToMine===false, String(r.backToMine));
    await ctx.close();
  }

  /* ---- toasts ---- */
  {
    const {ctx,p} = await open(b);
    await p.evaluate(()=>{
      GyojiGuide.notify.push({title:'Day 3 results are in', body:'Aki 2026'});
    });
    await p.waitForTimeout(400);
    let t = await toasts(p);
    chk('a toast appears when you are looking at the page', t.length===1 && /Day 3/.test(t[0]), JSON.stringify(t));
    chk('and nothing went to the OS while the page is visible',
        (await osMade(p)).length===0, JSON.stringify(await osMade(p)));

    await p.evaluate(()=>{ for(let i=0;i<8;i++) GyojiGuide.notify.push({title:'burst '+i}); });
    await p.waitForTimeout(600);
    t = await toasts(p);
    chk('a burst cannot fill the screen', t.length<=4, t.length+' on screen');

    await p.evaluate(()=>document.querySelector('.ggn-toast__x').click());
    await p.waitForTimeout(500);
    chk('they can be dismissed', (await toasts(p)).length<=3, JSON.stringify(await toasts(p)));
    await ctx.close();
  }

  /* ---- hidden tab, opted in: the OS gets it INSTEAD of a toast ---- */
  {
    const {ctx,p} = await open(b,{perm:'granted', optIn:true});
    await p.evaluate(()=>{
      Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});
      GyojiGuide.notify.push({title:'Your pick', body:'Round 2'});
    });
    await p.waitForTimeout(400);
    chk('a hidden tab sends it to the OS', (await osMade(p)).length===1, JSON.stringify(await osMade(p)));
    chk('and does NOT also raise a toast', (await toasts(p)).length===0,
        'both fired — every alert would arrive twice');
    await ctx.close();
  }

  /* ---- hidden tab, NOT opted in: held, then shown on return ---- */
  {
    const {ctx,p} = await open(b,{perm:'default'});
    await p.evaluate(()=>{
      Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});
      GyojiGuide.notify.push({title:'Your pick', body:'Round 2'});
    });
    await p.waitForTimeout(300);
    chk('nothing is shown while hidden', (await toasts(p)).length===0);
    chk('and nothing leaked to the OS without permission', (await osMade(p)).length===0);
    await p.evaluate(()=>{
      Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await p.waitForTimeout(500);
    const t = await toasts(p);
    chk('coming back shows what you missed rather than losing it',
        t.length===1 && /Your pick/.test(t[0]), JSON.stringify(t));
    await ctx.close();
  }

  /* ---- permission is only ever asked from a gesture ---- */
  {
    const {ctx,p} = await open(b,{perm:'default', grant:'granted'});
    await p.waitForTimeout(1200);
    chk('permission is not requested on page load',
        (await p.evaluate(()=>window.__os.asked))===0, 'asked on load');
    const after = await p.evaluate(async()=>{
      const r = await GyojiGuide.notify.askOS();
      return { r, asked: window.__os.asked, wanted: GyojiGuide.notify.osWanted() };
    });
    chk('asking explicitly works', after.r==='granted' && after.asked===1, JSON.stringify(after));
    chk('and the opt-in is remembered', after.wanted===true);
    await ctx.close();
  }

  /* ---- a denial is final and must not be re-asked ---- */
  {
    const {ctx,p} = await open(b,{perm:'denied'});
    const r = await p.evaluate(async()=>{
      const out = await GyojiGuide.notify.askOS();
      return { out, asked: window.__os.asked };
    });
    chk('a blocked origin is not asked again', r.out==='denied' && r.asked===0, JSON.stringify(r));
    await ctx.close();
  }

  /* ---- a browser with no Notification at all ---- */
  {
    const {ctx,p,errs} = await open(b,{perm:'unsupported'});
    const r = await p.evaluate(async()=>{
      const N = GyojiGuide.notify;
      const out = await N.askOS();
      N.push({title:'still works'});
      return { out, perm:N.osPermission(), toasts:document.querySelectorAll('.ggn-toast').length };
    });
    chk('an unsupported browser reports itself', r.out==='unsupported' && r.perm==='unsupported', JSON.stringify(r));
    chk('and toasts still work there', r.toasts===1, String(r.toasts));
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
