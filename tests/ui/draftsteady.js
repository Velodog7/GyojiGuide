/* The draft room under a struggling server, and the tripwire's alarm.

   10 Sept, Chanko Boogie: "seems to be slowing down to process picks", then
   "did draft just crash?". The page never said anything was wrong — a failed
   poll just returned — and its 4-second timer kept firing new requests while
   old ones were still out, so a slow server got slower. This pins down:
     - a failed or timed-out poll shows a "Connection trouble" strip, backs off,
       and clears itself when the server answers again;
     - a quiet server (no good answer for 15s+) is flagged even with no error;
     - only one draftState request is ever in flight;
     - only the member on the clock polls fast near a deadline;
     - the tripwire's alert: explained to everyone, one-click rewind for the
       commissioner.
*/
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{ T.push(ok); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

function mk(){ return { mode:'ok', hung:[], calls:0, posts:[], onClock:'bo', deadlineIn:100, alert:null, paused:false }; }
function state(S){
  return { ok:true, league:{draftStatus:'active', draftOrder:['bo','cy','sean'], commissioner:'sean', pickClock:120},
    turn:{round:1,phase:'makuuchi',handle:S.onClock,pickIdx:0},
    picks:[], pickedNames:[], members:[{handle:'sean',name:'SEAN'},{handle:'bo',name:'BO'},{handle:'cy',name:'CY'}],
    presence:{}, chat:[], paused:S.paused, pausedLeft:S.paused?60:0, restartAt:'', restartAgreed:[], alert:S.alert,
    serverNow:new Date().toISOString(),
    deadline:S.paused?'':new Date(Date.now()+S.deadlineIn*1000).toISOString(), clockSeconds:120, onClockAuto:false };
}
function leaguePayload(me){
  return { ok:true,
    league:{ id:'lg1', name:'Race', commissioner:'sean', inviteCode:'ABC', mode:'keepers',
      rosterSize:3, benchSize:0, farmSize:2, keepMk:null, keepJr:null, draftStatus:'active',
      scoring:{winPoint:1,sanyakuBonus:1,sansho:5,yusho:5}, draftDate:'',
      draftAgreedCount:3, draftMemberCount:3, isCommissioner:me==='sean', iAgreedDraft:true, isMember:true },
    champion:null,
    members:['sean','bo','cy'].map(h=>({handle:h,name:h.toUpperCase(),team:{},teamUpdated:'',
      roster:{makuuchi:[],juryo:[],active:[]},boardSet:false,boardUpdated:'',draftBoard:null,agreedDraft:true})),
    messages:[] };
}
async function open(b, S, me){
  const ctx = await b.newContext({viewport:{width:1200,height:1400}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  p.on('dialog', d=>{ S.dialogs=(S.dialogs||[]).concat(d.message()); d.accept(); });
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const req=r.request(), url=req.url();
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (req.method()==='POST'){
      let bd={}; try{ bd=JSON.parse(req.postData()||'{}'); }catch(e){}
      S.posts.push(bd);
      if (bd.action==='rewindDraft'){ S.alert=null; return j({ok:true,removed:3,toPick:+bd.toPick,paused:true,draftStatus:'active'}); }
      return j({ok:true});
    }
    if (/action=leagues/.test(url)) return j({ok:true, leagues:[{id:'lg1',name:'Race',commissioner:'sean',
      inviteCode:'ABC',members:3,mode:'keepers',draftStatus:'active',isCommissioner:me==='sean'}]});
    if (/action=league/.test(url)) return j(leaguePayload(me));
    if (/action=draftState/.test(url)){
      S.calls++;
      if (S.mode==='hang'){ S.hung.push(r); return; }
      if (S.mode==='500') return r.fulfill({status:500, contentType:'text/html', body:'<html>Service invoked too many times</html>'});
      if (S.mode==='busy') return j({ok:false, error:'Service invoked too many times for one day'});
      return j(state(S));
    }
    if (/action=trades/.test(url)) return j({ok:true, trades:[]});
    if (/dm/i.test(url)) return j({ok:true, threads:[], unread:0, users:[]});
    return j({ok:true, users:[], results:[], meta:{basho:'Aki 2026',lastDay:0}, champion:null});
  });
  await p.addInitScript(h=>{ try{ localStorage.setItem('fantasy.acct',
    JSON.stringify({handle:h,name:h.toUpperCase(),auth:'h1'})); }catch(e){} }, me);
  await p.goto('http://127.0.0.1:8902/fantasy.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{ const x=[...document.querySelectorAll('button,a')].find(e=>/my leagues/i.test(e.textContent||'')); if(x)x.click(); });
  await p.waitForTimeout(4000);
  await p.evaluate(()=>{ const r=document.querySelector('.lg-card,.lg-row,[data-league]'); if(r)r.click(); });
  await p.waitForTimeout(3000);
  return {ctx,p,errs};
}
const LG = "({id:'lg1', commissioner:'sean', name:'Race'})";
const poll = p => p.evaluate(`pollDraft(${LG})`);
const conn = p => p.evaluate(()=>{ const e=document.getElementById('lgConn');
  return { shown: !!e && !e.hidden, text: e ? e.innerText.replace(/\s+/g,' ') : '', ms: draftPollTimer ? draftPollMs : null }; });

(async ()=>{
  const b = await chromium.launch();

  /* ---- errors, backoff, recovery ---- */
  {
    const S = mk();
    const {ctx,p,errs} = await open(b, S, 'sean');
    let c = await conn(p);
    chk('healthy: no connection strip', !c.shown && c.ms===4000, JSON.stringify(c));

    S.mode='500'; await poll(p); c = await conn(p);
    chk('a failed poll shows the strip', c.shown && /connection trouble/i.test(c.text), c.text);
    chk('and keeps the room on screen', await p.evaluate(()=>document.querySelectorAll('#lgDraftGrid .dcard').length>0));
    await poll(p); c = await conn(p);
    chk('two failures in a row back off to 8s', c.ms===8000, c.ms);
    await poll(p); await poll(p); c = await conn(p);
    chk('four back off to 30s at most', c.ms===30000, c.ms);
    await poll(p); c = await conn(p);
    chk('and never past 30s', c.ms===30000, c.ms);

    S.mode='busy'; await poll(p); c = await conn(p);
    chk('a server error message is shown, not swallowed', /too many times/i.test(c.text), c.text);

    S.mode='ok'; await poll(p); c = await conn(p);
    chk('the first good answer clears the strip', !c.shown, c.text);
    chk('and restores the normal 4s poll', c.ms===4000, c.ms);

    /* quiet server: no error, just no answer for a while */
    await p.evaluate(()=>{ dpLastGood = Date.now() - 22000; paintConn(); });
    c = await conn(p);
    chk('no good answer for 15s+ is flagged too', c.shown && /last update 2\ds ago/.test(c.text), c.text);
    await poll(p); c = await conn(p);
    chk('and clears on the next answer', !c.shown);

    /* Retry now */
    S.mode='500'; await poll(p);
    S.mode='ok'; const before=S.calls;
    await p.click('#lgConnRetry'); await p.waitForTimeout(600);
    c = await conn(p);
    chk('Retry now polls straight away', S.calls===before+1 && !c.shown, (S.calls-before)+' calls');
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* ---- one request in flight ---- */
  {
    const S = mk();
    const {ctx,p,errs} = await open(b, S, 'sean');
    S.mode='hang'; S.calls=0;
    await p.evaluate(()=>{ DP_TIMEOUT_MS = 60000; });
    p.evaluate(`pollDraft(${LG})`);                      // goes out and hangs
    await p.waitForTimeout(9500);                        // two timer ticks fire meanwhile
    chk('timer ticks never stack a second request on a slow one', S.calls===1, S.calls+' requests in 9.5s');
    const queued = p.evaluate(`pollDraft(${LG}).then(()=>'done')`);   // an explicit poll waits its turn
    await p.waitForTimeout(300);
    chk('an explicit poll waits rather than doubling up', S.calls===1, S.calls+' requests');
    S.mode='ok';
    S.hung.forEach(r=>r.fulfill({contentType:'application/json',body:JSON.stringify(state(S))})); S.hung=[];
    const q = await Promise.race([queued, new Promise(r=>setTimeout(()=>r('stuck'),5000))]);
    chk('and runs once the slow one lands', q==='done' && S.calls===2, q+' / '+S.calls+' requests');

    /* a poll that never answers gives up */
    S.mode='hang';
    await p.evaluate(()=>{ DP_TIMEOUT_MS = 1500; });
    await poll(p);
    const c = await conn(p);
    chk('a poll that never answers gives up and says so', c.shown && /timed out/i.test(c.text), c.text);
    S.hung.forEach(r=>r.abort().catch(()=>{})); S.hung=[];
    chk('no page errors (in flight)', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* ---- fast polling only for the member on the clock ---- */
  {
    const S = mk(); S.onClock='bo'; S.deadlineIn=4;
    const {ctx,p,errs} = await open(b, S, 'sean');
    await poll(p);
    let c = await conn(p);
    chk('someone else near a deadline: I stay at 4s', c.ms===4000, c.ms);
    S.onClock='sean'; await poll(p); c = await conn(p);
    chk('me near my own deadline: 1.2s', c.ms===1200, c.ms);
    S.deadlineIn=90; await poll(p); c = await conn(p);
    chk('me with time to spare: back to 4s', c.ms===4000, c.ms);
    S.deadlineIn=3; S.paused=true; await poll(p); c = await conn(p);
    chk('paused: no fast polling', c.ms===4000, c.ms);
    chk('no page errors (fast)', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* ---- the tripwire's alarm ---- */
  const ALERT = { turns:[{pick:21, handle:'sean', names:['Daieisho','Gonoyama','Takanosho']}], names:[], fixFrom:21 };
  {
    const S = mk(); S.alert = ALERT; S.paused = true;
    const {ctx,p,errs} = await open(b, S, 'sean');
    const a = await p.evaluate(()=>{ const e=document.getElementById('lgAlert');
      return { shown: !!e && !e.hidden, text: e ? e.innerText.replace(/\s+/g,' ') : '', btn: !!document.getElementById('lgAlertFix'),
        banner: document.getElementById('lgPaused').innerText.replace(/\s+/g,' ') }; });
    chk('the commissioner sees what went wrong', a.shown && /stopped itself/i.test(a.text) && /Pick 22 was recorded 3 times/.test(a.text) && /Daieisho, Gonoyama, Takanosho/.test(a.text), a.text.slice(0,160));
    chk('with a one-click fix', a.btn && /Rewind to pick 22/.test(a.text));
    chk('the paused banner blames the problem, not the commissioner', /because of the problem above/.test(a.banner), a.banner.slice(0,100));
    S.dialogs=[];
    await p.click('#lgAlertFix'); await p.waitForTimeout(900);
    const rw = S.posts.filter(x=>x.action==='rewindDraft').pop();
    chk('the fix asks first, then rewinds to that pick', S.dialogs.length===1 && rw && rw.toPick===21, JSON.stringify(rw));
    const gone = await p.evaluate(()=>document.getElementById('lgAlert').hidden);
    chk('and the alarm clears once the log is clean', gone);
    chk('no page errors (alert, commissioner)', errs.length===0, errs[0]||'');
    await ctx.close();
  }
  {
    const S = mk(); S.alert = ALERT; S.paused = true;
    const {ctx,p,errs} = await open(b, S, 'bo');
    const a = await p.evaluate(()=>{ const e=document.getElementById('lgAlert');
      return { shown: !!e && !e.hidden, text: e ? e.innerText.replace(/\s+/g,' ') : '', btn: !!document.getElementById('lgAlertFix') }; });
    chk('a member is told too', a.shown && /commissioner has been told/i.test(a.text), a.text.slice(0,140));
    chk('but gets no rewind button', !a.btn);
    chk('no page errors (alert, member)', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  await b.close();
  const f=T.filter(x=>!x).length;
  console.log('\n'+(T.length-f)+' passed, '+f+' failed');
  process.exit(f?1:0);
})();
