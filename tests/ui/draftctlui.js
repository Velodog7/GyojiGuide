/* Commissioner draft controls in the REAL draft room (fantasy.html), not the
   mock. Sean ran the Chanko Boogie draft on 10 Sept and wrote in the chat
   "i dont see my draft controls to pause things" — pause, resume and undo had
   only ever existed in keepers-mock-draft.html. This pins down that they are
   there for the commissioner, absent for everyone else, and that a pause
   actually stops the page offering a pick. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{ T.push(ok); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

const PICKS = [
  {pickIndex:0,round:1,phase:'makuuchi',handle:'bo',rikishi:'Onosato'},
  {pickIndex:1,round:1,phase:'makuuchi',handle:'cy',rikishi:'Hoshoryu'},
  {pickIndex:2,round:1,phase:'makuuchi',handle:'sean',rikishi:'Kirishima'},
  {pickIndex:3,round:2,phase:'makuuchi',handle:'sean',rikishi:'Daieisho'},
  {pickIndex:3,round:2,phase:'makuuchi',handle:'sean',rikishi:'Gonoyama'},   // a logged double-pick
  {pickIndex:4,round:2,phase:'makuuchi',handle:'cy',rikishi:'Ura'},
];
function mk(){ return { picks:PICKS.slice(), posts:[], paused:false, onClock:'sean' }; }

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

async function open(b, S, me, vw){
  const ctx = await b.newContext({viewport:vw||{width:1200,height:1400}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  p.on('dialog', d=>{ S.dialogs=(S.dialogs||[]).concat(d.message()); d.accept(); });
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const req=r.request(), url=req.url();
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (req.method()==='POST'){
      let bd={}; try{ bd=JSON.parse(req.postData()||'{}'); }catch(e){}
      if (/Draft$/.test(bd.action||'')) S.posts.push(bd);
      if (bd.action==='pauseDraft'){ S.paused=true; return j({ok:true,paused:true,left:95}); }
      if (bd.action==='resumeDraft'){ S.paused=false; return j({ok:true,paused:false,deadline:new Date(Date.now()+95000).toISOString()}); }
      if (bd.action==='rewindDraft'){
        const to = bd.toPick===''||bd.toPick==null ? Math.max(...S.picks.map(x=>x.pickIndex)) : +bd.toPick;
        const n = S.picks.filter(x=>x.pickIndex>=to).length;
        S.picks = S.picks.filter(x=>x.pickIndex<to); S.paused=true;
        return j({ok:true,removed:n,toPick:to,paused:true,draftStatus:'active',turn:{round:1,phase:'makuuchi',handle:'sean'}});
      }
      if (bd.action==='makePick'){ S.made=(S.made||[]).concat(bd.rikishi); return j({ok:false,error:'The commissioner has paused the draft.'}); }
      return j({ok:true});
    }
    if (/action=leagues/.test(url)) return j({ok:true, leagues:[{id:'lg1',name:'Race',commissioner:'sean',
      inviteCode:'ABC',members:3,mode:'keepers',draftStatus:'active',isCommissioner:me==='sean'}]});
    if (/action=league/.test(url)) return j(leaguePayload(me));
    if (/action=draftState/.test(url)){
      return j({ ok:true, league:{draftStatus:'active', draftOrder:['bo','cy','sean'], commissioner:'sean'},
        turn:{round:2,phase:'makuuchi',handle:S.onClock,pickIdx:5},
        picks:S.picks, pickedNames:S.picks.map(x=>x.rikishi),
        members:[{handle:'sean',name:'SEAN'},{handle:'bo',name:'BO'},{handle:'cy',name:'CY'}],
        presence:{}, chat:[], paused:S.paused, pausedLeft:S.paused?95:0,
        serverNow:new Date().toISOString(),
        deadline:S.paused?'':new Date(Date.now()+100000).toISOString(), clockSeconds:120, onClockAuto:false });
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
const poll = p => p.evaluate(()=>pollDraft({id:'lg1', commissioner:'sean'}));
const room = p => p.evaluate(()=>{
  const g=id=>document.getElementById(id);
  const cards=[...document.querySelectorAll('#lgDraftGrid .dcard')];
  return { cmsh: !!g('lgCmsh'), pauseTxt: g('lgCmPause') ? g('lgCmPause').textContent : '',
    banner: g('lgPaused') && !g('lgPaused').hidden ? g('lgPaused').innerText : '',
    tick: g('lgTick') ? g('lgTick').textContent : '', turn: g('lgDraftTurn') ? g('lgDraftTurn').innerText : '',
    cards: cards.length, live: cards.filter(c=>!c.disabled).length,
    opts: g('lgCmRewindSel') ? [...g('lgCmRewindSel').options].map(o=>o.value+'|'+o.textContent) : [],
    groups: g('lgCmRewindSel') ? [...g('lgCmRewindSel').querySelectorAll('optgroup')].map(o=>o.label) : [],
    sel: g('lgCmRewindSel') ? g('lgCmRewindSel').value : null,
    status: g('lgCmStatus') ? g('lgCmStatus').textContent : '',
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
});

(async ()=>{
  const b = await chromium.launch();

  /* ---- the commissioner ---- */
  {
    const S = mk();
    const {ctx,p,errs} = await open(b, S, 'sean');
    let r = await room(p);
    chk('the commissioner sees the controls in the live room', r.cmsh);
    chk('running: the button offers Pause', /pause/i.test(r.pauseTxt), r.pauseTxt);
    chk('running: no paused banner', !r.banner);
    chk('running: on the clock, the pool is pickable', r.cards>0 && r.live===r.cards, r.live+'/'+r.cards);
    chk('the rewind list has one entry per pick number, newest first',
      r.opts.length===1+5 && r.opts[1].startsWith('4|') && r.opts[5].startsWith('0|'), JSON.stringify(r.opts.slice(0,3)));
    chk('grouped by round', JSON.stringify(r.groups)==='["Round 2","Round 1"]', JSON.stringify(r.groups));
    chk('a logged double-pick shows every name on that pick',
      r.opts.some(o=>/^3\|/.test(o) && /Daieisho \+ Gonoyama/.test(o) && /×2/.test(o)), r.opts.find(o=>/^3\|/.test(o))||'');

    /* selection survives a poll */
    await p.selectOption('#lgCmRewindSel','1');
    await poll(p); await p.waitForTimeout(300);
    r = await room(p);
    chk('the chosen pick survives the next poll', r.sel==='1', r.sel);

    /* pause */
    await p.click('#lgCmPause'); await p.waitForTimeout(800);
    r = await room(p);
    chk('Pause sends pauseDraft', S.posts.some(x=>x.action==='pauseDraft' && x.id==='lg1' && x.auth==='h1'), JSON.stringify(S.posts));
    chk('paused: the button now offers Resume', /resume/i.test(r.pauseTxt), r.pauseTxt);
    chk('paused: everyone sees the banner', /paused/i.test(r.banner), r.banner);
    chk('paused: the clock shows the frozen time', /1:35/.test(r.tick), r.tick);
    chk('paused: the member up next cannot pick', r.cards>0 && r.live===0, r.live+'/'+r.cards);
    chk('paused: the turn line says so', /paused/i.test(r.turn), r.turn);
    chk('and the commissioner is told what happened', /paused/i.test(r.status), r.status);

    /* resume */
    await p.click('#lgCmPause'); await p.waitForTimeout(800);
    r = await room(p);
    chk('Resume sends resumeDraft', S.posts.some(x=>x.action==='resumeDraft'));
    chk('resumed: pickable again, banner gone', r.live===r.cards && r.cards>0 && !r.banner, r.live+'/'+r.cards);

    /* undo */
    S.dialogs=[];
    await p.click('#lgCmUndo'); await p.waitForTimeout(900);
    const u = S.posts.filter(x=>x.action==='rewindDraft').pop();
    chk('Undo asks first', S.dialogs.length===1 && /undo/i.test(S.dialogs[0]), S.dialogs[0]);
    chk('Undo sends rewindDraft with no pick number', u && u.toPick==='', JSON.stringify(u));
    r = await room(p);
    chk('after an undo the list drops that pick', !r.opts.some(o=>o.startsWith('4|')), JSON.stringify(r.opts));

    /* rewind to a round */
    await p.selectOption('#lgCmRewindSel','2');
    S.dialogs=[];
    await p.click('#lgCmRewind'); await p.waitForTimeout(900);
    const w = S.posts.filter(x=>x.action==='rewindDraft').pop();
    chk('Rewind confirms, naming the pick', S.dialogs.length===1 && /pick 3/i.test(S.dialogs[0]), S.dialogs[0]);
    chk('Rewind sends the chosen pick number', w && w.toPick===2, JSON.stringify(w));
    r = await room(p);
    chk('the result is reported', /rewound to pick 3/i.test(r.status), r.status);
    chk('and the draft comes back paused', /paused/i.test(r.banner));

    /* rewind with nothing chosen */
    const before = S.posts.length;
    await p.evaluate(()=>{ document.getElementById('lgCmRewindSel').value=''; });
    await p.click('#lgCmRewind'); await p.waitForTimeout(400);
    chk('Rewind with nothing chosen sends nothing', S.posts.length===before);
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* ---- a member ---- */
  {
    const S = mk(); S.paused = true;
    const {ctx,p,errs} = await open(b, S, 'bo');
    S.onClock = 'bo'; await poll(p); await p.waitForTimeout(400);
    const r = await room(p);
    chk('a member does not get the controls', !r.cmsh);
    chk('but does see the paused banner', /paused/i.test(r.banner), r.banner);
    chk('and cannot pick while paused, even on the clock', r.cards>0 && r.live===0, r.live+'/'+r.cards);
    chk('no page errors (member)', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* ---- phone width ---- */
  {
    const S = mk();
    const {ctx,p,errs} = await open(b, S, 'sean', {width:390,height:900});
    const r = await room(p);
    chk('on a phone the controls are there and nothing overflows', r.cmsh && !r.overflow);
    await p.locator('#lgCmsh').screenshot({path: __dirname + '/draft-controls-mobile.png'}).catch(()=>{});
    chk('no page errors (phone)', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  await b.close();
  const f=T.filter(x=>!x).length;
  console.log('\n'+(T.length-f)+' passed, '+f+' failed');
  process.exit(f?1:0);
})();
