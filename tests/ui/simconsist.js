/* One simulation, one banzuke.

   dohyo.html used to seed DAYS with three real announced cards pasted in by
   hand. They went stale: ROSTER was rolled to the Aki banzuke while the cards
   stayed Nagoya's, so days 1-3 showed Aonishiki at Sekiwake and Oho at
   Komusubi while days 4-15 projected off Aki, where they are Ozeki and M10.

   So the assertion is not "day 1 looks right" but "every rank label printed on
   every card matches ROSTER" — which is what actually broke. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};
(async ()=>{
  const b = await chromium.launch();
  const p = await (await b.newContext({viewport:{width:1280,height:900}})).newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.goto('http://127.0.0.1:8902/dohyo.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4000);

  const r = await p.evaluate(()=>{
    const mismatches = [];
    let bouts = 0;
    for (const [d, day] of Object.entries(DAYS))
      for (const div of ['makuuchi','juryo'])
        for (const bt of (day[div]||[])) {
          bouts++;
          if (ROSTER[bt[1]] && ROSTER[bt[1]].code !== bt[0]) mismatches.push(`d${d} ${bt[1]} card ${bt[0]} vs roster ${ROSTER[bt[1]].code}`);
          if (ROSTER[bt[5]] && ROSTER[bt[5]].code !== bt[4]) mismatches.push(`d${d} ${bt[5]} card ${bt[4]} vs roster ${ROSTER[bt[5]].code}`);
        }
    const recs = {};
    Object.keys(ROSTER).forEach(n=>{ if(!ROSTER[n].off){ const rr=RESULTS[n]||{};
      recs[n]=Object.keys(rr).length; }});
    const counts = {};
    Object.values(recs).forEach(v=>counts[v]=(counts[v]||0)+1);
    return { days: Object.keys(DAYS).length, bouts, mismatches: mismatches.slice(0,6),
             nMismatch: mismatches.length, boutCounts: counts,
             realKeys: REAL_KEYS.length };
  });

  chk('the full fifteen days are generated', r.days===15, r.days+' days, '+r.bouts+' bouts');
  chk('no canned cards remain', r.realKeys===0, r.realKeys+' real keys');
  chk('every rank on every card matches the roster', r.nMismatch===0,
      r.nMismatch+' mismatches e.g. '+JSON.stringify(r.mismatches));
  chk('every active wrestler has a decided result on all 15 days',
      Object.keys(r.boutCounts).length===1 && r.boutCounts['15'],
      JSON.stringify(r.boutCounts));
  chk('no page errors', errs.length===0, errs[0]||'');

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
