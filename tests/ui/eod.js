/* The end-of-day results modal: every wrestler's simulated-tournament record,
   not just the ones on your team — while the head-to-head stays where it was. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};
(async()=>{
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:1280,height:1000},deviceScaleFactor:2});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.route('**script.google.com/**',r=>r.fulfill({contentType:'application/json',body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));
  await p.route('**sumo-api.com/**',r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.goto('http://127.0.0.1:8902/dohyo.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4000);

  // jump to a later day so records have something in them, then open the modal
  const opened = await p.evaluate(()=>{
    try { day = "2"; if (typeof loadDay==="function") loadDay("2"); } catch(e){}
    try { showDayModal(); return true; } catch(e){ return String(e); }
  });
  chk('the day modal builds', opened===true, String(opened));
  await p.waitForTimeout(600);

  const m = await p.evaluate(()=>{
    const rows=[...document.querySelectorAll('#dayModalBody .bout')];
    const first=rows[0];
    return { rows:rows.length,
      recsPerRow: rows.map(r=>r.querySelectorAll('.bout__rec').length),
      h2hInMid: rows.filter(r=>r.querySelector('.bout__mid .bout__h2h')).length,
      trailing: document.querySelectorAll('#dayModalBody .bout__past').length,
      bareRecs: rows[0] ? rows[0].querySelectorAll('.bout__rec').length : 0,
      h2hLabelled: [...document.querySelectorAll('#dayModalBody .bout__h2h')]
                     .every(e=>/^H2H\s/.test(e.textContent)),
      sample: first ? first.innerText.replace(/\s+/g,' ').trim() : '',
      recTexts: [...document.querySelectorAll('#dayModalBody .bout__rec')].slice(0,6).map(e=>e.textContent),
      kk: document.querySelectorAll('#dayModalBody .bout__rec.is-kk').length };
  });
  chk('every bout shows two records', m.rows>0 && m.recsPerRow.every(n=>n===2),
      m.rows+' rows, counts '+JSON.stringify(m.recsPerRow.slice(0,6)));
  chk('the head-to-head moved into the middle, under the kimarite', m.h2hInMid===m.rows,
      m.h2hInMid+' of '+m.rows+' rows');
  chk('and no longer sits in a trailing column of its own', m.trailing===0,
      m.trailing+' trailing cells left');
  chk('so the only bare W\u2013L on a row are the two records', m.bareRecs===2,
      m.bareRecs+' unlabelled numbers');
  chk('records look like W–L', m.recTexts.every(t=>/^\d+–\d+$/.test(t)), JSON.stringify(m.recTexts));
  chk('the head-to-head says what it is', m.h2hLabelled);
  chk('no page errors', errs.length===0, errs[0]||'');
  console.log('         sample row: '+m.sample.slice(0,110));

  // records must not run ahead of the day being shown
  const spoil = await p.evaluate(()=>{
    const tot = [...document.querySelectorAll('#dayModalBody .bout__rec')]
      .map(e=>e.textContent.split('–').map(Number)).map(([w,l])=>w+l);
    return { max: Math.max(...tot), min: Math.min(...tot) };
  });
  chk('a record never counts more bouts than days fought', spoil.max<=2, JSON.stringify(spoil));

  const el=await p.$('#dayModalBody'); if(el) await el.screenshot({path:'/tmp/eod.png'});
  await ctx.close();

  /* ---- and it has to be readable on a phone ----
     Pre-existing bug, found while adding the records: below 720px the two 1fr
     tracks collapse to ~77px and the shikona painted straight over the
     kimarite. 129 collisions at 390px before the fix. */
  {
    const c2 = await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
    const p2 = await c2.newPage();
    const e2=[]; p2.on('pageerror',e=>e2.push(String(e).slice(0,120)));
    await p2.route('**script.google.com/**',r=>r.fulfill({contentType:'application/json',body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));
    await p2.route('**sumo-api.com/**',r=>r.fulfill({contentType:'application/json',body:'{}'}));
    await p2.goto('http://127.0.0.1:8902/dohyo.html',{waitUntil:'domcontentloaded'});
    await p2.waitForTimeout(3500);
    await p2.evaluate(()=>{ try{ day='2'; loadDay('2'); }catch(e){} showDayModal(); });
    await p2.waitForTimeout(800);
    const mob = await p2.evaluate(()=>{
      const rows=[...document.querySelectorAll('#dayModalBody .bout')];
      let bad=0, worst=0;
      rows.forEach(r=>{
        const e=r.querySelector('.bout__e'), m=r.querySelector('.bout__mid'), w=r.querySelector('.bout__w');
        if(!e||!m||!w) return;
        const mr=m.getBoundingClientRect();
        [...e.children].forEach(c=>{ const b=c.getBoundingClientRect();
          const ov=b.right-mr.left; if(ov>1){bad++; worst=Math.max(worst,ov);} });
        [...w.children].forEach(c=>{ const b=c.getBoundingClientRect();
          const ov=mr.right-b.left; if(ov>1){bad++; worst=Math.max(worst,ov);} });
      });
      return { rows:rows.length, collisions:bad, worst:Math.round(worst),
               recs: rows[0]?rows[0].querySelectorAll('.bout__rec').length:0 };
    });
    chk('on a phone, nothing paints over the kimarite', mob.collisions<=2,
        mob.collisions+' collisions, worst '+mob.worst+'px');
    chk('and the records are still there', mob.recs===2, mob.recs+' per row');
    chk('no page errors on mobile', e2.length===0, e2[0]||'');
    const el2=await p2.$('#dayModalBody'); if(el2) await el2.screenshot({path:'/tmp/eod-mob.png'});
    await c2.close();
  }
  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if(bad) process.exit(1);
})();
