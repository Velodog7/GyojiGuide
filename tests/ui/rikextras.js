/* Honours, technique breakdown, rivals, and what a link to a profile says.

   All three panels are computed from feeds the page was already reading — the
   technique split and the rivals come out of the /matches document the career
   charts pull and used to throw away. So the first thing asserted is the thing
   that would quietly stop being true: that adding them added no requests.

   The arithmetic is checked against a 32-bout fixture small enough to verify by
   hand (tests/ui/fixtures/career.js). It is built per opponent, so the rivalry
   totals and the technique totals come from the same rows and cannot drift
   apart in the fixture itself.

   Four things here are deliberate traps for the implementation:

   - /stats reports 27 matches and 19–8 while /matches returns 32 rows. The real
     API disagrees with itself the same way (258 vs 261 for Onosato). Honours must
     print /stats' figures and the technique panel must print its own, and neither
     may add the two together.
   - Every bout against Kirishima is in a basho with no rankHistory entry —
     mae-zumo. Those bouts belong in the technique and rivalry history and must
     NOT reach the career chart. Move the "was he in this bout" filter after the
     "is this basho on the chart" filter and Kirishima disappears from the rivals.
   - One bout has an empty kimarite. That is not a technique the map has never
     heard of, it is a real result the Association never published a finish for —
     mae-zumo never gets one, and nor did Aonishiki's day-16 playoff win over
     Atamifuji in Nagoya 2026. It counts as a win and belongs in its own row.
   - Every record's `winnerJp` is an <img onerror> tag, which is what that field
     really contains in some responses. If any of it reaches innerHTML the page
     sets window.__XSS and the test says so. */
const { chromium } = require('playwright');
const F = require('./fixtures/career.js');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};

/* A banzuke big enough that GGRoster.load() accepts it as published (>=20
   Makuuchi, >=10 Juryo) — a thinner one makes it walk back to an older basho
   and the whole file passes vacuously. */
const NAMES = ['Onosato','Hoshoryu','Aonishiki','Kirishima','Fujinokawa','Atamifuji',
  'Daieisho','Hakunofuji','Kotoshoho','Oho','Roga','Ura','Tokihayate','Takanosho',
  'Gonoyama','Churanoumi','Hiradoumi','Ichiyamamoto','Oshoma','Shodai','Kotoeiho',
  'Takayasu','Wakamotoharu','Tobizaru','Asanoyama','Abi','Kinbozan','Shishi'];
const ID_OF = { Onosato: F.ME };
NAMES.forEach((n,i)=>{ if (!ID_OF[n]) ID_OF[n] = F.OPP_ID[n] || (1100+i); });

function banzuke(){
  const mak = NAMES.map((n,i)=>({ shikonaEn:n, rikishiId:ID_OF[n],
    rank: i===0?'Yokozuna East' : i===1?'Yokozuna West' : i===2?'Ozeki East'
        : i===3?'Ozeki West' : i===4?'Sekiwake East' : i===5?'Sekiwake West'
        : i===6?'Komusubi East' : i===7?'Komusubi West'
        : 'Maegashira '+(i-7)+(i%2?' West':' East') }));
  const jur = ['Dewanoryu','Kazuma','Daiseizan','Tamawashi','Onokatsu','Kyokukaiyu',
    'Sadanoumi','Ryuden','Mitakeumi','Midorifuji','Enho','Kagayaki']
    .map((n,i)=>({ shikonaEn:n, rikishiId:2000+i, rank:'Juryo '+(i+1)+(i%2?' West':' East') }));
  const half = a => ({ east:a.filter((_,i)=>i%2===0), west:a.filter((_,i)=>i%2===1) });
  return { mak: half(mak), jur: half(jur) };
}
const B = banzuke();

