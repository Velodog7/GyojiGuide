/* "Up next" above the day's bout list.

   The point of it is that it must answer the question the CURRENT MODE is
   asking. Under "every bout" that is the literal next row; under "only my
   team" it is your team's next bout, skipping everything in between. Both come
   off playableIdx(), which is the same sequence the player itself walks — so
   the strip cannot drift from what actually gets called.

   It must also not spoil: the bout has not been fought on screen, so no
   kimarite, no winner, and records taken through YESTERDAY. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};

async function boot(b, opts){
  opts = opts || {};
  const ctx = await b.newContext({viewport:{width:1280,height:1000}, deviceScaleFactor:2});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.goto('http://127.0.0.1:8902/dohyo.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4000);
  /* Put the page into a watchable state without going through the intro:
     seed a team from the day's own card so "mine" has something to match. */
  /* myPicks() is a lexical const deriving from `team`, so it cannot be stubbed
     from outside — set the real thing instead, which is closer to the truth
     anyway. Three bouts spread across the card, so "mine" must genuinely skip
     rows rather than happening to agree with "all". */
  await p.evaluate((scope)=>{
    const d = DAYS["2"].makuuchi;
    const picks = [d[1][1], d[6][5], d[14][1]];
    Object.keys(team).forEach(k=>delete team[k]);
    picks.forEach((n,i)=>{ team["slot"+i] = n; });
    watchScope = scope; watchDiv = "both"; runChoice = "watch";
    /* Leave the setup screen for real. Until body.setup clears, .wrap is
       display:none and the strip is not rendered at all — and Chrome's
       innerText falls back to textContent on a non-rendered node, so reading
       it "works" and every layout assertion passes vacuously. Learned the
       hard way: assert the strip has a real width, not just the right words. */
    enter();
    stop();                       // don't let playback run under the assertions
    mountDay("2");
    selectTab("makuuchi");
  }, opts.scope || 'all');
  await p.waitForTimeout(900);
  return {ctx,p,errs};
}
const read = p => p.evaluate(()=>{
  const el=document.getElementById('upNext');
  return { hidden: el.hidden, width: Math.round(el.getBoundingClientRect().width),
    lab: (document.getElementById('upNextLab')||{}).textContent||'',
    text: (document.getElementById('upNextBody')||{}).innerText.replace(/\s+/g,' ').trim(),
    names: [...document.querySelectorAll('#upNextBody .upnext__nm')].map(e=>e.textContent.replace(/[^A-Za-z]/g,'')),
    mineFlag: el.classList.contains('is-mine'),
    recs: [...document.querySelectorAll('#upNextBody .bout__rec')].map(e=>e.textContent) };
});

