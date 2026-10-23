/* The keeper deadline.

   A keeper window used to stay open until the commissioner closed it by hand,
   and a close before the new basho was started re-drafted from the OLD
   banzuke. Now the window can carry a deadline: declarations stop at it, and
   the hourly import closes the window once the new basho is in and its
   banzuke can be read. Every refusal must happen before anything is cut. */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const GS = process.env.GG_GS || require('path').join(__dirname, '..', '..', 'sumo-fantasy.gs');
const SRC = fs.readFileSync(GS, 'utf8');

/* ---- fake Apps Script ---- */
function makeSheet(name, rows){
  return {
    name, rows,
    getName(){ return name; },
    getLastRow(){ return this.rows.length; },
    getLastColumn(){ return this.rows.reduce((m,r)=>Math.max(m,r.length),0); },
    getDataRange(){ const s=this; return { getValues(){ return s.rows.map(r=>r.slice()); } }; },
    getRange(r,c,nr,nc){
      const s=this; nr=nr||1; nc=nc||1;
      return {
        getValues(){ const o=[]; for(let i=0;i<nr;i++){ const row=s.rows[r-1+i]||[]; o.push(row.slice(c-1,c-1+nc)); } return o; },
        getValue(){ return (s.rows[r-1]||[])[c-1]; },
        setValues(v){ for(let i=0;i<nr;i++){ while(s.rows.length<r-1+i+1) s.rows.push([]);
          for(let j=0;j<nc;j++) s.rows[r-1+i][c-1+j]=v[i][j]; } },
        setValue(v){ while(s.rows.length<r) s.rows.push([]); s.rows[r-1][c-1]=v; }
      };
    },
    appendRow(row){ this.rows.push(row.slice()); },
    deleteRow(pos){ this.rows.splice(pos-1, 1); },
    deleteRows(pos, n){ this.rows.splice(pos-1, n||1); }
  };
}
function makeCtx(sheets, net){
  const store = {};
  for (const k in sheets) store[k] = makeSheet(k, sheets[k].map(r=>r.slice()));
  const ss = { getSheetByName(n){ return store[n] || null; }, insertSheet(n){ store[n] = makeSheet(n, []); return store[n]; } };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet(){ return ss; }, flush(){} },
    PropertiesService: { getScriptProperties(){ return { getProperty(k){ return k === 'ADMIN_KEY' ? 'test-key' : null; }, setProperty(){} }; } },
    LockService: { getScriptLock(){ return { waitLock(){}, releaseLock(){} }; } },
    CacheService: { getScriptCache(){ const m={}; return { get(k){ return m[k]||null; }, getAll(){ return {}; }, put(k,v){ m[k]=v; }, remove(k){ delete m[k]; } }; } },
    /* sumo-api: a banzuke per basho id in net.banzuke; anything else is 404 */
    UrlFetchApp: { fetch(url){
      const m = String(url).match(/\/basho\/(\d+)\/banzuke\/(\w+)/);
      const b = m && (net.banzuke || {})[m[1]];
      if (!b || !b[m[2]]) return { getResponseCode(){ return 404; }, getContentText(){ return ''; } };
      const rows = b[m[2]].map(([shikonaEn, rank]) => ({ shikonaEn, rank }));
      return { getResponseCode(){ return 200; }, getContentText(){ return JSON.stringify({ east: rows, west: [] }); } };
    } },
    ContentService: { createTextOutput(){ return { setMimeType(){ return this; } }; }, MimeType:{ JSON:'json' } },
    Utilities: { formatDate(){ return ''; }, getUuid(){ return 'u' + Math.random().toString(36).slice(2); } },
    console, JSON, Math, Date, Number, String, Object, Array, isNaN, parseInt, parseFloat, RegExp,
    __store: store
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename:'sumo-fantasy.gs' });
  return ctx;
}

/* ---- the fixture: one keeper league, keep one Makuuchi man each ---- */
const LEAGUE_HEAD = ['id','name','commissioner','created','inviteCode','mode','rosterSize','draftStatus',
  'draftOrder','draftPickIdx','draftPhase','scoring','draftDate','draftAgree','benchSize','farmSize',
  'pickClock','pickDeadline','defaultOrder','keepMk','keepJr','draftPaused'];
