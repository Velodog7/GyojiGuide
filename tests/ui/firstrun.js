/* The soft-launch critical path, end to end, as a brand-new visitor with an
   empty browser: land → sign up → draft seven → save → see it on the
   leaderboard → come back on a second device and find the team waiting.
   Backed by a stateful fake of the real API. */
const { chromium } = require('playwright');

const server = { users: {}, meta:{basho:'Aki 2026', lastDay:0}, results:[] };

function handle(route){
  const req = route.request();
  const j = o => route.fulfill({contentType:'application/json', body:JSON.stringify(o)});
  if (req.method() === 'POST'){
    let b={}; try{ b=JSON.parse(req.postData()||'{}'); }catch(e){}
    const key = String(b.handle||'').toLowerCase();
    if (b.action==='register'){
      if (server.users[key]) return j({ok:false, error:'That handle is taken — sign in instead.'});
      server.users[key] = { handle:b.handle, name:b.name||b.handle, auth:b.auth, team:{}, updated:new Date().toISOString() };
      return j({ok:true, created:true});
    }
    if (b.action==='login'){
      const u=server.users[key];
      if (!u || u.auth!==b.auth) return j({ok:false, error:'Wrong handle or PIN.'});
      return j({ok:true, handle:u.handle, name:u.name});
    }
    if (b.action==='save'){
      const u=server.users[key];
      if (!u || u.auth!==b.auth) return j({ok:false, error:'Not authorised for this handle.'});
      u.team = b.team||{}; u.updated=new Date().toISOString();
      return j({ok:true, updated:true});
    }
    return j({ok:true});
  }
  const url=req.url();
  if (/action=leagues/.test(url)) return j({ok:true, leagues:[]});
  if (/action=accountSummary/.test(url)) return j({ok:true, titles:[], badges:[], history:[], allTime:{}, leagues:[]});
  if (/dm/i.test(url)) return j({ok:true, threads:[], unread:0, users:[]});
  return j({ ok:true,
    users: Object.values(server.users).map(u=>({handle:u.handle,name:u.name,team:u.team,updated:u.updated,
      rank:{idx:0,label:'Jonokuchi',div:'jonokuchi'}})),
    results: server.results, meta: server.meta, champion:null });
}

async function newPage(ctx){
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('   !! pageerror: '+String(e).split('\n')[0].slice(0,140)));
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', handle);
  return p;
}
const step = (n,ok,extra)=>console.log((ok?'  ok   ':'  FAIL ')+n+(extra?('   '+extra):''));

(async ()=>{
  const b = await chromium.launch();
  const ctx = await b.newContext({viewport:{width:1280,height:1000}});   // device 1: empty browser
  let pass=0, fail=0; const T=(n,ok,x)=>{ step(n,ok,x); ok?pass++:fail++; };

  // --- 1. land on the homepage cold ---
  let p = await newPage(ctx);
  await p.goto('http://127.0.0.1:8902/index.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  const landing = await p.evaluate(()=>({
    strip: (()=>{ const s=document.getElementById('bzStrip');
      return s && !s.hidden ? s.innerText.replace(/\s+/g,' ').slice(0,60) : ''; })(),
    signup: !!document.getElementById('ggaSignup'),
    footer: !!document.getElementById('gg-foot')
  }));
  T('homepage shows the basho strip', !!landing.strip, landing.strip);
  T('homepage offers Sign up', landing.signup);
  T('footer with terms is present', landing.footer);

  // --- 2. sign up through the real nav modal ---
  await p.click('#ggaSignup');
  await p.waitForTimeout(700);
  await p.fill('#ggaHandle','newbie');
  const hasName = await p.$('#ggaName'); if (hasName) await p.fill('#ggaName','New Bie');
  await p.fill('#ggaPin','sumo1234');
  await p.click('#ggaSubmit');
  await p.waitForTimeout(2500);
  const signedUp = await p.evaluate(()=>{
    const a = window.GyojiGuide && GyojiGuide.account.get();
    return { acct: a ? a.handle : null, chip: !!document.getElementById('ggaChip') };
  });
  T('sign-up creates the account', signedUp.acct==='newbie', 'acct='+signedUp.acct);
  T('nav switches to the account chip', signedUp.chip);
  T('the account reached the server', !!server.users['newbie']);
  await p.close();

  // --- 3. draft seven on analysis and save ---
  p = await newPage(ctx);
  await p.goto('http://127.0.0.1:8902/analysis.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4000);
  const drafted = await p.evaluate(()=>{
    BRACKETS.forEach(b=>{
      const used=new Set(Object.values(picks).filter(x=>x!=null));
      const c=R.find(r=>b.ok(r)&&!used.has(r.id));
      if(c) picks[b.id]=c.id;
    });
    updateDraftCount(); renderCards(); renderDraft();
    return Object.values(picks).filter(x=>x!=null).length;
  });
  T('can fill all seven brackets', drafted===7, drafted+'/7');
  const saveState = await p.evaluate(()=>{
    const s=document.getElementById('ggSave');
    return s ? {found:true, disabled:s.disabled} : {found:false};
  });
  T('Save my team is offered and enabled', saveState.found && !saveState.disabled, JSON.stringify(saveState));
  await p.evaluate(()=>document.getElementById('ggSave').click());
  await p.waitForTimeout(2500);
  const msgTxt = await p.evaluate(()=>(document.getElementById('ggMsg')||{}).textContent);
  T('save confirms to the user', /saved/i.test(msgTxt||''), JSON.stringify(msgTxt));
  T('the team reached the server', Object.keys(server.users['newbie'].team||{}).length===7,
    JSON.stringify(server.users['newbie'].team));
  await p.close();

  // --- 4. the fantasy leaderboard sees it ---
  p = await newPage(ctx);
  await p.goto('http://127.0.0.1:8902/fantasy.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4500);
  const board = await p.evaluate(()=>{
    const t=document.body.innerText;
    return { mentionsMe: /New Bie|newbie/i.test(t),
             countdown: !!(document.getElementById('countdown') && !document.getElementById('countdown').hidden) };
  });
  T('the player appears on the fantasy page', board.mentionsMe);
  T('the countdown to Aki is showing', board.countdown);
  await p.close();
  await ctx.close();

  // --- 5. a SECOND device: sign in, team should be waiting ---
  const ctx2 = await b.newContext({viewport:{width:390,height:844}});
  p = await newPage(ctx2);
  await p.goto('http://127.0.0.1:8902/analysis.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4000);
  const before = await p.evaluate(()=>Object.values(picks).filter(x=>x!=null).length);
  await p.evaluate(async ()=>{ await GyojiGuide.login('newbie','sumo1234');
    document.dispatchEvent(new CustomEvent('gg-auth-change',{detail:{}})); });
  await p.waitForTimeout(3500);
  const after = await p.evaluate(()=>({
    n: Object.values(picks).filter(x=>x!=null).length,
    first: (()=>{ const i=picks[BRACKETS[0].id]; return Number.isInteger(i)&&R[i]?R[i].n:null; })()
  }));
  T('second device starts empty', before===0, before+'/7');
  T('signing in there restores the saved team', after.n===7, after.n+'/7 first='+after.first);
  await p.close();
  await ctx2.close();

  console.log('\n'+pass+' passed, '+fail+' failed');
  await b.close();
  if (fail) process.exit(1);
})();