(async ()=>{
  const b = await chromium.launch();

  /* ---- every bout: the strip opens on the first row of the card ---- */
  {
    const {ctx,p,errs} = await boot(b,{scope:'all'});
    const u = await read(p);
    const first = await p.evaluate(()=>[DAYS["2"].makuuchi[0][1], DAYS["2"].makuuchi[0][5]]);
    chk('the strip shows', !u.hidden && u.width > 100, 'hidden='+u.hidden+' width='+u.width);
    chk('before play it reads "First up"', /First up/i.test(u.lab), u.lab);
    chk('and names the first bout of the card',
        u.names[0]===first[0] && u.names[1]===first[1], JSON.stringify(u.names)+' vs '+JSON.stringify(first));
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* ---- only my team: it must SKIP to your next bout, not the next row ---- */
  {
    const {ctx,p} = await boot(b,{scope:'mine'});
    const u = await read(p);
    const expect = await p.evaluate(()=>{
      const d=DAYS["2"].makuuchi, m=myPicks();
      const i=d.findIndex(x=>m.has(x[1])||m.has(x[5]));
      return { i, e:d[i][1], w:d[i][5], firstRow:0 };
    });
    chk('under "only my team" it names your first bout',
        u.names[0]===expect.e && u.names[1]===expect.w, JSON.stringify(u.names));
    chk('...which is NOT the first row of the card', expect.i>0, 'row '+expect.i);
    chk('and the strip is flagged as yours', u.mineFlag);
    await ctx.close();
  }

  /* ---- the two modes genuinely disagree ---- */
  {
    const a = await boot(b,{scope:'all'});   const ua = await read(a.p); await a.ctx.close();
    const m = await boot(b,{scope:'mine'});  const um = await read(m.p); await m.ctx.close();
    chk('the two settings name different bouts',
        JSON.stringify(ua.names) !== JSON.stringify(um.names),
        'all='+JSON.stringify(ua.names)+' mine='+JSON.stringify(um.names));
  }

  /* ---- switching mode repaints it immediately ---- */
  {
    const {ctx,p} = await boot(b,{scope:'all'});
    const before = (await read(p)).names;
    await p.evaluate(()=>{ watchScope='mine'; paintUpNext(); });
    await p.waitForTimeout(200);
    const after = (await read(p)).names;
    chk('flipping the setting repaints the strip',
        JSON.stringify(before)!==JSON.stringify(after),
        JSON.stringify(before)+' -> '+JSON.stringify(after));
    await ctx.close();
  }

  /* ---- it follows the run, in both modes ---- */
  for (const scope of ['all','mine']) {
    const {ctx,p} = await boot(b,{scope});
    const walk = await p.evaluate(()=>{
      const seq = playableIdx(); const seen = [];
      playing = true;
      for (const i of seq){ playIdx = i; paintUpNext();
        const nm=[...document.querySelectorAll('#upNextBody .upnext__nm')].map(e=>e.textContent.replace(/[^A-Za-z]/g,''));
        seen.push(nm.length ? nm.join('|') : (document.querySelector('#upNextBody .upnext__none')||{}).textContent); }
      return { seq, seen, card: seq.map(i=>card.makuuchi[i][1]+'|'+card.makuuchi[i][5]) };
    });
    /* while on seq[k], the strip must name seq[k+1] */
    let ok = true;
    for (let k=0;k<walk.seq.length-1;k++) if (walk.seen[k] !== walk.card[k+1]) ok = false;
    chk('['+scope+'] each bout points at the next one it will play', ok,
        walk.seen.slice(0,3).join(' / '));
    chk('['+scope+'] the last bout says so instead of going stale',
        /last bout/i.test(walk.seen[walk.seq.length-1]||''), walk.seen[walk.seq.length-1]);
    await ctx.close();
  }

  /* ---- no spoilers ---- */
  {
    const {ctx,p} = await boot(b,{scope:'all'});
    const spoil = await p.evaluate(()=>{
      const b0 = card.makuuchi[0];
      const txt = document.getElementById('upNextBody').innerText;
      const recs = [...document.querySelectorAll('#upNextBody .bout__rec')]
        .map(e=>e.textContent.split('–').map(Number)).map(([w,l])=>w+l);
      return { kimarite: b0[3] ? txt.includes(b0[3]) : false,
               saysWin: /wins/i.test(txt), maxBouts: Math.max(...recs), day: Number(day) };
    });
    chk('the kimarite is not given away', !spoil.kimarite);
    chk('nor the winner', !spoil.saysWin);
    chk('records stop at yesterday', spoil.maxBouts <= spoil.day-1,
        spoil.maxBouts+' bouts counted on day '+spoil.day);
    await ctx.close();
  }

  /* ---- a division your team is absent from ---- */
  {
    const {ctx,p} = await boot(b,{scope:'mine'});
    const t = await p.evaluate(()=>{ selectTab('juryo'); paintUpNext();
      return document.getElementById('upNextBody').innerText.replace(/\s+/g,' ').trim(); });
    chk('an empty division says so rather than showing nothing',
        /None of your seven|Jūryō|Juryo/i.test(t), t.slice(0,70));
    await ctx.close();
  }

  /* ---- and it stays out of the way on the non-card tabs ---- */
  {
    const {ctx,p} = await boot(b,{scope:'all'});
    const hid = await p.evaluate(()=>{ selectTab('team'); paintUpNext();
      return document.getElementById('upNext').hidden; });
    chk('hidden on the team tab', hid===true, String(hid));
    await ctx.close();
  }

  /* ---- mobile ---- */
  {
    const ctx = await b.newContext({viewport:{width:390,height:844}, deviceScaleFactor:2});
    const p = await ctx.newPage();
    await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
      body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));
    await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
    await p.goto('http://127.0.0.1:8902/dohyo.html',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(4000);
    await p.evaluate(()=>{ const d=DAYS["2"].makuuchi;
      Object.keys(team).forEach(k=>delete team[k]);
      team.a=d[1][1]; team.b=d[6][5];
      watchScope='all'; watchDiv='both'; runChoice='watch';
      enter(); stop(); mountDay("2"); selectTab("makuuchi"); });
    await p.waitForTimeout(600);
    const m = await p.evaluate(()=>{
      const el=document.getElementById('upNext'); const r=el.getBoundingClientRect();
      return { w:Math.round(r.width), hidden: el.hidden,
               overflows: el.scrollWidth>el.clientWidth+1,
               inViewport: r.right <= window.innerWidth+1 };
    });
    chk('it is actually rendered on a phone', !m.hidden && m.w > 100, JSON.stringify(m));
    chk('and fits without overflowing', !m.overflows && m.inViewport, JSON.stringify(m));
    const el=await p.$('#upNext'); if(el) await el.screenshot({path:'/tmp/upnext-mob.png'});
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
