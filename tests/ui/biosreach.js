/* GGRoster.bios() and the hundred-rikishi ceiling.

   Same root cause as the rank-change pill: /api/rikishis returns at most a
   hundred rikishi, lowest id first, and cannot be paged past that — `skip` is
   echoed back in the response and ignored, `offset` returns nothing, every sort
   parameter 400s. The old code asked for limit=1000, got 100, read that as a
   short final page and stopped. Roughly seventeen of the seventy sekitori on
   the Aki banzuke sit outside that window, Onosato and Aonishiki among them, so
   their stable, height, age, debut and career-best rank silently stayed at
   whatever the page had bundled.

   The pill was fixed by not using this endpoint at all. The remaining fields
   still need it, so bios() now takes the banzuke ids the caller already holds
   and looks up whoever the bulk pass missed.

   The stub reproduces the ceiling exactly, including the echoed-but-ignored
   `skip`, so a regression to page-based paging spins and still finds nobody.
   Two things beyond "does it work":

   - It must not fetch by id for men the bulk call already covered. Seventeen
     lookups is reasonable; seventy is not, and the difference is invisible
     unless counted.
   - An id pointing at the wrong man must be refused rather than believed. That
     is how head-to-head once shipped asking with a photo id and got a
     confident wrong answer for every pair. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};

/* Ten men. The first six have low ids and fall inside the bulk window; the last
   four are high-id and can only ever be reached one at a time. */
const IN  = [['Kotoshoho',8],['Hoshoryu',19],['Kirishima',31],
             ['Takayasu',44],['Abi',57],['Shodai',66]];
const OUT = [['Onosato',8850],['Aonishiki',8854],['Fujinokawa',8901],['Asakoryu',8930]];
const ALL = IN.concat(OUT);
const ID = {}; ALL.forEach(([n,i])=>ID[n]=i);

/* what the API would return for one man; deliberately different from anything
   a page could have bundled, so a stale value is visibly stale */
function rec(name, id){
  return { id: id, shikonaEn: name, shikonaJp: name+'　太郎', heya: 'Stable'+id,
           height: 180+(id%20), weight: 140+(id%30),
           birthDate: '2000-06-07T00:00:00Z', debut: '202305',
           shusshin: 'Ishikawa-ken, Kahoku-gun',
           rankHistory: [ { bashoId:'202609', rank:'Ozeki 1 East',    rankValue:201 },
                          { bashoId:'202607', rank:'Sekiwake 1 West', rankValue:302 } ] };
}

async function run(b, opts){
  opts = opts || {};
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  const hits = { bulk:0, byId:[] };

  await p.route('**sumo-api.com/**', r=>{
    const u = r.request().url();
    const j = o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (/\/rikishis\?/.test(u)){
      hits.bulk++;
      if (opts.deadBulk) return r.abort();
      /* The ceiling, reproduced: whatever `skip` says, the same low-id rows come
         back — and the parameter is echoed, which is what made it look supported. */
      const skip = (u.match(/skip=(\d+)/)||[])[1] || '0';
      return j({ limit:100, skip:Number(skip), total:601,
                 records: IN.map(([n,i])=>rec(n,i)) });
    }
    const m = u.match(/\/rikishi\/(\d+)\?/);
    if (m){
      hits.byId.push(Number(m[1]));
      if (opts.deadOne === Number(m[1])) return r.abort();
      const found = ALL.find(([,i])=>i === Number(m[1]));
      if (!found) return j({});
      /* the mixed-up-id case: this id answers with somebody else's record */
      const name = (opts.wrongName && opts.wrongName === found[0]) ? 'SomeoneElse' : found[0];
      return j(rec(name, found[1]));
    }
    return j({});
  });
  /* the page's own backend call, stubbed — otherwise it rejects and the
     "no page errors" assertion below fails on something this file is not
     testing */
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));
  await p.goto('http://127.0.0.1:8902/analysis.html',{waitUntil:'domcontentloaded'});
  await p.waitForFunction(()=>!!window.GGRoster, null, {timeout:15000});

  const out = await p.evaluate(async (cfg)=>{
    return await GGRoster.bios({ names: cfg.names, ids: cfg.ids, maxLookups: cfg.cap });
  }, { names: ALL.map(x=>x[0]), ids: opts.noIds ? {} : ID, cap: opts.cap });

  return { ctx, p, errs, hits, out };
}

