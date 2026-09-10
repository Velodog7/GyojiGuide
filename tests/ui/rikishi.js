const { chromium } = require('playwright');
const LIVE = require('/tmp/livebanzuke.json');
const CAREER = require('/tmp/career-hoshoryu.json');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};
async function open(b, q){
  const ctx = await b.newContext({viewport:{width:1280,height:1000}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,160)));
  const h2hUrls = [];
  await p.route('**sumo-api.com/**', r=>{
    const u=r.request().url();
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if(/banzuke\/Makuuchi/i.test(u)) return j(LIVE.mak);
    if(/banzuke\/Juryo/i.test(u))    return j(LIVE.jur);
    if(/\/matches$/.test(u))    return j(CAREER.matches);
    if(/ranks=true/.test(u))    return j(CAREER.profile);
    if(/\/matches\//.test(u)) { h2hUrls.push(u);
      return j({rikishiWins:9, opponentWins:3, total:12,
                matches:new Array(12).fill({}), kimariteWins:{}, kimariteLosses:{}}); }
    return j({});
  });
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));
  await p.goto('http://127.0.0.1:8902/rikishi.html'+(q||''),{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  return {ctx,p,errs,h2hUrls};
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

  { const {ctx,p,h2hUrls} = await open(b, '?n=Hoshoryu');
    await p.selectOption('#h2hSel','Onosato');
    await p.waitForTimeout(1500);
    const out = await p.textContent('#h2hOut');
    chk('head-to-head resolves on demand', /9.3/.test(out||''), out);

    /* The bug this exists for: the dossier's `pid` is the NSK PHOTO id, and
       sumo-api answers it with HTTP 200 and every count zero — so the page
       reported "no meetings on record" for every pair and nothing errored.
       Asserting the response is not enough; assert which id went on the wire. */
    const url = h2hUrls[h2hUrls.length-1] || '';
    const pids = await p.evaluate(()=>{
      const g = n => (GyojiGuide.rikishi(n)||{});
      return { hosho: String(g('Hoshoryu').pid||''), onosato: String(g('Onosato').pid||'') };
    });
    chk('it asks sumo-api using the banzuke rikishi id',
        /\/rikishi\/\d+\/matches\/\d+/.test(url), url);
    chk('and never the dossier photo id',
        !!url && url.indexOf(pids.hosho) < 0 && url.indexOf(pids.onosato) < 0,
        'photo ids ' + JSON.stringify(pids) + ' in ' + url);
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

  /* The dossier's four risk levels all feed projWins(); all four must show. */
  { const {ctx,p} = await open(b, '?n=Hoshoryu');
    const chips = await p.evaluate(()=>[...document.querySelectorAll('.chip')].map(e=>e.textContent));
    chk('the health risk level is stated, not just "out"',
        chips.some(c=>/expected to miss/i.test(c)), JSON.stringify(chips.slice(0,4)));
    await ctx.close(); }
  { const {ctx,p} = await open(b, '?n=Tamawashi');
    const chips = await p.evaluate(()=>[...document.querySelectorAll('.chip')].map(e=>e.textContent));
    const lv = await p.evaluate(()=>(GyojiGuide.rikishi('Tamawashi')||{}).lv);
    chk('and an iron man reads as one', lv!=='iron' || chips.some(c=>/iron man/i.test(c)),
        'lv='+lv+' chips='+JSON.stringify(chips.slice(0,4)));
    await ctx.close(); }

  /* ---- career charts ----
     The assertions worth making are about the NUMBERS, not that an <svg>
     exists. A chart that renders beautifully from wrong data is the failure
     mode, and this page has already produced one (career 0-643 at 0%, because
     bouts he was not in were being counted as losses). */
  { const {ctx,p,errs} = await open(b, '?n=Hoshoryu');
    await p.waitForTimeout(1500);
    const r = await p.evaluate(()=>({
      panels:[...document.querySelectorAll('.cc-panel h4')].map(e=>e.firstChild.textContent.trim()),
      career:(document.querySelector('.cc-panel h4 span')||{}).textContent,
      winsSub:[...document.querySelectorAll('.cc-panel h4 span')].map(e=>e.textContent),
      bars:document.querySelectorAll('.cc-panel rect[rx]').length,
      svgs:document.querySelectorAll('.cc-svg').length }));
    chk('three panels: rank, wins, absence',
        JSON.stringify(r.panels)==='["Rank","Wins per basho","Days absent"]', JSON.stringify(r.panels));
    chk('the career record is real, not every bout scored as a loss',
        /405–238 · 63%/.test(r.winsSub[1]||''), r.winsSub[1]);
    chk('days missed are counted', /49 career days missed/.test(r.winsSub[2]||''), r.winsSub[2]);
    chk('bars actually drew', r.bars>20, r.bars+' bars');
    chk('no page errors', errs.length===0, errs[0]||'');

    /* hovering reports the basho under the pointer */
    /* The career section sits below the fold; an unscrolled hover lands on
       nothing and the assertion fails for a reason that has nothing to do
       with the chart. */
    const svgH = await p.$('.cc-panel .cc-svg');
    await svgH.scrollIntoViewIfNeeded();
    await p.waitForTimeout(250);
    const svgBox = await svgH.boundingBox();
    await p.mouse.move(svgBox.x + svgBox.width*0.5, svgBox.y + svgBox.height/2);
    await p.waitForTimeout(400);
    const hint = await p.textContent('#ccHint');
    chk('hovering names a basho and its record', /\d{4}/.test(hint) && /–/.test(hint), hint);

    /* The three panels are small multiples over one shared axis, so the same
       x must resolve to the same basho in each. Hovering the same screen x on
       every panel is exactly the reading the alignment exists to support. */
    const readouts = [];
    for (const sv of await p.$$('.cc-panel .cc-svg')) {
      await sv.scrollIntoViewIfNeeded();
      const bx = await sv.boundingBox();
      await p.mouse.move(bx.x + bx.width*0.62, bx.y + bx.height/2);
      await p.waitForTimeout(220);
      readouts.push((await p.textContent('#ccHint')).split('·')[0].trim());
    }
    /* Three identical placeholders would satisfy "all the same", so require a
       real basho name before believing the panels agree. */
    chk('the same x reads the same basho in all three panels',
        readouts.length===3 && new Set(readouts).size===1 && /\d{4}$/.test(readouts[0]),
        JSON.stringify(readouts));

    /* the table is the accessible alternative to the plots */
    await p.click('#ccToggle');
    await p.waitForTimeout(500);
    const rows = await p.evaluate(()=>document.querySelectorAll('.cc-table tbody tr').length);
    chk('a table view carries the same data', rows===24, rows+' rows for a 24-basho window');

    /* the range filter changes the window, not the colours */
    await p.click('.cc-range button[data-n="12"]');
    await p.waitForTimeout(600);
    const after = await p.evaluate(()=>document.querySelectorAll('.cc-table tbody tr').length);
    chk('the range filter narrows the window', after===12, after+' rows after choosing 12');
    await ctx.close(); }

  /* A rank is held for a whole basho and then jumps — a diagonal would show
     him gliding through ranks he never actually held. */
  { const {ctx,p} = await open(b, '?n=Hoshoryu');
    await p.waitForTimeout(1500);
    const d = await p.evaluate(()=>{
      const path=document.querySelector('.cc-panel .cc-svg path[stroke]');
      return path ? path.getAttribute('d') : '';
    });
    const segs = (d.match(/L/g)||[]).length;
    const diagonal = /L([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)/.test(d);
    chk('the rank line is a step, not a slide', segs > 24, segs+' segments for 24 basho');
    await ctx.close(); }

  /* No live banzuke means no sumo-api id, so head-to-head cannot be offered at
     all. It must be absent rather than present-and-broken. */
  { const ctx = await b.newContext();
    const p = await ctx.newPage();
    const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,160)));
    await p.route('**sumo-api.com/**', r=>r.abort());
    await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',body:'{"ok":true}'}));
    await p.goto('http://127.0.0.1:8902/rikishi.html?n=Hoshoryu',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(3500);
    const r = await p.evaluate(()=>({
      name:(document.querySelector('.hero__name')||{}).textContent,
      h2h:!!document.getElementById('h2hSel'),
      stats:document.querySelectorAll('.stat').length }));
    chk('with sumo-api down the profile still renders', r.name==='Hoshoryu' && r.stats>=5,
        r.name+' / '+r.stats+' stats');
    chk('and head-to-head is withheld rather than shown broken', r.h2h===false, 'offered anyway');
    chk('no page errors with the API down', errs.length===0, errs[0]||'');
    await ctx.close(); }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
