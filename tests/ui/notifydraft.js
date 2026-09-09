/* Draft-room notifications, and the quota question.

   None of these events cost a request — turn, chat and presence all already
   ride the draftState poll the room makes every four seconds. What has to be
   proved is that they announce only on a CHANGE, never for your own actions,
   and that walking into a busy room does not fire a toast per backlog item.

   The last block is the one that protects the Apps Script quota: the nav poll
   must still be ONE request per cycle after swapping dmUnread for whatsNew. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};

function state(o){
  return Object.assign({
    ok:true, league:{draftStatus:'active'},
    turn:{round:1, phase:'makuuchi', handle:'bo', cursor:0},
    picks:[], pickedNames:[],
    members:[{handle:'sean',name:'Sean'},{handle:'bo',name:'Bo'},{handle:'cy',name:'Cy'}],
    presence:{sean:2, bo:3, cy:null},
    chat:[],
    serverNow:new Date().toISOString(), deadline:'', onClockAuto:false
  }, o||{});
}
function leaguePayload(){
  return { ok:true,
    league:{ id:'lg1', name:'Race', commissioner:'sean', inviteCode:'ABC', mode:'keepers',
      rosterSize:3, benchSize:0, farmSize:2, keepMk:null, keepJr:null, draftStatus:'active',
      scoring:{winPoint:1,sanyakuBonus:1,sansho:5,yusho:5}, draftDate:'',
      draftAgreedCount:3, draftMemberCount:3, isCommissioner:true, iAgreedDraft:true, isMember:true },
    champion:null,
    members:['sean','bo','cy'].map(h=>({handle:h,name:h.toUpperCase(),team:{},teamUpdated:'',
      roster:{makuuchi:[],juryo:[],active:[]},boardSet:false,boardUpdated:'',draftBoard:null,agreedDraft:true})),
    messages:[] };
}

async function room(b, initial){
  const ctx = await b.newContext({viewport:{width:1280,height:1000}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  const counts = { get:0, byAction:{} };
  /* the initial state must be in place BEFORE the first poll — otherwise the
     baseline is seeded empty and "walking into a busy room" is really
     "watching a room fill up", which is a different thing entirely */
  let cur = state(initial);
  await p.exposeFunction('__setState', o => { cur = state(o); });
  await p.addInitScript(()=>{ try{ localStorage.setItem('fantasy.acct',
    JSON.stringify({handle:'sean',name:'Sean',auth:'h1'})); }catch(e){} });
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const req=r.request(), url=req.url();
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (req.method()==='POST') return j({ok:true});
    counts.get++;
    const a = (url.match(/action=([a-zA-Z]+)/)||[])[1] || '(default)';
    counts.byAction[a] = (counts.byAction[a]||0) + 1;
    if (/action=leagues/.test(url)) return j({ok:true, leagues:[{id:'lg1',name:'Race',commissioner:'sean',
      inviteCode:'ABC',members:3,mode:'keepers',draftStatus:'active',isCommissioner:true}]});
    if (/action=league/.test(url)) return j(leaguePayload());
    if (/action=draftState/.test(url)) return j(cur);
    if (/action=whatsNew/.test(url)) return j({ok:true, unread:0, basho:'Aki 2026', lastDay:0, lastImport:''});
    if (/action=dmUnread/.test(url)) return j({ok:true, unread:0});
    if (/action=trades/.test(url)) return j({ok:true, trades:[]});
    if (/dm/i.test(url)) return j({ok:true, threads:[], unread:0, users:[]});
    return j({ok:true, users:[], results:[], meta:{basho:'Aki 2026',lastDay:0}, champion:null});
  });
  await p.goto('http://127.0.0.1:8902/fantasy.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{ const x=[...document.querySelectorAll('button,a')].find(e=>/my leagues/i.test(e.textContent||'')); if(x)x.click(); });
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{ const r=document.querySelector('.lg-card,.lg-row,[data-league]'); if(r)r.click(); });
  await p.waitForTimeout(4000);
  return {ctx,p,errs,counts,set:(o)=>p.evaluate(o=>window.__setState(o), o)};
}
const toasts = p => p.evaluate(()=>[...document.querySelectorAll('.ggn-toast')]
  .map(e=>e.querySelector('.ggn-toast__t').textContent));
const clear = p => p.evaluate(()=>document.querySelectorAll('.ggn-toast').forEach(e=>e.remove()));

