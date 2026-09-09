const { chromium } = require('playwright');
const NAMES=['Hatsu','Haru','Natsu','Nagoya','Aki','Kyushu'];
function hist(n){ const out=[]; let y=2026, i=4;
  for (let k=0;k<n;k++){ out.push({basho:NAMES[i]+' '+y, score:15+((k*17)%50), wins:12+((k*11)%30),
    savedAt:new Date(Date.UTC(y,i*2,20)).toISOString(), place:1+(k%9), of:12});
    i--; if(i<0){i=5;y--;} }
  return out; }
(async()=>{const b=await chromium.launch();
for (const n of [1,2,3,9,14]){
  const p=await b.newPage({viewport:{width:520,height:1000},deviceScaleFactor:2});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,120)));
  await p.route('**sumo-api.com/**',r=>r.fulfill({contentType:'application/json',body:'{}'}));
  await p.route('**script.google.com/**',r=>{const u=r.request().url();const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if(/accountSummary/.test(u))return j({ok:true,titles:[],badges:[],history:hist(n),allTime:{rank:2,of:9,total:400},leagues:[]});
    if(/dm/i.test(u))return j({ok:true,threads:[],unread:0,users:[]});
    return j({ok:true,users:[],results:[],meta:{}});});
  await p.addInitScript(()=>{try{localStorage.setItem('fantasy.acct',JSON.stringify({handle:'sean',name:'Sean',auth:'h1'}));}catch(e){}});
  await p.goto('http://127.0.0.1:8902/fantasy.html',{waitUntil:'domcontentloaded'});await p.waitForTimeout(3000);
  await p.evaluate(()=>{const b=[...document.querySelectorAll('button,a')].find(x=>/sean/i.test(x.textContent||''));if(b)b.click();});
  await p.waitForTimeout(2200);
  const r=await p.evaluate(()=>{const c=document.querySelector('.gga-chart');
    if(!c) return {chart:false, rows:document.querySelectorAll('.gga-hist__row').length};
    const labels=[...c.querySelectorAll('text')].filter(t=>/[A-Za-z]/.test(t.textContent));
    const boxes=labels.map(t=>{const b=t.getBoundingClientRect();return {t:t.textContent,l:b.left,r:b.right};}).sort((a,b)=>a.l-b.l);
    let collide=null; for(let i=1;i<boxes.length;i++) if(boxes[i].l < boxes[i-1].r-0.5) collide=boxes[i-1].t+' / '+boxes[i].t;
    const svg=c.querySelector('svg').getBoundingClientRect(), card=c.getBoundingClientRect();
    return {chart:true, rows:document.querySelectorAll('.gga-hist__row').length,
      labels:boxes.map(x=>x.t), collide, pts:c.querySelectorAll('circle').length,
      spillLeft:+(card.left-Math.min(...boxes.map(x=>x.l))).toFixed(1),
      spillRight:+(Math.max(...boxes.map(x=>x.r))-card.right).toFixed(1)};});
  console.log(n+' basho: '+JSON.stringify(r)+(errs.length?('  ERR '+errs[0]):''));
  await p.close();
}
await b.close();})();
