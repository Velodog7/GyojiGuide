/* The keepers board between tournaments.

   "Start a new basho" clears Results, so from the moment Kyushu opens there is
   nothing left on the sheet to recompute Aki from. The board therefore has to
   stop computing and start READING — and it has to switch on the calendar, not
   on whether the numbers happen to look empty, or a league would spend the
   first morning of a tournament showing last basho's final table.

   The clock is pinned in each pass, so the result of this test doesn't depend
   on the day it is run. */
const { chromium } = require('playwright');

const SNAP = {
  basho: 'Aki 2026', savedAt: '2026-09-27T12:00:00Z', entrants: 2,
  entries: [
    { handle:'ace', pos:1, score:12, wins:3, bonus:4, extras:5, benchPts:6, benchCount:1,
      active:[ { name:'Fujinokawa', tier:'S', w:3, wins:3, bonus:4, sansho:true,  yusho:false, pts:12 },
               { name:'Kazuma',     tier:'J', w:0, wins:0, bonus:0, sansho:false, yusho:false, pts:0  } ] },
    { handle:'bob', pos:2, score:7, wins:7, bonus:0, extras:0, benchPts:0, benchCount:1,
      active:[ { name:'Atamifuji', tier:'S', w:7, wins:7, bonus:0, sansho:false, yusho:false, pts:7 } ] }
  ]
};

function leaguePayload(snap){
  return { ok:true,
    league:{ id:'lg1', name:'Stable Wars', commissioner:'sean', inviteCode:'ABC', mode:'keepers',
      rosterSize:2, benchSize:1, farmSize:0, keepMk:null, keepJr:null,
      draftStatus:'complete', scoring:{winPoint:1,sanyakuBonus:1,sansho:5,yusho:5},
      draftDate:'', draftAgreedCount:2, draftMemberCount:2,
      isCommissioner:true, iAgreedDraft:true, isMember:true },
    champion:null,
    lastBasho: snap,
    members:[
      { handle:'sean', name:'Sean', team:{}, teamUpdated:'',
        roster:{ makuuchi:['Fujinokawa','Daieisho'], juryo:['Kazuma'], active:['Fujinokawa','Kazuma'] },
        boardSet:true, boardUpdated:'', draftBoard:null, agreedDraft:true },
      { handle:'bob', name:'Bob', team:{}, teamUpdated:'',
        roster:{ makuuchi:['Atamifuji','Hakunofuji'], juryo:[], active:['Atamifuji'] },
        boardSet:true, boardUpdated:'', draftBoard:null, agreedDraft:true }
    ],
    messages:[] };
}

/* handles are what the snapshot stores; the page must show the DISPLAY names
   the league payload carries, or a between-basho board reads like a different
   set of people from the one that was playing */
function withNames(p){
  p.members[0].handle = 'ace'; p.members[0].name = 'Ace';
  p.members[1].handle = 'bob'; p.members[1].name = 'Bob';
  return p;
}

const T=[]; const chk=(n,ok,x)=>{ T.push([n,ok]); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+String(x).slice(0,140):'')); };

async function openLeague(b, { now, snap, results }){
  const p = await b.newPage({ viewport:{ width:1280, height:1400 } });
  const errs=[]; p.on('pageerror', e=>errs.push(String(e).split('\n')[0].slice(0,150)));

  /* pin the wall clock before any of the page's own script runs, so
     gg-basho.js resolves the phase we mean to test */
  await p.addInitScript(`(()=>{ const T = ${now}; const D = Date;
    const F = function(...a){ return a.length ? new D(...a) : new D(T); };
    F.now = () => T; F.parse = D.parse; F.UTC = D.UTC; F.prototype = D.prototype;
    window.Date = F; })()`);
  await p.addInitScript(()=>{ try{ localStorage.setItem('fantasy.acct', JSON.stringify({handle:'ace',name:'Ace',auth:'h1'})); }catch(e){} });

  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const req = r.request(), url = req.url();
    const j = o => r.fulfill({contentType:'application/json', body:JSON.stringify(o)});
    if (req.method()==='POST') return j({ok:true});
    if (/action=leagues/.test(url)) return j({ok:true, leagues:[{id:'lg1',name:'Stable Wars',commissioner:'ace',
      inviteCode:'ABC',members:2,mode:'keepers',draftStatus:'complete',isCommissioner:true}]});
    if (/action=league&|action=league$/.test(url)) return j(withNames(leaguePayload(snap)));
    if (/action=trades/.test(url)) return j({ok:true, trades:[]});
    if (/dm/i.test(url)) return j({ok:true, threads:[], unread:0, users:[]});
    return j({ok:true, users:[], results: results || [],
               meta:{ basho: results && results.length ? 'Kyushu 2026' : 'Kyushu 2026', lastDay: results ? 3 : 0 },
               champion:null});
  });

  await p.goto('http://127.0.0.1:8902/fantasy.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3000);
  await p.evaluate(()=>{ const b=[...document.querySelectorAll('button,a')].find(x=>/my leagues/i.test(x.textContent||'')); if(b) b.click(); });
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{ const r=document.querySelector('.lg-card,.lg-row,[data-league]'); if(r) r.click(); });
  await p.waitForTimeout(3500);
  return { p, errs };
}

