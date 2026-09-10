/* The Edge column on likely matchups.

   The head-to-head column beside it cannot answer "is this a good day for him":
   most of these men have never met, and a blank is not an opinion. So Edge is a
   rating estimate — the same logistic the simulator's bout model uses, on the
   same 400 scale — moved by the head-to-head where there is one, weighted by
   how many meetings.

   What is actually asserted here, in order of how much it would cost to get
   wrong:

   1. The arithmetic. Every expected percentage below is computed in this file
      from the formula in the comment, independently of the page, and the
      fixtures are chosen so the answers are round numbers a reader can check.
   2. The weighting. A single meeting must not flip a coin toss to "Favoured",
      and a 3-9 series must not read "Even". Those two cases are what set
      EDGE_PRIOR to 6, so both are pinned here — change the constant and this
      file tells you which end you broke.
   3. That it is never colour alone. Every cell must carry a word.
   4. That it does not invent an opinion. No rating and no meetings is "—",
      never "Even 50%".

   The rating estimate needs no network, so the column must be populated on
   first paint and merely refined when each head-to-head lands. A column that
   sat empty until fifteen requests finished would be the obvious way to build
   this and the wrong one. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};

const K = 6;
const pElo   = (mine, his) => 1 / (1 + Math.pow(10, (his - mine) / 400));
const blend  = (p, a, b) => (K * p + a) / (K + a + b);
const pct    = p => Math.round(p * 100) + '%';
const word   = p => p >= 0.58 ? 'Favoured' : (p <= 0.42 ? 'Tough' : 'Even');

/* The man under test and three opponents chosen to land on distinct verdicts
   from rating alone, plus one with no rating at all. */
const ME = { n:'Onosato', id:8850, elo:2591 };
const OPP = [
  { n:'Hoshoryu',  id:19,   elo:2591 },   // dead level      → Even
  { n:'Ura',       id:31,   elo:2200 },   // he is far better → Favoured
  { n:'Aonishiki', id:8854, elo:2900 },   // far better       → Tough
  { n:'Kotoshoho', id:8,    elo:2400 }
];

