const { chromium } = require('playwright');
const LIVE = require('/tmp/livebanzuke.json');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};
async function open(b, q){
  const ctx = await b.newContext({viewport:{width:1280,height:1000}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,160)));
  await p.route('**sumo-api.com/**', r=>{
    const u=r.request().url();
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if(/banzuke\/Makuuchi/i.test(u)) return j(LIVE.mak);
    if(/banzuke\/Juryo/i.test(u))    return j(LIVE.jur);
    if(/\/matches\//.test(u))        return j({rikishiWins:7, opponentWins:3, total:10});
    return j({});
  });
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));
  await p.goto('http://127.0.0.1:8902/rikishi.html'+(q||''),{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  return {ctx,p,errs};
}
(async ()=>{
  const b = await chromium.launch();
  { const {ctx,p,errs} = await open(b);
    const r = await p.evaluate(()=>({
      cards: document.querySelectorAll('.rk').length,
      bands: [...document.querySelectorAll('.band h2')].map(e=>e.textContent),
      title: document.title,
      firstHref: (document.querySelector('.rk')||{}).getAttribute && document.querySelector('.rk').getAttribute('href'),
      hasNav: !!document.querySelector('nav, header')
    }));
    chk('the directory lists every rikishi', r.cards===73, r.cards+' cards');
    chk('grouped into bands', r.bands.length>=2, JSON.stringify(r.bands));
    chk('cards link to a profile', /rikishi\.html\?n=/.test(r.firstHref||''), r.firstHref);
    chk('the shared nav rendered', r.hasNav);
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close(); }

  { const {ctx,p,errs} = await open(b, '?n=Hoshoryu');
    const r = await p.evaluate(()=>({
      name: (document.querySelector('.hero__name')||{}).textContent,
      kanji: (document.querySelector('.hero__kanji')||{}).textContent,
      rank: (document.querySelector('.hero__rank')||{}).textContent,
      stats: document.querySelectorAll('.stat').length,
      basho: document.querySelectorAll('.basho').length,
      prose: document.querySelectorAll('.prose').length,
      title: document.title,
      h2h: !!document.getElementById('h2hSel'),
      lastLabels: [...document.querySelectorAll('.basho i')].filter(e=>/^last basho$/i.test(e.textContent)).length,
      firstBasho: (document.querySelector('.basho b')||{}).textContent,
      heroRec: ((document.querySelector('.hero__rank')||{}).textContent||'').split('· ')[1]?.replace(/ (this|last) basho/,'')
    }));
    chk('the profile names him', r.name==='Hoshoryu', r.name);
    chk('with his kanji', r.kanji==='豊昇龍', r.kanji);
    chk('and a live rank', /Yokozuna/.test(r.rank||''), r.rank);
    chk('career figures are shown', r.stats>=5, r.stats+' stats');
    chk('recent basho are shown', r.basho>=4, r.basho+' basho');
    chk('and only one of them is called the last basho', r.lastLabels===1,
        r.lastLabels+' blocks labelled "Last basho"');
    chk('the hero and the history agree on what last basho was',
        r.heroRec && r.firstBasho && r.firstBasho.indexOf(r.heroRec)>=0,
        'hero '+r.heroRec+' vs history '+r.firstBasho);
    chk('the written form/injury notes appear', r.prose>=1, r.prose+' paragraphs');
    chk('the tab title is his name', /Hoshoryu/.test(r.title), r.title);
    chk('head-to-head is offered', r.h2h);
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close(); }

  { const {ctx,p} = await open(b, '?n=Hoshoryu');
    await p.selectOption('#h2hSel','Onosato');
    await p.waitForTimeout(1200);
    const out = await p.textContent('#h2hOut');
    chk('head-to-head resolves on demand', /7.3/.test(out||''), out);
    await ctx.close(); }

  { const {ctx,p,errs} = await open(b, '?n=NotARealMan');
    const t = await p.textContent('#view');
    chk('an unknown name says so rather than breaking', /No rikishi called/.test(t), t.slice(0,60));
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close(); }

  { const {ctx,p} = await open(b);
    await p.fill('#find','Mongolia');
    await p.waitForTimeout(500);
    const n = await p.evaluate(()=>document.querySelectorAll('.rk').length);
    chk('search filters by birthplace', n>0 && n<73, n+' of 73');
    await ctx.close(); }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
