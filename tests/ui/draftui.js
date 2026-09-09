/* The draft room through the real UI, against a fake backend that COUNTS how
   many makePick requests actually leave the browser. The user report was three
   things: misclicks while scrolling, a long delay before a pick registers, and
   several picks landing on one turn. All three are checked here. */
const { chromium } = require('playwright');

const MAK = ['Onosato','Hoshoryu','Kotozakura','Aonishiki','Kirishima','Wakatakakage',
             'Takayasu','Atamifuji','Kotoshoho','Gonoyama','Oshoma','Hiradoumi',
             'Ura','Abi','Tamawashi','Churanoumi','Shonannoumi','Onokatsu'];

function mkState(onClock){
  return { picks:[], made:[], onClock, stateCalls:0, stateDelayMs:0 };
}

function leaguePayload(){
  return { ok:true,
    league:{ id:'lg1', name:'Race', commissioner:'sean', inviteCode:'ABC', mode:'keepers',
      rosterSize:2, benchSize:0, farmSize:2, keepMk:null, keepJr:null,
      draftStatus:'active', scoring:{winPoint:1,sanyakuBonus:1,sansho:5,yusho:5},
      draftDate:'', draftAgreedCount:3, draftMemberCount:3,
      isCommissioner:true, iAgreedDraft:true, isMember:true },
    champion:null,
    members:[{handle:'sean',name:'Sean',team:{},teamUpdated:'',roster:{makuuchi:[],juryo:[],active:[]},
              boardSet:false,boardUpdated:'',draftBoard:null,agreedDraft:true},
             {handle:'bo',name:'Bo',team:{},teamUpdated:'',roster:{makuuchi:[],juryo:[],active:[]},
              boardSet:false,boardUpdated:'',draftBoard:null,agreedDraft:true}],
    messages:[] };
}

async function open(b, S, vp){
  const ctx = await b.newContext({viewport: vp || {width:1280,height:1100}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,130)));
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', async r=>{
    const req=r.request(), url=req.url();
    const j = o => r.fulfill({contentType:'application/json', body:JSON.stringify(o)});
    if (req.method()==='POST'){
      let bd={}; try{ bd=JSON.parse(req.postData()||'{}'); }catch(e){}
      if (bd.action==='makePick'){
        S.made.push(bd.rikishi);
        if (S.onClock !== 'sean') return j({ok:false, error:'It’s not your turn.'});
        S.picks.push({round:1, handle:'sean', rikishi:bd.rikishi});
        S.onClock = 'bo';
        return j({ok:true, nextTurn:{round:1, phase:'makuuchi', handle:'bo', cursor:1},
                  draftStatus:'active', deadline:''});
      }
      return j({ok:true});
    }
    if (/action=leagues/.test(url)) return j({ok:true, leagues:[{id:'lg1',name:'Race',
      commissioner:'sean',inviteCode:'ABC',members:2,mode:'keepers',draftStatus:'active',isCommissioner:true}]});
    if (/action=league/.test(url)) return j(leaguePayload());
    if (/action=draftState/.test(url)){
      S.stateCalls++;
      if (S.stateDelayMs) await new Promise(x=>setTimeout(x, S.stateDelayMs));
      return j({ ok:true, league:{draftStatus:'active'},
        turn:{round:1, phase:'makuuchi', handle:S.onClock, cursor:S.picks.length},
        picks:S.picks, pickedNames:S.picks.map(x=>x.rikishi),
        serverNow:new Date().toISOString(), deadline:'', onClockAuto:false });
    }
    if (/action=trades/.test(url)) return j({ok:true, trades:[]});
    if (/dm/i.test(url)) return j({ok:true, threads:[], unread:0, users:[]});
    return j({ok:true, users:[], results:[], meta:{basho:'Aki 2026', lastDay:0}, champion:null});
  });
  await p.addInitScript(()=>{ try{ localStorage.setItem('fantasy.acct',
    JSON.stringify({handle:'sean',name:'Sean',auth:'h1'})); }catch(e){} });

  await p.goto('http://127.0.0.1:8902/fantasy.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{ const b=[...document.querySelectorAll('button,a')]
    .find(x=>/my leagues/i.test(x.textContent||'')); if(b) b.click(); });
  await p.waitForTimeout(4000);
  await p.evaluate(()=>{ const r=document.querySelector('.lg-card,.lg-row,[data-league]'); if(r) r.click(); });
  await p.waitForTimeout(4000);
  return {ctx, p, errs};
}

