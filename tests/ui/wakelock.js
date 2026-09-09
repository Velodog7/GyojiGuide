/* The screen must not dim while bouts are playing.

   Headless Chromium does not hand out a real screen wake lock, and even a
   headed browser would give us nothing observable to assert — so the API is
   stubbed BEFORE any page script runs and we assert the page's behaviour
   against it: when it asks, when it lets go, and whether it recovers the lock
   after the browser takes it away.

   That last one is the part worth testing. The spec has the browser release
   the lock whenever the document is hidden, and it does not come back by
   itself; a naive implementation acquires once and is silently dead for the
   rest of the run the first time you glance at another tab. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};

async function boot(b, opts){
  opts = opts || {};
  const ctx = await b.newContext({viewport:{width:1280,height:900}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.addInitScript((mode)=>{
    window.__wake = { requests:0, releases:0, held:0, types:[] };
    if (mode === 'absent') { try{ delete navigator.wakeLock; }catch(e){} return; }
    const makeSentinel = () => {
      const listeners = [];
      return {
        released:false,
        addEventListener(ev, fn){ if (ev==='release') listeners.push(fn); },
        _drop(){ if(this.released) return; this.released=true;
                 window.__wake.held--; listeners.forEach(f=>f()); },
        release(){ window.__wake.releases++; this._drop(); return Promise.resolve(); }
      };
    };
    const wl = {
      request(type){
        window.__wake.requests++; window.__wake.types.push(type);
        if (mode === 'refuse') return Promise.reject(new DOMException('denied','NotAllowedError'));
        window.__wake.held++;
        const s = makeSentinel();
        window.__wake.last = s;
        return Promise.resolve(s);
      }
    };
    Object.defineProperty(navigator, 'wakeLock', { value: wl, configurable: true });
    /* let a test pretend the browser yanked the lock, as it does on hide */
    window.__wakeYank = () => { if (window.__wake.last) window.__wake.last._drop(); };
  }, opts.mode || 'ok');
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.goto('http://127.0.0.1:8902/dohyo.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4000);
  await p.evaluate(()=>{
    const d = DAYS["1"].makuuchi;
    Object.keys(team).forEach(k=>delete team[k]); team.a = d[0][1];
    watchScope='all'; watchDiv='both'; runChoice='watch';
    enter(); stop();                       // enter() starts playback; stop it
    day="1"; mountDay("1"); selectTab("makuuchi");
  });
  await p.waitForTimeout(600);
  await p.evaluate(()=>{ window.__wake.requests=0; window.__wake.releases=0; });
  return {ctx,p,errs};
}
const wake = p => p.evaluate(()=>({...window.__wake, last:undefined}));

(async ()=>{
  const b = await chromium.launch();

  /* ---- it asks while playing, and lets go when the run ends ---- */
  {
    const {ctx,p,errs} = await boot(b);
    let w = await wake(p);
    chk('nothing is held before a run starts', w.held===0, JSON.stringify(w));

    await p.evaluate(()=>{ playing = true; paused = false; syncPlayBtn(); });
    await p.waitForTimeout(400);
    w = await wake(p);
    chk('starting a run takes a screen lock', w.held===1 && w.requests===1, JSON.stringify(w));
    chk('and asks for the screen, not something else',
        JSON.stringify(w.types)==='["screen"]', JSON.stringify(w.types));

    /* repainting the transport must not stack up locks */
    await p.evaluate(()=>{ for(let i=0;i<5;i++) syncPlayBtn(); });
    await p.waitForTimeout(400);
    w = await wake(p);
    chk('repeated transport repaints do not stack locks',
        w.held===1 && w.requests===1, JSON.stringify(w));

    await p.evaluate(()=>{ playing = false; paused = false; syncPlayBtn(); });
    await p.waitForTimeout(400);
    w = await wake(p);
    chk('ending the run releases it', w.held===0 && w.releases===1, JSON.stringify(w));
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* ---- pausing gives the screen back ---- */
  {
    const {ctx,p} = await boot(b);
    await p.evaluate(()=>{ playing=true; paused=false; syncPlayBtn(); });
    await p.waitForTimeout(300);
    await p.evaluate(()=>{ paused=true; syncPlayBtn(); });
    await p.waitForTimeout(300);
    let w = await wake(p);
    chk('a paused run does not hold the screen awake', w.held===0, JSON.stringify(w));
    await p.evaluate(()=>{ paused=false; syncPlayBtn(); });
    await p.waitForTimeout(300);
    w = await wake(p);
    chk('resuming takes it again', w.held===1, JSON.stringify(w));
    await ctx.close();
  }

  /* ---- the one that matters: recovery after the browser drops it ---- */
  {
    const {ctx,p} = await boot(b);
    await p.evaluate(()=>{ playing=true; paused=false; syncPlayBtn(); });
    await p.waitForTimeout(300);
    chk('holding the lock mid-run', (await wake(p)).held===1);

    /* the browser releases on hide and does NOT restore it on its own */
    await p.evaluate(()=>{ window.__wakeYank(); });
    await p.waitForTimeout(200);
    chk('the browser can take it away', (await wake(p)).held===0);

    /* coming back to the tab has to re-take it */
    await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await p.waitForTimeout(400);
    const w = await wake(p);
    chk('returning to the page re-acquires it', w.held===1 && w.requests>=2,
        JSON.stringify(w));
    await ctx.close();
  }

  /* ---- and it must not re-take it for a run that already ended ---- */
  {
    const {ctx,p} = await boot(b);
    await p.evaluate(()=>{ playing=true; paused=false; syncPlayBtn(); });
    await p.waitForTimeout(300);
    await p.evaluate(()=>{ playing=false; syncPlayBtn(); });
    await p.waitForTimeout(300);
    await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    await p.waitForTimeout(400);
    chk('coming back after the day is over leaves the screen alone',
        (await wake(p)).held===0, JSON.stringify(await wake(p)));
    await ctx.close();
  }

  /* ---- a refusal must be silent ---- */
  {
    const {ctx,p,errs} = await boot(b,{mode:'refuse'});
    await p.evaluate(()=>{ playing=true; paused=false; syncPlayBtn(); });
    await p.waitForTimeout(500);
    const w = await wake(p);
    chk('a refused lock is swallowed, not thrown', errs.length===0, errs[0]||'');
    chk('and it asked exactly once rather than retrying in a loop',
        w.requests===1 && w.held===0, JSON.stringify(w));
    const alive = await p.evaluate(()=>typeof syncPlayBtn === 'function' &&
      !!document.getElementById('upNext'));
    chk('the page keeps working without it', alive);
    await ctx.close();
  }

  /* ---- a browser with no API at all ---- */
  {
    const {ctx,p,errs} = await boot(b,{mode:'absent'});
    await p.evaluate(()=>{ playing=true; paused=false; syncPlayBtn();
      playing=false; syncPlayBtn(); });
    await p.waitForTimeout(400);
    chk('an unsupported browser is a non-event', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
