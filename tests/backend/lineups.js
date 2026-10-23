/* The lineups that played.

   A keeper basho used to be scored off each team's lineup at the time of
   READING: the standings board, the title and the basho record all looked at
   the roster as it stood, and the lineup lock lifted the moment the first
   day-15 bout imported. So a lineup changed on the last afternoon, or set for
   the next basho, re-scored the one already fought. At Aki 2026 a league's
   winner changed weeks after both players had agreed who won.

   Now each lineup is written down while it is locked, and everything that
   scores the basho reads it from there. The regression at the heart of this
   file ("a lineup changed after the basho can't re-score it") goes only
   through functions that existed before the fix, so it fails on the old .gs
   for the right reason: the title moves. */
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

function makeCtx(sheets){
  const store = {};
  for (const k in sheets) store[k] = makeSheet(k, sheets[k].map(r=>r.slice()));
  const ss = {
    getSheetByName(n){ return store[n] || null; },
    insertSheet(n){ store[n] = makeSheet(n, []); return store[n]; }
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet(){ return ss; }, flush(){} },
    PropertiesService: { getScriptProperties(){ return {
      getProperty(k){ return k === 'ADMIN_KEY' ? 'test-key' : null; }, setProperty(){} }; } },
    LockService: { getScriptLock(){ return { waitLock(){}, releaseLock(){} }; } },
    CacheService: { getScriptCache(){ const m={};
      return { get(k){ return m[k]||null; }, getAll(){ return {}; }, put(k,v){ m[k]=v; }, remove(k){ delete m[k]; } }; } },
    UrlFetchApp: { fetch(){ throw new Error('offline in tests'); } },
    ContentService: { createTextOutput(){ return { setMimeType(){ return this; } }; }, MimeType:{ JSON:'json' } },
    Utilities: { formatDate(){ return ''; }, getUuid(){ return 'u' + Math.random().toString(36).slice(2); } },
    console, JSON, Math, Date, Number, String, Object, Array, isNaN, parseInt, parseFloat, RegExp,
    __store: store
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename:'sumo-fantasy.gs' });
  return ctx;
}

/* ---- the fixture ----
   One keeper league with a lineup of two. ace starts two Sekiwake and has a
   Juryo man marked active (farm: the board never counted him). bob starts a
   Yokozuna and a Maegashira who never wins, with a Komusubi on the bench who
   wins five. cid never set a lineup, so all three of his Makuuchi read as
   active, and the board takes the first two in roster order. dan joined but
   has no roster at all. */
const TIERS = { Onosato:'Y', Hoshoryu:'Y', Aonishiki:'O', Kirishima:'O', Fujinokawa:'S', Atamifuji:'S',
                Daieisho:'K', Hakunofuji:'K', Kazuma:'J' };
const HEAD = ['day','division','east','west','winner','kimarite'];
function results(){
  const R = [HEAD];
  R.push([1,'Makuuchi','Fujinokawa','Filler5','Fujinokawa','yorikiri']);
  R.push([1,'Makuuchi','Hoshoryu','Filler6','Hoshoryu','yorikiri']);
  R.push([1,'Makuuchi','Onosato','Filler7','Onosato','yorikiri']);
  R.push([2,'Makuuchi','Atamifuji','Filler8','Atamifuji','yorikiri']);
  R.push([3,'Makuuchi','Aonishiki','Filler10','Aonishiki','yorikiri']);
  for (let d = 3; d <= 7; d++) R.push([d,'Makuuchi','Hakunofuji','Filler'+(20+d),'Hakunofuji','oshidashi']);
  for (let d = 1; d <= 3; d++) R.push([d,'Juryo','Kazuma','Filler'+(30+d),'Kazuma','oshidashi']);
  return R;
}
const SCORING = JSON.stringify({ winPoint:1, sanyakuBonus:1, sansho:5, yusho:5 });
const LEAGUE_HEAD = ['id','name','commissioner','created','inviteCode','mode','rosterSize','draftStatus',
  'draftOrder','draftPickIdx','draftPhase','scoring','draftDate','draftAgree','benchSize','farmSize'];
const ROS_HEAD = ['leagueId','handle','rikishi','division','acquiredVia','acquiredAt','slot'];

