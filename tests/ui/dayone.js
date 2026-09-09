/* Day 1 of Aki, hour by hour.

   The bug this pins down: the calendar says a basho has begun at 00:00 JST,
   but Meta.lastDay stays 0 until the hourly importer lands that day's bouts
   ~19 hours later. In that window nextBasho() has already advanced to Kyushu,
   so fantasy.html counted down to Fukuoka in November and told everyone the
   draft was locked pending a banzuke — on the opening day of Aki.

   The clock is faked with a Date override installed before any page script
   runs, so the real schedule table in gg-basho.js is exercised, not a stub. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{ T.push(ok); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

const AKI_OPENS = Date.parse('2026-09-13T00:00:00+09:00');
const H = 3600000;

/* started=false models "results have not imported yet" */
function payload(started, lastDay){
  return { ok:true,
    /* A team that is actually LEGAL for the brackets — the page validates each
       pick against its rank tier and silently drops the ones that don't fit,
       which would leave Save disabled at 0/7 and the refusal path untested. */
    users:[{handle:'sean', name:'Sean', team:{sanyaku:'Hoshoryu', m1:'Fujinokawa',
            m5:'Ura', m9:'Fujiryoga', m13:'Nishikifuji', any:'Onosato',
            juryo:'Asasuiryu'}, updated:'', avatar:'', rank:null}],
    results: started ? [{day:1,division:'Makuuchi',east:'A',west:'B',winner:'A',kimarite:'yorikiri'}] : [],
    meta:{ basho:'Aki 2026', lastDay: started ? lastDay : 0 }, champion:null };
}

