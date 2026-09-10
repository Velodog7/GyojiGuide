/* The rank-change pill on the analysis scout cards.

   Reported by Sean: Aonishiki's card is headed Ozeki and his pill reads
   "▼ O→S". Not a reversed label — the wrong PAIR of basho. The pill was built
   from each man's rankHistory as returned by the bulk /rikishis endpoint, and
   that endpoint returns only the first hundred rikishi by id. It accepts a
   `skip`, echoes it back in the response, and then sends the same hundred rows
   regardless; `offset` returns nothing and every other paging parameter 400s.
   Onosato (id 8850) and Aonishiki (id 8854) are outside that window, so their
   live bio was never found and the card kept the BUNDLED chg — which describes
   the move into the finished basho, one tournament behind. Aonishiki really
   did go O→S for Nagoya, and then S→O for Aki.

   The fix diffs two banzuke instead, which has no such cap and is the same
   document the rank printed above the pill comes from. So the top assertion
   here is the one Sean could see: the pill and the rank on the same card must
   never contradict each other.

   The fixture is the real Aki/Nagoya shape for the men that matter:

     Aonishiki   Sekiwake 2 West  -> Ozeki 2 East        promoted    S→O
     Kotoshoho   Sekiwake 1 West  -> Maegashira 1 East   demoted     S→M1
     Onosato     Yokozuna 1 West  -> Yokozuna 1 East     unchanged   same
     Takerufuji  Maegashira 5 East-> Maegashira 5 West   side only   same
     Kusano      (not on it)      -> Maegashira 16 East  arrived     new
     Asakoryu    Juryo 1 East     -> Maegashira 17 West  up a division

   Onosato and Aonishiki keep their real ids so that a regression back to the
   bulk endpoint fails here rather than passing on the men who happen to sit
   inside the first hundred. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};

const AKI = '202609', NAGOYA = '202607';

/* Enough rows that GGRoster.load() accepts each banzuke as published
   (>=20 Makuuchi, >=10 Juryo) — a thinner one is treated as unpublished and it
   walks back to an older basho, which would make every assertion vacuous. */
const FILL_M = ['Hoshoryu','Kirishima','Fujinokawa','Atamifuji','Daieisho','Hakunofuji',
  'Oho','Roga','Ura','Tokihayate','Takanosho','Gonoyama','Churanoumi','Hiradoumi',
  'Ichiyamamoto','Oshoma','Shodai','Kotoeiho','Takayasu','Wakamotoharu','Tobizaru',
  'Asanoyama','Abi','Kinbozan'];
const FILL_J = ['Dewanoryu','Kazuma','Daiseizan','Tamawashi','Onokatsu','Kyokukaiyu',
  'Sadanoumi','Ryuden','Mitakeumi','Midorifuji','Enho','Kagayaki'];
const ID = { Onosato:8850, Aonishiki:8854, Kotoshoho:8, Hoshoryu:19 };
const idOf = n => ID[n] || (3000 + n.length * 7 + n.charCodeAt(0));

/* the men under test, then filler at ranks that do not move */
function board(when){
  const aki = when === AKI;
  const mak = [
    ['Onosato',    aki ? 'Yokozuna 1 East'      : 'Yokozuna 1 West'],
    ['Aonishiki',  aki ? 'Ozeki 2 East'         : 'Sekiwake 2 West'],
    ['Kotoshoho',  aki ? 'Maegashira 1 East'    : 'Sekiwake 1 West'],
    ['Takerufuji', aki ? 'Maegashira 5 West'    : 'Maegashira 5 East'],
    ['Asakoryu',   aki ? 'Maegashira 17 West'   : null],
    ['Kusano',     aki ? 'Maegashira 16 East'   : null]
  ].filter(r=>r[1]);
  FILL_M.forEach((n,i)=>mak.push([n, 'Maegashira '+(i+6)+(i%2?' West':' East')]));
  const jur = [];
  if (!aki) jur.push(['Asakoryu','Juryo 1 East']);
  FILL_J.forEach((n,i)=>jur.push([n, 'Juryo '+(i+2)+(i%2?' West':' East')]));
  const row = ([n,rank])=>({ shikonaEn:n, rikishiID:idOf(n), rank, wins:0, losses:0 });
  const half = a => ({ east:a.filter((_,i)=>i%2===0).map(row),
                       west:a.filter((_,i)=>i%2===1).map(row) });
  return { mak: half(mak), jur: half(jur) };
}
const AKI_B = board(AKI), NAG_B = board(NAGOYA);