const SCORING = JSON.stringify({ winPoint:1, sanyakuBonus:1, sansho:5, yusho:5 });
const MK = { sean:['Onosato','Ura'], ace:['Hoshoryu','Abi'], bob:['Kirishima','Oho'] };
const NEXT = { '202611': { Makuuchi: ['Onosato','Ura','Hoshoryu','Abi','Kirishima','Oho','Tobizaru'].map(n => [n, 'Maegashira 1 East']), Juryo: [['Kazuma','Juryo 1 East']] } };
function base(meta){
  const M = Object.assign({ basho:'Aki 2026', bashoId:'202609', lastDay:15, rankedBasho:'Aki 2026',
                            lastImport:'2026-09-28T00:00:00Z', lastImportAdded:0 }, meta || {});
  const ros = [['leagueId','handle','rikishi','division','acquiredVia','acquiredAt','slot']];
  for (const [h, names] of Object.entries(MK)) names.forEach(n => ros.push(['lgK', h, n, 'makuuchi', 'draft', '', 'active']));
  return {
    Results: [['day','division','east','west','winner','kimarite'],
      [1,'Makuuchi','Ura','Onosato','Ura','yorikiri'], [2,'Makuuchi','Ura','Abi','Ura','yorikiri'],
      [3,'Makuuchi','Oho','Kirishima','Oho','oshidashi']],
    Meta: [['key','value']].concat(Object.keys(M).map(k => [k, M[k]])),
    Users: [['handle','name','auth','team','updated','avatar','status','warnMsg'],
      ['sean','Sean','h1','{}','','','',''], ['ace','Ace','h1','{}','','','',''], ['bob','Bob','h1','{}','','','','']],
    Leagues: [LEAGUE_HEAD, ['lgK','Chanko','sean','2026-09-01','KKK','keepers',2,'complete','[]',0,'',SCORING,'','{}',0,0,'','','',1,0,'']],
    LeagueMembers: [['leagueId','handle','joined'], ['lgK','sean',''], ['lgK','ace',''], ['lgK','bob','']],
    LeagueTeams: [['leagueId','handle','team','updated']],
    KeeperRosters: ros,
    KeeperKeeps: [['leagueId','handle','rikishi','declaredAt']],
    Champions: [['id','basho','scope','leagueId','leagueName','handle','score','runnerUp','runnerUpScore','entrants','awardedAt']],
    TeamHistory: [['handle','basho','team','score','wins','rows','savedAt']],
    Messages: [['id','leagueId','handle','name','body','parentId','created']]
  };
}
const sean = (ctx, extra) => Object.assign({ handle:'sean', auth:'h1', id:'lgK' }, extra || {});
const inDays = d => new Date(Date.now() + d * 86400000).toISOString();
const L = ctx => ctx.leagueRow('lgK');
const setCell = (ctx, col, v) => { const r = ctx.__store.Leagues.rows.find(x => x[0] === 'lgK'); r[col - 1] = v; };
const setMeta = (ctx, k, v) => { const r = ctx.__store.Meta.rows.find(x => x[0] === k); if (r) r[1] = v; else ctx.__store.Meta.rows.push([k, v]); };
/* the admin page's "start a new basho": the real roll-over, which empties Results */
const rollOver = ctx => { const r = ctx.adminResetBasho({ adminKey:'test-key', basho:'Kyushu 2026' });
                          assert.ok(r.ok && r.bashoId === '202611', JSON.stringify(r)); };
const rosterCount = ctx => ctx.__store.KeeperRosters.rows.length - 1;

