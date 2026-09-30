/* The stale tier map, and putting a wrong crown right.

   Aki 2026 was crowned against NAGOYA's banzuke. admin.html posted
   gg-account.js's hand-maintained RANKS table, which had not been rolled to
   the new basho; tierMapFor_ preferred a posted map over everything and then
   cached it under 'tiers:Aki 2026' as if it were authoritative. Every sanyaku
   upset bonus in the tournament was computed against the wrong ranks — 39
   rikishi affected, 135 bonus points handed out where 74 were due — and
   nothing errored, because a plausible map is indistinguishable from a
   correct one.

   So the thing under test is an ORDER OF TRUST, not a calculation: the real
   banzuke must beat a posted map, and must beat a cache that was poisoned by
   one. The fixture makes that visible by crowning two different people from
   the same bouts depending on which map is used.

   Second half: recrownBasho_, which exists because awardChampions_ is
   deliberately once-only. It defaults to writing nothing. */
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
        setValues(v){ for(let i=0;i<nr;i++){ while(s.rows.length<r-1+i+1) s.rows.push([]);
          for(let j=0;j<nc;j++) s.rows[r-1+i][c-1+j]=v[i][j]; } },
        setValue(v){ while(s.rows.length<r) s.rows.push([]); s.rows[r-1][c-1]=v; }
      };
    },
    appendRow(row){ this.rows.push(row.slice()); },
    /* the real one splices; the old stub was a no-op, which would have let a
       broken re-crown look like a clean one */
    deleteRow(pos){ this.rows.splice(pos-1, 1); },
    deleteRows(pos, n){ this.rows.splice(pos-1, n||1); },
    insertSheet(){}
  };
}

function makeCtx(sheets, opts){
  opts = opts || {};
  const store = {};
  for (const k in sheets) store[k] = makeSheet(k, sheets[k].map(r=>r.slice()));
  const ss = {
    getSheetByName(n){ return store[n] || null; },
    insertSheet(n){ store[n] = makeSheet(n, []); return store[n]; }
  };
  const fetched = [];
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet(){ return ss; } },
    PropertiesService: { getScriptProperties(){ return { getProperty(){ return 'test-key'; } }; } },
    LockService: { getScriptLock(){ return { waitLock(){}, releaseLock(){} }; } },
    CacheService: { getScriptCache(){ const m = {};
      return { get(k){ return m[k] || null; }, getAll(){ return {}; },
               put(k,v){ m[k] = v; }, remove(k){ delete m[k]; } }; } },
    UrlFetchApp: { fetch(url){
      fetched.push(url);
      if (opts.deadApi) throw new Error('no net');
      const m = String(url).match(/\/basho\/(\d+)\/banzuke\/(\w+)/);
      if (!m) throw new Error('unexpected fetch ' + url);
      const board = (opts.banzuke || {})[m[1]];
      if (!board) return { getResponseCode(){ return 404; }, getContentText(){ return ''; } };
      const rows = (board[m[2]] || []).map(([shikonaEn, rank]) => ({ shikonaEn, rank }));
      return { getResponseCode(){ return 200; },
               getContentText(){ return JSON.stringify({ east: rows, west: [] }); } };
    } },
    ContentService: { createTextOutput(){ return { setMimeType(){ return this; } }; }, MimeType:{ JSON:'json' } },
    Utilities: { formatDate(){ return ''; } },
    console, JSON, Math, Date, Number, String, Object, Array, isNaN, parseInt, parseFloat, RegExp,
    __store: store, __fetched: fetched
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename:'sumo-fantasy.gs' });
  return ctx;
}

/* ---- the fixture ----
   Fujinokawa is the man the two maps disagree about, exactly as in the real
   Aki data: Sekiwake on the Aki banzuke, Maegashira on Nagoya's. He beats two
   Yokozuna, so the map decides whether those are worth 4 apiece or 2. */
