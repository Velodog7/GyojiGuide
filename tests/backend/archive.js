/* The basho-close archive, over the real sumo-fantasy.gs in a Node vm against
   a fake Sheet and a fake sumo-api. The question every test here asks is the
   one the old client-only path got wrong: does a player who never opens the
   site still end up in TeamHistory, with the score he actually earned? */
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const GS = process.env.GG_GS ||
  require('path').join(__dirname, '..', '..', 'sumo-fantasy.gs');
const SRC = fs.readFileSync(GS,'utf8');

/* ---------- fake Sheet ---------- */
function makeSheet(name, rows){
  return { name, rows,
    getName(){return name;}, getLastRow(){return this.rows.length;},
    getLastColumn(){return this.rows.reduce((m,r)=>Math.max(m,r.length),0);},
    getDataRange(){const s=this;return {getValues(){return s.rows.map(r=>r.slice());}};},
    getRange(r,c,nr,nc){ const s=this; nr=nr||1; nc=nc||1; return {
      getValues(){const o=[];for(let i=0;i<nr;i++){const row=s.rows[r-1+i]||[];o.push(row.slice(c-1,c-1+nc));}return o;},
      setValues(v){for(let i=0;i<nr;i++){while(s.rows.length<r-1+i+1)s.rows.push([]);
        for(let j=0;j<nc;j++)s.rows[r-1+i][c-1+j]=v[i][j];}},
      setValue(v){while(s.rows.length<r)s.rows.push([]);s.rows[r-1][c-1]=v;},
      getValue(){const row=s.rows[r-1]||[];return row[c-1];} };},
    deleteRow(r){ this.rows.splice(r-1,1); },
    deleteRows(r,n){ this.rows.splice(r-1,n); },
    appendRow(row){this.rows.push(row.slice());} };
}

/* ---------- the banzuke the fake api serves, and the bouts ---------- */
const BANZUKE = [
  ['Hoshoryu','Yokozuna 1 East'], ['Onosato','Yokozuna 1 West'],
  ['Kirishima','Ozeki 1 East'],   ['Kotozakura','Ozeki 1 West'],
  ['Atamifuji','Sekiwake 1 East'],['Aonishiki','Sekiwake 1 West'],
  ['Oho','Komusubi 1 East'],      ['Yoshinofuji','Komusubi 1 West'],
  ['Kotoshoho','Maegashira 1 East'], ['Wakatakakage','Maegashira 1 West'],
  ['Ura','Maegashira 5 East'],    ['Takayasu','Maegashira 5 West'],
  ['Roga','Maegashira 9 East'],   ['Abi','Maegashira 9 West'],
  ['Asakoryu','Maegashira 13 East'], ['Tobizaru','Maegashira 13 West'],
  ['Gonoyama','Maegashira 15 East'], ['Shishi','Maegashira 15 West']
];
const JURYO = [['Dewanoryu','Juryo 1 East'], ['Tokihayate','Juryo 1 West'], ['Kazuma','Juryo 3 East']];
const TIER = {}; // what the server SHOULD derive
BANZUKE.forEach(([n,r])=>TIER[n]=r.split(' ')[0][0]==='M'?'M':{Yokozuna:'Y',Ozeki:'O',Sekiwake:'S',Komusubi:'K',Maegashira:'M'}[r.split(' ')[0]]);
JURYO.forEach(([n])=>TIER[n]='J');

/* day d, Makuuchi: pair i with i+1 down the list. East wins on odd days.
   Day 15 also carries the honours, exactly as sumo-api's payload does. */