async function open(b, opts){
  opts = opts || {};
  const ctx = await b.newContext({viewport:{width: opts.w || 1400, height: opts.h || 1100}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,160)));

  /* A banzuke GGRoster.load() will accept as published (>=20 Makuuchi, >=10
     Juryo). Everyone is here so the matchmaking model has a field to work with;
     only the four above have their Elo pinned in the dossier override. */
  const NAMES = ['Onosato','Hoshoryu','Aonishiki','Kirishima','Fujinokawa','Atamifuji',
    'Daieisho','Hakunofuji','Kotoshoho','Oho','Roga','Ura','Tokihayate','Takanosho',
    'Gonoyama','Churanoumi','Hiradoumi','Ichiyamamoto','Oshoma','Shodai','Kotoeiho',
    'Takayasu','Wakamotoharu','Tobizaru','Asanoyama','Abi','Kinbozan','Shishi'];
  const idOf = {}; NAMES.forEach((n,i)=>idOf[n] = 1100+i);
  idOf[ME.n] = ME.id; OPP.forEach(o=>idOf[o.n] = o.id);

  const mak = NAMES.map((n,i)=>({ shikonaEn:n, rikishiId:idOf[n],
    rank: i===0?'Yokozuna East' : i===1?'Yokozuna West' : i===2?'Ozeki East'
        : i===3?'Ozeki West' : i===4?'Sekiwake East' : i===5?'Sekiwake West'
        : i===6?'Komusubi East' : i===7?'Komusubi West'
        : 'Maegashira '+(i-7)+(i%2?' West':' East') }));
  const jur = ['Dewanoryu','Kazuma','Daiseizan','Tamawashi','Onokatsu','Kyokukaiyu',
    'Sadanoumi','Ryuden','Mitakeumi','Midorifuji','Enho','Kagayaki']
    .map((n,i)=>({ shikonaEn:n, rikishiId:2000+i, rank:'Juryo '+(i+1)+(i%2?' West':' East') }));
  const half = a => ({ east:a.filter((_,i)=>i%2===0), west:a.filter((_,i)=>i%2===1) });

  /* Pin the dossier Elo for the men under test, and — for the no-rating case —
     take one away entirely. The page must not fall back to the simulator's 2200
     default, which would manufacture an opinion out of nothing. */
  await p.addInitScript((cfg)=>{
    const apply = () => {
      const GG = window.GyojiGuide;
      if (!GG || !GG.rikishi) return false;
      Object.keys(cfg.elo).forEach(n=>{
        const d = GG.rikishi(n);
        if (d) { if (cfg.elo[n] === null) delete d.elo; else d.elo = cfg.elo[n]; }
      });
      return true;
    };
    if (!apply()) document.addEventListener('DOMContentLoaded', apply);
  }, { elo: Object.assign({ [ME.n]: ME.elo },
        ...OPP.map(o=>({[o.n]: o.elo})), opts.noElo ? { [opts.noElo]: null } : {}) });

  await p.route('**sumo-api.com/**', r=>{
    const u = r.request().url();
    const j = o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (/banzuke\/Makuuchi/i.test(u)) return j(half(mak));
    if (/banzuke\/Juryo/i.test(u))    return j(half(jur));
    if (/\/rikishi\/\d+\/stats/.test(u)) return j({});
    const m = u.match(/\/rikishi\/\d+\/matches\/(\d+)/);
    if (m){
      const rec = (opts.h2h || {})[m[1]];
      const body = rec ? { total: rec[0]+rec[1], rikishiWins: rec[0], opponentWins: rec[1], matches: [] }
                       : { total: 0, rikishiWins: 0, opponentWins: 0, matches: [] };
      /* A stub answers instantly, which would let the head-to-head land before
         the test can look — and the "painted before the network" assertion
         would pass vacuously. Hold the answer so the gap is real. */
      if (opts.slowH2h) return new Promise(res=>setTimeout(()=>res(j(body)), opts.slowH2h));
      return j(body);
    }
    if (/\/rikishi\/\d+\/matches(\?|$)/.test(u)) return j({ records: [] });
    if (/\/rikishi\/\d+(\?|$)/.test(u)) return j({ id:ME.id, shikonaEn:ME.n, rankHistory: [] });
    return j({});
  });
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));

  await p.goto('http://127.0.0.1:8902/rikishi.html?n=Onosato&from=browse',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1200);
  return {ctx,p,errs};
}

/* every distinct opponent in the table, with the two cells that matter */
const table = p => p.evaluate(()=>{
  const out = {};
  document.querySelectorAll('#h2hBody tr[data-opp]').forEach(tr=>{
    const n = tr.getAttribute('data-opp');
    if (out[n]) return;
    const e = tr.querySelector('.lm-edge');
    out[n] = {
      h2h: (tr.querySelector('.lm-h2h')||{}).textContent,
      word: e && e.querySelector('b') ? e.querySelector('b').textContent : null,
      cls:  e && e.querySelector('b') ? e.querySelector('b').className : null,
      pct:  e && e.querySelector('.lm-ep') ? e.querySelector('.lm-ep').textContent : null,
      dash: !!(e && e.querySelector('.lm-none')),
      why:  e ? e.getAttribute('title') : null
    };
  });
  return out;
});
const settle = p => p.waitForTimeout(3500);