const AKI_BOARD = {
  Makuuchi: [['Onosato','Yokozuna 1 East'], ['Hoshoryu','Yokozuna 1 West'],
             ['Aonishiki','Ozeki 2 East'],  ['Kirishima','Ozeki 1 West'],
             ['Fujinokawa','Sekiwake 1 East'], ['Atamifuji','Sekiwake 1 West'],
             ['Daieisho','Komusubi 1 East'], ['Hakunofuji','Komusubi 1 West']],
  Juryo: []
};
for (let i = 1; i <= 34; i++) AKI_BOARD.Makuuchi.push(['Filler' + i, 'Maegashira ' + i + ' East']);

const NAGOYA_TIERS = { Onosato:'Y', Hoshoryu:'Y', Aonishiki:'S', Kirishima:'O',
                       Fujinokawa:'M', Atamifuji:'S', Daieisho:'M', Hakunofuji:'M' };
for (let i = 1; i <= 34; i++) NAGOYA_TIERS['Filler' + i] = 'M';

function results(){
  return [['day','division','east','west','winner','kimarite'],
    [1,'Makuuchi','Onosato','Fujinokawa','Fujinokawa','yorikiri'],
    [2,'Makuuchi','Hoshoryu','Fujinokawa','Fujinokawa','oshidashi'],
    [3,'Makuuchi','Onosato','Filler1','Onosato','yorikiri'],
    [4,'Makuuchi','Atamifuji','Filler2','Atamifuji','yorikiri'],
    [5,'Makuuchi','Atamifuji','Filler3','Atamifuji','oshidashi'],
    [6,'Makuuchi','Atamifuji','Filler4','Atamifuji','yorikiri'],
    [7,'Makuuchi','Atamifuji','Filler5','Atamifuji','yorikiri'],
    [8,'Makuuchi','Atamifuji','Filler6','Atamifuji','yorikiri'],
    [9,'Makuuchi','Atamifuji','Filler7','Atamifuji','oshidashi'],
    [10,'Makuuchi','Atamifuji','Filler8','Atamifuji','yorikiri']];
}
const META = [['key','value'],['basho','Aki 2026'],['lastDay',15],['yusho',''],['sansho','']];
const HIST_HEAD = ['handle','basho','team','score','wins','rows','savedAt'];
const CHAMP_HEAD = ['id','basho','scope','leagueId','leagueName','handle','score',
  'runnerUp','runnerUpScore','entrants','awardedAt'];
const LEAGUE_HEAD = ['id','name','commissioner','created','inviteCode','mode','rosterSize','draftStatus',
  'draftOrder','draftPickIdx','draftPhase','scoring','draftDate','draftAgree','benchSize','farmSize'];
const SCORING = JSON.stringify({ winPoint:1, sanyakuBonus:1, sansho:0, yusho:0 });

/* punto owns Fujinokawa, cafe owns Atamifuji.
     stale (Nagoya): Fujinokawa is M, so beating two Yokozuna pays 4+4=8 -> 2 wins + 8 = 10
     real  (Aki):    Fujinokawa is S, so the same two bouts pay 2+2=4 -> 2 wins + 4 = 6
     cafe: Atamifuji, 7 wins over Maegashira, no bonus either way            -> 7
   So the stale map crowns punto 10-7 and the real banzuke crowns cafe 7-6 —
   the bogus bonus is the whole margin, in both directions. */
function leagueSheets(){
  return {
    Leagues: [LEAGUE_HEAD,
      ['lgK','Chanko Test','punto','','ABC','keepers',1,'complete','[]',0,'',SCORING,'','{}',0,0]],
    LeagueMembers: [['leagueId','handle','joined'], ['lgK','punto',''], ['lgK','cafe','']],
    LeagueTeams: [['leagueId','handle','team','updated']],
    KeeperRosters: [['leagueId','handle','rikishi','division','acquiredVia','acquiredAt','slot'],
      ['lgK','punto','Fujinokawa','makuuchi','draft','','active'],
      ['lgK','cafe','Atamifuji','makuuchi','draft','','active']]
  };
}
function base(extra){
  return Object.assign({ Results:results(), Meta:META.map(r=>r.slice()),
    TeamHistory:[HIST_HEAD], Champions:[CHAMP_HEAD],
    Users:[['handle','name','auth','team','updated','avatar','status','warnMsg']] },
    leagueSheets(), extra || {});
}

