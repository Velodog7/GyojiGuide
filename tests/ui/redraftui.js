/* The supplemental re-draft, brought in line with the snake draft: cards, an
   ⓘ flip, a filter, and select-then-confirm instead of fire-on-tap. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{ T.push(ok); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

const MK = ['Onosato','Hoshoryu','Kirishima','Ura','Takayasu','Abi','Oshoma','Roga'];
const JR = ['Dewanoryu','Kazuma','Tokihayate','Asakoryu'];

function mk(open){ return { made:[], onClock:'sean', open: open || {mk:2, jr:1},
  pool: MK.map(n=>({name:n,division:'makuuchi'})).concat(JR.map(n=>({name:n,division:'juryo'}))),
  stateCalls:0 }; }

function leaguePayload(){
  return { ok:true,
    league:{ id:'lg1', name:'Race', commissioner:'sean', inviteCode:'ABC', mode:'keepers',
      rosterSize:4, benchSize:0, farmSize:2, keepMk:2, keepJr:1, draftStatus:'redraft',
      scoring:{winPoint:1,sanyakuBonus:1,sansho:5,yusho:5}, draftDate:'',
      draftAgreedCount:2, draftMemberCount:2, isCommissioner:true, iAgreedDraft:true, isMember:true },
    champion:null,
    members:['sean','bo'].map(h=>({handle:h,name:h.toUpperCase(),team:{},teamUpdated:'',
      roster:{makuuchi:[],juryo:[],active:[]},boardSet:false,boardUpdated:'',draftBoard:null,agreedDraft:true})),
    messages:[] };
}

async function open(b, S){
  const ctx = await b.newContext({viewport:{width:1200,height:1300}, deviceScaleFactor:2});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  p.on('dialog', d=>d.accept());
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const req=r.request(), url=req.url();
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (req.method()==='POST'){
      let bd={}; try{ bd=JSON.parse(req.postData()||'{}'); }catch(e){}
      if (bd.action==='redraftState'){
        S.stateCalls++;
        return j({ ok:true, redraft:true, rosterSize:4, benchSize:0, farmSize:2,
          order:['sean','bo'],
          turn:{ phase:'redraft', handle:S.onClock, cursor:0, open:S.open },
          pool:S.pool });
      }
      if (bd.action==='redraftPick'){
        S.made.push(bd.rikishi);
        S.pool = S.pool.filter(x=>x.name!==bd.rikishi);
        S.onClock = 'bo';
        return j({ok:true, nextTurn:{phase:'redraft', handle:'bo', cursor:1, open:{mk:2,jr:1}}, draftStatus:'redraft'});
      }
      return j({ok:true});
    }
    if (/action=leagues/.test(url)) return j({ok:true, leagues:[{id:'lg1',name:'Race',commissioner:'sean',
      inviteCode:'ABC',members:2,mode:'keepers',draftStatus:'redraft',isCommissioner:true}]});
    if (/action=league/.test(url)) return j(leaguePayload());
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
  await p.waitForTimeout(4500);
  return {ctx,p,errs};
}

(async ()=>{
  const b = await chromium.launch();

  /* ---- cards, not bare buttons ---- */
  {
    const S = mk();
    const {ctx,p,errs} = await open(b, S);
    const c = await p.evaluate(()=>{
      const cards=[...document.querySelectorAll('#rdPools .dcard')];
      const f=cards[0];
      return { n:cards.length, oldButtons: document.querySelectorAll('.rd-pick').length,
        photo: !!(f&&f.querySelector('.pc-photo img')), info: !!(f&&f.querySelector('.dcard__info')),
        back: (f&&f.querySelector('.dcard__back')||{}).innerText||'',
        blocks: document.querySelectorAll('#rdPools .lg-roster-block').length,
        heads: [...document.querySelectorAll('#rdPools h5')].map(h=>h.textContent.replace(/\s+/g,' ')) };
    });
    chk('the pools render as cards', c.n===12, c.n+' cards');
    chk('the old bare-name buttons are gone', c.oldButtons===0, c.oldButtons+' left');
    chk('with portraits and an ⓘ', c.photo && c.info);
    chk('and a dossier on the back', /Stable|Elo|Style/.test(c.back), c.back.slice(0,60).replace(/\s+/g,' '));
    chk('both divisions get their own block', c.blocks===2, JSON.stringify(c.heads));
    chk('each says how many slots are open', c.heads.every(h=>/slot/.test(h)), JSON.stringify(c.heads));
    chk('no page errors', errs.length===0, errs[0]||'');

    /* the ⓘ flips without selecting */
    await p.evaluate(()=>document.querySelector('#rdPools .dcard .dcard__info').click());
    await p.waitForTimeout(400);
    const f = await p.evaluate(()=>({ flipped:document.querySelectorAll('#rdPools .dcard.flipped').length,
      sel:document.querySelectorAll('#rdPools .dcard.sel').length }));
    chk('the ⓘ flips without selecting', f.flipped===1 && f.sel===0, JSON.stringify(f));
    chk('and drafts nobody', S.made.length===0, S.made.length+' sent');
    await ctx.close();
  }

  /* ---- select then confirm ---- */
  {
    const S = mk();
    const {ctx,p} = await open(b, S);
    await p.evaluate(()=>document.querySelector('#rdPools .dcard').click());
    await p.waitForTimeout(500);
    const sel = await p.evaluate(()=>({
      n: document.querySelectorAll('#rdPools .dcard.sel').length,
      bar: !document.getElementById('rdConfirm').hidden,
      text: document.getElementById('rdConfirm').innerText.replace(/\s+/g,' ') }));
    chk('a tap only selects', sel.n===1 && S.made.length===0, JSON.stringify(sel.n)+' sel, '+S.made.length+' sent');
    chk('and raises a confirm bar', sel.bar && /Draft/.test(sel.text), sel.text.slice(0,50));

    /* eight stray taps, still nothing sent */
    await p.evaluate(()=>{ [...document.querySelectorAll('#rdPools .dcard')].slice(0,8).forEach(c=>c.click()); });
    await p.waitForTimeout(700);
    chk('eight stray taps send nothing', S.made.length===0, S.made.length+' sent');

    const name = await p.evaluate(()=>document.querySelector('#rdPools .dcard.sel').dataset.pick);
    await p.evaluate(()=>{ const g=document.getElementById('rdGo'); g.click(); g.click(); g.click(); });
    await p.waitForTimeout(2000);
    chk('mashing confirm sends exactly one pick', S.made.length===1 && S.made[0]===name, JSON.stringify(S.made));
    const after = await p.evaluate(()=>({
      turn: document.getElementById('rdTurn').innerText,
      live: [...document.querySelectorAll('#rdPools .dcard')].filter(c=>!c.disabled).length }));
    chk('the turn line moves on immediately', /Waiting on/.test(after.turn), after.turn.slice(0,40));
    chk('and the pools lock', after.live===0, after.live+' live');
    await ctx.close();
  }

  /* ---- the filter ---- */
  {
    const S = mk();
    const {ctx,p} = await open(b, S);
    const type = async q => { await p.evaluate(v=>{ const i=document.getElementById('rdFind');
      i.value=v; i.dispatchEvent(new Event('input')); }, q); await p.waitForTimeout(400); };
    const all = await p.evaluate(()=>document.querySelectorAll('#rdPools .dcard').length);
    await type('ura');
    let r = await p.evaluate(()=>[...document.querySelectorAll('#rdPools .dcard')].map(c=>c.dataset.pick));
    chk('the filter narrows both pools', r.length>0 && r.length<all, r.join(','));
    await type('mongolia');
    r = await p.evaluate(()=>[...document.querySelectorAll('#rdPools .dcard')].map(c=>c.dataset.pick));
    chk('and searches the dossier too', r.length>0 && r.length<all, r.join(','));
    await type('zzzz');
    chk('no match says so', /Nobody matches/.test(await p.evaluate(()=>document.getElementById('rdPools').innerText)));
    await type('');
    chk('clearing restores the pools',
        (await p.evaluate(()=>document.querySelectorAll('#rdPools .dcard').length))===all);
    chk('the filter never hit the network', S.stateCalls < 6, S.stateCalls+' redraftState calls');
    await ctx.close();
  }

  /* ---- a division you have no room for ---- */
  {
    const S = mk({mk:2, jr:0});
    const {ctx,p} = await open(b, S);
    const st = await p.evaluate(()=>{
      const cards=[...document.querySelectorAll('#rdPools .dcard')];
      const jr = ['Dewanoryu','Kazuma','Tokihayate','Asakoryu'];
      return { juryoLive: cards.filter(c=>jr.includes(c.dataset.pick) && !c.disabled).length,
               makuLive:  cards.filter(c=>!jr.includes(c.dataset.pick) && !c.disabled).length,
               heads: [...document.querySelectorAll('#rdPools h5')].map(h=>h.textContent.replace(/\s+/g,' ')) };
    });
    chk('a full division is shown but not pickable', st.juryoLive===0, st.juryoLive+' juryo live');
    chk('the open division still is', st.makuLive===8, st.makuLive+' makuuchi live');
    chk('and the heading says why', st.heads.some(h=>/no open slot/.test(h)), JSON.stringify(st.heads));
    await ctx.close();
  }

  /* ---- someone else's turn ---- */
  {
    const S = mk(); S.onClock = 'bo';
    const {ctx,p} = await open(b, S);
    const st = await p.evaluate(()=>({
      live: [...document.querySelectorAll('#rdPools .dcard')].filter(c=>!c.disabled).length,
      info: document.querySelectorAll('#rdPools .dcard__info').length,
      turn: document.getElementById('rdTurn').innerText }));
    chk('you cannot pick on someone else’s turn', st.live===0, st.live+' live');
    chk('but the cards still read', st.info===12, st.info+' ⓘ');
    chk('and it says who you are waiting on', /Waiting on/.test(st.turn), st.turn.slice(0,40));
    await p.evaluate(()=>{ [...document.querySelectorAll('#rdPools .dcard')].forEach(c=>c.click()); });
    await p.waitForTimeout(700);
    chk('no picks leaked', S.made.length===0, S.made.length+' sent');
    const el = await p.$('#redraftBody'); if (el) await el.screenshot({path:'/tmp/redraft.png'});
    await ctx.close();
  }

  /* ---- the poll must not throw away your work ---- */
  {
    const S = mk();
    const {ctx,p} = await open(b, S);
    await p.evaluate(()=>{ const i=document.getElementById('rdFind'); i.value='ura'; i.dispatchEvent(new Event('input')); });
    await p.evaluate(()=>{ const g=document.querySelector('#rdPools .rd-pool'); if(g) g.scrollTop=40; });
    await p.evaluate(()=>{ window.__mark = document.querySelector('#rdPools .dcard'); });
    await p.waitForTimeout(9000);                    // two poll ticks
    const kept = await p.evaluate(()=>({
      filter: document.getElementById('rdFind').value,
      same: window.__mark === document.querySelector('#rdPools .dcard') }));
    chk('a poll leaves the filter alone', kept.filter==='ura', JSON.stringify(kept.filter));
    chk('and does not rebuild the pool under you', kept.same, 'rebuilt='+(!kept.same));
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close();
  if (bad) process.exit(1);
})();
