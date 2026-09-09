/* The two pages that can save a public team must both refuse to while a basho
   is on, and say why — the server refuses anyway, but a button that fails under
   your hands is worse than one that explains itself. */
const { chromium } = require('playwright');

function payload(results, lastDay){
  return { ok:true,
    users:[{handle:'sean',name:'Sean',team:{sanyaku:'Onosato',m1:'Kotoshoho',m5:'Ura',m9:'Roga',
      m13:'Asakoryu',any:'Kirishima',juryo:'Dewanoryu'}, updated:'2026-09-09T00:00:00Z',
      rank:{idx:3,label:'Sandanme',div:'sandanme'}}],
    results: results, meta:{basho:'Aki 2026', lastDay:lastDay}, champion:null };
}
const day = d => ({day:d, division:'makuuchi', east:'Onosato', west:'Hoshoryu', winner:'Onosato', kimarite:'yorikiri'});

async function load(b, page, results, lastDay){
  const ctx = await b.newContext({viewport:{width:1280,height:1100}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,120)));
  let saved = 0;
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const req=r.request(), url=req.url();
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (req.method()==='POST'){
      let bd={}; try{ bd=JSON.parse(req.postData()||'{}'); }catch(e){}
      if (bd.action==='save'){ saved++;
        return j(results.length ? {ok:false, locked:true, error:'The basho is under way — teams are locked until it ends.'}
                                : {ok:true, updated:true}); }
      return j({ok:true});
    }
    if (/action=leagues/.test(url)) return j({ok:true, leagues:[]});
    if (/action=accountSummary/.test(url)) return j({ok:true, titles:[], badges:[], history:[], allTime:{}, leagues:[]});
    if (/dm/i.test(url)) return j({ok:true, threads:[], unread:0, users:[]});
    return j(payload(results, lastDay));
  });
  await p.addInitScript(()=>{ try{ localStorage.setItem('fantasy.acct',
    JSON.stringify({handle:'sean',name:'Sean',auth:'h1'})); }catch(e){} });
  await p.goto('http://127.0.0.1:8902/'+page,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5000);
  return {ctx,p,errs,saves:()=>saved};
}

const T=[]; const chk=(n,ok,x)=>{ T.push(ok); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

(async ()=>{
  const b = await chromium.launch();

  /* ---- fantasy.html ---- */
  {   // mid-basho
    const {ctx,p} = await load(b,'fantasy.html',[day(1),day(2),day(3)],3);
    const st = await p.evaluate(()=>({
      disabled: document.getElementById('saveBtn').disabled,
      note: (()=>{ const n=document.getElementById('teamLock'); return n && !n.hidden ? n.innerText.replace(/\s+/g,' ') : ''; })(),
      slotCta: (document.querySelector('.pcard.locked .cta')||{}).textContent || '' }));
    chk('fantasy: save is disabled during the basho', st.disabled);
    chk('fantasy: and it says why', /under way/i.test(st.note), st.note.slice(0,70));
    chk('fantasy: empty slots read as locked for the basho', /locked for the basho/i.test(st.slotCta), st.slotCta);
    await ctx.close();
  }
  {   // finished but not yet reset
    const {ctx,p} = await load(b,'fantasy.html',[day(15)],15);
    const st = await p.evaluate(()=>({
      disabled: document.getElementById('saveBtn').disabled,
      note: (()=>{ const n=document.getElementById('teamLock'); return n && !n.hidden ? n.innerText.replace(/\s+/g,' ') : ''; })() }));
    chk('fantasy: still locked after day 15', st.disabled);
    chk('fantasy: and says it unlocks with the next basho', /next one opens/i.test(st.note), st.note.slice(0,70));
    await ctx.close();
  }
  {   // no results at all — the normal pre-basho state
    const {ctx,p} = await load(b,'fantasy.html',[],0);
    const st = await p.evaluate(()=>({
      note: (()=>{ const n=document.getElementById('teamLock'); return n && !n.hidden ? n.innerText.replace(/\s+/g,' ') : ''; })(),
      hasSlots: document.querySelectorAll('#slots .pcard').length }));
    chk('fantasy: no lock notice before the basho', st.note==='' || /banzuke/i.test(st.note), st.note.slice(0,60));
    chk('fantasy: the board still renders', st.hasSlots>0, st.hasSlots+' slots');
    await ctx.close();
  }

  /* ---- analysis.html ---- */
  {
    const {ctx,p,saves} = await load(b,'analysis.html',[day(1),day(2)],2);
    const st = await p.evaluate(()=>{
      const s=document.getElementById('ggSave'), n=document.getElementById('ggLockNote');
      return { found:!!s, disabled: s? s.disabled : null,
               note: n && !n.hidden ? n.textContent : '' };
    });
    chk('analysis: Save my team is disabled during the basho', st.found && st.disabled, JSON.stringify(st));
    chk('analysis: and it says why', /under way/i.test(st.note), st.note.slice(0,70));
    await p.evaluate(()=>{ const s=document.getElementById('ggSave'); if(s) s.click(); });
    await p.waitForTimeout(900);
    chk('analysis: clicking it sends nothing', saves()===0, saves()+' saves sent');
    await ctx.close();
  }
  {
    const {ctx,p} = await load(b,'analysis.html',[],0);
    const st = await p.evaluate(()=>{
      const s=document.getElementById('ggSave'), n=document.getElementById('ggLockNote');
      return { disabled: s? s.disabled : null, note: n && !n.hidden ? n.textContent : '' };
    });
    chk('analysis: no lock before the basho', st.note==='', st.note.slice(0,50));
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close();
  if (bad) process.exit(1);
})();
