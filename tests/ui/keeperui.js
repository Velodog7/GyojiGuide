/* The keeper roll-over through the actual UI: the commissioner sets limits,
   opens declarations, a member ticks his keepers, the commissioner closes. */
const { chromium } = require('playwright');

const MK = ['Hoshoryu','Onosato','Kirishima','Kotozakura'];
const JR = ['Dewanoryu','Tokihayate','Kazuma'];

function state(){
  return {
    keepMk: null, keepJr: null, draftStatus: 'complete',
    declared: null, closed: false, posted: []
  };
}

function leaguePayload(S){
  return { ok:true,
    league:{ id:'lg1', name:'Stable Wars', commissioner:'sean', inviteCode:'ABC', mode:'keepers',
      rosterSize:3, benchSize:1, farmSize:3, keepMk:S.keepMk, keepJr:S.keepJr,
      draftStatus:S.draftStatus, scoring:{winPoint:1,sanyakuBonus:1,sansho:5,yusho:5},
      draftDate:'', draftAgreedCount:1, draftMemberCount:1,
      isCommissioner:true, iAgreedDraft:true, isMember:true },
    champion:null,
    members:[{ handle:'sean', name:'Sean', team:{}, teamUpdated:'',
      roster:{ makuuchi:MK, juryo:JR, active:MK.slice(0,3) },
      boardSet:true, boardUpdated:'', draftBoard:null, agreedDraft:true }],
    messages:[] };
}

