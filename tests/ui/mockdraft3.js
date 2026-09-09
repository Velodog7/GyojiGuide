/* Every case the Mock Draft ↔ account sync has to get right. */
const { chromium } = require('playwright');

const TEAM = { sanyaku:'Onosato', m1:'Kotoshoho', m5:'Ura', m9:'Roga',
               m13:'Asakoryu', any:'Kirishima', juryo:'Dewanoryu' };
const LOCAL = JSON.stringify({sanyaku:0,m1_4:10,m5_8:18,m9_12:26,m13_16:34,any:1,juryo:42});

function payload(team){ return { ok:true,
  users: team ? [{handle:'sean',name:'Sean',team:team,updated:'2026-09-03T12:00:00Z',
                  rank:{idx:3,label:'Sandanme',div:'sandanme'}}] : [],
  results:[], meta:{basho:'Aki 2026',lastDay:0}, champion:null }; }

async function run(b, label, {serverTeam, seedLocal, seedSynced, signedIn=true, act}){
  const ctx = await b.newContext({viewport:{width:1280,height:1000}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,130)));
  let gets = 0, posted = null;
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const req=r.request();
    if (req.method()==='POST'){
      try{ const bd=JSON.parse(req.postData()||'{}'); if(bd.action==='save') posted=bd.team; }catch(e){}
      return r.fulfill({contentType:'application/json',body:'{"ok":true,"updated":true}'});
    }
    if (/action=data/.test(req.url()) || !/action=/.test(req.url())) gets++;
    return r.fulfill({contentType:'application/json',body:JSON.stringify(payload(serverTeam))});
  });
  await p.addInitScript(([acct, loc, syn]) => { try{
    if (acct) localStorage.setItem('fantasy.acct', JSON.stringify({handle:'sean',name:'Sean',auth:'h1'}));
    if (loc) localStorage.setItem('tachiai.picks.v1', loc);
    if (syn) localStorage.setItem('tachiai.picks.synced', syn);
  }catch(e){} }, [signedIn, seedLocal||null, seedSynced?JSON.stringify(seedSynced):null]);

  await p.goto('http://127.0.0.1:8902/analysis.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4500);
  if (act) await act(p);
  await p.waitForTimeout(1200);

  const r = await p.evaluate(()=>({
    n: Object.values(picks).filter(x=>x!=null).length,
    team: (function(){ const B={sanyaku:'sanyaku',m1_4:'m1',m5_8:'m5',m9_12:'m9',m13_16:'m13',any:'any',juryo:'juryo'};
      const t={}; BRACKETS.forEach(b=>{const i=picks[b.id]; if(Number.isInteger(i)&&R[i]) t[B[b.id]]=R[i].n;}); return t; })(),
    notice: (()=>{ const el=document.getElementById('draftRestore');
      return el && !el.hidden ? el.innerText.replace(/\s+/g,' ').slice(0,80) : ''; })(),
    synced: localStorage.getItem('tachiai.picks.synced'),
    drN: (document.getElementById('drN')||{}).textContent
  }));
  console.log('\n--- '+label+' ---');
  console.log('  picks '+r.n+'/7  counter '+r.drN+'  data GETs: '+gets);
  console.log('  board :', JSON.stringify(r.team));
  if (r.notice) console.log('  notice:', r.notice);
  if (posted)   console.log('  posted:', JSON.stringify(posted));
  if (errs.length) console.log('  ERRORS: '+errs[0]);
  await ctx.close();
  return r;
}

(async ()=>{
  const b = await chromium.launch();
  const eq=(a,x)=>JSON.stringify(a)===JSON.stringify(x);
  const results = [];

  let r = await run(b,'THE BUG: fresh browser, account has a team', {serverTeam:TEAM});
  results.push(['fresh browser adopts the account team', eq(r.team,TEAM) && r.n===7]);

  r = await run(b,'local picks match last save -> account wins (changed elsewhere)',
    {serverTeam:TEAM, seedLocal:LOCAL,
     seedSynced:{sanyaku:'Hoshoryu',m1:'Fujinokawa',m5:'Ura',m9:'Fujiryoga',m13:'Nishikifuji',any:'Onosato',juryo:'Asasuiryu'}});
  results.push(['a team changed elsewhere replaces an unedited board', eq(r.team,TEAM)]);

  r = await run(b,'UNSAVED local edits -> asks, changes nothing', {serverTeam:TEAM, seedLocal:LOCAL});
  results.push(['unsaved picks are never clobbered', r.team.sanyaku==='Hoshoryu' && !!r.notice]);

  r = await run(b,'...and "Load my saved team" applies it', {serverTeam:TEAM, seedLocal:LOCAL,
    act: async p => { await p.evaluate(()=>{ const b=document.getElementById('ggRestoreBtn'); if(b) b.click(); }); }});
  results.push(['the offer loads the saved team when accepted', eq(r.team,TEAM)]);

  r = await run(b,'...and "Keep these picks" leaves them alone', {serverTeam:TEAM, seedLocal:LOCAL,
    act: async p => { await p.evaluate(()=>{ const b=document.getElementById('ggKeepBtn'); if(b) b.click(); }); }});
  results.push(['the offer can be declined', r.team.sanyaku==='Hoshoryu' && !r.notice]);

  r = await run(b,'signed out -> local picks, no fetch of anyone’s team', {serverTeam:TEAM, seedLocal:LOCAL, signedIn:false});
  results.push(['signed out is untouched', r.team.sanyaku==='Hoshoryu' && !r.notice]);

  r = await run(b,'account with no team yet -> local picks kept', {serverTeam:null, seedLocal:LOCAL});
  results.push(['an empty account never wipes the board', r.team.sanyaku==='Hoshoryu' && !r.notice]);

  r = await run(b,'save marks the browser in sync', {serverTeam:TEAM, seedLocal:LOCAL,
    act: async p => { await p.evaluate(()=>{ const b=document.getElementById('ggKeepBtn'); if(b) b.click();
                                             const s=document.getElementById('ggSave'); if(s&&!s.disabled) s.click(); }); }});
  results.push(['saving records the synced team', !!r.synced && JSON.parse(r.synced).sanyaku==='Hoshoryu']);

  console.log('\n================ verdict ================');
  let bad=0;
  results.forEach(([n,ok])=>{ console.log((ok?'  ok   ':'  FAIL ')+n); if(!ok) bad++; });
  console.log(bad? '\n'+bad+' FAILED' : '\nall good');
  await b.close();
  if (bad) process.exit(1);
})();
