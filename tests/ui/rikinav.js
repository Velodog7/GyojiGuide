/* A profile page must still read as part of Analysis.

   rikishi.html is the Rikishi tab's content shown full-page. Before this it
   was an orphan: gg-nav.js highlighted nothing in the top bar (rikishi.html
   was in no match list), and the page had no tab bar at all, so a reader
   arriving from a scout card had no idea which section of the site they were
   standing in and no one-click way back to a sibling tab.

   Two things are asserted here, and they are separate mechanisms:
     - the TOP nav marks Analysis current, which is gg-nav.js's match list;
     - the SUBNAV marks Rikishi current and links the other five tabs into
       analysis.html at the right hash.

   The current tab must NOT be a link. A link to the page you are already on
   is a dead end, and screen readers announce it as somewhere to go. So the
   test asserts the tag as well as the aria state.

   And the hashes have to be real: a subnav that links to analysis.html#rank
   when the view is called #tiers lands the reader on the default tab with no
   error anywhere. So each href is followed and the landing view checked. */
const { chromium } = require('playwright');
const T=[]; const chk=(n,ok,x)=>{T.push(ok);console.log((ok?'  ok   ':'  FAIL ')+n+(x?'   '+x:''));};

const BANZUKE = (()=>{
  const mak=[], jur=[];
  const names=['Onosato','Hoshoryu','Aonishiki','Kirishima','Fujinokawa','Atamifuji',
    'Daieisho','Hakunofuji','Kotoshoho','Oho','Roga','Ura','Tokihayate','Takanosho',
    'Gonoyama','Churanoumi','Hiradoumi','Ichiyamamoto','Oshoma','Shodai','Kotoeiho',
    'Takayasu','Wakamotoharu','Tobizaru','Asanoyama','Abi','Kinbozan','Shishi'];
  names.forEach((n,i)=>mak.push({shikonaEn:n, rikishiId:1000+i,
    rank: i===0?'Yokozuna East' : i===1?'Yokozuna West' : i===2?'Ozeki East'
        : i===3?'Ozeki West' : i===4?'Sekiwake East' : i===5?'Sekiwake West'
        : i===6?'Komusubi East' : i===7?'Komusubi West'
        : 'Maegashira '+(i-7)+(i%2?' West':' East')}));
  ['Dewanoryu','Kazuma','Daiseizan','Tamawashi','Onokatsu','Kyokukaiyu','Sadanoumi',
   'Ryuden','Mitakeumi','Midorifuji','Enho','Kagayaki'].forEach((n,i)=>
    jur.push({shikonaEn:n, rikishiId:2000+i, rank:'Juryo '+(i+1)+(i%2?' West':' East')}));
  const half = a => ({ east:a.filter((_,i)=>i%2===0), west:a.filter((_,i)=>i%2===1) });
  return { mak: half(mak), jur: half(jur) };
})();

