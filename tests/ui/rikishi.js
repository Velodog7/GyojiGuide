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
      /* a lead, a deficit, a level series and a first meeting, so the colour
         rules all get exercised rather than just the green one */
      const pat=[[9,3],[1,5],[3,3],[0,0]][h2hUrls.length%4];
      return j({rikishiWins:pat[0], opponentWins:pat[1], total:pat[0]+pat[1],
                matches:new Array(pat[0]+pat[1]).fill({}), kimariteWins:{}, kimariteLosses:{}}); }
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
  /* The directory moved to the Rikishi tab on analysis.html; a bare
     rikishi.html now redirects there. Its listing, banding and search are
     covered by tests/ui/navround.js, which also walks the round trip back. */
  { const {ctx,p,errs} = await open(b, '?n=Hoshoryu');
    const r = await p.evaluate(()=>({
      name: (document.querySelector('.hero__name')||{}).textContent,
      kanji: (document.querySelector('.hero__kanji')||{}).textContent,
      rank: (document.querySelector('.hero__rank')||{}).textContent,
      stats: document.querySelectorAll('.stat').length,
      basho: document.querySelectorAll('.basho').length,
      prose: document.querySelectorAll('.prose').length,
      title: document.title,
      h2h: !!document.getElementById('h2hBody'),
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
    chk('the likely-matchups section is present', r.h2h);
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close(); }

  /* ---- likely matchups ----
     The model projects a CARD, so the assertions are about it being a card:
     fifteen days, fifteen different men. Picking each day's most frequent
     opponent independently produced repeats (Fujinokawa on 7 and again on 8),
     which is a basho that cannot happen — nobody meets twice. */
  { const {ctx,p,h2hUrls,errs} = await open(b, '?n=Hoshoryu');
    await p.waitForTimeout(2500);
    const r = await p.evaluate(()=>{
      const rows=[...document.querySelectorAll('.lm tbody tr')];
      return { n:rows.length,
        days:rows.map(t=>t.children[0].textContent.trim()),
        opps:rows.map(t=>(t.querySelector('a')||{}).textContent||null),
        pcts:rows.map(t=>parseInt((t.querySelector('.lm-pct')||{}).textContent)||0),
        classes:rows.map(t=>((t.querySelector('.lm-h2h')||{}).className||'').replace('lm-h2h ','')),
        /* the record only. The cell now also carries a .lm-sub line spelling out
           what it comes to as a percentage, and reading the whole textContent
           runs the two together as "1–517% of 6 meetings". */
        cells:rows.map(t=>{
          const c = t.querySelector('.lm-h2h');
          if (!c) return '';
          return String(c.firstChild ? c.firstChild.textContent : c.textContent).trim();
        }),
        subs:rows.map(t=>{
          const x = t.querySelector('.lm-h2h .lm-sub');
          return x ? x.textContent.trim() : null;
        }) };
    });
    chk('all fifteen days are projected', r.n===15 && r.days[0]==='1' && r.days[14]==='15',
        r.n+' rows');
    const named = r.opps.filter(Boolean);
    chk('every day names an opponent', named.length===15, named.length+' named');
    chk('and nobody is met twice', new Set(named).size===15,
        JSON.stringify(named.filter((v,i,a)=>a.indexOf(v)!==i)));
    chk('day one is near-certain, later days less so', r.pcts[0] >= r.pcts[8],
        'day1 '+r.pcts[0]+'% vs day9 '+r.pcts[8]+'%');

    /* colour has to follow the record, and the record is written out too */
    const pairs = r.cells.map((c,i)=>[c, r.classes[i]]);
    const bad = pairs.filter(([c,cls])=>{
      const m = c.match(/^(\d+)–(\d+)$/);
      if (!m) return cls!=='lm-new';
      const a=+m[1], b=+m[2];
      return cls !== (a>b?'lm-up':a<b?'lm-down':'lm-even');
    });
    chk('a winning record is green, a losing one red', bad.length===0, JSON.stringify(bad.slice(0,3)));
    /* and the record says what it comes to, so the Edge beside it can be seen
       to sit between that and the rating rather than contradicting both */
    const subBad = r.cells.map((c,i)=>[c, r.subs[i]]).filter(([c,sub])=>{
      const m = c.match(/^(\d+)–(\d+)$/);
      if (!m) return sub !== null;                 // "never met" carries no percentage
      const a=+m[1], b=+m[2];
      return sub !== Math.round(a/(a+b)*100)+'% of '+(a+b)+(a+b===1?' meeting':' meetings');
    });
    chk('and each record states its own percentage and sample size',
        subBad.length===0, JSON.stringify(subBad.slice(0,3)));
    chk('and the numbers are shown, so colour is never the only tell',
        r.cells.every(c=>/^(\d+–\d+|never met|—)$/.test(c)), JSON.stringify(r.cells.slice(0,4)));

    chk('one head-to-head request per opponent, not per day',
        h2hUrls.length===15, h2hUrls.length+' requests for 15 distinct men');
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close(); }

  { const {ctx,p,errs} = await open(b, '?n=NotARealMan');
    const t = await p.textContent('#view');
    chk('an unknown name says so rather than breaking', /No rikishi called/.test(t), t.slice(0,60));
    chk('no page errors', errs.length===0, errs[0]||'');
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
      h2h:!!document.querySelector('.lm'),
      stats:document.querySelectorAll('.stat').length }));
    chk('with sumo-api down the profile still renders', r.name==='Hoshoryu' && r.stats>=5,
        r.name+' / '+r.stats+' stats');
    chk('and the projected card is withheld rather than shown broken', r.h2h===false, 'a table was drawn anyway');
    chk('no page errors with the API down', errs.length===0, errs[0]||'');
    await ctx.close(); }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
