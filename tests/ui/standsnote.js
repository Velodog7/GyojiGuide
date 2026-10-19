/* A title that stands as called, as the league actually sees it.

   The deal with Sean was: the called winner keeps the trophy, and the site
   never pretends the arithmetic agreed. So the banner has to carry the reason
   AND name who the corrected scoring puts first — and an ordinary title must
   stay exactly as plain as it was. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{ T.push(ok); console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:'')); };

const STANDS = { handles:['cafergy'], basho:'Aki 2026', score:119, stands:true,
  note:'Called at the end of the basho and left to stand by the league.',
  correctedHandle:'puntodog', correctedScore:123 };
const PLAIN = { handles:['cafergy'], basho:'Aki 2026', score:119, stands:false, note:'',
  correctedHandle:'', correctedScore:null };

function leaguePayload(champion){
  return { ok:true,
    league:{ id:'lg1', name:'Chanko Boogie', commissioner:'sean', inviteCode:'ABC', mode:'keepers',
      rosterSize:3, benchSize:0, farmSize:2, keepMk:null, keepJr:null, draftStatus:'complete',
      scoring:{winPoint:1,sanyakuBonus:1,sansho:5,yusho:5}, draftDate:'',
      draftAgreedCount:3, draftMemberCount:3, isCommissioner:true, iAgreedDraft:true, isMember:true },
    champion: champion,
    members:[['sean','SEAN'],['cafergy','Cafergy'],['puntodog','Punto Dog']].map(([h,n])=>({handle:h,name:n,team:{},teamUpdated:'',
      roster:{makuuchi:[],juryo:[],active:[]},boardSet:false,boardUpdated:'',draftBoard:null,agreedDraft:true})),
    messages:[] };
}
async function open(b, champion){
  const ctx = await b.newContext({viewport:{width:1200,height:1400}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,140)));
  await p.route('**sumo-api.com/**', r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**', r=>{
    const req=r.request(), url=req.url();
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (req.method()==='POST') return j({ok:true});
    if (/action=leagues/.test(url)) return j({ok:true, leagues:[{id:'lg1',name:'Chanko Boogie',commissioner:'sean',
      inviteCode:'ABC',members:3,mode:'keepers',draftStatus:'complete',isCommissioner:true}]});
    if (/action=league/.test(url)) return j(leaguePayload(champion));
    if (/action=trades/.test(url)) return j({ok:true, trades:[]});
    if (/dm/i.test(url)) return j({ok:true, threads:[], unread:0, users:[]});
    return j({ok:true, users:[], results:[], meta:{basho:'Kyushu 2026',lastDay:0}, champion:null});
  });
  await p.addInitScript(()=>{ try{ localStorage.setItem('fantasy.acct',
    JSON.stringify({handle:'sean',name:'Sean',auth:'h1'})); }catch(e){} });
  await p.goto('http://127.0.0.1:8902/fantasy.html',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  await p.evaluate(()=>{ const x=[...document.querySelectorAll('button,a')].find(e=>/my leagues/i.test(e.textContent||'')); if(x)x.click(); });
  await p.waitForTimeout(4000);
  await p.evaluate(()=>{ const r=document.querySelector('.lg-card,.lg-row,[data-league]'); if(r)r.click(); });
  await p.waitForTimeout(3000);
  return {ctx,p,errs};
}
const champ = p => p.evaluate(()=>{ const e=document.getElementById('lgChamp');
  return { shown: !!e && !e.hidden, text: e ? e.innerText.replace(/\s+/g,' ') : '',
    note: e && e.querySelector('.lg-champ__note') ? e.querySelector('.lg-champ__note').innerText.replace(/\s+/g,' ') : '',
    ast: !!(e && e.querySelector('.lg-champ__ast')),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1 }; });

(async ()=>{
  const b = await chromium.launch();

  {
    const {ctx,p,errs} = await open(b, STANDS);
    const c = await champ(p);
    chk('the called winner still holds the title', c.shown && /Cafergy/.test(c.text), c.text.slice(0,120));
    chk('marked with an asterisk', c.ast);
    chk('the reason is spelled out, not hidden in a tooltip', /left to stand by the league/.test(c.note), c.note);
    chk('and the corrected result is named, with both scores',
      /Corrected scoring gives it to Punto Dog/.test(c.note) && /123 to 119/.test(c.note), c.note);
    chk('nothing overflows the page', !c.overflow);
    chk('no page errors', errs.length===0, errs[0]||'');
    await p.locator('#lgChamp').screenshot({path: __dirname + '/champ-stands.png'}).catch(()=>{});
    await ctx.close();
  }
  {
    const {ctx,p,errs} = await open(b, PLAIN);
    const c = await champ(p);
    chk('an ordinary title is left plain', c.shown && /Cafergy/.test(c.text) && !c.ast && !c.note, c.text.slice(0,120));
    chk('no page errors (plain)', errs.length===0, errs[0]||'');
    await ctx.close();
  }
  {
    const {ctx,p,errs} = await open(b, null);
    const c = await champ(p);
    chk('a league with no title shows no banner at all', !c.shown, c.text.slice(0,80));
    chk('no page errors (none)', errs.length===0, errs[0]||'');
    await ctx.close();
  }

  await b.close();
  const f=T.filter(x=>!x).length;
  console.log('\n'+(T.length-f)+' passed, '+f+' failed');
  process.exit(f?1:0);
})();