let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e){ fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

console.log('\nsetting it');
{
  const ctx = makeCtx(base(), { banzuke: NEXT });
  const when = inDays(2);
  const r = ctx.openKeeperWindow(sean(ctx, { deadline: when }));
  t('the commissioner opens declarations with a deadline', () => assert.ok(r.ok, JSON.stringify(r)));
  t('it is stored, as ISO, in a new keepDeadline column', () => {
    assert.strictEqual(L(ctx).keepDeadline, when);
    assert.strictEqual(ctx.__store.Leagues.rows[0][22], 'keepDeadline');
  });
  t('the declaration screen and the league page both see it', () => {
    assert.strictEqual(ctx.keeperState('lgK', 'ace').deadline, when);
    assert.strictEqual(ctx.leagueDetail('lgK', 'ace').league.keepDeadline, when);
  });
  t('only the commissioner can move it', () => {
    const r2 = ctx.setKeeperDeadline({ handle:'ace', auth:'h1', id:'lgK', deadline: inDays(3) });
    assert.ok(!r2.ok && /commissioner/i.test(r2.error), JSON.stringify(r2));
  });
  t('he can move it, or clear it back to closing by hand', () => {
    const moved = inDays(3);
    assert.ok(ctx.setKeeperDeadline(sean(ctx, { deadline: moved })).ok);
    assert.strictEqual(L(ctx).keepDeadline, moved);
    assert.ok(ctx.setKeeperDeadline(sean(ctx, { deadline: '' })).ok);
    assert.strictEqual(L(ctx).keepDeadline, '');
  });
}
{
  const ctx = makeCtx(base(), { banzuke: NEXT });
  t('a deadline in the past, months away, or not a date is refused', () => {
    for (const bad of [inDays(-1), inDays(60), 'next friday']) {
      const r = ctx.openKeeperWindow(sean(ctx, { deadline: bad }));
      assert.ok(!r.ok, bad + ' was accepted');
    }
    assert.strictEqual(L(ctx).draftStatus, 'complete', 'a refused open must not open');
  });
  t('opening without one still works: it then closes only by hand', () => {
    const r = ctx.openKeeperWindow(sean(ctx));
    assert.ok(r.ok && r.deadline === '', JSON.stringify(r));
  });
}

console.log('\nat the deadline');
{
  const ctx = makeCtx(base(), { banzuke: NEXT });
  ctx.openKeeperWindow(sean(ctx, { deadline: inDays(1) }));
  t('before it, a member declares as usual', () =>
    assert.ok(ctx.declareKeepers({ handle:'ace', auth:'h1', id:'lgK', keep:['Hoshoryu'] }).ok));
  setCell(ctx, 23, new Date(Date.now() - 60000).toISOString());     // the deadline has passed
  t('after it, declarations are refused', () => {
    const r = ctx.declareKeepers({ handle:'bob', auth:'h1', id:'lgK', keep:['Kirishima'] });
    assert.ok(!r.ok && r.closed, JSON.stringify(r));
  });
  t('and the screen says closed, and not ready while the old basho is still in Meta', () => {
    const s = ctx.keeperState('lgK', 'bob');
    assert.strictEqual(s.closed, true); assert.strictEqual(s.ready, false);
  });
  const before = rosterCount(ctx);
  ctx.refreshResults();
  t('the hourly import leaves it alone until the new basho is started', () => {
    assert.strictEqual(L(ctx).draftStatus, 'keepers');
    assert.strictEqual(rosterCount(ctx), before, 'nothing may be cut');
  });
  t('closing by hand is refused too, with nothing cut', () => {
    const r = ctx.closeKeeperWindow(sean(ctx));
    assert.ok(!r.ok && r.notReady, JSON.stringify(r));
    assert.strictEqual(rosterCount(ctx), before);
  });
  rollOver(ctx);
  t('after the roll-over the screen still shows the finished basho\u2019s wins, though Results is empty', () => {
    const mk = ctx.keeperState('lgK', 'sean').mine.makuuchi;
    assert.strictEqual(JSON.stringify(mk.map(x => x.name + ' ' + x.wins)), '["Ura 2","Onosato 0"]');
  });
  ctx.refreshResults();
  t('once the new basho is in, the import closes it and opens the re-draft', () =>
    assert.strictEqual(L(ctx).draftStatus, 'redraft'));
  t('the cuts follow the declarations; whoever never declared keeps his best by wins', () => {
    const own = h => ctx.__store.KeeperRosters.rows.filter(r => r[1] === h).map(r => r[2]);
    assert.deepStrictEqual(JSON.stringify(own('ace')), '["Hoshoryu"]');        // declared
    assert.deepStrictEqual(JSON.stringify(own('sean')), '["Ura"]');            // Ura won twice at Aki
  });
  t('the deadline is cleared and the close is logged in Meta', () => {
    assert.strictEqual(L(ctx).keepDeadline, '');
    assert.ok(ctx.__store.Meta.rows.some(r => r[0] === 'keepclosed:lgK'));
  });
}
{
  const ctx = makeCtx(base(), { banzuke: {} });                 // sumo-api has no Kyushu banzuke yet
  ctx.openKeeperWindow(sean(ctx, { deadline: inDays(1) }));
  setCell(ctx, 23, new Date(Date.now() - 60000).toISOString());
  rollOver(ctx);
  const before = rosterCount(ctx);
  ctx.refreshResults();
  t('a new basho with no readable banzuke is waited out, not half-closed', () => {
    assert.strictEqual(L(ctx).draftStatus, 'keepers');
    assert.strictEqual(rosterCount(ctx), before, 'nothing may be cut before the re-draft can open');
  });
}
{
  const ctx = makeCtx(base(), { banzuke: NEXT });
  ctx.openKeeperWindow(sean(ctx, { deadline: inDays(2) }));
  rollOver(ctx);
  ctx.refreshResults();
  t('a deadline still in the future is left alone', () => assert.strictEqual(L(ctx).draftStatus, 'keepers'));
  t('and the commissioner can still close early by hand once the new basho is in', () => {
    const r = ctx.closeKeeperWindow(sean(ctx));
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(L(ctx).draftStatus, 'redraft');
  });
}

console.log('\nreminding');
{
  const ctx = makeCtx(base(), { banzuke: NEXT });
  const when = inDays(1);
  ctx.openKeeperWindow(sean(ctx, { deadline: when }));
  const mine = h => ctx.myLeagues(h).leagues.find(l => l.id === 'lgK');
  t('the leagues list tells each member the deadline and whether he owes a declaration', () => {
    assert.strictEqual(mine('ace').keepDeadline, when);
    assert.strictEqual(mine('ace').keepDeclared, false);
  });
  ctx.declareKeepers({ handle:'ace', auth:'h1', id:'lgK', keep:['Hoshoryu'] });
  t('and stops once he has', () => {
    assert.strictEqual(mine('ace').keepDeclared, true);
    assert.strictEqual(mine('bob').keepDeclared, false);
  });
}

console.log('\nthe league without limits');
{
  const ctx = makeCtx(base(), { banzuke: NEXT });
  ctx.__store.Leagues.rows[1][19] = ''; ctx.__store.Leagues.rows[1][20] = '';      // no keeper limit
  t('its re-draft also waits for the new basho', () => {
    const r = ctx.openSupplementalDraft(sean(ctx));
    assert.ok(!r.ok && r.notReady, JSON.stringify(r));
  });
}

console.log('\ndraft day: while declarations are open, the draft date is when keepers lock');
{
  const ctx = makeCtx(base(), { banzuke: NEXT });
  setCell(ctx, 13, '2026-09-10T23:00:00.000Z'); setCell(ctx, 14, '{"sean":true,"ace":true}');   // the first draft's, long past
  ctx.openKeeperWindow(sean(ctx));
  t('opening declarations clears the first draft’s old date and its agreement', () => {
    const lg = ctx.leagueDetail('lgK', 'ace').league;
    assert.strictEqual(lg.draftDate, ''); assert.strictEqual(lg.draftAgreedCount, 0);
  });
  const when = inDays(4);
  const r = ctx.setDraftDate(sean(ctx, { draftDate: when }));
  t('setting the draft date sets the keeper deadline too', () => {
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(L(ctx).keepDeadline, when);
    assert.strictEqual(ctx.keeperState('lgK', 'ace').deadline, when);
  });
  t('members can still agree to it', () => {
    assert.ok(ctx.agreeDraftDate({ handle:'ace', auth:'h1', id:'lgK', agree:true }).ok);
    assert.strictEqual(ctx.leagueDetail('lgK', 'sean').league.draftAgreedCount, 2);
  });
  t('moving the keeper deadline moves the draft date with it, and asks everyone again', () => {
    const moved = inDays(5);
    assert.ok(ctx.setKeeperDeadline(sean(ctx, { deadline: moved })).ok);
    const lg = ctx.leagueDetail('lgK', 'sean').league;
    assert.strictEqual(lg.draftDate, moved);
    assert.strictEqual(lg.draftAgreedCount, 1);                      // the commissioner, who proposed it
  });
  t('a draft date too soon is refused, with nothing changed', () => {
    const before = L(ctx).keepDeadline;
    const r2 = ctx.setDraftDate(sean(ctx, { draftDate: new Date(Date.now() + 60000).toISOString() }));
    assert.ok(!r2.ok, JSON.stringify(r2));
    assert.strictEqual(L(ctx).keepDeadline, before);
    assert.strictEqual(ctx.leagueDetail('lgK', 'sean').league.draftDate, before);
  });
  t('clearing the draft date clears the deadline', () => {
    assert.ok(ctx.setDraftDate(sean(ctx, { draftDate: '' })).ok);
    assert.strictEqual(L(ctx).keepDeadline, '');
  });
}
{
  const ctx = makeCtx(base(), { banzuke: NEXT });
  const r = ctx.setDraftDate(sean(ctx, { draftDate: inDays(3) }));
  t('outside declarations the draft date is only a date: no keeper deadline', () => {
    assert.ok(r.ok, JSON.stringify(r));
    assert.strictEqual(L(ctx).keepDeadline || '', '');
  });
}

console.log('\nthe keeper clock (every few minutes, not just hourly)');
{
  const ctx = makeCtx(base(), { banzuke: NEXT });
  ctx.openKeeperWindow(sean(ctx, { deadline: inDays(1) }));
  rollOver(ctx);
  ctx.keeperClock();
  t('it leaves a window whose deadline is still ahead', () => assert.strictEqual(L(ctx).draftStatus, 'keepers'));
  setCell(ctx, 23, new Date(Date.now() - 60000).toISOString());
  ctx.keeperClock();
  t('and closes it once the deadline passes, without waiting for the hourly import', () =>
    assert.strictEqual(L(ctx).draftStatus, 'redraft'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