(async ()=>{
  const b = await chromium.launch();

  /* ---- walking into a busy room announces nothing ---- */
  {
    const {ctx,p,errs} = await room(b, {
      chat:[{id:'m1',handle:'bo',name:'Bo',body:'hi'},
            {id:'m2',handle:'cy',name:'Cy',body:'yo'}],
      presence:{sean:2, bo:3, cy:5},
      turn:{round:1,phase:'makuuchi',handle:'sean',cursor:0}   // even your own turn
    });
    await p.waitForTimeout(5000);
    chk('arriving mid-draft with a chat log and a full room is silent',
        (await toasts(p)).length===0, JSON.stringify(await toasts(p)));
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* ---- your turn ---- */
  {
    const {ctx,p,set} = await room(b);
    await p.waitForTimeout(4500); await clear(p);
    await set({ turn:{round:1,phase:'makuuchi',handle:'sean',cursor:1} });
    await p.waitForTimeout(5000);
    const t = await toasts(p);
    chk('your turn arriving is announced', t.some(x=>/your pick/i.test(x)), JSON.stringify(t));

    await clear(p);
    await p.waitForTimeout(5000);
    chk('and it is not repeated every poll while it stays your turn',
        (await toasts(p)).length===0, JSON.stringify(await toasts(p)));
    await ctx.close();
  }

  /* ---- someone else's turn is not your business ---- */
  {
    const {ctx,p,set} = await room(b);
    await p.waitForTimeout(4500); await clear(p);
    await set({ turn:{round:1,phase:'makuuchi',handle:'cy',cursor:1} });
    await p.waitForTimeout(5000);
    chk('the clock moving to someone else says nothing',
        (await toasts(p)).length===0, JSON.stringify(await toasts(p)));
    await ctx.close();
  }

  /* ---- chat ---- */
  {
    const {ctx,p,set} = await room(b);
    await p.waitForTimeout(4500); await clear(p);
    await set({ chat:[{id:'m1',handle:'bo',name:'Bo',body:'who is taking Ura'}] });
    await p.waitForTimeout(5000);
    let t = await toasts(p);
    chk('someone else’s message is announced', t.some(x=>/Bo/.test(x)), JSON.stringify(t));

    await clear(p);
    await set({ chat:[{id:'m1',handle:'bo',name:'Bo',body:'who is taking Ura'},
                      {id:'m2',handle:'sean',name:'Sean',body:'me'}] });
    await p.waitForTimeout(5000);
    chk('your own message is not announced back at you',
        (await toasts(p)).length===0, JSON.stringify(await toasts(p)));

    await clear(p);
    await set({ chat:[{id:'m1'},{id:'m2'},{id:'m3',handle:'cy',name:'Cy',body:'a'},
                      {id:'m4',handle:'cy',name:'Cy',body:'b'},
                      {id:'m5',handle:'cy',name:'Cy',body:'c'}] });
    await p.waitForTimeout(5000);
    t = await toasts(p);
    chk('three messages at once is one toast, not three', t.length===1, JSON.stringify(t));
    await ctx.close();
  }

  /* ---- presence ---- */
  {
    const {ctx,p,set} = await room(b);
    await p.waitForTimeout(4500); await clear(p);
    await set({ presence:{sean:2, bo:3, cy:4} });          // cy arrives
    await p.waitForTimeout(5000);
    let t = await toasts(p);
    chk('someone joining is announced', t.some(x=>/join/i.test(x)), JSON.stringify(t));

    await clear(p);
    await set({ presence:{sean:2, bo:3, cy:null} });        // cy leaves
    await p.waitForTimeout(5000);
    chk('someone leaving is not', (await toasts(p)).length===0, JSON.stringify(await toasts(p)));
    await ctx.close();
  }

  /* ---- the quota question ---- */
  {
    const {ctx,p,counts} = await room(b);
    await p.waitForTimeout(8000);
    /* counted across the whole session, not a window — the cycle is 45s, so a
       short delta proves nothing either way */
    const whats = counts.byAction.whatsNew || 0;
    const unread = counts.byAction.dmUnread || 0;
    chk('the nav poll was swapped to whatsNew, not joined by it',
        unread===0 && whats>=1, whats+' whatsNew / '+unread+' dmUnread');
    chk('and it did not start polling harder', whats<=2,
        whats+' nav calls in ~20s (cycle is 45s)');
    console.log('         all GETs by action: '+JSON.stringify(counts.byAction));
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
