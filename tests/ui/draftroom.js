/* The draft room's chat and presence strip, through the real UI. Both ride on
   the draftState poll, so the fake counts every request the page makes. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{ T.push(ok); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

function mk(){ return { picks:[], made:[], posted:[], chat:[], onClock:'sean',
  presence:{sean:2, bo:20, cy:null}, stateCalls:0, whoSeen:[] }; }

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

async function open(b, S){
  const ctx = await b.newContext({viewport:{width:1200,height:1400}, deviceScaleFactor:2});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const req=r.request(), url=req.url();
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (req.method()==='POST'){
      let bd={}; try{ bd=JSON.parse(req.postData()||'{}'); }catch(e){}
      if (bd.action==='postMessage'){
        S.posted.push(bd.body);
        S.chat.push({id:'m'+S.chat.length, handle:'sean', name:'SEAN', body:bd.body,
                     parentId:'', created:new Date().toISOString()});
        return j({ok:true, id:'m'+(S.chat.length-1)});
      }
      if (bd.action==='makePick'){ S.made.push(bd.rikishi); return j({ok:true,
        nextTurn:{round:1,phase:'makuuchi',handle:'bo',cursor:1}, draftStatus:'active', deadline:''}); }
      return j({ok:true});
    }
    if (/action=leagues/.test(url)) return j({ok:true, leagues:[{id:'lg1',name:'Race',commissioner:'sean',
      inviteCode:'ABC',members:3,mode:'keepers',draftStatus:'active',isCommissioner:true}]});
    if (/action=league/.test(url)) return j(leaguePayload());
    if (/action=draftState/.test(url)){
      S.stateCalls++;
      const who = new URL(url).searchParams.get('who');
      S.whoSeen.push(who);
      return j({ ok:true, league:{draftStatus:'active'},
        turn:{round:1,phase:'makuuchi',handle:S.onClock,cursor:S.picks.length},
        picks:S.picks, pickedNames:S.picks.map(x=>x.rikishi),
        members:[{handle:'sean',name:'SEAN'},{handle:'bo',name:'BO'},{handle:'cy',name:'CY'}],
        presence:S.presence, chat:S.chat,
        serverNow:new Date().toISOString(), deadline:'', onClockAuto:false });
    }
    if (/action=trades/.test(url)) return j({ok:true, trades:[]});
    if (/dm/i.test(url)) return j({ok:true, threads:[], unread:0, users:[]});
    return j({ok:true, users:[], results:[], meta:{basho:'Aki 2026',lastDay:0}, champion:null});
  });
  await p.addInitScript(()=>{ try{ localStorage.setItem('fantasy.acct',
    JSON.stringify({handle:'sean',name:'Sean',auth:'h1'})); }catch(e){} });
  await p.goto('http://127.0.0.1:8902/fantasy.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{ const x=[...document.querySelectorAll('button,a')].find(e=>/my leagues/i.test(e.textContent||'')); if(x)x.click(); });
  await p.waitForTimeout(4000);
  await p.evaluate(()=>{ const r=document.querySelector('.lg-card,.lg-row,[data-league]'); if(r)r.click(); });
  await p.waitForTimeout(4000);
  return {ctx,p,errs};
}

(async ()=>{
  const b = await chromium.launch();

  /* ---- presence ---- */
  {
    const S = mk();
    const {ctx,p,errs} = await open(b, S);
    const room = await p.evaluate(()=>{
      const el=document.getElementById('lgRoom');
      return { shown: el && !el.hidden,
        text: el ? el.innerText.replace(/\s+/g,' ') : '',
        here: el ? el.querySelectorAll('.lg-who.here').length : 0,
        idle: el ? el.querySelectorAll('.lg-who.idle').length : 0,
        cold: el ? [...el.querySelectorAll('.lg-who')].filter(x=>!x.classList.contains('here')&&!x.classList.contains('idle')).length : 0,
        you:  el ? el.querySelectorAll('.lg-who.you').length : 0 };
    });
    chk('the room strip shows', room.shown, room.text.slice(0,60));
    chk('everyone in the league is listed', /SEAN/.test(room.text) && /BO/.test(room.text) && /CY/.test(room.text), room.text);
    chk('someone polling seconds ago reads as here', room.here===2, room.here+' here');
    chk('someone away for minutes does not', room.cold===1, JSON.stringify(room));
    chk('and you are marked', room.you===1, room.you+' marked you');
    chk('the poll tells the server who is asking', S.whoSeen.every(w=>w==='sean'), JSON.stringify(S.whoSeen.slice(0,3)));
    chk('no page errors', errs.length===0, errs[0]||'');

    /* idle band */
    S.presence = {sean:3, bo:200, cy:null};
    await p.evaluate(()=>pollDraft({id:'lg1'}));
    await p.waitForTimeout(1200);
    const idle = await p.evaluate(()=>document.querySelectorAll('#lgRoom .lg-who.idle').length);
    chk('a few minutes away reads as idle, not gone', idle===1, idle+' idle');
    await ctx.close();
  }

  /* ---- chat ---- */
  {
    const S = mk();
    S.chat = [{id:'m0',handle:'bo',name:'BO',body:'who is taking Onosato',parentId:'',created:new Date(Date.now()-90000).toISOString()}];
    const {ctx,p,errs} = await open(b, S);
    let c = await p.evaluate(()=>({
      msgs: document.querySelectorAll('#lgChatLog .lg-chat__m').length,
      text: document.getElementById('lgChatLog').innerText.replace(/\s+/g,' '),
      hasInput: !!document.getElementById('lgChatInput'),
      hasSend: !!document.getElementById('lgChatSend') }));
    chk('the existing board shows as chat', c.msgs===1 && /who is taking Onosato/.test(c.text), c.text.slice(0,60));
    chk('with a composer', c.hasInput && c.hasSend);

    await p.evaluate(()=>{ const i=document.getElementById('lgChatInput');
      i.value='taking Ura, thanks'; document.getElementById('lgChatSend').click(); });
    await p.waitForTimeout(2000);
    chk('sending posts to the league board', S.posted.length===1 && S.posted[0]==='taking Ura, thanks', JSON.stringify(S.posted));
    c = await p.evaluate(()=>({
      msgs: document.querySelectorAll('#lgChatLog .lg-chat__m').length,
      mine: document.querySelectorAll('#lgChatLog .lg-chat__m.me').length,
      box:  document.getElementById('lgChatInput').value }));
    chk('the message appears in the log', c.msgs===2, c.msgs+' messages');
    chk('your own posts are marked', c.mine===1, c.mine+' marked mine');
    chk('and the box is cleared', c.box==='', JSON.stringify(c.box));

    /* Enter sends, Shift+Enter does not */
    await p.evaluate(()=>{ const i=document.getElementById('lgChatInput'); i.value='second line';
      i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true})); });
    await p.waitForTimeout(800);
    chk('Shift+Enter does not send', S.posted.length===1, JSON.stringify(S.posted));
    await p.evaluate(()=>{ const i=document.getElementById('lgChatInput'); i.value='third';
      i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); });
    await p.waitForTimeout(1800);
    chk('Enter sends', S.posted.length===2 && S.posted[1]==='third', JSON.stringify(S.posted));

    /* an empty message goes nowhere */
    await p.evaluate(()=>{ const i=document.getElementById('lgChatInput'); i.value='   ';
      document.getElementById('lgChatSend').click(); });
    await p.waitForTimeout(900);
    chk('whitespace is not a message', S.posted.length===2, JSON.stringify(S.posted));
    chk('no page errors', errs.length===0, errs[0]||'');
    const el = await p.$('.lg-draftroom'); if (el) await el.screenshot({path:'/tmp/draft-room.png'});
    await ctx.close();
  }

  /* ---- neither gets a poller of its own ---- */
  {
    const S = mk();
    const {ctx,p} = await open(b, S);
    const before = S.stateCalls;
    await p.waitForTimeout(9000);          // two poll ticks
    const added = S.stateCalls - before;
    chk('chat and presence add no requests of their own', added <= 3, added+' draftState calls in 9s');
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close();
  if (bad) process.exit(1);
})();
