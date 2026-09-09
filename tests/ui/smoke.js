const fs=require('fs');
const { chromium } = require('playwright');
const WORD={Y:'Yokozuna',O:'Ozeki',S:'Sekiwake',K:'Komusubi',M:'Maegashira',J:'Juryo'};
const rows=fs.readFileSync('/tmp/aki.json','utf8').trim().split(',').map(s=>{
  const [n,c]=s.split('|'); const t=c[0]; const num=(c.match(/\d+/)||[1])[0];
  const side=c.endsWith('w')?'West':'East';
  return {shikonaEn:n, rank:`${WORD[t]} ${num} ${side}`, side, tier:t, wins:0, losses:0, record:[]};
});
const banzuke=div=>{const sel=rows.filter(r=> div==='Juryo'? r.tier==='J' : r.tier!=='J');
  return JSON.stringify({bashoId:'202609',division:div,east:sel.filter(r=>r.side==='East'),west:sel.filter(r=>r.side==='West')});};

/* the backend payload a signed-out visitor gets, mid-basho on day 6 */
const results=[];
for (let d=1;d<=6;d++){
  for (let i=0;i+1<rows.length;i+=2){
    const a=rows[i], b=rows[i+1];
    results.push({day:d,division:a.tier==='J'?'Juryo':'Makuuchi',east:a.shikonaEn,west:b.shikonaEn,
      winner:(d+i)%2?a.shikonaEn:b.shikonaEn,kimarite:'yorikiri'});
  }
}
const DATA={ok:true,users:[{handle:'sean',name:'Sean',team:{sanyaku:'Onosato',m1:'Kotoshoho',m5:'Roga',
  m9:'Ura',m13:'Asakoryu',any:'Kirishima',juryo:'Dewanoryu'},rank:{idx:3,label:'Sandanme',div:'sandanme'}}],
  results:results, meta:{basho:'Aki 2026',lastDay:6,yusho:'',sansho:''}, champion:null};

const PAGES=['index.html','analysis.html','fantasy.html','dohyo.html','banzuke.html','keepers-mock-draft.html'];
(async()=>{
  const b=await chromium.launch();
  for (const w of [1280, 390]){
    console.log('\n=== viewport '+w+'px ===');
    for (const page of PAGES){
      const p=await b.newPage({viewport:{width:w,height:900}});
      const errs=[], warns=[];
      p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,160)));
      p.on('console',m=>{ if(m.type()==='error'){ const t=m.text(); if(!/favicon|net::ERR|Failed to load resource/.test(t)) warns.push(t.slice(0,140)); }});
      await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',body:JSON.stringify(DATA)}));
      await p.route('**sumo-api.com/**', route=>{
        const u=route.request().url();
        if(/banzuke\/Makuuchi/.test(u)) return route.fulfill({contentType:'application/json',body:banzuke('Makuuchi')});
        if(/banzuke\/Juryo/.test(u))    return route.fulfill({contentType:'application/json',body:banzuke('Juryo')});
        if(/torikumi/.test(u))          return route.fulfill({contentType:'application/json',body:JSON.stringify({torikumi:[]})});
        return route.fulfill({contentType:'application/json',body:'{}'});
      });
      try { await p.goto('http://127.0.0.1:8902/'+page,{waitUntil:'domcontentloaded',timeout:30000}); }
      catch(e){ console.log('  '+page.padEnd(24)+' NAV FAIL '+e.message.slice(0,80)); await p.close(); continue; }
      await p.waitForTimeout(6000);
      const info=await p.evaluate(()=>({
        overflow: document.documentElement.scrollWidth>document.documentElement.clientWidth+1,
        spinners: document.querySelectorAll('.gg-spin,.gg-loader,[class*=spinner]:not([hidden])').length,
        title: document.title
      }));
      const flag=[];
      if (errs.length) flag.push('PAGEERROR: '+errs[0]);
      if (warns.length) flag.push('console: '+warns[0]);
      if (info.overflow) flag.push('H-OVERFLOW');
      console.log('  '+page.padEnd(24)+(flag.length?('  ✗ '+flag.join(' | ')):'  ok'));
      await p.close();
    }
  }
  await b.close();
})();
