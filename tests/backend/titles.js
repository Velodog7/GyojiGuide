/* Exercises the real title-bag code lifted verbatim out of taiko-radio.js,
   against a fake localStorage. */
const fs=require('fs'), vm=require('vm'), assert=require('assert');
const SRC=fs.readFileSync(process.env.GG_TAIKO ||
  require('path').join(__dirname,'..','..','taiko-radio.js'),'utf8');

// pull out SONG_TITLES ... end of nextTitle()
const start=SRC.indexOf('  var SONG_TITLES = [');
const end=SRC.indexOf('  var SAMPLES = [');
assert.ok(start>0 && end>start, 'could not slice the title block');
const BLOCK=SRC.slice(start,end);
assert.ok(/function nextTitle\(\)/.test(BLOCK), 'nextTitle not in the slice');
assert.ok(!/randomTitle/.test(SRC), 'randomTitle still referenced somewhere');

function makeWorld(store){
  const ls={ getItem(k){ return k in store ? store[k] : null; },
             setItem(k,v){ store[k]=String(v); }, removeItem(k){ delete store[k]; } };
  const ctx={ localStorage: ls, Math, JSON, String, Number, Array, Object, console };
  vm.createContext(ctx);
  vm.runInContext(BLOCK+'\n;({nextTitle:nextTitle, TITLES:SONG_TITLES, KEY:TITLE_KEY, SIG:TITLE_SIG});',ctx);
  return vm.runInContext('({nextTitle:nextTitle, TITLES:SONG_TITLES, KEY:TITLE_KEY, SIG:TITLE_SIG})',ctx);
}

let pass=0,fail=0;
function t(n,fn){ try{ fn(); console.log('  ok   '+n); pass++; }
  catch(e){ console.log('  FAIL '+n+'\n         '+e.message); fail++; } }

console.log('\n— the title bag —');
t('one full cycle plays every title exactly once', ()=>{
  const w=makeWorld({}); const N=w.TITLES.length;
  const seen=[]; for(let i=0;i<N;i++) seen.push(w.nextTitle());
  assert.strictEqual(new Set(seen).size, N, 'got '+new Set(seen).size+' distinct of '+N);
  assert.strictEqual(new Set(seen).size, new Set(w.TITLES).size, 'and it is the whole list');
});
t('every cycle of N is a clean sweep, over 40 cycles', ()=>{
  const w=makeWorld({}); const N=w.TITLES.length;
  const seq=[]; for(let i=0;i<N*40;i++) seq.push(w.nextTitle());
  for(let c=0;c*N<seq.length;c++){
    const cycle=seq.slice(c*N,(c+1)*N);
    assert.strictEqual(new Set(cycle).size, N, 'cycle '+c+' repeated a name');
  }
});
t('no name comes back inside half a list, over 40 cycles', ()=>{
  const w=makeWorld({}); const N=w.TITLES.length, floor=(N>>1)+1;
  const seq=[]; for(let i=0;i<N*40;i++) seq.push(w.nextTitle());
  const lastAt={}; let worst=Infinity, worstName='';
  seq.forEach((n,i)=>{ if(lastAt[n]!=null && i-lastAt[n]<worst){ worst=i-lastAt[n]; worstName=n; } lastAt[n]=i; });
  assert.ok(worst>=floor, 'closest repeat was '+worst+' apart ("'+worstName+'"), floor is '+floor);
  console.log('         closest repeat across '+seq.length+' songs: '+worst+' apart (floor '+floor+', list of '+N+')');
});
t('the deal survives a page navigation', ()=>{
  const store={};
  const a=makeWorld(store); const N=a.TITLES.length;
  const first=[]; for(let i=0;i<5;i++) first.push(a.nextTitle());
  const b=makeWorld(store);                       // new page, same localStorage
  const rest=[]; for(let i=0;i<N-5;i++) rest.push(b.nextTitle());
  const cycle=first.concat(rest);
  assert.strictEqual(new Set(cycle).size, N, 'the second page restarted the deal');
});
t('the back half of a deal is barred from the front half of the next', ()=>{
  const store={};
  for(let trial=0; trial<200; trial++){
    for(const k in store) delete store[k];
    const w=makeWorld(store); const N=w.TITLES.length, g=N>>1;
    const c1=[]; for(let i=0;i<N;i++) c1.push(w.nextTitle());
    const c2=[]; for(let i=0;i<g;i++) c2.push(w.nextTitle());
    const tail=new Set(c1.slice(N-g));
    const clash=c2.find(n=>tail.has(n));
    assert.ok(!clash, 'trial '+trial+': "'+clash+'" closed one deal and opened the next');
  }
});
t('the order actually differs run to run', ()=>{
  const runs=new Set();
  for(let i=0;i<8;i++){ const w=makeWorld({}); runs.add(w.nextTitle()+'|'+w.nextTitle()+'|'+w.nextTitle()); }
  assert.ok(runs.size>1, 'every run dealt the same opening — not shuffling');
});
t('editing the list discards the old deal instead of dealing stale indices', ()=>{
  const store={};
  const w=makeWorld(store); w.nextTitle(); w.nextTitle();
  const saved=JSON.parse(store[w.KEY]);
  store[w.KEY]=JSON.stringify({ sig: saved.sig ^ 0xffff, order: saved.order, i: 2 });   // as if SONG_TITLES changed
  const w2=makeWorld(store); const N=w2.TITLES.length;
  const seen=[]; for(let i=0;i<N;i++) seen.push(w2.nextTitle());
  assert.strictEqual(new Set(seen).size, N, 'a fresh full cycle after the list changed');
});
t('a corrupt or truncated bag is recovered, not thrown', ()=>{
  for (const bad of ['not json', '{}', '[]', 'null', JSON.stringify({sig:1,order:[0,1],i:0})]){
    const store={}; const probe=makeWorld({}); store[probe.KEY]=bad;
    const w=makeWorld(store);
    const n=w.nextTitle();
    assert.ok(w.TITLES.indexOf(n)>=0, 'bad bag "'+bad+'" produced '+JSON.stringify(n));
  }
});
t('storage being unavailable falls back to an in-memory deal', ()=>{
  const throwing={ getItem(){ throw new Error('denied'); },
                   setItem(){ throw new Error('denied'); }, removeItem(){ throw new Error('denied'); } };
  const ctx={ localStorage: throwing, Math, JSON, String, Number, Array, Object, console };
  vm.createContext(ctx);
  vm.runInContext(BLOCK,ctx);
  const nt=vm.runInContext('nextTitle',ctx), N=vm.runInContext('SONG_TITLES.length',ctx);
  const seen=[]; for(let i=0;i<N;i++) seen.push(nt());
  assert.strictEqual(new Set(seen).size, N, 'still a clean cycle with no storage at all');
});

console.log('\n'+pass+' passed, '+fail+' failed');
if (fail) process.exit(1);