(async ()=>{
  const b = await chromium.launch();
  const p = await b.newPage({viewport:{width:1280,height:1200}});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,150)));
  const S = state();

  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const req = r.request();
    const j = o => r.fulfill({contentType:'application/json', body:JSON.stringify(o)});
    const url = req.url();
    if (req.method()==='POST'){
      let bd={}; try{ bd=JSON.parse(req.postData()||'{}'); }catch(e){}
      S.posted.push(bd.action);
      if (bd.action==='setLeagueKeepers'){
        S.keepMk = bd.keepMk === '' ? null : bd.keepMk;
        S.keepJr = bd.keepJr === '' ? null : bd.keepJr;
        return j({ok:true, keepMk:S.keepMk, keepJr:S.keepJr, rosterMk:4, rosterJr:3});
      }
      if (bd.action==='openKeeperWindow'){ S.draftStatus='keepers'; return j({ok:true, keepMk:S.keepMk, keepJr:S.keepJr}); }
      if (bd.action==='declareKeepers'){ S.declared = bd.keep; return j({ok:true}); }
      if (bd.action==='closeKeeperWindow'){ S.closed=true; S.draftStatus='redraft'; return j({ok:true, released:[], autoKept:[]}); }
      if (bd.action==='redraftState') return j({ok:true, redraft:true, rosterSize:3, benchSize:1, farmSize:3,
        order:['sean'], turn:{phase:'redraft', handle:'sean', cursor:0, open:{mk:2,jr:2}}, pool:[{name:'Ura',division:'makuuchi'}]});
      return j({ok:true});
    }
    if (/action=leagues/.test(url)) return j({ok:true, leagues:[{id:'lg1',name:'Stable Wars',commissioner:'sean',
      inviteCode:'ABC',members:1,mode:'keepers',draftStatus:S.draftStatus,isCommissioner:true}]});
    if (/action=league&|action=league$/.test(url)) return j(leaguePayload(S));
    if (/action=keeperState/.test(url)){
      if (S.draftStatus!=='keepers') return j({ok:true, open:false, draftStatus:S.draftStatus, keepMk:S.keepMk, keepJr:S.keepJr});
      return j({ ok:true, open:true, keepMk:S.keepMk, keepJr:S.keepJr,
        members:[{handle:'sean', declared: !!S.declared}],
        waiting: S.declared ? 0 : 1,
        mine:{ makuuchi: MK.map((n,i)=>({name:n, wins:12-i*3})),
               juryo:    JR.map((n,i)=>({name:n, wins:9-i*3})),
               declared: S.declared } });
    }
    if (/action=trades/.test(url)) return j({ok:true, trades:[]});
    if (/dm/i.test(url)) return j({ok:true, threads:[], unread:0, users:[]});
    return j({ok:true, users:[], results:[], meta:{basho:'Aki 2026', lastDay:15}, champion:null});
  });
  await p.addInitScript(()=>{ try{ localStorage.setItem('fantasy.acct', JSON.stringify({handle:'sean',name:'Sean',auth:'h1'})); }catch(e){} });

  const T=[]; const chk=(n,ok,x)=>{ T.push([n,ok,x]); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

  await p.goto('http://127.0.0.1:8902/fantasy.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{ const b=[...document.querySelectorAll('button,a')].find(x=>/my leagues/i.test(x.textContent||'')); if(b) b.click(); });
  await p.waitForTimeout(4000);
  await p.evaluate(()=>{ const r=document.querySelector('.lg-card,.lg-row,[data-league]'); if(r) r.click(); });
  await p.waitForTimeout(3500);

  // --- the setting ---
  let v = await p.evaluate(()=>{
    const box=document.getElementById('lgKeepSet');
    return { shown: box && !box.hidden, text: box? box.innerText.replace(/\s+/g,' ').slice(0,90):'' };
  });
  chk('keeper panel appears for a keeper league', !!v.shown, v.text);
  chk('defaults to "no limit"', /no limit/i.test(v.text), v.text);

  await p.evaluate(()=>{ const b=document.getElementById('lgKeepEdit'); if(b) b.click(); });
  await p.waitForTimeout(600);
  const hasInputs = await p.evaluate(()=>!!document.getElementById('kp_mk') && !!document.getElementById('kp_jr'));
  chk('editable even though the draft is complete', hasInputs);

  await p.evaluate(()=>{ document.getElementById('kp_mk').value='2'; document.getElementById('kp_mk').dispatchEvent(new Event('input'));
                         document.getElementById('kp_jr').value='1'; document.getElementById('kp_jr').dispatchEvent(new Event('input')); });
  await p.waitForTimeout(300);
  const prev = await p.evaluate(()=>document.getElementById('kpPreview').innerText);
  chk('preview counts what gets released', /releases 4 wrestlers/i.test(prev), prev);

  await p.evaluate(()=>document.getElementById('kpSave').click());
  await p.waitForTimeout(1500);
  chk('limits saved to the backend', S.keepMk===2 && S.keepJr===1, JSON.stringify({mk:S.keepMk,jr:S.keepJr}));

  // --- open declarations ---
  const openBtn = await p.evaluate(()=>{
    const b=document.getElementById('lgOpenKeepers');
    return b ? {found:true, label:b.textContent} : {found:false,
      redraftInstead: !!document.getElementById('lgOpenRedraft')};
  });
  chk('commissioner is offered keeper declarations, not the bare re-draft',
      openBtn.found, JSON.stringify(openBtn));

  p.on('dialog', d=>d.accept());
  await p.evaluate(()=>document.getElementById('lgOpenKeepers').click());
  await p.waitForTimeout(3000);

  // --- the declaration screen ---
  v = await p.evaluate(()=>{
    const body=document.getElementById('keepBody');
    if(!body) return {missing:true};
    return { boxes: body.querySelectorAll('.kw-cb').length,
      mkCount: (document.getElementById('kwCount_makuuchi')||{}).textContent,
      jrCount: (document.getElementById('kwCount_juryo')||{}).textContent,
      wins: /12 wins/.test(body.innerText),
      waiting: /1 of 1 still to decide/.test(body.innerText),
      hasClose: !!document.getElementById('kwClose') };
  });
  chk('declaration screen lists the whole roster', v.boxes===7, 'checkboxes='+v.boxes);
  chk('shows each wrestler’s wins from the basho', !!v.wins);
  chk('counters start at 0 of the limit', v.mkCount==='0/2 kept' && v.jrCount==='0/1 kept', v.mkCount+' | '+v.jrCount);
  chk('names who still has to decide', !!v.waiting);
  chk('commissioner gets the close button', !!v.hasClose);

  // over-tick, expect a refusal
  await p.evaluate(()=>{ [...document.querySelectorAll('.kw-cb[data-div="makuuchi"]')].slice(0,3).forEach(c=>{c.checked=true;c.dispatchEvent(new Event('change'));}); });
  await p.waitForTimeout(300);
  const over = await p.evaluate(()=>(document.getElementById('kwCount_makuuchi')||{}).className);
  chk('counter warns when you go over the limit', /closed/.test(over||''), over);
  await p.evaluate(()=>document.getElementById('kwSave').click());
  await p.waitForTimeout(900);
  let st = await p.evaluate(()=>document.getElementById('kwStatus').textContent);
  chk('saving too many is refused client-side', /at most 2/i.test(st), st.trim());
  chk('and nothing was sent', !S.declared);

  // tick a legal set
  await p.evaluate(()=>{
    [...document.querySelectorAll('.kw-cb')].forEach(c=>{c.checked=false;});
    const mk=[...document.querySelectorAll('.kw-cb[data-div="makuuchi"]')].slice(0,2);
    const jr=[...document.querySelectorAll('.kw-cb[data-div="juryo"]')].slice(0,1);
    mk.concat(jr).forEach(c=>{c.checked=true;c.dispatchEvent(new Event('change'));});
  });
  await p.evaluate(()=>document.getElementById('kwSave').click());
  await p.waitForTimeout(1800);
  chk('a legal declaration is sent', Array.isArray(S.declared) && S.declared.length===3, JSON.stringify(S.declared));

  // --- close ---
  await p.evaluate(()=>{ const b=document.getElementById('kwClose'); if(b) b.click(); });
  await p.waitForTimeout(3000);
  chk('closing hands over to the re-draft', S.closed && S.draftStatus==='redraft');
  const nowShows = await p.evaluate(()=>{
    const t=document.body.innerText; return /re-draft/i.test(t); });
  chk('and the re-draft screen takes over', nowShows);

  if (errs.length) console.log('\nPAGE ERRORS: '+errs.slice(0,3).join(' | '));
  const bad = T.filter(x=>!x[1]).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close();
  if (bad || errs.length) process.exit(1);
})();