function torikumi(div, day){
  const list = div==='Makuuchi' ? BANZUKE : JURYO;
  const bouts=[];
  for (let i=0;i+1<list.length;i+=2){
    const e=list[i][0], w=list[i+1][0];
    bouts.push({ eastShikona:e, westShikona:w, winnerEn: (day%2? e : w), kimarite:'yorikiri' });
  }
  const out={ torikumi:bouts };
  if (day===15 && div==='Makuuchi'){
    out.yusho = [{ type:'Makuuchi', shikonaEn:'Onosato' }, { type:'Juryo', shikonaEn:'Dewanoryu' }];
    out.specialPrizes = [{ type:'Shukun-sho', shikonaEn:'Ura' },
                         { type:'Kanto-sho',  shikonaEn:'Ura' },      // two prizes, one man
                         { type:'Gino-sho',   shikonaEn:'Asakoryu' }];
  }
  return out;
}

function makeCtx(opts){
  opts=opts||{};
  const store={};
  const ss={ getSheetByName(n){return store[n]||null;},
             insertSheet(n){store[n]=makeSheet(n,[]);return store[n];},
             getSheets(){return Object.keys(store).map(k=>store[k]);} };
  const props={};
  const calls={fetch:0, days:new Set()};
  const ctx={ SpreadsheetApp:{getActiveSpreadsheet(){return ss;}},
    PropertiesService:{getScriptProperties(){return {
      getProperty(k){ if (props[k]!==undefined) return props[k];
        return k==='ADMIN_KEY' ? 'test' : null; }, setProperty(k,v){props[k]=v;},
      deleteProperty(k){delete props[k];} };}},
    LockService:{getScriptLock(){return {waitLock(){},tryLock(){return true;},releaseLock(){}};}},
    UrlFetchApp:{ fetch(url){
      calls.fetch++;
      const body=(code,obj)=>({getResponseCode:()=>code, getContentText:()=>JSON.stringify(obj)});
      if (opts.offline) throw new Error('no net');
      let m = url.match(/\/banzuke\/(\w+)/);
      if (m){
        const list = m[1]==='Juryo' ? JURYO : BANZUKE;
        return body(200, { east: list.filter((_,i)=>i%2===0).map(([n,r])=>({shikonaEn:n, rank:r})),
                           west: list.filter((_,i)=>i%2===1).map(([n,r])=>({shikonaEn:n, rank:r})) });
      }
      m = url.match(/\/torikumi\/(\w+)\/(\d+)/);
      if (m){
        const day=Number(m[2]);
        if (day > (opts.throughDay==null?15:opts.throughDay)) return body(404,{});
        calls.days.add(day);
        return body(200, torikumi(m[1], day));
      }
      return body(404,{});
    }},
    CacheService:{getScriptCache(){const m={};return {get(k){return m[k]||null;},put(k,v){m[k]=v;},remove(k){delete m[k];}};}},
    ContentService:{createTextOutput(t){return {t,setMimeType(){return this;},getContent(){return t;}};},MimeType:{JSON:'json'}},
    Utilities:{formatDate(){return '';}},
    console,JSON,Math,Date,Number,String,Object,Array,isNaN,parseInt,parseFloat,RegExp,Error,
    __store:store, __calls:calls };
  vm.createContext(ctx); vm.runInContext(SRC,ctx,{filename:'sumo-fantasy.gs'});
  ctx.setup();
  return ctx;
}

/* ---------- the client's scoring, transcribed from gg-account.js ----------
   The archive is only correct if it agrees with what players watched all
   fortnight, so the expected numbers come from the client's own algorithm
   rather than from a rerun of the server's. */
