/* The draft pool as wrestler cards: the ⓘ corner flips to the dossier, tapping
   still only selects, and the filter box narrows the pool without touching the
   network. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{ T.push(ok); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

function mk(onClock){ return {picks:[], made:[], onClock, stateCalls:0}; }
function leaguePayload(){
  return { ok:true,
    league:{ id:'lg1', name:'Race', commissioner:'sean', inviteCode:'ABC', mode:'keepers',
      rosterSize:4, benchSize:0, farmSize:2, keepMk:null, keepJr:null, draftStatus:'active',
      scoring:{winPoint:1,sanyakuBonus:1,sansho:5,yusho:5}, draftDate:'',
      draftAgreedCount:2, draftMemberCount:2, isCommissioner:true, iAgreedDraft:true, isMember:true },
    champion:null,
    members:[{handle:'sean',name:'Sean',team:{},teamUpdated:'',roster:{makuuchi:[],juryo:[],active:[]},
              boardSet:false,boardUpdated:'',draftBoard:null,agreedDraft:true},
             {handle:'bo',name:'Bo',team:{},teamUpdated:'',roster:{makuuchi:[],juryo:[],active:[]},
              boardSet:false,boardUpdated:'',draftBoard:null,agreedDraft:true}],
    messages:[] };
}
async function open(b, S, vp){
  const ctx = await b.newContext({viewport: vp || {width:1280,height:1200}, deviceScaleFactor:2});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const req=r.request(), url=req.url();
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (req.method()==='POST'){
      let bd={}; try{ bd=JSON.parse(req.postData()||'{}'); }catch(e){}
      if (bd.action==='makePick'){ S.made.push(bd.rikishi);
        S.picks.push({round:1,handle:'sean',rikishi:bd.rikishi}); S.onClock='bo';
        return j({ok:true, nextTurn:{round:1,phase:'makuuchi',handle:'bo',cursor:1}, draftStatus:'active', deadline:''}); }
      return j({ok:true});
    }
    if (/action=leagues/.test(url)) return j({ok:true, leagues:[{id:'lg1',name:'Race',commissioner:'sean',
      inviteCode:'ABC',members:2,mode:'keepers',draftStatus:'active',isCommissioner:true}]});
    if (/action=league/.test(url)) return j(leaguePayload());
    if (/action=draftState/.test(url)){ S.stateCalls++;
      return j({ok:true, league:{draftStatus:'active'},
        turn:{round:1,phase:'makuuchi',handle:S.onClock,cursor:S.picks.length},
        picks:S.picks, pickedNames:S.picks.map(x=>x.rikishi),
        serverNow:new Date().toISOString(), deadline:'', onClockAuto:false}); }
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

  /* --- the cards themselves --- */
  {
    const S = mk('sean');
    const {ctx,p,errs} = await open(b, S);
    const c = await p.evaluate(()=>{
      const cards=[...document.querySelectorAll('#lgDraftGrid .dcard')];
      const first=cards[0];
      return { n:cards.length,
        isButton: first && first.tagName==='BUTTON',
        hasPhoto: !!first.querySelector('.pc-photo img'),
        hasKanji: !!first.querySelector('.pc-kanji'),
        hasRank:  !!first.querySelector('.pc-rankline'),
        hasInfo:  !!first.querySelector('.dcard__info'),
        hasBack:  !!first.querySelector('.dcard__back'),
        backText: (first.querySelector('.dcard__back')||{}).innerText||'' };
    });
    chk('the pool renders as cards', c.n>10, c.n+' cards');
    chk('each card is a real button', c.isButton);
    chk('with the portrait, kanji and rank', c.hasPhoto && c.hasKanji && c.hasRank, JSON.stringify(c));
    chk('and a back face carrying the dossier', c.hasBack && /Stable|Elo|Style/.test(c.backText), c.backText.slice(0,80).replace(/\s+/g,' '));
    chk('no page errors', errs.length===0, errs[0]||'');

    /* the ⓘ flips and must NOT select */
    await p.evaluate(()=>document.querySelector('#lgDraftGrid .dcard .dcard__info').click());
    await p.waitForTimeout(500);
    const f = await p.evaluate(()=>({
      flipped: document.querySelectorAll('#lgDraftGrid .dcard.flipped').length,
      selected: document.querySelectorAll('#lgDraftGrid .dcard.sel').length,
      bar: document.getElementById('lgDraftConfirm').hidden }));
    chk('the ⓘ flips the card', f.flipped===1, f.flipped+' flipped');
    chk('and does not select him', f.selected===0 && f.bar, JSON.stringify(f));
    chk('and certainly does not draft him', S.made.length===0, S.made.length+' sent');

    /* flipping back */
    await p.evaluate(()=>document.querySelector('#lgDraftGrid .dcard .dcard__info').click());
    await p.waitForTimeout(400);
    chk('a second ⓘ turns it back over',
        (await p.evaluate(()=>document.querySelectorAll('#lgDraftGrid .dcard.flipped').length))===0);

    /* the card body still selects */
    await p.evaluate(()=>document.querySelector('#lgDraftGrid .dcard').click());
    await p.waitForTimeout(500);
    chk('tapping the card still selects',
        (await p.evaluate(()=>document.querySelectorAll('#lgDraftGrid .dcard.sel').length))===1);
    chk('and still sends nothing', S.made.length===0, S.made.length+' sent');
    const el = await p.$('#lgDraftGrid'); if (el) await el.screenshot({path:'/tmp/draft-cards.png'});
    await ctx.close();
  }

  /* --- the filter --- */
  {
    const S = mk('sean');
    const {ctx,p} = await open(b, S);
    const all = await p.evaluate(()=>document.querySelectorAll('#lgDraftGrid .dcard').length);
    const count0 = await p.evaluate(()=>document.getElementById('lgDraftCount').textContent);
    chk('the count shows the pool size', /available/.test(count0), count0);

    const type = async q => { await p.evaluate(v=>{ const i=document.getElementById('lgDraftFind');
      i.value=v; i.dispatchEvent(new Event('input')); }, q); await p.waitForTimeout(400); };

    await type('ura');
    let r = await p.evaluate(()=>({n:document.querySelectorAll('#lgDraftGrid .dcard').length,
      names:[...document.querySelectorAll('#lgDraftGrid .dcard')].map(c=>c.dataset.pick),
      count:document.getElementById('lgDraftCount').textContent}));
    chk('filtering by name narrows the pool', r.n>0 && r.n<all, r.n+' of '+all+' — '+r.names.join(','));
    chk('and the counter says so', / of /.test(r.count), r.count);

    await type('mongolia');
    r = await p.evaluate(()=>({n:document.querySelectorAll('#lgDraftGrid .dcard').length,
      names:[...document.querySelectorAll('#lgDraftGrid .dcard')].map(c=>c.dataset.pick)}));
    chk('you can filter by country', r.n>0 && r.n<all, r.n+' — '+r.names.slice(0,4).join(','));

    await type('nishonoseki');
    r = await p.evaluate(()=>[...document.querySelectorAll('#lgDraftGrid .dcard')].map(c=>c.dataset.pick));
    chk('and by stable', r.length>0 && r.includes('Onosato'), r.join(','));

    await type('ozeki');
    r = await p.evaluate(()=>[...document.querySelectorAll('#lgDraftGrid .dcard')].map(c=>c.dataset.pick));
    chk('and by rank', r.length>0, r.join(','));

    await type('豊昇龍');
    r = await p.evaluate(()=>[...document.querySelectorAll('#lgDraftGrid .dcard')].map(c=>c.dataset.pick));
    chk('and by kanji', r.length===1 && r[0]==='Hoshoryu', r.join(','));

    await type('zzzznobody');
    r = await p.evaluate(()=>document.getElementById('lgDraftGrid').innerText);
    chk('no match says so instead of going blank', /Nobody matches/.test(r), r.slice(0,60));

    await type('');
    r = await p.evaluate(()=>document.querySelectorAll('#lgDraftGrid .dcard').length);
    chk('clearing the box restores the pool', r===all, r+' of '+all);
    chk('none of that touched the network', S.stateCalls < 6, S.stateCalls+' draftState calls');
    await ctx.close();
  }

  /* --- filtering then picking --- */
  {
    const S = mk('sean');
    const {ctx,p} = await open(b, S);
    await p.evaluate(()=>{ const i=document.getElementById('lgDraftFind'); i.value='ura'; i.dispatchEvent(new Event('input')); });
    await p.waitForTimeout(500);
    await p.evaluate(()=>document.querySelector('#lgDraftGrid .dcard').click());
    await p.waitForTimeout(400);
    const name = await p.evaluate(()=>(document.querySelector('#lgDraftGrid .dcard.sel')||{}).dataset.pick);
    await p.evaluate(()=>{ const g=document.getElementById('lgPickGo'); if(g) g.click(); });
    await p.waitForTimeout(1500);
    chk('a filtered card can be drafted', S.made.length===1 && S.made[0]===name, JSON.stringify(S.made)+' sel='+name);
    await ctx.close();
  }

  /* --- someone else's turn --- */
  {
    const S = mk('bo');
    const {ctx,p} = await open(b, S);
    const st = await p.evaluate(()=>({
      cards: document.querySelectorAll('#lgDraftGrid .dcard').length,
      live: [...document.querySelectorAll('#lgDraftGrid .dcard')].filter(c=>!c.disabled).length,
      info: document.querySelectorAll('#lgDraftGrid .dcard__info').length }));
    chk('the cards are inert on someone else’s turn', st.live===0, st.live+' of '+st.cards+' live');
    chk('but you can still read them', st.info===st.cards, st.info+' ⓘ buttons');
    await p.evaluate(()=>document.querySelector('#lgDraftGrid .dcard__info').click());
    await p.waitForTimeout(400);
    chk('and flipping still works while waiting',
        (await p.evaluate(()=>document.querySelectorAll('#lgDraftGrid .dcard.flipped').length))===1);
    chk('no picks leaked', S.made.length===0, S.made.length+' sent');
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close();
  if (bad) process.exit(1);
})();