(async ()=>{
  const b = await chromium.launch();

  /* ---- between basho: Aki is over, Kyushu has not started ---- */
  {
    const { p, errs } = await openLeague(b, { now: Date.parse('2026-10-15T12:00:00Z'), snap: SNAP });

    const v = await p.evaluate(()=>{
      const el = document.querySelector('.lg-kpfinal');
      const rows = [...document.querySelectorAll('.lg-kpfinal .lg-team-row')];
      return {
        phase: (window.GyojiGuide && GyojiGuide.basho) ? GyojiGuide.basho.state().phase : '?',
        found: !!el,
        head: el ? (el.querySelector('.lg-rm-head h4')||{}).textContent : '',
        window: el ? (el.querySelector('.lg-rm-window')||{}).textContent : '',
        names: rows.map(r => (r.querySelector('.lg-team-row__name')||{}).textContent || ''),
        scores: rows.map(r => (r.querySelector('.lg-team-row__score')||{}).textContent || ''),
        pos: rows.map(r => (r.querySelector('.lg-kp-pos')||{}).textContent || ''),
        expandHTML: rows.length ? rows[0].querySelector('.lg-team-expand').innerHTML : '',
        liveBoard: !!document.querySelector('.lg-kpstand:not(.lg-kpfinal)')
      };
    });

    chk('the calendar says we are between tournaments', v.phase === 'upcoming', v.phase);
    chk('the final readout is what the league shows', v.found);
    chk('and the live standings board is not also on the page', !v.liveBoard);
    chk('it is headed as final, naming the basho it describes',
        /final standings/i.test(v.head||'') && /Aki 2026/.test(v.window||''), v.head + ' | ' + v.window);
    chk('managers appear by display name, in placing order',
        /Ace/.test(v.names[0]||'') && /Bob/.test(v.names[1]||''), JSON.stringify(v.names));
    chk('placings are numbered from the record', v.pos.join(',') === '1,2', v.pos.join(','));
    chk('scores are the stored ones, not a recount of an empty sheet',
        /12/.test(v.scores[0]||'') && /\b7\b/.test(v.scores[1]||''), JSON.stringify(v.scores));

    chk('the expanded row says where the points came from',
        /3 wins/.test(v.expandHTML) && /4 upset bonus/.test(v.expandHTML), v.expandHTML.slice(0,120));
    chk('the held bench is named as unplayed, never added in',
        /1 held/.test(v.expandHTML) && /unplayed/.test(v.expandHTML), v.expandHTML.slice(0,200));
    chk('a wrestler carries the rank he FOUGHT at, not today’s',
        /pcard[^"]*r-S/.test(v.expandHTML), (v.expandHTML.match(/r-[A-Z]/g)||[]).join(','));

    const opened = await p.evaluate(()=>{
      const row = document.querySelector('.lg-kpfinal .lg-team-row');
      const top = row.querySelector('.lg-team-row__top') || row;
      top.click();
      return !row.querySelector('.lg-team-expand').hidden;
    });
    chk('tapping a manager opens the breakdown', opened);

    chk('no page errors', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---- day 3 of the next tournament: back to the live board ---- */
  {
    const { p, errs } = await openLeague(b, {
      now: Date.parse('2026-11-10T12:00:00Z'), snap: SNAP,
      results: [{day:1,division:'Makuuchi',east:'Fujinokawa',west:'Atamifuji',winner:'Fujinokawa',kimarite:'yorikiri'}]
    });
    const v = await p.evaluate(()=>({
      phase: GyojiGuide.basho.state().phase,
      final: !!document.querySelector('.lg-kpfinal'),
      live: !!document.querySelector('.lg-kpstand'),
      head: (document.querySelector('.lg-kpstand .lg-rm-head h4')||{}).textContent || ''
    }));
    chk('the calendar says a tournament is being fought', v.phase === 'live', v.phase);
    chk('last basho is put away the moment day 1 starts', !v.final);
    chk('and the running standings are back', v.live && /^standings$/i.test((v.head||'').trim()), v.head);
    chk('no page errors', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  /* ---- a league with no record yet ---- */
  {
    const { p, errs } = await openLeague(b, { now: Date.parse('2026-10-15T12:00:00Z'), snap: null });
    const v = await p.evaluate(()=>({
      final: !!document.querySelector('.lg-kpfinal'),
      live: !!document.querySelector('.lg-kpstand')
    }));
    chk('a league that has never finished a basho falls back to the live board rather than blanking',
        !v.final && v.live);
    chk('no page errors', errs.length === 0, errs.join(' | '));
    await p.close();
  }

  await b.close();
  const bad = T.filter(x=>!x[1]).length;
  console.log('\n' + (T.length - bad) + ' passed, ' + bad + ' failed');
  process.exit(bad ? 1 : 0);
})();