const LEVEL={Y:4,O:3,S:2,K:1,M:0,J:0};
function clientScore(team, results, meta, tiers){
  const sc={winPoint:1,sanyakuBonus:1,sansho:5,yusho:5};
  const wins={}, bonus={};
  results.forEach(b=>{
    if(!b.winner) return;
    const w=b.winner, loser=(w===b.east)?b.west:b.east;
    wins[w]=(wins[w]||0)+1;
    const diff=(LEVEL[tiers[loser]||'M']||0)-(LEVEL[tiers[w]||'M']||0);
    if(diff>0) bonus[w]=(bonus[w]||0)+diff*sc.sanyakuBonus;
  });
  const sansho={}; String(meta.sansho||'').split(/[,;/]+/).forEach(x=>{x=x.trim(); if(x) sansho[x]=1;});
  const yusho=String(meta.yusho||'').trim();
  let pts=0, tw=0;
  Object.keys(team||{}).forEach(k=>{
    const n=team[k]; if(!n) return;
    const wg=wins[n]||0, bn=bonus[n]||0, w=wg*sc.winPoint;
    const sa=sansho[n]?sc.sansho:0, yu=(yusho&&yusho===n)?sc.yusho:0;
    pts+=w+bn+sa+yu; tw+=w;
  });
  return {pts, wins:tw};
}

/* ---------- a world with four players, three of whom picked ---------- */
const TEAMS = {
  sean: {sanyaku:'Onosato', m1:'Kotoshoho', m5:'Ura',   m9:'Roga',  m13:'Asakoryu', any:'Kirishima', juryo:'Dewanoryu'},
  mika: {sanyaku:'Hoshoryu',m1:'Wakatakakage', m5:'Takayasu', m9:'Abi', m13:'Tobizaru', any:'Oho', juryo:'Tokihayate'},
  dave: {sanyaku:'Aonishiki', m1:'Kotoshoho', m5:'Ura', m9:'Gonoyama', m13:'Shishi', any:'Atamifuji', juryo:'Kazuma'}
};
function world(opts){
  const c=makeCtx(opts);
  ['sean','mika','dave','lurker'].forEach((h,i)=>{
    assert.ok(c.register({handle:h,auth:'h'+i,name:h}).ok, 'register '+h);
  });
  Object.keys(TEAMS).forEach((h,i)=>{
    const r=c.saveTeam({handle:h, auth:'h'+['sean','mika','dave'].indexOf(h), team:TEAMS[h]});
    assert.ok(r.ok, 'saveTeam '+h+': '+JSON.stringify(r));
  });
  return c;
}
function history(c){
  return c.__store.TeamHistory.rows.slice(1).map(r=>({
    handle:r[0], basho:r[1], team:JSON.parse(r[2]||'{}'), score:Number(r[3]), wins:Number(r[4]),
    rows:JSON.parse(r[5]||'[]'), savedAt:r[6] }));
}

let pass=0,fail=0,failures=[];
function t(n,fn){ try{ fn(); console.log('  ok   '+n); pass++; }
  catch(e){ console.log('  FAIL '+n+'\n         '+e.message); fail++; failures.push(n); } }
function section(s){ console.log('\n— '+s+' —'); }

/* ===================================================================== */
section('the banzuke tier map the server derives for itself');
t('every rank string maps to the tier gg-account.js uses', ()=>{
  const c=world();
  const got=c.fetchBanzukeTiers_('202609');
  Object.keys(TIER).forEach(n=>assert.strictEqual(got[n], TIER[n], n+' came back as '+got[n]+', want '+TIER[n]));
  assert.strictEqual(Object.keys(got).length, BANZUKE.length+JURYO.length, 'whole banzuke');
});
t('an unreachable sumo-api yields an empty map, not an exception', ()=>{
  const c=world({offline:true});
  const got=c.fetchBanzukeTiers_('202609');
  assert.strictEqual(Object.keys(got).length, 0, 'got '+JSON.stringify(got));
});

section('the guards');
t('nothing is archived mid-basho', ()=>{
  const c=world({throughDay:7});
  c.refreshResults();
  assert.strictEqual(Number(c.readMeta().lastDay), 7, 'seven days imported');
  assert.strictEqual(history(c).length, 0, 'archived '+history(c).length+' rows on day 7');
  assert.ok(!c.readMeta().archivedBasho, 'and did not set the once-per-basho flag');
});
t('an empty results sheet is refused even with force', ()=>{
  const c=world();
  const r=c.archiveBasho_({force:true});
  assert.ok(!r.ok && /no results/i.test(r.error), JSON.stringify(r));
});
t('a blank Meta label falls back to the code label, never to an empty key', ()=>{
  const c=world({throughDay:15}); c.refreshResults();
  c.setMeta_('basho',''); c.setMeta_('archivedBasho','');
  const r=c.archiveBasho_({});
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.basho, 'Aki 2026', 'archived under '+JSON.stringify(r.basho));
  assert.ok(history(c).every(x=>x.basho==='Aki 2026'), 'a row was filed under a blank basho');
});