async function open(b, opts){
  opts = opts || {};
  const ctx = await b.newContext({viewport:{width:1400,height:1100}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,160)));
  const hits = { banzuke:[], rikishis:0 };

  await p.route('**sumo-api.com/**', r=>{
    const u = r.request().url();
    const j = o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    const m = u.match(/\/basho\/(\d+)\/banzuke\/(\w+)/);
    if (m){
      hits.banzuke.push(m[1]+'/'+m[2]);
      if (m[1] === AKI)    return j(m[2]==='Makuuchi' ? AKI_B.mak : AKI_B.jur);
      if (m[1] === NAGOYA){
        if (opts.noPrev) return r.abort();
        if (opts.thinPrev) return j({ east:[], west:[] });
        return j(m[2]==='Makuuchi' ? NAG_B.mak : NAG_B.jur);
      }
      return j({ east:[], west:[] });      // any other basho: not published
    }
    if (/\/rikishis\?/.test(u)){
      hits.rikishis++;
      /* The real endpoint's behaviour, reproduced: a hundred rows by id, and
         `skip` echoed but ignored. Nobody under test is inside the window, so
         any code that goes back to reading chg from here gets nothing. */
      return j({ limit:100, skip:0, total:601, records: [] });
    }
    return j({});
  });
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));

  await p.goto('http://127.0.0.1:8902/analysis.html#browse',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(6000);
  return {ctx,p,errs,hits};
}

/* every card, as a reader sees it: the rank heading and the pill beside it */
const cards = p => p.evaluate(()=>{
  const out = {};
  document.querySelectorAll('#cards .card').forEach(c=>{
    const nm = c.querySelector('.nm'); if (!nm) return;
    const pill = c.querySelector('.chgpill');
    out[nm.textContent.trim()] = {
      rank: (c.querySelector('.rk')||{}).textContent.replace(/\s+/g,' ').trim(),
      pill: pill ? pill.textContent.replace(/\s+/g,' ').trim() : null,
      cls:  pill ? pill.className : null
    };
  });
  return out;
});

/* the first tier letter of a rank heading like "Ozeki · East" */
const TIER = { Yokozuna:'Y', Ozeki:'O', Sekiwake:'S', Komusubi:'K', Maegashira:'M', Juryo:'J' };
function headTier(rank){
  const w = String(rank||'').split(/[\s·]/)[0];
  return TIER[w] || '?';
}

