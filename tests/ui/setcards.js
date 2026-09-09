/* The four commissioner settings cards must come out the same height — in the
   normal view, with a card in edit mode, and with the scoring form open. */
const { chromium } = require('playwright');

const MEMBERS = ['Gyoji','puntodog','Zat0ich1','cafergy'];

function leaguePayload(){
  return { ok:true,
    league:{ id:'lg1', name:'Chanko Boogie', commissioner:'gyoji', inviteCode:'ABC', mode:'keepers',
      rosterSize:8, benchSize:2, farmSize:4, keepMk:5, keepJr:4,
      draftStatus:'none', scoring:{winPoint:1,sanyakuBonus:1,sansho:5,yusho:5},
      draftDate:'2026-09-10T17:00:00.000Z', draftAgreedCount:1, draftMemberCount:4,
      isCommissioner:true, iAgreedDraft:true, isMember:true },
    champion:null,
    members: MEMBERS.map((n,i)=>({ handle:n.toLowerCase(), name:n, team:{}, teamUpdated:'',
      roster:{makuuchi:[],juryo:[],active:[]}, boardSet:false, boardUpdated:'',
      draftBoard:null, agreedDraft:i===0 })),
    messages:[] };
}

async function open(b, vp){
  const ctx = await b.newContext({viewport:vp, deviceScaleFactor:2});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,120)));
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const req=r.request(), url=req.url();
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (req.method()==='POST') return j({ok:true});
    if (/action=leagues/.test(url)) return j({ok:true, leagues:[{id:'lg1',name:'Chanko Boogie',
      commissioner:'gyoji',inviteCode:'ABC',members:4,mode:'keepers',draftStatus:'none',isCommissioner:true}]});
    if (/action=league/.test(url)) return j(leaguePayload());
    if (/action=trades/.test(url)) return j({ok:true, trades:[]});
    if (/dm/i.test(url)) return j({ok:true, threads:[], unread:0, users:[]});
    return j({ok:true, users:[], results:[], meta:{basho:'Aki 2026',lastDay:0}, champion:null});
  });
  await p.addInitScript(()=>{ try{ localStorage.setItem('fantasy.acct',
    JSON.stringify({handle:'gyoji',name:'Gyoji',auth:'h1'})); }catch(e){} });
  await p.goto('http://127.0.0.1:8902/fantasy.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{ const x=[...document.querySelectorAll('button,a')].find(e=>/my leagues/i.test(e.textContent||'')); if(x)x.click(); });
  await p.waitForTimeout(4000);
  await p.evaluate(()=>{ const r=document.querySelector('.lg-card,.lg-row,[data-league]'); if(r)r.click(); });
  await p.waitForTimeout(4000);
  return {ctx,p,errs};
}

const boxes = p => p.evaluate(()=>{
  const wrap=document.getElementById('lgSettings');
  if (!wrap || wrap.hidden) return null;
  return [...wrap.children].filter(c=>!c.hidden).map(c=>({
    id:c.id||c.className,
    h:Math.round(c.getBoundingClientRect().height),
    w:Math.round(c.getBoundingClientRect().width) }));
});

const T=[]; const chk=(n,ok,x)=>{ T.push(ok); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

(async ()=>{
  const b = await chromium.launch();

  /* --- desktop, resting state --- */
  {
    const {ctx,p,errs} = await open(b,{width:1200,height:1400});
    const bx = await boxes(p);
    chk('all four settings cards are shown', bx && bx.length===4, JSON.stringify((bx||[]).map(x=>x.id)));
    const hs = (bx||[]).map(x=>x.h), ws=(bx||[]).map(x=>x.w);
    chk('every card is the same height', new Set(hs).size===1, hs.join(' / '));
    chk('every card is the same width', new Set(ws).size===1, ws.join(' / '));
    const el = await p.$('#lgSettings');
    if (el) await el.screenshot({path:'/tmp/cards-rest.png'});
    if (errs.length) console.log('   page errors: '+errs[0]);
    await ctx.close();
  }

  /* --- desktop, keeper card in edit mode --- */
  {
    const {ctx,p} = await open(b,{width:1200,height:1400});
    await p.evaluate(()=>{ const x=document.getElementById('lgKeepEdit'); if(x)x.click(); });
    await p.waitForTimeout(700);
    const hs = (await boxes(p)).map(x=>x.h);
    chk('an open editor is free to be taller than its neighbours', new Set(hs).size>1, hs.join(' / '));
    chk('and it is the edited card that grew', hs[2] === Math.max(...hs), hs.join(' / '));
    const el = await p.$('#lgSettings');
    if (el) await el.screenshot({path:'/tmp/cards-editing.png'});
    await ctx.close();
  }

  /* --- desktop, scoring form open (the tallest thing on the panel) --- */
  {
    const {ctx,p} = await open(b,{width:1200,height:1600});
    await p.evaluate(()=>{ const x=document.getElementById('lgScoreEdit'); if(x)x.click(); });
    await p.waitForTimeout(700);
    const hs = (await boxes(p)).map(x=>x.h);
    chk('the scoring form does not stretch the other three', new Set(hs).size>1, hs.join(' / '));
    chk('and the other three stay their resting height', Math.max(hs[0],hs[1]) < hs[3]/2, hs.join(' / '));
    const el = await p.$('#lgSettings');
    if (el) await el.screenshot({path:'/tmp/cards-scoring.png'});
    await ctx.close();
  }

  /* --- closing the editor snaps them back to matching --- */
  {
    const {ctx,p} = await open(b,{width:1200,height:1600});
    await p.evaluate(()=>{ const x=document.getElementById('lgKeepEdit'); if(x)x.click(); });
    await p.waitForTimeout(600);
    await p.evaluate(()=>{ const c=[...document.querySelectorAll('#lgKeepBody button')]
      .find(x=>/cancel/i.test(x.textContent||'')); if(c) c.click(); });
    await p.waitForTimeout(700);
    const hs=(await boxes(p)).map(x=>x.h);
    chk('closing the editor restores matching heights', new Set(hs).size===1, hs.join(' / '));
    await ctx.close();
  }

  /* --- phone: one column, cards should NOT be padded to a common height --- */
  {
    const {ctx,p} = await open(b,{width:390,height:900});
    const bx = await boxes(p);
    const hs = bx.map(x=>x.h);
    chk('on a phone each card keeps its own height', new Set(hs).size>1, hs.join(' / '));
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close();
  if (bad) process.exit(1);
})();