function base(meta, extra){
  const M = Object.assign({ basho:'Kyushu 2026', bashoId:'202611', lastDay:3, rankedBasho:'Aki 2026',
                            lastImport:new Date().toISOString(), lastImportAdded:2 }, meta || {});
  return Object.assign({
    Results: results(),
    Meta: [['key','value']].concat(Object.keys(M).map(k => [k, M[k]])),
    Users:[['handle','name','auth','team','updated','avatar','status','warnMsg'],
      ['ace','Ace','h1','{}','','','',''], ['bob','Bob','h1','{}','','','',''], ['cid','Cid','h1','{}','','','',''], ['dan','Dan','h1','{}','','','','']],
    Leagues:[LEAGUE_HEAD,
      ['lgA','Stable Wars','ace','','AAA','keepers',2,'complete','[]',0,'',SCORING,'','{}',1,1],
      ['lgC','Old Guard','ace','','CCC','classic',7,'none','[]',0,'',SCORING,'','{}',0,0]],
    LeagueMembers:[['leagueId','handle','joined'],
      ['lgA','ace',''], ['lgA','bob',''], ['lgA','cid',''], ['lgA','dan',''], ['lgC','ace','']],
    LeagueTeams:[['leagueId','handle','team','updated']],
    KeeperRosters:[ROS_HEAD,
      ['lgA','ace','Fujinokawa','makuuchi','draft','','active'],
      ['lgA','ace','Atamifuji','makuuchi','draft','','active'],
      ['lgA','ace','Daieisho','makuuchi','draft','','bench'],
      ['lgA','ace','Kazuma','juryo','draft','','active'],
      ['lgA','bob','Hoshoryu','makuuchi','draft','','active'],
      ['lgA','bob','Filler1','makuuchi','draft','','active'],
      ['lgA','bob','Hakunofuji','makuuchi','draft','','bench'],
      ['lgA','cid','Onosato','makuuchi','draft','',''],
      ['lgA','cid','Kirishima','makuuchi','draft','',''],
      ['lgA','cid','Aonishiki','makuuchi','draft','','']],
    Champions:[['id','basho','scope','leagueId','leagueName','handle','score',
      'runnerUp','runnerUpScore','entrants','awardedAt']],
    TeamHistory:[['handle','basho','team','score','wins','rows','savedAt']],
    Messages:[['id','leagueId','handle','name','body','parentId','created']]
  }, extra || {});
}
function setMeta(ctx, k, v){
  const rows = ctx.__store.Meta.rows, r = rows.find(x => x[0] === k);
  if (r) r[1] = v; else rows.push([k, v]);
}
function finishBasho(ctx, stillArriving){
  setMeta(ctx, 'lastDay', 15);
  setMeta(ctx, 'lastImport', new Date().toISOString());
  setMeta(ctx, 'lastImportAdded', stillArriving ? 4 : 0);
}
const lineupRows = ctx => (ctx.__store.KeeperLineups ? ctx.__store.KeeperLineups.rows : []).slice(1);
const onRecord = (ctx, h) => {
  const r = lineupRows(ctx).find(x => String(x[2]) === h);
  return r ? { basho: String(r[1]), active: JSON.parse(r[3]), held: JSON.parse(r[4]), at: String(r[5]) } : null;
};
const scoreIn = (scopes, h) => (scopes.find(s => s.leagueId === 'lgA').res.winners.find(w => w.handle === h) || {}).score;
const bobSwaps = ctx => ctx.setActive({ handle:'bob', auth:'h1', id:'lgA', active:['Hoshoryu','Hakunofuji'] });

let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e){ fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message)); }
}

console.log('\nthe regression: a lineup changed after the basho');
{
  const ctx = makeCtx(base());
  ctx.refreshResults();                        // the hourly import, mid-basho
  finishBasho(ctx, false);
  const res = bobSwaps(ctx);
  t('the change itself is allowed once the basho is over', () => assert.ok(res && res.ok, JSON.stringify(res)));
  t('...and it can\'t re-score the basho: the title stays where the lineups put it', () => {
    const lg = ctx.championScopesFor_('Kyushu 2026', TIERS).find(s => s.leagueId === 'lgA');
    assert.strictEqual(JSON.stringify(lg.res.winners.map(w => w.handle)), '["ace"]',
      'winners ' + JSON.stringify(lg.res.winners) + ', runner-up ' + JSON.stringify(lg.res.runnerUp));
    assert.strictEqual(lg.res.top, 2);
  });
  t('the basho record agrees with the title', () => {
    ctx.snapshotKeeperBasho_('Kyushu 2026', TIERS, { apply:true });
    const rows = ctx.__store.KeeperHistory.rows.slice(1);
    const bob = rows.find(r => r[4] === 'bob'), ace = rows.find(r => r[4] === 'ace');
    assert.strictEqual(Number(bob[6]), 1, 'bob played Hoshoryu and Filler1');
    assert.strictEqual(Number(ace[5]), 1, 'ace placed first');
  });
  t('the league page hands the board the lineups on record, not the roster', () => {
    const d = ctx.leagueDetail('lgA', 'ace');
    assert.ok(d.played, 'no played lineups served');
    assert.strictEqual(d.played.basho, 'Kyushu 2026');
    assert.strictEqual(JSON.stringify(d.played.active.bob), '["Hoshoryu","Filler1"]');
    const bobNow = d.members.find(m => m.handle === 'bob').roster.active;
    assert.ok(bobNow.indexOf('Hakunofuji') >= 0, 'the roster itself did change: ' + JSON.stringify(bobNow));
  });
}