(async ()=>{
  const b = await chromium.launch();

  const {ctx,p,errs,hits} = await open(b);
  const c = await cards(p);
  /* snapshot before the Kusano probe below, which calls load() a second time
     and would otherwise double every count measured here */
  const firstLoad = hits.banzuke.slice();

  /* ---- the report ---- */
  chk('Aonishiki’s card is headed Ozeki', headTier((c.Aonishiki||{}).rank) === 'O',
      JSON.stringify((c.Aonishiki||{}).rank));
  chk('and his pill reads S→O, the promotion, not O→S',
      (c.Aonishiki||{}).pill === '▲ S→O', JSON.stringify((c.Aonishiki||{}).pill));
  chk('coloured as a rise', (c.Aonishiki||{}).cls === 'chgpill up', (c.Aonishiki||{}).cls);

  /* ---- the general form of the same bug: no card may contradict itself ---- */
  const contradictions = Object.keys(c).filter(n=>{
    const pill = c[n].pill; if (!pill) return false;
    const m = pill.match(/([A-Z]+\d*)→([A-Z]+\d*)/); if (!m) return false;
    return m[2][0] !== headTier(c[n].rank);       // pill's destination vs the heading
  });
  chk('no card’s pill disagrees with the rank printed above it',
      contradictions.length === 0,
      JSON.stringify(contradictions.map(n=>n+': '+c[n].rank+' / '+c[n].pill)));

  /* ---- each direction ---- */
  chk('a demotion reads down', (c.Kotoshoho||{}).pill === '▼ S→M1' &&
      (c.Kotoshoho||{}).cls === 'chgpill down', JSON.stringify(c.Kotoshoho));
  chk('holding the same rank reads as no change',
      (c.Onosato||{}).pill === '= no change' && (c.Onosato||{}).cls === 'chgpill same',
      JSON.stringify(c.Onosato));
  /* M5e outranks M5w, but nobody calls that a demotion and "▼ M5→M5" would be
     a pill arguing with itself */
  chk('swapping side at the same number is not a demotion',
      (c.Takerufuji||{}).pill === '= no change', JSON.stringify(c.Takerufuji));
  chk('coming up from Juryo is a rise, across divisions',
      (c.Asakoryu||{}).pill === '▲ J1→M17' && (c.Asakoryu||{}).cls === 'chgpill up',
      JSON.stringify(c.Asakoryu));

  /* ---- someone who was not on either division last time ----
     Checked against the loader rather than a card, because analysis.html
     deliberately does not inject newcomers: a man with no curated entry has no
     Elo, grade or prose, and a card invented for him would show made-up
     numbers. So the pill exists, and nothing on this page draws it yet. */
  {
    const nw = await p.evaluate(async ()=>{
      const res = await GGRoster.load({ change: true });
      const k = res.ranks['Kusano'];
      return k ? { chg: k.chg, rk: k.rk } : null;
    });
    chk('a man new to the salaried ranks says so, without guessing at a debut',
        nw && nw.chg && nw.chg.d === 'new' && nw.chg.t === 'up to sekitori',
        JSON.stringify(nw));
    chk('and the pill it would draw is the gold one, not an arrow',
        !!(nw && nw.chg && !/[▲▼]/.test(nw.chg.t)), JSON.stringify(nw && nw.chg));
  }

  /* ---- it must not go back to the bulk endpoint for this ---- */
  chk('the previous banzuke is read, once per division',
      firstLoad.filter(x=>x.indexOf(NAGOYA) === 0).length === 2,
      JSON.stringify(firstLoad));
  /* load() probes the upcoming basho first and walks back when it is not yet
     published, so the count is 2 per basho TOUCHED, not 2 per basho used. What
     matters is that nothing is fetched per rikishi. */
  chk('and nothing is fetched per rikishi',
      firstLoad.length <= 6 && firstLoad.every(x=>/^\d{6}\/(Makuuchi|Juryo)$/.test(x)),
      firstLoad.length+' banzuke requests for 41 cards');
  chk('no page errors', errs.length === 0, errs[0]||'');
  await ctx.close();

  /* ---- degrade to no pill, never to a wrong one ---- */
  for (const [opt, why] of [[{noPrev:true},'unreachable'], [{thinPrev:true},'not yet published']]){
    const {ctx:c2,p:p2,errs:e2} = await open(b, opt);
    const cc = await cards(p2);
    const pills = Object.keys(cc).filter(n=>cc[n].pill);
    chk('with the previous banzuke '+why+', no card shows a pill at all',
        pills.length === 0, JSON.stringify(pills.slice(0,4).map(n=>n+': '+cc[n].pill)));
    chk('  but the cards themselves still render', Object.keys(cc).length > 20,
        Object.keys(cc).length+' cards');
    chk('  and the ranks are still live', headTier((cc.Aonishiki||{}).rank) === 'O',
        JSON.stringify((cc.Aonishiki||{}).rank));
    chk('  no page errors', e2.length === 0, e2[0]||'');
    await c2.close();
  }

  /* ---- the step-back arithmetic, which the whole thing rests on ---- */
  {
    const {ctx:c3,p:p3} = await open(b);
    const steps = await p3.evaluate(()=>['202609','202601','202603','202611','','20xx09','202699']
      .map(id=>id+' -> '+GGRoster.prevBashoId(id)));
    /* the junk cases matter: parseInt reads "20xx09" as the year 20 and would
       answer "2007", a plausible-looking id that would be fetched for real */
    chk('a basho id steps back two months, wrapping the year, and refuses junk',
        JSON.stringify(steps) === JSON.stringify([
          '202609 -> 202607','202601 -> 202511','202603 -> 202601',
          '202611 -> 202609',' -> ','20xx09 -> ','202699 -> ']), JSON.stringify(steps));
    await c3.close();
  }

  /* a picture of the reported card, fixed */
  {
    const {ctx:c5,p:p5} = await open(b);
    await p5.evaluate(()=>{
      const card=[...document.querySelectorAll('#cards .card')].find(c=>/Aonishiki/.test(c.textContent));
      if(card) card.scrollIntoView({block:'center'});
    });
    await p5.waitForTimeout(600);
    await p5.screenshot({path:'/tmp/pill-fixed.png'});
    await c5.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
