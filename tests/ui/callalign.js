/* The two name-calls either side of the dohyō must line up with each other.

   The bug: .call__pill ("Win") was always in the DOM and merely invisible when
   it did not apply — but .call__mine ("★ My Team") was rendered only when the
   wrestler was one of your seven. So any bout involving your team gained a row
   on that side alone, and the kanji, name, rank, hoshitori, record and bio all
   sat lower there than across the ring.

   These assertions measure the real boxes at matching rows and require them to
   share a baseline, in the case that actually broke it: yours on one side. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};

async function boot(b, pick){
  const ctx = await b.newContext({viewport:{width:1400,height:950}, deviceScaleFactor:2});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.goto('http://127.0.0.1:8902/dohyo.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4000);
  await p.evaluate((which)=>{
    const d = DAYS["3"].makuuchi;
    Object.keys(team).forEach(k=>delete team[k]);
    /* bout 0: put the EAST man on the team, or the WEST man, or neither */
    if (which === 'east') team.a = d[0][1];
    if (which === 'west') team.a = d[0][5];
    if (which === 'both') { team.a = d[0][1]; team.b = d[0][5]; }
    watchScope = 'all'; watchDiv = 'both'; runChoice = 'watch';
    enter(); stop();
    day = "3"; mountDay("3"); selectTab("makuuchi");
    loadBout("makuuchi", 0);               // paint both name-calls without playing
  }, pick);
  await p.waitForTimeout(900);
  return {ctx,p,errs};
}

/* top edge of each part of a stack, per side */
const rows = p => p.evaluate(()=>{
  const stacks = [...document.querySelectorAll('.call__stack')];
  if (stacks.length < 2) return null;
  const part = (st, sel) => { const e = st.querySelector(sel);
    return e ? Math.round(e.getBoundingClientRect().top) : null; };
  const read = st => ({
    flags:  part(st,'.call__flags'),
    kanji:  part(st,'.call__kanji'),
    romaji: part(st,'.call__romaji'),
    rank:   part(st,'.call__rank'),
    days:   part(st,'.call__days'),
    score:  part(st,'.call__score'),
    bio:    part(st,'.call__bio'),
    top:    Math.round(st.getBoundingClientRect().top),
  });
  return { e: read(stacks[0]), w: read(stacks[1]),
           flagCounts: stacks.map(st=>st.querySelectorAll('.call__flags').length),
           mineEls:    stacks.map(st=>st.querySelectorAll('.call__mine').length),
           visibleMine: stacks.map(st=>[...st.querySelectorAll('.call__mine')]
             .filter(e=>getComputedStyle(e).visibility!=='hidden').length) };
});

(async ()=>{
  const b = await chromium.launch();
  const KEYS = ['flags','kanji','romaji','rank','days','score','bio'];

  for (const pick of ['none','east','west','both']) {
    const {ctx,p,errs} = await boot(b, pick);
    const r = await rows(p);
    if (!r) { chk('['+pick+'] both name-calls painted', false, 'fewer than two stacks'); await ctx.close(); continue; }

    const drift = {};
    let worst = 0;
    for (const k of KEYS) {
      if (r.e[k]===null || r.w[k]===null) continue;
      const d = Math.abs(r.e[k]-r.w[k]);
      drift[k] = d; worst = Math.max(worst, d);
    }
    chk('['+pick+'] east and west share every row', worst <= 1, 'worst '+worst+'px — '+JSON.stringify(drift));
    chk('['+pick+'] the badge rail exists on both sides',
        JSON.stringify(r.flagCounts)==='[1,1]', JSON.stringify(r.flagCounts));
    chk('['+pick+'] the My Team badge is present on both, shown on the right ones',
        JSON.stringify(r.mineEls)==='[1,1]' &&
        JSON.stringify(r.visibleMine)===JSON.stringify(
          pick==='none' ? [0,0] : pick==='east' ? [1,0] : pick==='west' ? [0,1] : [1,1]),
        'els '+JSON.stringify(r.mineEls)+' visible '+JSON.stringify(r.visibleMine));
    chk('['+pick+'] no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* ---- rank movement must read as good or bad news, correctly ----
     .call__move.down was set to var(--win): a demotion was painted the same
     green as a promotion, so falling from Sekiwake to Maegashira looked like
     a rise. Checked as computed colour, per direction, on the real page. */
  {
    const {ctx,p} = await boot(b, 'none');
    const cols = await p.evaluate(()=>{
      const probe = dir => {
        const el = document.createElement('span');
        el.className = 'call__move ' + dir;
        el.textContent = 'x';
        (document.querySelector('.call__stack') || document.body).appendChild(el);
        const c = getComputedStyle(el).color;
        el.remove(); return c;
      };
      const varOf = n => {
        const el = document.createElement('span');
        el.style.color = 'var(' + n + ')';
        document.body.appendChild(el);
        const c = getComputedStyle(el).color; el.remove(); return c;
      };
      return { up:probe('up'), down:probe('down'), same:probe(''), neu:probe('new'),
               win:varOf('--win'), loss:varOf('--loss'), sun:varOf('--sun') };
    });
    chk('a demotion is painted with the loss colour', cols.down===cols.loss,
        'down='+cols.down+' loss='+cols.loss);
    chk('a promotion is still the win colour', cols.up===cols.win,
        'up='+cols.up+' win='+cols.win);
    chk('the two directions do not look the same', cols.up!==cols.down,
        'up='+cols.up+' down='+cols.down);
    chk('an unchanged rank stays neutral', cols.same!==cols.win && cols.same!==cols.loss,
        'same='+cols.same);
    chk('new to the division keeps its own colour', cols.neu===cols.sun,
        'new='+cols.neu+' sun='+cols.sun);
    await ctx.close();
  }

  /* the winner's pill must not shift anything either */
  {
    const {ctx,p} = await boot(b, 'east');
    const before = await rows(p);
    await p.evaluate(()=>{
      document.querySelectorAll('.call').forEach(c=>c.classList.add('win'));
    });
    await p.waitForTimeout(700);
    const after = await rows(p);
    const moved = ['kanji','romaji','rank','days','score']
      .filter(k => Math.abs(before.e[k]-after.e[k]) > 1 || Math.abs(before.w[k]-after.w[k]) > 1);
    chk('showing the Win pill moves nothing', moved.length===0, JSON.stringify(moved));
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