async function open(b, page, atMs, started, lastDay, opts){
  opts = opts || {};
  const ctx = await b.newContext({viewport:{width:1200,height:1000}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  const posts=[];
  await p.addInitScript(t => {
    const RealDate = Date; let off = t - RealDate.now();
    class D extends RealDate {
      constructor(...a){ if(!a.length) super(RealDate.now()+off); else super(...a); }
      static now(){ return RealDate.now()+off; }
    }
    D.parse = RealDate.parse; D.UTC = RealDate.UTC;
    window.Date = D;
    try{ localStorage.setItem('fantasy.acct',
      JSON.stringify({handle:'sean',name:'Sean',auth:'h1'})); }catch(e){}
  }, atMs);
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const req=r.request();
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (req.method()==='POST'){
      let bd={}; try{ bd=JSON.parse(req.postData()||'{}'); }catch(e){}
      posts.push(bd.action);
      if (bd.action==='save'){
        if (opts.refuseSave)
          return j({ok:false, locked:true,
                    error:'The basho is under way — teams are locked until it ends.'});
        return j({ok:true});
      }
      return j({ok:true});
    }
    if (/action=leagues/.test(req.url())) return j({ok:true, leagues:[]});
    if (/dm/i.test(req.url())) return j({ok:true, threads:[], unread:0, users:[]});
    return j(opts.late ? payload(true,1) : payload(started,lastDay));
  });
  await p.goto('http://127.0.0.1:8902/'+page, {waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4000);
  return {ctx,p,errs,posts};
}

(async ()=>{
  const b = await chromium.launch();

  /* ---------- fantasy.html across the boundary ---------- */
  const cases = [
    ['the evening before',      AKI_OPENS - 4*H,  false, 0, false],
    ['half an hour in',         AKI_OPENS + 0.5*H, false, 0, true],
    ['ten hours in, still no results', AKI_OPENS + 10*H, false, 0, true],
    ['after the day-1 import',  AKI_OPENS + 19*H, true,  1, true],
  ];
  for (const [label, at, started, lastDay, wantLocked] of cases){
    const {ctx,p,errs} = await open(b, 'fantasy.html', at, started, lastDay);
    const st = await p.evaluate(()=>({
      cd:   !document.getElementById('countdown').hidden,
      name: (document.getElementById('cdBasho')||{}).textContent||'',
      sub:  (document.getElementById('cdSub')||{}).textContent||'',
      lock: (document.getElementById('teamLock')||{}).innerText||'',
      lockShown: !(document.getElementById('teamLock')||{}).hidden,
      save: (document.getElementById('saveBtn')||{}).disabled }));
    if (wantLocked){
      chk(label+': locked as running', /under way/i.test(st.lock), st.lock.slice(0,70));
      chk(label+': no countdown to the wrong basho',
          !st.cd && !/Kyushu|Fukuoka/i.test(st.name+st.sub), 'cd='+st.cd+' '+st.name);
    } else {
      chk(label+': counting down to Aki', st.cd && /Aki/.test(st.name), st.name);
      chk(label+': warns that day 1 is the deadline',
          /lock/i.test(st.sub), st.sub.slice(0,90));
    }
    chk(label+': no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* ---------- analysis.html: the stale tab ---------- */
  {
    /* Opened before the basho (Save live), then the server starts refusing. */
    const {ctx,p,posts} = await open(b, 'analysis.html', AKI_OPENS - 4*H, false, 0,
                                     {refuseSave:true});
    await p.evaluate(()=>{ const t=document.getElementById('tab-draft'); if(t)t.click(); });
    await p.waitForTimeout(1200);
    const before = await p.evaluate(()=>({
      disabled: (document.getElementById('ggSave')||{}).disabled,
      picks: (document.getElementById('drN')||{}).textContent,
      note: (document.getElementById('ggLockNote')||{}).hidden }));
    chk('the saved team restored, so Save is actually reachable',
        before.picks==='7/7' && before.disabled===false, JSON.stringify(before));
    chk('a tab opened pre-basho is not locked', before.note !== false, JSON.stringify(before));

    /* the seven picks are restored from the account, so Save is reachable */
    await p.evaluate(()=>{ const s=document.getElementById('ggSave'); if(s&&!s.disabled) s.click(); });
    await p.waitForTimeout(2500);
    const after = await p.evaluate(()=>({
      msg: (document.getElementById('ggMsg')||{}).textContent||'',
      disabled: (document.getElementById('ggSave')||{}).disabled,
      note: (document.getElementById('ggLockNote')||{}).textContent||'' }));
    chk('a refused save shows the server’s reason, not "Couldn’t save"',
        /under way|locked/i.test(after.msg), JSON.stringify(after.msg));
    chk('and the button locks itself without a reload', after.disabled===true,
        'disabled='+after.disabled);
    /* The refetch here still returns the PRE-basho payload, i.e. a server whose
       read disagrees with its own refusal. The refusal must still win, or the
       button flips back to enabled and invites the same rejection again. */
    await p.waitForTimeout(1500);
    const settled = await p.evaluate(()=>
      (document.getElementById('ggSave')||{}).disabled);
    chk('a disagreeing re-read cannot unlock it again', settled===true,
        'disabled='+settled);
    chk('only one save was attempted', posts.filter(a=>a==='save').length<=1,
        JSON.stringify(posts));
    await ctx.close();
  }

  /* ---------- analysis.html: a fresh load during the blind window ---------- */
  {
    const {ctx,p,errs} = await open(b, 'analysis.html', AKI_OPENS + 6*H, false, 0);
    await p.evaluate(()=>{ const t=document.getElementById('tab-draft'); if(t)t.click(); });
    await p.waitForTimeout(1500);
    const st = await p.evaluate(()=>({
      disabled: (document.getElementById('ggSave')||{}).disabled,
      note: (document.getElementById('ggLockNote')||{}).textContent||'',
      hidden: (document.getElementById('ggLockNote')||{}).hidden }));
    chk('day 1 with no results yet still locks the save', st.disabled===true, JSON.stringify(st));
    chk('and says why', !st.hidden && /under way/i.test(st.note), st.note.slice(0,70));
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* ---------- and it must NOT lock early ---------- */
  {
    const {ctx,p} = await open(b, 'analysis.html', AKI_OPENS - 26*H, false, 0);
    await p.evaluate(()=>{ const t=document.getElementById('tab-draft'); if(t)t.click(); });
    await p.waitForTimeout(1500);
    const st = await p.evaluate(()=>({
      note: (document.getElementById('ggLockNote')||{}).hidden }));
    chk('the day before, nothing is locked', st.note !== false, JSON.stringify(st));
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close();
  if (bad) process.exit(1);
})();
