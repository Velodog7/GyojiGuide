/* The same team must score the same on every page.

   GG.standings() computes the sanyaku upset bonus from RANKS, a banzuke
   snapshot baked into gg-account.js. fantasy.html always replaced it with live
   data (setRanks); index.html and analysis.html did not — so the homepage strip
   and the leaderboard scored the same team differently, and with eight sanyaku
   wrong going into Aki that is enough to name a different leader.

   The bug is a DISAGREEMENT, so that is what these assert: identical input,
   identical points, across the three surfaces. Nothing here asserts a
   hand-computed total — a test that agreed with my arithmetic but not with the
   page would prove nothing.

   sumo-api is stubbed with a banzuke that deliberately differs from the bundled
   snapshot in exactly the way Aki's does: a promotion into sanyaku and a
   demotion out of it. If the page ignores the live data, the numbers move. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};

/* The bundled snapshot has Aonishiki S and Kotoshoho S. Live Aki has Aonishiki
   Ozeki and Kotoshoho down at M1 — the real change, which moves the bonus. */
/* GGRoster.load() only accepts a banzuke with >=20 Makuuchi and >=10 Juryo
   rows — anything thinner and it treats the basho as unpublished and walks
   back to an older one. A stub that ignores that silently exercises nothing,
   which is exactly what the first version of this file did. So: a full-size
   banzuke, with the handful of tiers that matter set deliberately. */
const KEY_RANKS = {
  Onosato:'Yokozuna East',    Hoshoryu:'Yokozuna West',
  Aonishiki:'Ozeki East',     Kirishima:'Ozeki West',     // snapshot has Aonishiki Sekiwake
  Fujinokawa:'Sekiwake East', Atamifuji:'Sekiwake West',  // snapshot has Fujinokawa Maegashira
  Daieisho:'Komusubi East',   Hakunofuji:'Komusubi West', // snapshot has both Maegashira
  Kotoshoho:'Maegashira 1 East',                          // snapshot has Sekiwake
  Oho:'Maegashira 10 West',                               // snapshot has Komusubi
  Roga:'Maegashira 5 East',   Ura:'Maegashira 9 East',
  Tokihayate:'Maegashira 15 West'
};
const FILLER = ['Takanosho','Gonoyama','Churanoumi','Hiradoumi','Ichiyamamoto','Oshoma',
  'Shodai','Fujiseiun','Kotoeiho','Takayasu','Wakamotoharu','Fujiryoga','Tobizaru',
  'Asanoyama','Chiyoshoma','Abi','Nishikifuji','Takerufuji','Kinbozan','Shishi'];

function banzuke(){
  const mak = [], jur = [];
  Object.keys(KEY_RANKS).forEach(n=>mak.push({shikonaEn:n, rank:KEY_RANKS[n]}));
  FILLER.forEach((n,i)=>mak.push({shikonaEn:n, rank:'Maegashira '+(i+2)+(i%2?' West':' East')}));
  ['Dewanoryu','Kazuma','Daiseizan','Tamawashi','Onokatsu','Kyokukaiyu','Sadanoumi',
   'Ryuden','Mitakeumi','Midorifuji','Enho','Kagayaki'].forEach((n,i)=>
    jur.push({shikonaEn:n, rank:'Juryo '+(i+1)+(i%2?' West':' East')}));
  const half = a => ({ east: a.filter((_,i)=>i%2===0), west: a.filter((_,i)=>i%2===1) });
  return { mak: half(mak), jur: half(jur) };
}
const LIVE = banzuke();

/* One team, scored everywhere. Picked so the bonus actually bites: the team
   owns men who beat higher-ranked opponents under the live banzuke. */
const TEAM = { sanyaku:'Aonishiki', m1:'Kotoshoho', m5:'Roga', m9:'Ura',
               m13:'Tokihayate', any:'Fujinokawa', juryo:'Dewanoryu' };

/* Results where the bonus depends on the tiers above: lower men beating
   higher ones, and vice versa. */
const RESULTS = [
  [1,'makuuchi','Kotoshoho','Aonishiki','Kotoshoho','yorikiri'],   // M1 beats an Ozeki
  [1,'makuuchi','Fujinokawa','Onosato','Fujinokawa','oshidashi'],  // Sekiwake beats a Yokozuna
  [1,'makuuchi','Ura','Daieisho','Ura','hatakikomi'],              // M9 beats a Komusubi
  [1,'makuuchi','Roga','Oho','Roga','yorikiri'],                   // M5 beats M10 — no bonus
  [2,'makuuchi','Aonishiki','Hoshoryu','Aonishiki','oshidashi'],
  [2,'makuuchi','Tokihayate','Kotoshoho','Tokihayate','tsukiotoshi'],
  [2,'juryo','Dewanoryu','Kazuma','Dewanoryu','yorikiri']
];

const USERS = [
  { handle:'sean', name:'Sean', team:TEAM, updated:'' },
  { handle:'bo',   name:'Bo',
    team:{ sanyaku:'Onosato', m1:'Kotoeiho', m5:'Roga', m9:'Ura',
           m13:'Tokihayate', any:'Daieisho', juryo:'Dewanoryu' }, updated:'' }
];

const PAYLOAD = { ok:true, users:USERS,
  results: RESULTS.map(r=>({day:r[0],division:r[1],east:r[2],west:r[3],winner:r[4],kimarite:r[5]})),
  meta:{ basho:'Aki 2026', lastDay:2 }, champion:null };