async function open(b, opts){
  opts = opts || {};
  const ctx = await b.newContext({viewport:{width: opts.w || 1280, height: opts.h || 1000}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,160)));
  const hits = { stats:0, matches:0, h2h:0, profile:0, banzuke:0 };
  const urls = [];

  await p.route('**sumo-api.com/**', r=>{
    const u = r.request().url();
    urls.push(u);
    const j = o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (/banzuke\/Makuuchi/i.test(u)){ hits.banzuke++; return opts.deadApi ? r.abort() : j(B.mak); }
    if (/banzuke\/Juryo/i.test(u))    return opts.deadApi ? r.abort() : j(B.jur);
    if (opts.deadCareer && /\/rikishi\//.test(u)) return r.abort();
    if (/\/rikishi\/\d+\/stats/.test(u)){ hits.stats++;
      return opts.noStats ? j({}) : j(F.STATS); }
    /* /matches/<id> is head-to-head for one pair; /matches alone is the whole
       career. Two different endpoints one regex away from each other — count
       them apart or the career feed looks like it is fetched sixteen times. */
    if (/\/rikishi\/\d+\/matches\/\d+/.test(u)){ hits.h2h++;
      return j({ total:0, rikishiWins:0, opponentWins:0, matches:[] }); }
    if (/\/rikishi\/\d+\/matches(\?|$)/.test(u)){ hits.matches++;
      return j({ limit:1000, skip:0, total: F.records().length,
                 records: F.records().concat(F.noise()) }); }
    if (/\/rikishi\/\d+(\?|$)/.test(u)){ hits.profile++;
      return j({ id:F.ME, shikonaEn:'Onosato', rankHistory: F.RANK_HISTORY }); }
    return j({});
  });
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));

  await p.goto('http://127.0.0.1:8902/rikishi.html?n=Onosato&from=browse',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4000);
  return {ctx,p,errs,hits,urls};
}

const txt = (p, sel) => p.evaluate(s=>{ const e=document.querySelector(s); return e? e.textContent.replace(/\s+/g,' ').trim() : null; }, sel);
const rows = (p, sel) => p.evaluate(s=>[...document.querySelectorAll(s)]
  .map(e=>e.textContent.replace(/\s+/g,' ').trim()), sel);
/* one entry per bar: family, count, share — read from the cells, because
   textContent runs "Kihon-waza" straight into "10" with nothing between */
const bars = (p, sel) => p.evaluate(s=>[...document.querySelectorAll(s+' .km-bars li')].map(li=>({
  ja: (li.querySelector('.km-lab b')||{}).textContent,
  en: ((li.querySelector('.km-lab span')||{}).textContent||'').trim(),
  n: parseInt((li.querySelector('.km-n')||{}).childNodes[0].nodeValue, 10),
  pct: ((li.querySelector('.km-n span')||{}).textContent||'').trim(),
  width: li.querySelector('.km-track i') ? li.querySelector('.km-track i').style.width : ''
})), sel);
const cells = (p, sel) => p.evaluate(s=>[...document.querySelectorAll(s)]
  .map(tr=>[...tr.children].map(td=>td.textContent.trim())), sel);