async function open(b, url){
  const ctx = await b.newContext({viewport:{width:1280,height:1000}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(String(e).split('\n')[0].slice(0,160)));
  await p.route('**sumo-api.com/**', r=>{
    const u=r.request().url();
    const j=o=>r.fulfill({contentType:'application/json',body:JSON.stringify(o)});
    if (/banzuke\/Makuuchi/i.test(u)) return j(BANZUKE.mak);
    if (/banzuke\/Juryo/i.test(u))    return j(BANZUKE.jur);
    if (/rikishi\/\d+\/matches\/\d+/i.test(u)) return j({matches:[], total:0});
    return j({});
  });
  await p.route('**script.google.com/**', r=>r.fulfill({contentType:'application/json',
    body:'{"ok":true,"users":[],"results":[],"meta":{"basho":"Aki 2026","lastDay":0}}'}));
  await p.goto('http://127.0.0.1:8902/'+url,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3500);
  return {ctx,p,errs};
}

/* whatever gg-nav.js has decided is the current top-level section */
const topCurrent = p => p.evaluate(()=>{
  const els = [...document.querySelectorAll('[aria-current="page"], .ggn-link.is-here, .ggn-link[aria-current]')]
    .filter(e => !e.closest('nav.tabs'));
  return els.map(e => (e.textContent||'').trim()).filter(Boolean);
});

const subnav = p => p.evaluate(()=>{
  const bar = document.querySelector('nav.tabs');
  if (!bar) return null;
  return [...bar.querySelectorAll('.tab')].map(e=>({
    label: (e.querySelector('.tab-lab')||e).textContent.trim(),
    tag: e.tagName.toLowerCase(),
    href: e.getAttribute('href') || '',
    sel: e.getAttribute('aria-selected'),
    cur: e.getAttribute('aria-current') || ''
  }));
});

(async ()=>{
  const b = await chromium.launch();

  /* ---- the profile page ---- */
  const {ctx,p,errs} = await open(b, 'rikishi.html?n=Onosato&from=rikishi');

  const top = await topCurrent(p);
  chk('the top nav marks Analysis as where you are',
      top.length===1 && /analysis/i.test(top[0]), JSON.stringify(top));

  const tabs = await subnav(p);
  chk('the profile carries the analysis subnav', !!tabs && tabs.length===6,
      tabs ? tabs.length+' tabs' : 'no nav.tabs at all');

  const labels = (tabs||[]).map(t=>t.label);
  chk('with the same six tabs, in the same order as analysis.html',
      JSON.stringify(labels)===JSON.stringify(['Banzuke','Rikishi','Health','Compare','Tiers','Mock Draft']),
      JSON.stringify(labels));

  const rk = (tabs||[]).find(t=>t.label==='Rikishi') || {};
  chk('Rikishi is the selected tab', rk.sel==='true' && rk.cur==='page',
      'aria-selected='+rk.sel+' aria-current='+rk.cur);
  chk('and it is not a link to where you already are', rk.tag==='span' && !rk.href,
      rk.tag+' href='+rk.href);

  const others = (tabs||[]).filter(t=>t.label!=='Rikishi');
  chk('every other tab is a real link back into analysis.html',
      others.length===5 && others.every(t=>t.tag==='a' && /^analysis\.html#/.test(t.href)),
      JSON.stringify(others.map(t=>t.tag+':'+t.href)));
  chk('and none of them claims to be current',
      others.every(t=>t.sel==='false' && !t.cur),
      JSON.stringify(others.map(t=>t.label+'='+t.sel)));

  chk('no page errors on the profile', errs.length===0, errs[0]||'');

  /* the subnav must not swallow the page's own content */
  const hasBody = await p.evaluate(()=>{
    const v=document.getElementById('view');
    return !!v && v.textContent.trim().length>200 && !/Loading the banzuke/.test(v.textContent);
  });
  chk('the profile itself still renders under the bar', hasBody);

  const hrefs = others.map(t=>t.href);
  await ctx.close();

  /* ---- each href actually lands on that view ---- */
  const WANT = { '#browse':'v-browse', '#health':'v-health', '#compare':'v-compare',
                 '#tiers':'v-tiers', '#draft':'v-draft' };
  for (const href of hrefs){
    const hash = href.slice(href.indexOf('#'));
    const {ctx:c2,p:p2,errs:e2} = await open(b, href);
    const shown = await p2.evaluate(()=>{
      const s=[...document.querySelectorAll('section.view')].filter(x=>x.classList.contains('on')||
        getComputedStyle(x).display!=='none');
      return s.map(x=>x.id);
    });
    chk('subnav '+hash+' opens '+WANT[hash],
        shown.length===1 && shown[0]===WANT[hash], JSON.stringify(shown));
    chk('  and analysis.html'+hash+' throws nothing', e2.length===0, e2[0]||'');
    await c2.close();
  }

  /* ---- the reverse trip: analysis.html still highlights Analysis ---- */
  {
    const {ctx:c3,p:p3} = await open(b, 'analysis.html#rikishi');
    const t3 = await topCurrent(p3);
    chk('analysis.html itself is unchanged in the top nav',
        t3.length===1 && /analysis/i.test(t3[0]), JSON.stringify(t3));
    await c3.close();
  }

  /* ---- and a page that is NOT analysis must not be caught by the new match ---- */
  {
    const {ctx:c4,p:p4} = await open(b, 'index.html');
    const t4 = await topCurrent(p4);
    chk('the new match entry does not leak onto other pages',
        t4.length===1 && !/analysis/i.test(t4[0]), JSON.stringify(t4));
    await c4.close();
  }

  const bad=T.filter(x=>!x).length;
  console.log('\n'+(T.length-bad)+' passed, '+bad+' failed');
  await b.close(); if (bad) process.exit(1);
})();