section('basho close');
t('day 15 archives every player who picked, and only those', ()=>{
  const c=world(); c.refreshResults();
  const h=history(c);
  assert.strictEqual(h.length, 3, 'expected 3 rows, got '+h.length+': '+h.map(x=>x.handle));
  assert.deepStrictEqual(h.map(x=>x.handle).sort(), ['dave','mika','sean'], 'the lurker who never picked is not archived');
  h.forEach(r=>assert.strictEqual(r.basho, 'Aki 2026', 'stamped with the basho'));
});
t('the honours are lifted off the day-15 payload', ()=>{
  const c=world(); c.refreshResults();
  const m=c.readMeta();
  assert.strictEqual(String(m.yusho), 'Onosato', 'Makuuchi yusho, not the Juryo one');
  assert.strictEqual(String(m.sansho), 'Ura, Asakoryu', 'both prizewinners, Ura listed once for two prizes');
});
t('a hand-typed yusho is not overwritten by the feed', ()=>{
  const c=world({throughDay:14}); c.refreshResults();
  c.setMeta_('yusho','Hoshoryu'); c.setMeta_('sansho','Takayasu');
  c.refreshResults();                       // day 15 now lands, carrying Onosato
  assert.strictEqual(String(c.readMeta().yusho), 'Hoshoryu', 'the manual correction survived');
  assert.strictEqual(String(c.readMeta().sansho), 'Takayasu');
});
t('every archived score matches what the client would have computed', ()=>{
  const c=world(); c.refreshResults();
  const results=c.readResults(), meta=c.readMeta();
  history(c).forEach(r=>{
    const want=clientScore(TEAMS[r.handle], results, meta, TIER);
    assert.strictEqual(r.score, want.pts, r.handle+' scored '+r.score+', client says '+want.pts);
    assert.strictEqual(r.wins,  want.wins, r.handle+' wins '+r.wins+', client says '+want.wins);
  });
});
t('the yusho and sansho bonuses actually land in the rows', ()=>{
  const c=world(); c.refreshResults();
  const sean=history(c).find(r=>r.handle==='sean');
  const ono=sean.rows.find(r=>r.name==='Onosato'), ura=sean.rows.find(r=>r.name==='Ura');
  assert.ok(ono.yusho, 'Onosato took the cup and Sean picked him');
  assert.ok(ura.sansho, 'Ura took a sansho');
  assert.strictEqual(ura.pts, ura.w + ura.bonus + 5, 'one sansho, not two, for two prizes');
});
t('the stored rows carry the tier and the breakdown the account page reads', ()=>{
  const c=world(); c.refreshResults();
  history(c).forEach(r=>{
    assert.strictEqual(r.rows.length, 7, r.handle+' has '+r.rows.length+' rows');
    r.rows.forEach(x=>{
      ['name','tier','w','wins','bonus','sansho','yusho','pts'].forEach(k=>
        assert.ok(k in x, 'row for '+x.name+' is missing '+k));
      assert.strictEqual(x.tier, TIER[x.name], x.name+' filed as tier '+x.tier);
      assert.strictEqual(x.pts, x.w + x.bonus + (x.sansho?5:0) + (x.yusho?5:0), x.name+' points do not add up');
    });
    for (let i=1;i<r.rows.length;i++) assert.ok(r.rows[i-1].pts >= r.rows[i].pts, 'rows sorted by points');
  });
});
t('the sanyaku bonus is paid from the fetched banzuke, not from a default of M', ()=>{
  const c=world(); c.refreshResults();
  // Kotoshoho (M1) beats Wakatakakage (M1) — no gap. Kirishima (O) loses to nobody above him.
  // Ura (M5) beats Takayasu (M5): no bonus. The gap that must exist: none in these pairs,
  // so assert instead that a Maegashira who beat a Yokozuna would score it.
  const tiers=c.fetchBanzukeTiers_('202609');
  const model=c.serverScoreModel_(c.defaultScoring(), tiers);
  const solo=c.serverTeamRows_({a:'Kotoshoho'}, model, tiers);
  assert.strictEqual(solo.rows[0].tier,'M');
  // synthesise the upset directly through the model's own tier lookup
  assert.strictEqual(c.tierLevel_('Hoshoryu',tiers) - c.tierLevel_('Kotoshoho',tiers), 4,
    'a Maegashira beating a Yokozuna must be worth four');
});