(async ()=>{
  const b = await chromium.launch();

  /* ---- the whole card, not just the low ids ---- */
  {
    const { ctx, errs, hits, out } = await run(b);
    chk('every name asked for comes back', out.ok && out.count === ALL.length,
        (out.count||0)+' of '+ALL.length);
    chk('nobody is left unaccounted for', (out.missing||[]).length === 0,
        JSON.stringify(out.missing));
    chk('the men inside the window come from the one bulk call',
        out.bulk === IN.length, out.bulk+' from bulk');
    chk('and only the ones outside it are fetched individually',
        out.lookedUp === OUT.length, out.lookedUp+' looked up');
    chk('which is exactly four requests, not seventy',
        hits.byId.length === OUT.length, hits.byId.length+' by-id requests');
    chk('no id is requested for a man the bulk call already covered',
        hits.byId.every(id=>OUT.some(([,i])=>i===id)), JSON.stringify(hits.byId));
    chk('the bulk endpoint is called once, not paged',
        hits.bulk === 1, hits.bulk+' bulk calls');
    chk('a high-id man really does get live data',
        !!(out.byName.Onosato && out.byName.Onosato.stable === 'Stable8850'),
        JSON.stringify(out.byName.Onosato));
    chk('and it is the same shape as a bulk one',
        JSON.stringify(Object.keys(out.byName.Onosato).sort()) ===
        JSON.stringify(Object.keys(out.byName.Kotoshoho).sort()),
        JSON.stringify(Object.keys(out.byName.Onosato||{}).sort()));
    chk('no page errors', errs.length === 0, errs[0]||'');
    await ctx.close();
  }

  /* ---- an id pointing at the wrong man is refused, not believed ---- */
  {
    const { ctx, out } = await run(b, { wrongName: 'Onosato' });
    chk('a record that answers with a different shikona is thrown away',
        !out.byName.Onosato, JSON.stringify(out.byName.Onosato));
    chk('and he is reported missing rather than given someone else’s bio',
        (out.missing||[]).indexOf('Onosato') >= 0, JSON.stringify(out.missing));
    chk('while the other lookups are unaffected', !!out.byName.Aonishiki);
    await ctx.close();
  }

  /* ---- degrade, in both directions ---- */
  {
    const { ctx, out, hits } = await run(b, { deadBulk: true });
    /* With the bulk call gone nobody is covered, so everyone is looked up —
       more requests than the happy path, and the right trade: the alternative
       is a page of stale bios because one call failed. */
    chk('with the bulk call dead, everyone is fetched individually',
        out.ok && out.lookedUp === ALL.length, JSON.stringify({ok:out.ok, up:out.lookedUp}));
    chk('so nobody is missing even with the bulk endpoint down',
        (out.missing||[]).length === 0, JSON.stringify(out.missing));
    chk('  at one request per man and no more', hits.byId.length === ALL.length,
        hits.byId.length+' by-id requests for '+ALL.length+' men');
    await ctx.close();
  }
  {
    const { ctx, out } = await run(b, { deadOne: 8854 });
    chk('one failed lookup does not sink the batch',
        out.ok && !!out.byName.Onosato && !out.byName.Aonishiki,
        JSON.stringify({ ok:out.ok, ono:!!out.byName.Onosato, ao:!!out.byName.Aonishiki }));
    chk('and only that man is reported missing',
        JSON.stringify(out.missing) === JSON.stringify(['Aonishiki']), JSON.stringify(out.missing));
    await ctx.close();
  }

  /* ---- without ids, it says so instead of pretending ---- */
  {
    const { ctx, out, hits } = await run(b, { noIds: true });
    chk('with no ids it falls back to the bulk pass alone',
        out.count === IN.length && hits.byId.length === 0,
        out.count+' found, '+hits.byId.length+' lookups');
    chk('and names everyone the ceiling hid, rather than reporting success',
        JSON.stringify((out.missing||[]).sort()) === JSON.stringify(OUT.map(x=>x[0]).sort()),
        JSON.stringify(out.missing));
    await ctx.close();
  }

  /* ---- the cap is a real limit, not decoration ---- */
  {
    const { ctx, out, hits } = await run(b, { cap: 2 });
    chk('maxLookups bounds the number of individual requests',
        hits.byId.length === 2, hits.byId.length+' by-id requests with cap 2');
    chk('and whoever was left over is reported missing',
        (out.missing||[]).length === OUT.length - 2, JSON.stringify(out.missing));
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
