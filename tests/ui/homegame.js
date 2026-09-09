/* gg-rikishi.js (GGRikishi — the homepage guessing game's name/kanji/heya table)
   must be untouched by the dossier extraction. I overwrote this file once by
   picking the same name; this is the check that says I put it back. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{ T.push(ok); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

(async ()=>{
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1280,height:1000}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0},"champion":null}'}));
  await p.goto('http://127.0.0.1:8902/index.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4500);

  const r = await p.evaluate(()=>{
    const G = window.GGRikishi;
    if (!G) return {missing:true};
    const names = Object.keys(G.ALL||{});
    const one = G.ALL[names[0]] || {};
    return { n: names.length,
      hasKanji: !!one.k, hasCode: !!one.c, hasHeya: !!one.h, hasDiv: !!one.d,
      photo: G.photo ? G.photo('Ura') : null,
      rank: G.rank ? G.rank('Ura') : null,
      tiers: Object.keys(G.TIER||{}).length };
  });
  chk('GGRikishi still exists on the homepage', !r.missing, r.missing?'window.GGRikishi is gone':'');
  chk('with the full table', r.n > 60, r.n+' rikishi');
  chk('carrying kanji, code, heya and division', r.hasKanji && r.hasCode && r.hasHeya && r.hasDiv, JSON.stringify(r));
  chk('photo() still resolves', r.photo === 'images/rikishi/Ura.webp', String(r.photo));
  chk('rank() still formats', /Maegashira \d+ (East|West)/.test(r.rank||''), String(r.rank));
  chk('the tier map is intact', r.tiers === 6, r.tiers+' tiers');
  chk('and it is NOT the dossier', await p.evaluate(()=>!(window.GyojiGuide && window.GyojiGuide.RIKISHI)),
      'the homepage should not be loading the dossier at all');
  chk('no page errors', errs.length===0, errs[0]||'');

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close();
  if (bad) process.exit(1);
})();