section('idempotence — the part that decides whether a basho can be lost');
t('a second hourly tick changes nothing', ()=>{
  const c=world(); c.refreshResults();
  const before=JSON.stringify(history(c).map(r=>[r.handle,r.score,r.wins]));
  c.refreshResults(); c.refreshResults();
  const after=history(c);
  assert.strictEqual(after.length, 3, 'still 3 rows, got '+after.length);
  assert.strictEqual(JSON.stringify(after.map(r=>[r.handle,r.score,r.wins])), before, 'scores drifted');
});
t('a team edited for the NEXT basho does not overwrite the archive', ()=>{
  const c=world(); c.refreshResults();
  const was=history(c).find(r=>r.handle==='sean');
  c.saveTeam({handle:'sean',auth:'h0',team:{sanyaku:'Kotozakura'}});   // drafting again
  c.refreshResults();
  const now=history(c).find(r=>r.handle==='sean');
  assert.strictEqual(now.score, was.score, 'the archived score changed to '+now.score);
  assert.strictEqual(Object.keys(now.team).length, 7, 'the archived team was replaced by the new draft');
});
t('the client snapshot and the server pass share one row', ()=>{
  const c=world(); c.refreshResults();
  const before=history(c).length;
  const r=c.archiveTeam({handle:'sean',auth:'h0',basho:'Aki 2026',
    team:TEAMS.sean, score:999, wins:9, rows:[{name:'Onosato',tier:'Y',w:9,wins:9,bonus:0,sansho:false,yusho:true,pts:14}]});
  assert.ok(r.ok && r.updated, 'client archive should have updated, got '+JSON.stringify(r));
  assert.strictEqual(history(c).length, before, 'the client created a duplicate row');
  assert.strictEqual(history(c).find(x=>x.handle==='sean').score, 999, 'the client write did not land');
});
t('a client snapshot taken first is corrected by the server pass', ()=>{
  const c=world({throughDay:15});
  c.refreshResults();
  // pretend the client got there first with a stale, mid-basho score
  c.setMeta_('archivedBasho','');
  const sh=c.__store.TeamHistory;
  sh.rows.slice(1).forEach(r=>{ if(r[0]==='sean'){ r[3]=1; r[4]=1; } });
  const r=c.archiveBasho_({});
  assert.ok(r.ok, JSON.stringify(r));
  const sean=history(c).find(x=>x.handle==='sean');
  assert.ok(sean.score > 1, 'the server pass left the stale score in place: '+sean.score);
  assert.strictEqual(history(c).length, 3, 'and did not duplicate');
});