(async ()=>{
  const b = await chromium.launch();

  /* ---- the column is there before the network is ---- */
  {
    const {ctx,p,errs} = await open(b, { slowH2h: 6000 });
    await p.waitForTimeout(1400);         // head-to-head deliberately still in flight
    const early = await table(p);
    const seen = Object.keys(early);
    chk('the table projects a card at all', seen.length >= 3, seen.length+' opponents');
    chk('the head-to-head really has not landed yet',
        seen.every(n=>early[n].h2h === '…'), JSON.stringify(seen.map(n=>early[n].h2h)));
    chk('and every row already has an edge anyway — the rating needs no network',
        seen.every(n=>early[n].word || early[n].dash),
        JSON.stringify(seen.filter(n=>!early[n].word && !early[n].dash)));

    /* rating-only arithmetic, checked against the formula not against the page */
    await p.waitForTimeout(7000);
    const t = await table(p);
    for (const o of OPP){
      if (!t[o.n]) continue;
      const p0 = pElo(ME.elo, o.elo);
      chk('never met, '+o.n+' ('+o.elo+' vs '+ME.elo+') reads '+word(p0)+' '+pct(p0),
          t[o.n].word === word(p0) && t[o.n].pct === pct(p0),
          JSON.stringify(t[o.n]));
    }
    const lvl = t['Hoshoryu'];
    if (lvl) chk('an evenly rated pair is Even, at 50%',
        lvl.word === 'Even' && lvl.pct === '50%', JSON.stringify(lvl));
    chk('a rating-only row says that is what it is',
        Object.keys(t).every(n=>!t[n].word || /never met/.test(t[n].why||'')),
        JSON.stringify(Object.keys(t).map(n=>t[n].why)[0]));
    chk('no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  /* ---- the weighting: what set EDGE_PRIOR to 6 ---- */
  {
    /* Hoshoryu is rated dead level with him and has beaten him once. A prior
       worth 4 meetings turns that into "Favoured 60%", which is the whole
       reason the constant is not 4. */
    const {ctx,p} = await open(b, { h2h: { 19: [1,0] } });
    await settle(p);
    const t = await table(p);
    const exp = blend(pElo(ME.elo, 2591), 1, 0);
    chk('one win over an evenly rated man does NOT make him favoured',
        t['Hoshoryu'] && t['Hoshoryu'].word === 'Even' && t['Hoshoryu'].pct === pct(exp),
        JSON.stringify(t['Hoshoryu'])+' expected Even '+pct(exp));
    chk('but it does move the number off level',
        t['Hoshoryu'] && t['Hoshoryu'].pct !== '50%', JSON.stringify(t['Hoshoryu']));
    chk('and the row now says the record was folded in',
        /moved by their record/.test((t['Hoshoryu']||{}).why||''), (t['Hoshoryu']||{}).why);
    await ctx.close();
  }
  {
    /* the other end: a long losing series must beat the rating, or the page
       says "Even" about a man who has been handled twelve times */
    const {ctx,p} = await open(b, { h2h: { 19: [3,9] } });
    await settle(p);
    const t = await table(p);
    const exp = blend(pElo(ME.elo, 2591), 3, 9);
    chk('a 3–9 series reads Tough even against an equal rating',
        t['Hoshoryu'] && t['Hoshoryu'].word === 'Tough' && t['Hoshoryu'].pct === pct(exp),
        JSON.stringify(t['Hoshoryu'])+' expected Tough '+pct(exp));
    chk('and the head-to-head cell agrees with it', (t['Hoshoryu']||{}).h2h === '3–9',
        (t['Hoshoryu']||{}).h2h);
    await ctx.close();
  }
  {
    /* a single upset must not erase a large rating gap in the other direction */
    const {ctx,p} = await open(b, { h2h: { 31: [0,1] } });   // Ura, 2200
    await settle(p);
    const t = await table(p);
    const exp = blend(pElo(ME.elo, 2200), 0, 1);
    chk('losing once to a much weaker man leaves him still favoured',
        t['Ura'] && t['Ura'].word === 'Favoured' && t['Ura'].pct === pct(exp),
        JSON.stringify(t['Ura'])+' expected Favoured '+pct(exp));
    await ctx.close();
  }

  /* ---- no opinion is better than a made-up one ---- */
  {
    const {ctx,p} = await open(b, { noElo: 'Kotoshoho' });
    await settle(p);
    const t = await table(p);
    if (t['Kotoshoho']){
      chk('no rating and no meetings prints a dash, not an even 50%',
          t['Kotoshoho'].dash && !t['Kotoshoho'].word, JSON.stringify(t['Kotoshoho']));
      chk('and does not borrow the simulator’s 2200 default',
          t['Kotoshoho'].pct === null, JSON.stringify(t['Kotoshoho'].pct));
    } else {
      chk('the no-rating opponent appeared on the card', false, 'Kotoshoho not projected');
    }
    await ctx.close();
  }
  {
    /* ...but a record with no rating is still something */
    const {ctx,p} = await open(b, { noElo: 'Kotoshoho', h2h: { 8: [4,0] } });
    await settle(p);
    const t = await table(p);
    const exp = blend(0.5, 4, 0);
    if (t['Kotoshoho'])
      chk('with no rating but a 4–0 record, the record alone decides',
          t['Kotoshoho'].word === word(exp) && t['Kotoshoho'].pct === pct(exp) &&
          /record alone/.test(t['Kotoshoho'].why||''),
          JSON.stringify(t['Kotoshoho'])+' expected '+word(exp)+' '+pct(exp));
    await ctx.close();
  }

  /* ---- never colour alone ---- */
  {
    const {ctx,p} = await open(b, { h2h: { 19: [3,9], 31: [7,0] } });
    await settle(p);
    const shape = await p.evaluate(()=>{
      const cells = [...document.querySelectorAll('#h2hBody .lm-edge')];
      return {
        n: cells.length,
        wordless: cells.filter(c=>!c.querySelector('b') && !c.querySelector('.lm-none')).length,
        classes: [...new Set(cells.map(c=>{ const b=c.querySelector('b'); return b?b.className:'dash'; }))],
        header: [...document.querySelectorAll('#h2hBody table.lm thead th')].map(t=>t.textContent),
        spans: [...document.querySelectorAll('#h2hBody .lm-none[colspan]')].map(c=>c.getAttribute('colspan'))
      };
    });
    chk('every edge cell carries a word or an explicit dash', shape.wordless === 0,
        shape.wordless+' colour-only cells');
    chk('the three verdicts use the page’s existing up/even/down classes',
        shape.classes.every(c=>/^(lm-up|lm-even|lm-down|dash)$/.test(c)), JSON.stringify(shape.classes));
    chk('the column is headed', JSON.stringify(shape.header) ===
        JSON.stringify(['Day','Likely opponent','Seen','Head to head','Edge']),
        JSON.stringify(shape.header));
    chk('and a day with no projected bout still spans the whole row',
        shape.spans.every(s=>s === '4'), JSON.stringify(shape.spans));
    await ctx.close();
  }

  /* ---- phone ---- */
  {
    const {ctx,p} = await open(b, { w:390, h:844, h2h: { 19: [3,9] } });
    await settle(p);
    const over = await p.evaluate(()=>{
      const t = document.querySelector('#h2hBody table.lm');
      /* Measure the VERDICT, not the cell: .lm-edge is a <td>, so its height is
         the row's, and a long opponent name in another column would fail a
         height check that has nothing to do with this one. getClientRects()
         gives one box per line of actual text. */
      const split = [...document.querySelectorAll('#h2hBody .lm-edge b')]
        .filter(el=>el.getClientRects().length > 1).length;
      return { page: document.documentElement.scrollWidth - window.innerWidth,
               table: t ? t.scrollWidth - t.clientWidth : 0, split: split };
    });
    chk('the fifth column does not push the page sideways at 390px', over.page <= 1,
        over.page+'px');
    chk('nor make the table itself scroll', over.table <= 1, over.table+'px');
    chk('and no verdict is broken across two lines', over.split === 0, over.split+' split');
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