console.log('\nwhat goes on record, and when');
{
  const idle = makeCtx(base({}, { Results:[HEAD] }));
  t('between basho nothing goes on record, and no sheet is made', () => {
    assert.strictEqual(idle.recordLineupsLocked_(), 0);
    assert.strictEqual(idle.__store.KeeperLineups, undefined);
  });

  const ctx = makeCtx(base());
  ctx.refreshResults();
  t('the hourly import records every keeper team once the basho is under way', () => {
    assert.strictEqual(lineupRows(ctx).length, 3, JSON.stringify(lineupRows(ctx)));
    assert.ok(lineupRows(ctx).every(r => r[0] === 'lgA' && r[1] === 'Kyushu 2026'));
  });
  t('a classic league has no lineups to record', () =>
    assert.ok(!lineupRows(ctx).some(r => r[0] === 'lgC')));
  t('the record is the board\'s rule: Makuuchi men marked active, a Juryo man is farm', () => {
    const ace = onRecord(ctx, 'ace');
    assert.deepStrictEqual(ace.active, ['Fujinokawa','Atamifuji']);
    assert.ok(ace.held.indexOf('Kazuma') >= 0 && ace.held.indexOf('Daieisho') >= 0, JSON.stringify(ace.held));
  });
  t('a team that never set a lineup plays its first Makuuchi men, up to the lineup size', () => {
    const cid = onRecord(ctx, 'cid');
    assert.deepStrictEqual(cid.active, ['Onosato','Kirishima']);
    assert.deepStrictEqual(cid.held, ['Aonishiki']);
  });
  t('the title counts the same men: ace 2, not 5 with his Juryo man', () =>
    assert.strictEqual(scoreIn(ctx.championScopesFor_('Kyushu 2026', TIERS), 'ace'), 2));
  t('once on record it is never rewritten', () => {
    const before = JSON.stringify(lineupRows(ctx));
    ctx.refreshResults(); ctx.refreshResults();
    assert.strictEqual(JSON.stringify(lineupRows(ctx)), before);
  });

  const ranked = makeCtx(base({ rankedBasho:'Kyushu 2026' }));
  t('a basho already ranked is closed: nothing more goes on record', () => {
    assert.strictEqual(ranked.recordLineupsLocked_(), 0);
    assert.strictEqual(ranked.__store.KeeperLineups, undefined);
  });
}

console.log('\nthe lock');
{
  const ctx = makeCtx(base());
  ctx.refreshResults();
  t('during the basho a lineup can\'t change', () => {
    const r = bobSwaps(ctx);
    assert.ok(!r.ok && /locked/i.test(r.error), JSON.stringify(r));
  });
  finishBasho(ctx, true);
  t('on the last day it stays locked while results are still arriving', () => {
    const r = bobSwaps(ctx);
    assert.ok(!r.ok && /last day/i.test(r.error), JSON.stringify(r));
  });
  setMeta(ctx, 'lastImportAdded', 0);
  t('and opens once the import goes quiet', () => assert.ok(bobSwaps(ctx).ok));
}

console.log('\nbelt and braces: nothing on record yet when a roster changes');
{
  const ctx = makeCtx(base());
  finishBasho(ctx, false);                     // the import never recorded anything
  const r = bobSwaps(ctx);
  t('the change goes through', () => assert.ok(r.ok, JSON.stringify(r)));
  t('...after the lineup it replaced went on record', () =>
    assert.deepStrictEqual(onRecord(ctx, 'bob').active, ['Hoshoryu','Filler1']));
  t('so the title still counts what played', () =>
    assert.strictEqual(JSON.stringify(ctx.championScopesFor_('Kyushu 2026', TIERS)
      .find(s => s.leagueId === 'lgA').res.winners.map(w => w.handle)), '["ace"]'));
}

console.log('\nthe re-draft order is the standings, worst first');
{
  const ctx = makeCtx(base());
  ctx.refreshResults();
  finishBasho(ctx, false);
  bobSwaps(ctx);
  /* the old order was raw wins of each roster's active men: cid 2, ace 5 with
     his Juryo man, bob 6 with the man he swapped in after the basho */
  t('it scores the lineups that played under the league\'s points; no lineup picks first', () =>
    assert.strictEqual(JSON.stringify(ctx.keeperStandings('lgA')), '["dan","bob","cid","ace"]'));
  ctx.snapshotKeeperBasho_('Kyushu 2026', TIERS, { apply:true });
  setMeta(ctx, 'rankedBasho', 'Kyushu 2026');
  ctx.__store.KeeperRosters.rows = ctx.__store.KeeperRosters.rows.filter(r => r[2] !== 'Fujinokawa');  // a keeper cut
  ctx.__store.Results.rows = [HEAD];                                                                   // the roll-over
  setMeta(ctx, 'basho', 'Hatsu 2027');
  t('after the cuts and the roll-over it reads the finished basho\'s stored record', () =>
    assert.strictEqual(JSON.stringify(ctx.keeperStandings('lgA')), '["dan","bob","cid","ace"]'));
}

console.log('\nreads stay reads');
{
  const ctx = makeCtx(base());
  const d = ctx.leagueDetail('lgA', 'ace');
  t('before anything is on record the board gets null and falls back to the roster', () =>
    assert.strictEqual(d.played, null));
  t('loading the league page never creates the sheet', () =>
    assert.strictEqual(ctx.__store.KeeperLineups, undefined));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