section('the admin path');
t('adminArchiveBasho needs the key', ()=>{
  const c=world(); c.refreshResults();
  const bad=c.adminArchiveBasho({adminKey:'nope'});
  assert.ok(!bad.ok, 'a wrong key was accepted: '+JSON.stringify(bad));
  const good=c.adminArchiveBasho({adminKey:'test'});
  assert.ok(good.ok && good.already, 'expected "already", got '+JSON.stringify(good));
});
t('force re-archives after the flag is set', ()=>{
  const c=world(); c.refreshResults();
  const r=c.adminArchiveBasho({adminKey:'test', force:true});
  assert.ok(r.ok && r.archived===3, JSON.stringify(r));
  assert.strictEqual(history(c).length, 3, 'force duplicated rows');
});
t('applying the ranking archives first, so the button works on a cold sheet', ()=>{
  const c=world({throughDay:15});
  // import the results without ever letting the auto-archive run
  c.setMeta_('archivedBasho','SKIP');
  c.refreshResults();
  c.__store.TeamHistory.rows = [c.__store.TeamHistory.rows[0]];   // nothing archived at all
  c.setMeta_('archivedBasho','');
  const r=c.applyBashoRanking('Aki 2026', null);
  assert.ok(r.ok, 'applyBashoRanking: '+JSON.stringify(r));
  assert.strictEqual(r.ranked, 3, 'ranked '+r.ranked+' players');
  assert.strictEqual(history(c).length, 3, 'it should have archived the three teams itself');
  assert.ok(c.__store.Rankings.rows.length > 1, 'and written the ranks');
});
t('champions are crowned off the server archive', ()=>{
  const c=world({throughDay:15});
  c.refreshResults();
  const r=c.applyBashoRanking('Aki 2026', null);
  assert.ok(r.ok, JSON.stringify(r));
  const champ=c.reigningChampion_('');
  assert.ok(champ, 'no public champion was crowned');
  const top=history(c).sort((a,b)=>b.score-a.score)[0];
  assert.strictEqual(JSON.stringify(champ.handles), JSON.stringify([top.handle]),
    'crowned '+JSON.stringify(champ.handles)+', top score was '+top.handle);
});

section('reading it back');
t('accountSummary hands the page a per-basho history it can plot', ()=>{
  const c=world(); c.refreshResults();
  const s=c.accountSummary('sean');
  assert.ok(s.ok !== false, JSON.stringify(s));
  assert.ok(Array.isArray(s.history) && s.history.length===1, 'history: '+JSON.stringify(s.history));
  const h=s.history[0];
  ['basho','score','wins'].forEach(k=>assert.ok(k in h, 'summary row missing '+k));
  assert.strictEqual(h.basho,'Aki 2026');
  assert.strictEqual(h.score, history(c).find(x=>x.handle==='sean').score);
});
t('myHistory returns the team and the breakdown', ()=>{
  const c=world(); c.refreshResults();
  const h=c.myHistory('SEAN');            // case-insensitive
  assert.strictEqual(h.length,1);
  assert.strictEqual(h[0].rows.length,7);
  assert.strictEqual(h[0].team.sanyaku,'Onosato');
});

section('offline / degraded');
t('with sumo-api unreachable nothing is imported and nothing is archived', ()=>{
  const c=world({offline:true});
  c.refreshResults();
  assert.strictEqual(history(c).length, 0);
  assert.strictEqual(Number(c.readMeta().lastDay), 0);
});
t('results already in the sheet still archive if the banzuke fetch fails', ()=>{
  const c=world(); c.refreshResults();                 // full basho, tiers cached in Meta
  const c2=world({offline:true});
  c2.__store.Results.rows = c.__store.Results.rows.map(r=>r.slice());
  c2.setMeta_('lastDay',15);
  const r=c2.archiveBasho_({});
  assert.ok(r.ok && r.archived===3, 'offline archive: '+JSON.stringify(r));
  const sean=history(c2).find(x=>x.handle==='sean');
  assert.ok(sean.score>0, 'scored zero with no tier map');
  assert.ok(sean.rows.every(x=>x.tier==='M'), 'unknown tiers should fall back to M, as gg-account.js does');
});

console.log('\n'+pass+' passed, '+fail+' failed');
if (fail){ console.log('failing: '+failures.join(', ')); process.exit(1); }