const T=[]; const chk=(n,ok,x)=>{ T.push(ok); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

(async ()=>{
  const b = await chromium.launch();

  /* ---- on the clock: tapping selects, it does not draft ---- */
  {
    const S = mkState('sean');
    const {ctx,p,errs} = await open(b, S);
    const tiles = await p.evaluate(()=>document.querySelectorAll('#lgDraftGrid [data-pick]').length);
    chk('the grid renders on your turn', tiles > 5, tiles+' tiles');

    await p.click('#lgDraftGrid [data-pick]');
    await p.waitForTimeout(600);
    const afterTap = await p.evaluate(()=>{
      const bar=document.getElementById('lgDraftConfirm');
      return { sent:0, barShown: bar && !bar.hidden, barText: bar? bar.innerText.replace(/\s+/g,' ') : '',
               sel: document.querySelectorAll('#lgDraftGrid .sel').length };
    });
    chk('a tap sends nothing', S.made.length === 0, S.made.length+' picks sent');
    chk('a tap highlights the name', afterTap.sel === 1, afterTap.sel+' highlighted');
    chk('and raises a confirm bar naming him', afterTap.barShown && /Draft/.test(afterTap.barText), afterTap.barText.slice(0,50));

    /* the misclick case: seven fast taps while "scrolling" */
    await p.evaluate(()=>{ const t=[...document.querySelectorAll('#lgDraftGrid [data-pick]')].slice(0,7);
      t.forEach(x=>x.click()); });
    await p.waitForTimeout(800);
    chk('seven stray taps still send nothing', S.made.length === 0, S.made.length+' picks sent');
    const stillOne = await p.evaluate(()=>document.querySelectorAll('#lgDraftGrid .sel').length);
    chk('only the last tap stays selected', stillOne === 1, stillOne+' highlighted');

    /* tapping the same name again lets go of it */
    const selName = await p.evaluate(()=>document.querySelector('#lgDraftGrid .sel').dataset.pick);
    await p.evaluate(n=>[...document.querySelectorAll('#lgDraftGrid [data-pick]')]
      .find(x=>x.dataset.pick===n).click(), selName);
    await p.waitForTimeout(400);
    const cleared = await p.evaluate(()=>({sel:document.querySelectorAll('#lgDraftGrid .sel').length,
      hidden: document.getElementById('lgDraftConfirm').hidden}));
    chk('tapping the same name again deselects', cleared.sel===0 && cleared.hidden);
    await ctx.close();
  }

  /* ---- confirming: exactly one request, however hard you mash it ---- */
  {
    const S = mkState('sean'); S.stateDelayMs = 2500;   // make the follow-up poll slow on purpose
    const {ctx,p,errs} = await open(b, S);
    await p.click('#lgDraftGrid [data-pick]');
    await p.waitForTimeout(500);
    const name = await p.evaluate(()=>document.querySelector('#lgDraftGrid .sel').dataset.pick);

    await p.evaluate(()=>{ const g=document.getElementById('lgPickGo');
      g.click(); g.click(); g.click(); g.click(); });     // mash it
    await p.waitForTimeout(1200);
    chk('mashing confirm sends exactly one pick', S.made.length === 1, JSON.stringify(S.made));

    /* the delay complaint: the turn line must move before the slow poll returns */
    const turnNow = await p.evaluate(()=>document.getElementById('lgDraftTurn').innerText.replace(/\s+/g,' '));
    chk('the turn line updates without waiting for a poll', /bo is on the clock/i.test(turnNow), turnNow.slice(0,60));
    /* "locked" means a card can no longer be picked. The cards are <button>s,
       so that is the disabled ATTRIBUTE — whether it was set by commitPick or
       by the repaint that follows it, both of which fire here. */
    const gridNow = await p.evaluate(()=>({
      live: [...document.querySelectorAll('#lgDraftGrid [data-pick]')]
              .filter(x=>!x.disabled && !x.classList.contains('disabled')).length,
      total: document.querySelectorAll('#lgDraftGrid [data-pick]').length,
      bar: document.getElementById('lgDraftConfirm').hidden }));
    chk('the grid locks immediately after the pick', gridNow.live === 0, gridNow.live+' still live');
    chk('and the confirm bar goes away', gridNow.bar);

    /* it must stay at one even after the poll lands */
    await p.waitForTimeout(4000);
    chk('still one pick after the poll reconciles', S.made.length === 1, JSON.stringify(S.made));
    chk('the pick shows on the board', await p.evaluate(n=>document.getElementById('lgDraftBoard').innerText.includes(n), name));
    if (errs.length) console.log('   page errors: '+errs.slice(0,2).join(' | '));
    await ctx.close();
  }

  /* ---- somebody else's turn: the grid is inert ---- */
  {
    const S = mkState('bo');
    const {ctx,p} = await open(b, S);
    await p.evaluate(()=>{ const t=[...document.querySelectorAll('#lgDraftGrid [data-pick]')].slice(0,5);
      t.forEach(x=>x.click()); });
    await p.waitForTimeout(700);
    chk('you cannot pick on someone else’s turn', S.made.length === 0, S.made.length+' picks sent');
    const bar = await p.evaluate(()=>document.getElementById('lgDraftConfirm').hidden);
    chk('and no confirm bar appears', bar);
    await ctx.close();
  }

  /* ---- the grid must not be rebuilt under a scrolling finger ---- */
  {
    const S = mkState('bo');
    const {ctx,p} = await open(b, S, {width:390,height:844});   // narrow, so the grid really scrolls
    await p.evaluate(()=>{ const g=document.getElementById('lgDraftGrid');
      g.scrollTop = 120; window.__mark = g.firstElementChild; });
    const before = await p.evaluate(()=>document.getElementById('lgDraftGrid').scrollTop);
    await p.waitForTimeout(9000);          // two polls go by with the pool unchanged
    const after = await p.evaluate(()=>({ top: document.getElementById('lgDraftGrid').scrollTop,
      same: window.__mark === document.getElementById('lgDraftGrid').firstElementChild }));
    chk('an unchanged pool leaves the grid alone', after.same, 'rebuilt='+(!after.same));
    chk('the grid actually scrolls in this layout', before > 0, 'scrollTop='+before);
    chk('and keeps your scroll position', after.top === before, before+' -> '+after.top);
    await ctx.close();
  }

  const bad = T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close();
  if (bad) process.exit(1);
})();
