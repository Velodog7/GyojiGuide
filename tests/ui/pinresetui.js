/* The admin PIN-reset queue: Approve resets, Dismiss closes without resetting.
   Against a stubbed backend that records which action was actually sent. */
const { chromium } = require('playwright');

const T=[]; const chk=(n,ok,x)=>{ T.push(ok); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

(async ()=>{
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1200,height:1000}, deviceScaleFactor:2});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,130)));
  p.on('dialog', d=>d.accept());          // the confirm() on both buttons

  let resets = [
    {id:'rst_1', handle:'puntodog', name:'Punto Dog',  requested:'2026-09-08T21:14:00Z'},
    {id:'rst_2', handle:'cafergy',  name:'Caf Ergy',   requested:'2026-09-09T02:02:00Z'}
  ];
  const sent = [];

  await p.route('**script.google.com/**', r=>{
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    let bd={}; try{ bd=JSON.parse(r.request().postData()||'{}'); }catch(e){}
    sent.push(bd.action+(bd.handle?':'+bd.handle:''));
    if (bd.action==='adminStats') return j({ok:true, users:71, teams:12, results:0,
      basho:'Aki 2026', lastDay:0, version:'test', pageviews:{}, analytics:{}});
    if (bd.action==='adminPinResets') return j({ok:true, resets:resets});
    if (bd.action==='adminDismissPinReset'){
      resets = resets.filter(x=>x.handle!==bd.handle);
      return j({ok:true, dismissed:1});
    }
    if (bd.action==='adminResetPin'){
      resets = resets.filter(x=>x.handle!==bd.handle);
      return j({ok:true});
    }
    if (bd.action==='adminUsers') return j({ok:true, users:[]});
    return j({ok:true});
  });

  await p.goto('http://127.0.0.1:8902/admin.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(2000);
  await p.fill('#gateKey','test');
  await p.click('#gateGo');
  await p.waitForTimeout(2500);
  // the queue lives on the Users view
  await p.evaluate(()=>{ const x=document.getElementById('tab-users'); if(x) x.click(); });
  await p.waitForTimeout(3000);

  const box = await p.evaluate(()=>{
    const el=document.getElementById('pinResetsBox');
    const btns=[...el.querySelectorAll('button')].map(b=>b.textContent.trim());
    return { text: el.innerText.replace(/\s+/g,' '), btns, n: el.querySelectorAll('button').length };
  });
  chk('the queue lists both requests', /puntodog/.test(box.text) && /cafergy/.test(box.text), box.text.slice(0,80));
  chk('each row offers Approve and Dismiss', box.btns.filter(t=>/dismiss/i.test(t)).length===2
      && box.btns.filter(t=>/approve/i.test(t)).length===2, JSON.stringify(box.btns));
  chk('the note explains what Dismiss does', /leaves their current PIN working/i.test(box.text), '');
  chk('and says it sends no message', /sends no message/i.test(box.text), '');

  const el = await p.$('#pinResetsBox');
  if (el) await el.screenshot({path:'/tmp/pinresets.png'});

  // dismiss the first one
  sent.length = 0;
  await p.evaluate(()=>{ const b=[...document.querySelectorAll('#pinResetsBox button')]
    .find(x=>/dismiss/i.test(x.textContent)); b.click(); });
  await p.waitForTimeout(2000);
  chk('Dismiss sends adminDismissPinReset, not adminResetPin',
      sent.some(a=>a.startsWith('adminDismissPinReset:puntodog')) && !sent.some(a=>a.startsWith('adminResetPin')),
      JSON.stringify(sent));
  const after = await p.evaluate(()=>document.getElementById('pinResetsBox').innerText.replace(/\s+/g,' '));
  chk('the dismissed request leaves the queue', !/puntodog/.test(after) && /cafergy/.test(after), after.slice(0,70));

  // approve the other
  sent.length = 0;
  await p.evaluate(()=>{ const b=[...document.querySelectorAll('#pinResetsBox button')]
    .find(x=>/approve/i.test(x.textContent)); b.click(); });
  await p.waitForTimeout(2000);
  chk('Approve still sends adminResetPin', sent.some(a=>a.startsWith('adminResetPin:cafergy')), JSON.stringify(sent));
  const empty = await p.evaluate(()=>document.getElementById('pinResetsBox').innerText.trim());
  chk('an empty queue renders nothing at all', empty==='', JSON.stringify(empty.slice(0,40)));

  if (errs.length) console.log('   page errors: '+errs.slice(0,2).join(' | '));
  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close();
  if (bad || errs.length) process.exit(1);
})();