async function open(b, page, opts){
  opts = opts || {};
  const ctx = await b.newContext({viewport:{width:1280,height:1000}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  let banzukeHits = 0;

  await p.addInitScript(()=>{ try{
    localStorage.setItem('fantasy.acct', JSON.stringify({handle:'sean',name:'Sean',auth:'h1'}));
  }catch(e){} });
  /* index.html only fetches the live strip during a basho — `if (ph === "live"
     || ph === "final")`. Run the page on a clock inside Aki, or the code path
     under test never executes and the whole file passes vacuously. */
  await p.clock.install({ time: new Date('2026-09-18T09:00:00Z') });

  await p.route('**sumo-api.com/**', r=>{
    const u = r.request().url();
    const j = o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (/banzuke\/Makuuchi/i.test(u)) { banzukeHits++;
      if (opts.deadApi) return r.abort();
      return j(LIVE.mak); }
    if (/banzuke\/Juryo/i.test(u))    { if (opts.deadApi) return r.abort(); return j(LIVE.jur); }
    return j({});
  });
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body: JSON.stringify(PAYLOAD)}));

  await p.goto('http://127.0.0.1:8902/'+page,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5000);
  return {ctx,p,errs,hits:()=>banzukeHits};
}

/* Score the shared team through the page's own scorer, whatever ranks it has
   settled on by now — this is the number that page would display. */
const scoreOf = (p, team) => p.evaluate(async (team)=>{
  const GG = window.GyojiGuide;
  const d = await GG.dataOnce();
  const m = GG.scoreModel(d);
  return GG.teamScore(team, m).pts;
}, team);
const ranksOf = p => p.evaluate(()=>({
  aonishiki: GyojiGuide.RANKS['Aonishiki'],
  kotoshoho: GyojiGuide.RANKS['Kotoshoho'],
  fujinokawa: GyojiGuide.RANKS['Fujinokawa'] }));

(async ()=>{
  const b = await chromium.launch();
  const scores = {};

  /* analysis.html is deliberately NOT in this list. Its leader-strip block
     looks for #ggLeader, an element that does not exist on that page and never
     has — the block is unreachable, so the page never scores anything and has
     nothing to agree or disagree with. Asserted separately below rather than
     silently skipped. */
  for (const page of ['index.html','fantasy.html']) {
    const {ctx,p,errs} = await open(b, page);
    const r = await ranksOf(p);
    scores[page] = await scoreOf(p, TEAM);
    chk('['+page+'] took the live banzuke, not the bundled snapshot',
        r.aonishiki==='O' && r.kotoshoho==='M' && r.fujinokawa==='S', JSON.stringify(r));
    chk('['+page+'] no page errors', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  const vals = Object.values(scores);
  chk('the same team scores the same on every page that scores',
      new Set(vals).size === 1, JSON.stringify(scores));

  {
    const {ctx,p} = await open(b, 'analysis.html');
    const dead = await p.evaluate(()=>!document.getElementById('ggLeader'));
    chk('analysis.html has no leader strip to keep in sync', dead,
        '#ggLeader now exists — wire ranksReady into it and add it to the check above');
    await ctx.close();
  }

  /* Prove the test could actually fail: under the stale snapshot the number
     is different. If these matched, everything above would be vacuous. */
  {
    const {ctx,p} = await open(b, 'index.html');
    const stale = await p.evaluate(async (team)=>{
      const GG = window.GyojiGuide;
      GG.setRanks({Aonishiki:'S', Kotoshoho:'S', Fujinokawa:'M', Daieisho:'M', Oho:'K',
                   Onosato:'Y', Hoshoryu:'Y', Kirishima:'O', Ura:'M', Roga:'M',
                   Tokihayate:'J', Dewanoryu:'J'});
      const d = await GG.dataOnce();
      return GG.teamScore(team, GG.scoreModel(d)).pts;
    }, TEAM);
    chk('and the stale snapshot really does score differently',
        stale !== scores['index.html'], 'stale '+stale+' vs live '+scores['index.html']);
    await ctx.close();
  }

  /* One load, not one per caller. Measured as a DELTA — gg-banzuke.js loads the
     banzuke for its own backdrop, so the absolute count is not ranksReady's. */
  {
    const {ctx,p,hits} = await open(b, 'index.html');
    const before = hits();
    await p.evaluate(async ()=>{ await GyojiGuide.ranksReady(); await GyojiGuide.ranksReady();
                                 await GyojiGuide.ranksReady(); });
    await p.waitForTimeout(800);
    chk('repeated calls add no further banzuke loads', hits() === before,
        (hits()-before)+' extra fetches for three calls');
    await ctx.close();
  }

  /* sumo-api down must degrade, never blank the strip or throw. */
  {
    const {ctx,p,errs} = await open(b, 'index.html', {deadApi:true});
    const ok = await p.evaluate(async ()=>{
      const r = await GyojiGuide.ranksReady();
      return { seeded: r, stillScores: typeof GyojiGuide.teamScore === 'function' };
    });
    chk('an unreachable sumo-api reports that it could not seed', ok.seeded === false, String(ok.seeded));
    chk('and the page still scores off the bundled snapshot', ok.stillScores);
    chk('no page errors with the API down', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