let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e){ fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('\nthe fixture really does turn on the map');
{
  const ctx = makeCtx(base(), { banzuke:{ '202609': AKI_BOARD } });
  const real = ctx.tierMapFor_('Aki 2026', null);
  const mReal = ctx.serverScoreModel_(ctx.parseScoring(SCORING), real);
  const mStale = ctx.serverScoreModel_(ctx.parseScoring(SCORING), NAGOYA_TIERS);
  t('Fujinokawa is Sekiwake on the real banzuke, Maegashira on the stale map', () => {
    assert.strictEqual(real['Fujinokawa'], 'S');
    assert.strictEqual(NAGOYA_TIERS['Fujinokawa'], 'M');
  });
  t('so the same two bouts are worth 8 under the stale map and 4 under the real one', () => {
    assert.strictEqual(mStale.bonus['Fujinokawa'], 8);
    assert.strictEqual(mReal.bonus['Fujinokawa'], 4);
  });
  t('which is the difference between winning the league and losing it', () => {
    assert.strictEqual(ctx.serverTeamScore_(['Fujinokawa'], mStale), 10);
    assert.strictEqual(ctx.serverTeamScore_(['Fujinokawa'], mReal), 6);
    assert.strictEqual(ctx.serverTeamScore_(['Atamifuji'], mReal), 7);
  });
}

console.log('\ntierMapFor_ — the order of trust');
{
  t('the real banzuke beats a posted map', () => {
    const ctx = makeCtx(base(), { banzuke:{ '202609': AKI_BOARD } });
    const map = ctx.tierMapFor_('Aki 2026', NAGOYA_TIERS);
    assert.strictEqual(map['Fujinokawa'], 'S', 'posted map won');
    assert.strictEqual(map['Aonishiki'], 'O');
  });
  t('and beats a cache that a posted map poisoned earlier', () => {
    const ctx = makeCtx(base({ Meta: META.concat([['tiers:Aki 2026', JSON.stringify(NAGOYA_TIERS)]]) }),
      { banzuke:{ '202609': AKI_BOARD } });
    const map = ctx.tierMapFor_('Aki 2026', null);
    assert.strictEqual(map['Fujinokawa'], 'S', 'poisoned cache won');
  });
  t('the good map is cached, so the next pass agrees with this one', () => {
    const ctx = makeCtx(base(), { banzuke:{ '202609': AKI_BOARD } });
    ctx.tierMapFor_('Aki 2026', null);
    const cached = JSON.parse(ctx.readMeta()['tiers:Aki 2026'] || '{}');
    assert.strictEqual(cached['Fujinokawa'], 'S');
  });
  t('it asks for the basho it was given, not whatever is current', () => {
    const ctx = makeCtx(base(), { banzuke:{ '202609': AKI_BOARD } });
    ctx.tierMapFor_('Aki 2026', null);
    assert.ok(ctx.__fetched.every(u => u.indexOf('/basho/202609/') >= 0),
      'fetched ' + JSON.stringify(ctx.__fetched));
  });
  t('with sumo-api unreachable it falls back to a posted map rather than nothing', () => {
    const ctx = makeCtx(base(), { deadApi:true });
    const map = ctx.tierMapFor_('Aki 2026', NAGOYA_TIERS);
    assert.strictEqual(map['Fujinokawa'], 'M');
  });
  t('a basho label it cannot parse does not send it fetching nonsense', () => {
    const ctx = makeCtx(base(), { banzuke:{ '202609': AKI_BOARD } });
    ctx.tierMapFor_('Some Other Thing', NAGOYA_TIERS);
    assert.strictEqual(ctx.__fetched.length, 0, JSON.stringify(ctx.__fetched));
  });
}

console.log('\nhasSanyaku_ — a short answer is worse than none');
{
  const ctx = makeCtx(base(), { banzuke:{ '202609': AKI_BOARD } });
  const big = {}; for (let i=0;i<50;i++) big['M'+i] = 'M';
  t('a map of nothing but Maegashira is refused', () => assert.strictEqual(ctx.hasSanyaku_(big), false));
  t('a handful of names is refused even with sanyaku in it', () =>
    assert.strictEqual(ctx.hasSanyaku_({ a:'Y', b:'O', c:'S', d:'K' }), false));
  t('a full banzuke is accepted', () => {
    assert.strictEqual(ctx.hasSanyaku_(ctx.tierMapFor_('Aki 2026', null)), true);
  });
  t('an empty map is refused', () => assert.strictEqual(ctx.hasSanyaku_({}), false));
}

console.log('\nthe bug, end to end');
{
  /* crowned the old way: a posted stale map wins and cafe loses a title he won */
  const bad = makeCtx(base(), { deadApi:true });
  bad.awardChampions_('Aki 2026', bad.tierMapFor_('Aki 2026', NAGOYA_TIERS));
  const badRow = bad.__store.Champions.rows.find(r => r[3] === 'lgK');
  t('against the stale map the wrong manager is crowned', () => {
    assert.ok(badRow, 'no league title awarded');
    assert.strictEqual(badRow[5], 'punto');
    assert.strictEqual(badRow[6], 10);
  });

  /* crowned with the banzuke available: the right one */
  const good = makeCtx(base(), { banzuke:{ '202609': AKI_BOARD } });
  good.awardChampions_('Aki 2026', good.tierMapFor_('Aki 2026', NAGOYA_TIERS));
  const goodRow = good.__store.Champions.rows.find(r => r[3] === 'lgK');
  t('with the banzuke reachable the right manager is crowned, even if a stale map is posted', () => {
    assert.strictEqual(goodRow[5], 'cafe');
    assert.strictEqual(goodRow[6], 7);
    assert.strictEqual(goodRow[7], 'punto');
    assert.strictEqual(goodRow[8], 6);
  });
}

console.log('\nrecrownBasho_ — putting it right');
{
  function wrongly(){
    const ctx = makeCtx(base(), { banzuke:{ '202609': AKI_BOARD }, deadApi:false });
    /* mint the bad trophies the way they were really minted: no banzuke, stale
       map posted, cached as authoritative */
    const sick = makeCtx(base(), { deadApi:true });
    sick.awardChampions_('Aki 2026', sick.tierMapFor_('Aki 2026', NAGOYA_TIERS));
    /* then carry those rows into a context that CAN see the banzuke */
    const rows = sick.__store.Champions.rows.map(r => r.slice());
    return makeCtx(base({ Champions: rows,
      Meta: META.concat([['tiers:Aki 2026', JSON.stringify(NAGOYA_TIERS)]]) }),
      { banzuke:{ '202609': AKI_BOARD } });
  }

  {
    const ctx = wrongly();
    const before = JSON.stringify(ctx.__store.Champions.rows);
    const dry = ctx.recrownBasho_({ basho:'Aki 2026' });
    t('a dry run writes nothing at all', () =>
      assert.strictEqual(JSON.stringify(ctx.__store.Champions.rows), before));
    t('and says so', () => assert.strictEqual(dry.dryRun, true));
    t('it reports the title moving, and to whom', () => {
      const c = dry.changes.find(x => x.leagueId === 'lgK');
      assert.ok(c, 'no lgK in ' + JSON.stringify(dry.changes));
      assert.strictEqual(c.titleMoves, true);
      assert.strictEqual(JSON.stringify(c.wasHandles), '["punto"]');
      assert.strictEqual(JSON.stringify(c.nowHandles), '["cafe"]');
      assert.strictEqual(c.wasScore, 10);
      assert.strictEqual(c.nowScore, 7);
    });
    t('and counts what would move', () => assert.strictEqual(dry.titlesMoving, 1));
  }

  {
    const ctx = wrongly();
    const res = ctx.recrownBasho_({ basho:'Aki 2026', apply:true });
    const rows = ctx.__store.Champions.rows.slice(1);
    t('applying replaces the row rather than adding a second', () => {
      const forLeague = rows.filter(r => r[1] === 'Aki 2026' && r[3] === 'lgK');
      assert.strictEqual(forLeague.length, 1, JSON.stringify(forLeague));
      assert.strictEqual(forLeague[0][5], 'cafe');
    });
    t('the old trophy is gone, not merely outranked', () =>
      assert.ok(!rows.some(r => r[1] === 'Aki 2026' && r[5] === 'punto' && r[2] === 'league')));
    t('it says what it removed and what it wrote', () => {
      assert.strictEqual(res.dryRun, false);
      assert.ok(res.removed >= 1 && res.awarded >= 1, JSON.stringify(res));
    });
    t('and the trophy case now names the right man', () => {
      const reign = ctx.reigningChampion_('lgK');
      assert.strictEqual(JSON.stringify(reign.handles), '["cafe"]');
      assert.strictEqual(reign.score, 7);
    });
    t('the loser holds no title at all now', () =>
      assert.strictEqual(ctx.championsOf_('punto').length, 0));
  }

  {
    const ctx = wrongly();
    ctx.recrownBasho_({ basho:'Aki 2026', apply:true });
    const after = JSON.stringify(ctx.__store.Champions.rows);
    ctx.recrownBasho_({ basho:'Aki 2026', apply:true });
    t('re-running it is a no-op, not a second set of trophies', () => {
      const rows = ctx.__store.Champions.rows.slice(1).filter(r => r[1]==='Aki 2026' && r[3]==='lgK');
      assert.strictEqual(rows.length, 1);
    });
  }

  t('another basho is left alone', () => {
    const ctx = wrongly();
    ctx.__store.Champions.rows.push(
      ['old','Natsu 2026','league','lgK','Chanko Test','punto',99,'cafe',1,2,'2026-05-30T00:00:00Z']);
    ctx.recrownBasho_({ basho:'Aki 2026', apply:true });
    const natsu = ctx.__store.Champions.rows.filter(r => r[1] === 'Natsu 2026');
    assert.strictEqual(natsu.length, 1);
    assert.strictEqual(natsu[0][5], 'punto');
  });

  t('it refuses to re-crown when it cannot see a banzuke', () => {
    const sick = makeCtx(base(), { deadApi:true });
    sick.awardChampions_('Aki 2026', sick.tierMapFor_('Aki 2026', NAGOYA_TIERS));
    const ctx = makeCtx(base({ Champions: sick.__store.Champions.rows.map(r=>r.slice()) }), { deadApi:true });
    const r = ctx.recrownBasho_({ basho:'Aki 2026' });
    assert.strictEqual(r.ok, false);
    assert.ok(/banzuke/i.test(r.error), r.error);
  });
}

console.log('\nthe door is locked');
{
  const ctx = makeCtx(base(), { banzuke:{ '202609': AKI_BOARD } });
  t('adminRecrown refuses a wrong key', () => {
    const r = ctx.adminRecrown({ adminKey:'nope', basho:'Aki 2026' });
    assert.strictEqual(r.ok, false);
    assert.ok(/auth/i.test(r.error || ''), JSON.stringify(r));
  });
  t('and does not write on a refusal', () =>
    assert.strictEqual(ctx.__store.Champions.rows.length, 1));
  t('the right key with no apply is still only a dry run', () => {
    const r = ctx.adminRecrown({ adminKey:'test-key', basho:'Aki 2026' });
    assert.strictEqual(r.dryRun, true);
    assert.strictEqual(ctx.__store.Champions.rows.length, 1);
  });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
