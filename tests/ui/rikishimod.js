/* gg-dossier.js is now the single source of the dossier. analysis.html must
   behave exactly as it did with the rows inlined, and fantasy.html must be able
   to read the same rows. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{ T.push(ok); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

async function page(b, url){
  const ctx = await b.newContext({viewport:{width:1280,height:1000}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (r.request().method()==='POST') return j({ok:true});
    const u=r.request().url();
    if (/action=leagues/.test(u)) return j({ok:true, leagues:[]});
    if (/dm/i.test(u)) return j({ok:true, threads:[], unread:0, users:[]});
    return j({ok:true, users:[], results:[], meta:{basho:'Aki 2026',lastDay:0}, champion:null});
  });
  await p.goto('http://127.0.0.1:8902/'+url,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4500);
  return {ctx,p,errs};
}

(async ()=>{
  const b = await chromium.launch();

  /* --- analysis.html: the rows arrive from the module, everything still works --- */
  {
    const {ctx,p,errs} = await page(b,'analysis.html');
    const r = await p.evaluate(()=>({
      rows: (typeof R!=='undefined' && R.length) || 0,
      xIsNull: (typeof X!=='undefined') && X===null,
      idsAssigned: typeof R!=='undefined' && R.every((x,i)=>x.id===i),
      ns: !!(window.GyojiGuide && GyojiGuide.RIKISHI && GyojiGuide.RIKISHI.length),
      lookup: (window.GyojiGuide && GyojiGuide.rikishi) ? (GyojiGuide.rikishi('Ura')||{}).stable : null,
      cards: document.querySelectorAll('.card, .r-card, [data-id]').length,
      brackets: (typeof BRACKETS!=='undefined' && BRACKETS.length) || 0
    }));
    chk('the module supplies R to analysis.html', r.rows>50, r.rows+' rows');
    chk('X is still the unknown-value sentinel', r.xIsNull);
    chk('ids are assigned once, in the module', r.idsAssigned);
    chk('and it publishes GyojiGuide.RIKISHI', r.ns);
    chk('with a name lookup', r.lookup==='Kise', String(r.lookup));
    chk('the browse grid still renders', r.cards>10, r.cards+' elements');
    chk('the draft brackets still exist', r.brackets===7, r.brackets+'/7');
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* --- compare still works, since it reads the same rows --- */
  {
    const {ctx,p,errs} = await page(b,'analysis.html');
    const out = await p.evaluate(()=>{
      compare.add(0); compare.add(1);
      setView('compare');
      const t = document.getElementById('cmpBody').innerText;
      /* assert on the VALUES, not the row labels: the label column's text does
         not surface in innerText, and never did — checked against the
         pre-extraction file, which behaves identically. */
      return { cols: document.querySelectorAll('.cmp-col').length,
               cells: document.querySelectorAll('.cmp-cell').length,
               hasStable: /Nishonoseki|Tatsunami/.test(t),
               hasElo: /2591|2569/.test(t),
               hasRec: /\u2013/.test(t) };
    });
    chk('the compare table still fills', out.cols===3 && out.cells>30 && out.hasStable && out.hasElo && out.hasRec,
        JSON.stringify(out));
    chk('no page errors in compare', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* --- fantasy.html can now read the dossier --- */
  {
    const {ctx,p,errs} = await page(b,'fantasy.html');
    const r = await p.evaluate(()=>{
      const G=window.GyojiGuide||{};
      const u=G.rikishi ? G.rikishi('Ura') : null;
      return { has: !!(G.RIKISHI && G.RIKISHI.length),
               n: (G.RIKISHI||[]).length,
               ura: u ? {rank:u.rank, elo:u.elo, stable:u.stable, sig:(u.sig||[]).length, form:!!u.form} : null,
               missing: (G.RIKISHI||[]).filter(x=>!x.n).length };
    });
    chk('fantasy.html sees the dossier', r.has, r.n+' rows');
    chk('with the fields a card back needs', r.ura && r.ura.rank && r.ura.stable && r.ura.sig>0 && r.ura.form,
        JSON.stringify(r.ura));
    chk('every row has a shikona', r.missing===0, r.missing+' nameless');
    chk('no page errors on fantasy', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close();
  if (bad) process.exit(1);
})();
