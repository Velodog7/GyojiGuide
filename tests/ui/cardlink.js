/* The scout card is the way in to a profile.

   The card grid has a delegated click that expands/collapses a card, so the
   thing to prove is not just "a link exists" but that the link NAVIGATES and
   does not merely toggle the card underneath it. */
const { chromium } = require('playwright');
const LIVE = require('/tmp/livebanzuke.json');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};
(async ()=>{
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1280,height:1000}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.route('**sumo-api.com/**', r=>{
    const u=r.request().url(); const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if(/banzuke\/Makuuchi/i.test(u)) return j(LIVE.mak);
    if(/banzuke\/Juryo/i.test(u))    return j(LIVE.jur);
    return j({});
  });
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));
  await p.goto('http://127.0.0.1:8902/analysis.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5000);

  const info = await p.evaluate(()=>{
    const links=[...document.querySelectorAll('.act.profile')];
    return { n:links.length, cards:document.querySelectorAll('#cards .card').length,
             first:links[0] && links[0].getAttribute('href'),
             text:links[0] && decodeURIComponent(new URLSearchParams(String(links[0].getAttribute('href')).split('?')[1]||'').get('n')||'') };
  });
  chk('every scout card carries a Profile button', info.n>0 && info.n===info.cards,
      info.n+' links / '+info.cards+' cards');
  chk('pointing at the right page', /^rikishi\.html\?n=/.test(info.first||''), info.first);
  chk('no page errors', errs.length===0, errs[0]||'');

  /* the real question: does clicking it navigate, or just toggle the card? */
  const before = await p.evaluate(()=>document.querySelectorAll('#cards .card.open').length);
  await p.click('.act.profile');
  await p.waitForTimeout(2500);
  const url = p.url();
  chk('clicking the name goes to the profile', /rikishi\.html\?n=/.test(url), url);
  const name = await p.evaluate(()=>(document.querySelector('.hero__name')||{}).textContent);
  chk('and lands on the right man', name===info.text, name+' vs '+info.text);

  await p.goBack({waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4000);
  const after = await p.evaluate(()=>document.querySelectorAll('#cards .card.open').length);
  chk('and did not toggle the card underneath it', after===before, before+' → '+after);

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
