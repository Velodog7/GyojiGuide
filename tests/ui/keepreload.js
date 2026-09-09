/* The regression Sean hit: a keeper limit that IS saved on the server must show
   up on a cold load of the league — and a league with no limit must still say
   "no limit". Also: 0 is a real answer and must not read as blank. */
const { chromium } = require('playwright');

function payload(keepMk, keepJr){
  return { ok:true,
    league:{ id:'lg1', name:'Chanko Boogie', commissioner:'sean', inviteCode:'ABC', mode:'keepers',
      rosterSize:8, benchSize:2, farmSize:4, keepMk:keepMk, keepJr:keepJr,
      draftStatus:'none', scoring:{winPoint:1,sanyakuBonus:1,sansho:5,yusho:5},
      draftDate:'', draftAgreedCount:0, draftMemberCount:1,
      isCommissioner:true, iAgreedDraft:false, isMember:true },
    champion:null,
    members:[{ handle:'sean', name:'Sean', team:{}, teamUpdated:'',
      roster:{ makuuchi:[], juryo:[], active:[] },
      boardSet:false, boardUpdated:'', draftBoard:null, agreedDraft:false }],
    messages:[] };
}

async function load(b, keepMk, keepJr){
  const ctx = await b.newContext({viewport:{width:1280,height:1100}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,120)));
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const req=r.request(), url=req.url();
    const j = o => r.fulfill({contentType:'application/json', body:JSON.stringify(o)});
    if (req.method()==='POST') return j({ok:true});
    if (/action=leagues/.test(url)) return j({ok:true, leagues:[{id:'lg1',name:'Chanko Boogie',
      commissioner:'sean',inviteCode:'ABC',members:1,mode:'keepers',draftStatus:'none',isCommissioner:true}]});
    if (/action=league/.test(url)) return j(payload(keepMk, keepJr));
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
  await p.waitForTimeout(3500);

  const out = await p.evaluate(()=>{
    const box=document.getElementById('lgKeepSet');
    return { text: box && !box.hidden ? box.innerText.replace(/\s+/g,' ') : '(panel hidden)' };
  });
  // open the editor and read what the inputs are pre-filled with
  await p.evaluate(()=>{ const b=document.getElementById('lgKeepEdit'); if(b) b.click(); });
  await p.waitForTimeout(700);
  out.inputs = await p.evaluate(()=>{
    const mk=document.getElementById('kp_mk'), jr=document.getElementById('kp_jr');
    return mk&&jr ? {mk:mk.value, jr:jr.value} : null;
  });
  out.errs = errs;
  await ctx.close();
  return out;
}

(async ()=>{
  const b = await chromium.launch();
  const T=[]; const chk=(n,ok,x)=>{ T.push(ok); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

  let r = await load(b, 5, 4);
  chk('a saved limit survives a cold load', /5 Makuuchi/.test(r.text) && /4 J/.test(r.text), r.text.slice(0,80));
  chk('and the edit form is pre-filled with it', r.inputs && r.inputs.mk==='5' && r.inputs.jr==='4', JSON.stringify(r.inputs));

  r = await load(b, null, null);
  chk('no limit still reads as no limit', /no limit/i.test(r.text), r.text.slice(0,60));
  chk('and the edit form is left blank', r.inputs && r.inputs.mk==='' && r.inputs.jr==='', JSON.stringify(r.inputs));

  r = await load(b, 0, 0);
  chk('0 is kept as a real answer, not blank', !/no limit/i.test(r.text), r.text.slice(0,70));
  chk('and 0 pre-fills as 0', r.inputs && r.inputs.mk==='0' && r.inputs.jr==='0', JSON.stringify(r.inputs));

  r = await load(b, 3, null);
  chk('one division limited, the other not', /3 Makuuchi/.test(r.text) && /all/i.test(r.text), r.text.slice(0,80));

  const bad = T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close();
  if (bad) process.exit(1);
})();