(async ()=>{
  const b = await chromium.launch();
  const {ctx,p,errs,hits,urls} = await open(b);

  /* ---- the point: no new requests ---- */
  chk('the career feed is fetched once for all three panels', hits.matches === 1,
      hits.matches+' /matches requests');
  chk('and the rank feed once', hits.profile === 1, hits.profile+' profile requests');
  chk('honours costs exactly one more', hits.stats === 1, hits.stats+' /stats requests');

  /* ---- which id went on the wire (the pid lesson) ---- */
  const asked = urls.filter(u=>/\/rikishi\/\d+/.test(u)).map(u=>u.match(/\/rikishi\/(\d+)/)[1]);
  chk('every career request asks with the banzuke id', asked.every(id=>id===String(F.ME)),
      JSON.stringify([...new Set(asked)]));
  const pid = await p.evaluate(()=>{ const d = window.GyojiGuide && GyojiGuide.rikishi
    && GyojiGuide.rikishi('Onosato'); return d && String(d.pid || ''); });
  chk('and never with the photo id', !pid || !asked.includes(pid), 'pid '+pid);

  /* ---- honours, from /stats and only /stats ---- */
  const tiles = await rows(p, '#hnBody .hn-tile');
  chk('the yusho count is shown', /^3\s*Yūshō/.test(tiles[0]||''), JSON.stringify(tiles[0]));
  chk('every sansho he has won gets a tile', tiles.length === 3, JSON.stringify(tiles));
  chk('and the one worth zero does not', !tiles.join(' ').includes('Kantō'), JSON.stringify(tiles));
  const career = await txt(p, '#hnBody .hn-career');
  chk('career totals come from /stats', /5 basho/.test(career) && /19–8/.test(career) && /70%/.test(career),
      career);
  chk('and the division split runs highest-first',
      /Makuuchi[\s\S]*Jūryō/.test(await txt(p,'#hnBody .hn-divs')), await txt(p,'#hnBody .hn-divs'));

  /* ---- the technique split ---- */
  const wins = await bars(p, '#kmBody .km-panel:nth-child(1)');
  const loss = await bars(p, '#kmBody .km-panel:nth-child(2)');
  const find = (a, ja) => a.filter(x=>x.ja===ja)[0] || {};

  chk('the wins panel totals what the records say',
      (await txt(p,'#kmBody .km-panel:nth-child(1) h4 span')) === '20',
      await txt(p,'#kmBody .km-panel:nth-child(1) h4 span'));
  chk('and the losses panel too',
      (await txt(p,'#kmBody .km-panel:nth-child(2) h4 span')) === '9',
      await txt(p,'#kmBody .km-panel:nth-child(2) h4 span'));

  chk('kihon-waza is 10 of his 20 wins, at 50%',
      find(wins,'Kihon-waza').n === 10 && find(wins,'Kihon-waza').pct === '50%',
      JSON.stringify(find(wins,'Kihon-waza')));
  chk('nage-te is 4 at 20%',
      find(wins,'Nage-te').n === 4 && find(wins,'Nage-te').pct === '20%',
      JSON.stringify(find(wins,'Nage-te')));
  chk('kihon-waza is also 4 of his 9 losses, at 44%',
      find(loss,'Kihon-waza').n === 4 && find(loss,'Kihon-waza').pct === '44%',
      JSON.stringify(find(loss,'Kihon-waza')));
  chk('each family carries its English gloss, so the term is never the only label',
      wins.every(x=>x.en.length > 3), JSON.stringify(wins.map(x=>x.en)));

  /* the bar is scaled against the panel's own biggest value, not the total —
     otherwise five of the six rows are invisible slivers */
  chk('the longest bar in each panel is full width',
      find(wins,'Kihon-waza').width === '100%' && find(loss,'Kihon-waza').width === '100%',
      find(wins,'Kihon-waza').width+' / '+find(loss,'Kihon-waza').width);
  chk('and a smaller one is scaled against it, not against the total',
      find(wins,'Nage-te').width === '40%', find(wins,'Nage-te').width);

  const order = a => a.map(x=>x.ja);
  chk('both panels use the same row order, so they can be read against each other',
      JSON.stringify(order(wins)) === JSON.stringify(order(loss)), JSON.stringify(order(wins)));
  chk('which is by how often the family comes up at all',
      JSON.stringify(order(wins)) === JSON.stringify(['Kihon-waza','Nage-te','Hineri-te','Hiwaza','Tokushu-waza','Kake-te','Unrecorded']),
      JSON.stringify(order(wins)));
  chk('a family he never loses to still shows, at zero',
      find(loss,'Kake-te').n === 0 && find(loss,'Kake-te').pct === '0%',
      JSON.stringify(find(loss,'Kake-te')));
  /* and draws nothing: the minimum width that keeps a count of 1 visible turns
     zero into a stub that reads as "hardly ever" rather than "never" */
  chk('and draws no bar at all', find(loss,'Kake-te').width === '',
      JSON.stringify(find(loss,'Kake-te').width));
  chk('while a count of one still draws something', find(wins,'Kake-te').width !== '',
      JSON.stringify(find(wins,'Kake-te').width));

  /* forfeits are not techniques and must not be inside the split */
  const cap = await txt(p, '#kmBody .cc-cap');
  chk('forfeits and fouls are reported outside the split',
      /29 bouts decided on the doh/.test(cap||'') && /2 won and 1 lost by forfeit or foul/.test(cap||''), cap);
  chk('and are not counted into any family', find(wins,'Kihon-waza').n === 10,
      JSON.stringify(find(wins,'Kihon-waza')));

  /* the opponent's own error is its own row, not a technique he owns */
  chk('an opponent stepping out is filed as the opponent\u2019s error, not a move of his',
      find(wins,'Hiwaza').n === 1 && /opponent/.test(find(wins,'Hiwaza').en||''),
      JSON.stringify(find(wins,'Hiwaza')));

  /* ---- every technique by name ---- */
  await p.click('#kmToggle');
  await p.waitForTimeout(250);
  const tbl = await cells(p, '#kmBody .km-table tbody tr');
  chk('the table lists every finish on the record', tbl.length === 14, tbl.length+' rows');

  /* the one that only live data revealed: a real bout the Association never
     published a kimarite for. It is a win, so it counts — but calling it
     "Other" would claim a technique nobody recorded. */
  chk('a bout with no published kimarite gets its own row, not "Other"',
      find(wins,'Unrecorded').n === 1 && !order(wins).includes('Other'),
      JSON.stringify(find(wins,'Unrecorded'))+' / '+JSON.stringify(order(wins)));
  chk('and is counted as a win, because it was one',
      find(wins,'Unrecorded').n + find(wins,'Kihon-waza').n + find(wins,'Nage-te').n +
      find(wins,'Hineri-te').n + find(wins,'Hiwaza').n + find(wins,'Tokushu-waza').n +
      find(wins,'Kake-te').n === 20,
      JSON.stringify(wins.map(x=>x.ja+':'+x.n)));
  chk('the table names it honestly',
      JSON.stringify(tbl.filter(r=>r[0]==='unrecorded')[0]) === JSON.stringify(['unrecorded','Unrecorded','1','—']),
      JSON.stringify(tbl.filter(r=>r[0]==='unrecorded')[0]));
  chk('including the forfeits the chart leaves out',
      tbl.some(r=>r[0]==='fusen (forfeit)') && tbl.some(r=>r[0]==='hansoku (foul)'),
      JSON.stringify(tbl.filter(r=>/fusen|hansoku/.test(r[0]))));
  chk('and names the family each one belongs to',
      JSON.stringify(tbl.filter(r=>r[0]==='oshidashi')[0]) === JSON.stringify(['oshidashi','Kihon-waza','4','4']),
      JSON.stringify(tbl.filter(r=>r[0]==='oshidashi')[0]));
  chk('hatakikomi is filed under tokushu-waza, where the Association puts it',
      JSON.stringify(tbl.filter(r=>r[0]==='hatakikomi')[0]) === JSON.stringify(['hatakikomi','Tokushu-waza','2','—']),
      JSON.stringify(tbl.filter(r=>r[0]==='hatakikomi')[0]));
  /* by total bouts, not by wins: oshidashi decided eight of his (4–4),
     yorikiri six (6–0), so oshidashi leads even though he never lost a
     yorikiri. Sorting by wins would put his best move on top and quietly
     answer a different question. */
  chk('the table is ordered by how often the move decided a bout, either way',
      tbl[0][0] === 'oshidashi' && tbl[1][0] === 'yorikiri', JSON.stringify(tbl.slice(0,2).map(r=>r[0])));

  /* ---- mae-zumo: on his record, off the chart ---- */
  const rv = await rows(p, '#rvBody .rv-grid > div:nth-child(1) .rv-list li');
  chk('a rivalry fought entirely in mae-zumo still counts',
      /^Kirishima ?4–0$/.test((rv[0]||'').replace(/\s+/g,' ')), JSON.stringify(rv[0]));
  const ccHead = await txt(p, '#ccBody .cc-panel:nth-child(3) h4');
  chk('while the career chart, which is per-banzuke, does not see those bouts',
      /career 17–10/.test(ccHead||''), ccHead);

  /* ---- rivals ---- */
  const rvOwned = await rows(p, '#rvBody .rv-grid > div:nth-child(2) .rv-list li');
  chk('he owns five men', rv.length === 5, JSON.stringify(rv));
  chk('ordered by how far ahead he is',
      JSON.stringify(rv.map(s=>s.replace(/\s+/g,' '))) ===
      JSON.stringify(['Kirishima4–0','Roga3–0','Tokihayate3–0','Daieisho3–1','Oho3–1'].map(s=>s.replace(/(\D)(\d)/,'$1 $2'))) ||
      rv[0].startsWith('Kirishima') && rv[3].startsWith('Daieisho'), JSON.stringify(rv));
  chk('two men own him, worst first',
      rvOwned.length === 2 && /^Takayasu/.test(rvOwned[0]) && /^Hoshoryu/.test(rvOwned[1]),
      JSON.stringify(rvOwned));
  chk('an even record is nobody’s rivalry',
      !rv.concat(rvOwned).some(s=>/Kotoshoho/.test(s)), JSON.stringify(rv.concat(rvOwned)));
  chk('and two meetings is not enough to be one',
      !rv.concat(rvOwned).some(s=>/Ura/.test(s)), JSON.stringify(rv.concat(rvOwned)));
  chk('the note says how big the pool was', /from 8 opponents/.test(await txt(p,'#rvBody .cc-cap')||''),
      await txt(p,'#rvBody .cc-cap'));
  const rvLinks = await p.evaluate(()=>[...document.querySelectorAll('#rvBody .rv-list a')]
    .map(a=>a.getAttribute('href')));
  chk('rivals on the banzuke link to their own profile',
      rvLinks.length >= 5 && rvLinks.every(h=>/^rikishi\.html\?n=/.test(h)), JSON.stringify(rvLinks[0]));
  chk('carrying the tab you came from', rvLinks.every(h=>/from=browse/.test(h)), JSON.stringify(rvLinks[0]));

  /* ---- what a link to this page says it is ---- */
  const meta = await p.evaluate(()=>({
    title: document.title,
    desc: (document.querySelector('meta[name="description"]')||{}).content,
    ogt: (document.querySelector('meta[property="og:title"]')||{}).content,
    ogd: (document.querySelector('meta[property="og:description"]')||{}).content,
    ogu: (document.querySelector('meta[property="og:url"]')||{}).content,
    ogi: (document.querySelector('meta[property="og:image"]')||{}).content,
    canon: (document.querySelector('link[rel="canonical"]')||{}).href,
    canonN: document.querySelectorAll('link[rel="canonical"]').length,
    descN: document.querySelectorAll('meta[name="description"]').length
  }));
  chk('the page titles itself after the man', meta.title === 'Onosato · Sumo Slapdown', meta.title);
  chk('and describes him rather than the directory',
      /^Onosato — /.test(meta.desc||'') && !/Every sekitori/.test(meta.desc||''), meta.desc);
  chk('the description carries his rank', /Yokozuna/.test(meta.desc||''), meta.desc);
  chk('canonical names this profile', /rikishi\.html\?n=Onosato$/.test(meta.canon||''), meta.canon);
  chk('on the production origin, not wherever it is being served',
      /^https:\/\/sumoslapdown\.com\//.test(meta.canon||''), meta.canon);
  chk('the tags are replaced, not duplicated', meta.canonN === 1 && meta.descN === 1,
      'canonical '+meta.canonN+' description '+meta.descN);
  chk('an unfurl gets his portrait', /\.(jpg|png|webp|svg)/i.test(meta.ogi||''), meta.ogi);
  /* and can actually fetch it: a relative og:image is silently ignored by every
     unfurler, so the preview comes back with no picture and no error */
  chk('at an absolute URL, or no unfurler will load it',
      /^https:\/\/sumoslapdown\.com\/\S+/.test(meta.ogi||''), meta.ogi);
  chk('og and the page agree', meta.ogt === meta.title && meta.ogd === meta.desc,
      meta.ogt+' / '+meta.ogd);

  /* ---- the feed's markup never becomes the page's markup ---- */
  const xss = await p.evaluate(()=>!!window.__XSS ||
    document.body.innerHTML.indexOf('onerror="window.__XSS') >= 0);
  chk('winnerJp’s <img> tag never reaches the DOM', !xss);
  chk('no page errors', errs.length === 0, errs[0]||'');
  await ctx.close();

  /* ---- a career with no /stats: drop the section, keep the rest ---- */
  {
    const {ctx:c2,p:p2,errs:e2} = await open(b, {noStats:true});
    chk('an empty /stats removes the honours heading rather than apologising under it',
        await p2.evaluate(()=>!document.getElementById('hnSect')));
    chk('and the technique panel, which does not need it, still renders',
        !!(await txt(p2,'#kmBody .km-panel h4')), await txt(p2,'#kmBody .km-panel h4'));
    chk('no page errors without /stats', e2.length === 0, e2[0]||'');
    await c2.close();
  }

  /* ---- career feed down: no half-drawn panels ---- */
  {
    const {ctx:c3,p:p3,errs:e3} = await open(b, {deadCareer:true});
    const gone = await p3.evaluate(()=>({ km: !document.getElementById('kmSect'),
                                          rv: !document.getElementById('rvSect'),
                                          hero: !!document.querySelector('.hero__name') }));
    chk('with the career feed down the derived sections are dropped', gone.km && gone.rv,
        JSON.stringify(gone));
    chk('and the profile itself still renders', gone.hero);
    chk('no page errors with the career feed down', e3.length === 0, e3[0]||'');
    await c3.close();
  }

  /* ---- phone ---- */
  {
    const {ctx:c4,p:p4} = await open(b, {w:390,h:844});
    const over = await p4.evaluate(()=>document.documentElement.scrollWidth - window.innerWidth);
    chk('no horizontal overflow at 390px', over <= 1, over+'px wider than the screen');
    const clipped = await p4.evaluate(()=>[...document.querySelectorAll('#kmBody .km-lab, #rvBody .rv-list li')]
      .filter(e=>e.scrollWidth > e.clientWidth + 1).length);
    chk('and no label is cut off', clipped === 0, clipped+' clipped');
    await c4.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
