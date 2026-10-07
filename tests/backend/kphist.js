/* The keeper-league basho record.

   A keeper league's tournament used to leave no trace: TeamHistory stores only
   the public seven-band team, and "Start a new basho" clears the Results rows a
   keeper score is computed from. So the standings board went to zeroes the
   moment the next tournament opened, and the basho that had just been fought
   became unreadable.

   The thing under test is therefore not a calculation but a RECORD: the rows
   must say what the standings board said on the last day, they must keep saying
   it after Results is emptied, and they must agree with the trophy that was
   minted beside them — a snapshot that disagreed with its own league's champion
   would be worse than no snapshot at all. */
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
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet(){ return ss; } },
    PropertiesService: { getScriptProperties(){ return { getProperty(){ return 'test-key'; } }; } },
    LockService: { getScriptLock(){ return { waitLock(){}, releaseLock(){} }; } },
    CacheService: { getScriptCache(){ const m={};
      return { get(k){ return m[k]||null; }, getAll(){ return {}; }, put(k,v){ m[k]=v; }, remove(k){ delete m[k]; } }; } },
    UrlFetchApp: { fetch(url){
      if (opts.deadApi) throw new Error('no net');
      const m = String(url).match(/\/basho\/(\d+)\/banzuke\/(\w+)/);
      if (!m) throw new Error('unexpected fetch ' + url);
      const board = (opts.banzuke || {})[m[1]];
      if (!board) return { getResponseCode(){ return 404; }, getContentText(){ return ''; } };
      const rows = (board[m[2]] || []).map(([shikonaEn, rank]) => ({ shikonaEn, rank }));
      return { getResponseCode(){ return 200; }, getContentText(){ return JSON.stringify({ east: rows, west: [] }); } };
    } },
    ContentService: { createTextOutput(){ return { setMimeType(){ return this; } }; }, MimeType:{ JSON:'json' } },
    Utilities: { formatDate(){ return ''; } },
    console, JSON, Math, Date, Number, String, Object, Array, isNaN, parseInt, parseFloat, RegExp,
    __store: store
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename:'sumo-fantasy.gs' });
  return ctx;
}

/* ---- the fixture ----
   Two keepers leagues and one classic one, so the classic league can be shown
   to stay out of the record. In lgA: ace starts a Sekiwake who beats two
   Yokozuna (bonus + a sanshō), bob starts plain Maegashira who simply win more
   bouts, and cid owns wrestlers but never set a lineup. */
const BOARD = {
  Makuuchi: [['Onosato','Yokozuna 1 East'], ['Hoshoryu','Yokozuna 1 West'],
             ['Aonishiki','Ozeki 2 East'],  ['Kirishima','Ozeki 1 West'],
             ['Fujinokawa','Sekiwake 1 East'], ['Atamifuji','Sekiwake 1 West'],
             ['Daieisho','Komusubi 1 East'], ['Hakunofuji','Komusubi 1 West']],
  Juryo: [['Kazuma','Juryo 1 East']]
};
for (let i = 1; i <= 34; i++) BOARD.Makuuchi.push(['Filler' + i, 'Maegashira ' + i + ' East']);

function results(){
  const R = [['day','division','east','west','winner','kimarite']];
  R.push([1,'Makuuchi','Onosato','Fujinokawa','Fujinokawa','yorikiri']);
  R.push([2,'Makuuchi','Hoshoryu','Fujinokawa','Fujinokawa','oshidashi']);
  for (let i = 1; i <= 7; i++) R.push([2+i,'Makuuchi','Atamifuji','Filler'+i,'Atamifuji','yorikiri']);
  for (let i = 8; i <= 12; i++) R.push([2+i,'Makuuchi','Filler'+i,'Kazuma','Filler'+i,'oshidashi']);
  R.push([15,'Juryo','Kazuma','Filler20','Kazuma','yorikiri']);
  return R;
}
const META = [['key','value'],['basho','Aki 2026'],['bashoId','202609'],['lastDay',15],
              ['yusho','Onosato'],['sansho','Fujinokawa']];
const SCORING = JSON.stringify({ winPoint:1, sanyakuBonus:1, sansho:5, yusho:5 });
const LEAGUE_HEAD = ['id','name','commissioner','created','inviteCode','mode','rosterSize','draftStatus',
  'draftOrder','draftPickIdx','draftPhase','scoring','draftDate','draftAgree','benchSize','farmSize'];
const ROS_HEAD = ['leagueId','handle','rikishi','division','acquiredVia','acquiredAt','slot'];
const HIST_HEAD = ['handle','basho','team','score','wins','rows','savedAt'];
const CHAMP_HEAD = ['id','basho','scope','leagueId','leagueName','handle','score',
  'runnerUp','runnerUpScore','entrants','awardedAt'];

function base(extra){
  return Object.assign({
    Results: results(), Meta: META.map(r=>r.slice()),
    TeamHistory:[HIST_HEAD], Champions:[CHAMP_HEAD],
    Users:[['handle','name','auth','team','updated','avatar','status','warnMsg']],
    Leagues:[LEAGUE_HEAD,
      ['lgA','Stable Wars','ace','','AAA','keepers',2,'complete','[]',0,'',SCORING,'','{}',2,0],
      ['lgB','Quiet League','dot','','BBB','keepers',2,'complete','[]',0,'',SCORING,'','{}',0,0],
      ['lgC','Old Guard','eve','','CCC','classic',7,'none','[]',0,'',SCORING,'','{}',0,0]],
    LeagueMembers:[['leagueId','handle','joined'],
      ['lgA','ace',''], ['lgA','bob',''], ['lgA','cid',''],
      ['lgB','dot',''], ['lgB','eve',''],
      ['lgC','eve','']],
    LeagueTeams:[['leagueId','handle','team','updated']],
    KeeperRosters:[ROS_HEAD,
      ['lgA','ace','Fujinokawa','makuuchi','draft','','active'],
      ['lgA','ace','Kazuma','juryo','draft','','active'],
      ['lgA','ace','Daieisho','makuuchi','draft','','bench'],
      ['lgA','bob','Atamifuji','makuuchi','draft','','active'],
      ['lgA','bob','Filler1','makuuchi','draft','','active'],
      ['lgA','bob','Hakunofuji','makuuchi','draft','','bench'],
      ['lgA','cid','Onosato','makuuchi','draft','','bench'],
      ['lgB','dot','Filler8','makuuchi','draft','','active'],
      ['lgB','eve','Filler9','makuuchi','draft','','active']]
  }, extra || {});
}
const OPT = { banzuke:{ '202609': BOARD } };

let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e){ fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function rowsOf(ctx){ return (ctx.__store.KeeperHistory ? ctx.__store.KeeperHistory.rows : []).slice(1); }
function find(ctx, lg, h){
  return rowsOf(ctx).find(r => String(r[2]) === lg && String(r[4]) === h);
}

console.log('\nwhat gets written down');
{
  const ctx = makeCtx(base(), OPT);
  const res = ctx.snapshotKeeperBasho_('Aki 2026', ctx.tierMapFor_('Aki 2026', null), { apply:true });

  t('a row per member who set a lineup', () => {
    assert.strictEqual(res.written, 4, JSON.stringify(res));   // ace, bob, dot, eve
    assert.strictEqual(rowsOf(ctx).length, 4);
  });
  t('a member who never set one is left out entirely', () =>
    assert.strictEqual(find(ctx, 'lgA', 'cid'), undefined));
  t('a classic league is not in the record at all', () =>
    assert.ok(!rowsOf(ctx).some(r => String(r[2]) === 'lgC')));

  t('the league name travels with the row, so a rename cannot orphan it', () => {
    assert.strictEqual(String(find(ctx, 'lgA', 'ace')[3]), 'Stable Wars');
  });

  /* ace: Fujinokawa 2 wins over Yokozuna at S = 2 steps each = 4 bonus, +5 sanshō;
     Kazuma 1 win. 3 wins + 4 + 5 = 12. */
  t('the score is wins, upset bonus and the extras, itemised', () => {
    const r = find(ctx, 'lgA', 'ace');
    assert.strictEqual(Number(r[6]), 12, 'score');
    assert.strictEqual(Number(r[7]), 3,  'raw wins');
    assert.strictEqual(Number(r[8]), 4,  'bonus');
    assert.strictEqual(Number(r[9]), 5,  'extras');
  });
  t('raw wins are bouts won, not win POINTS', () => {
    /* the two must not be conflated: with winPoint 1 they agree, and that is
       exactly how a bug here would hide */
    const r = find(ctx, 'lgA', 'ace');
    const rows = JSON.parse(r[11]);
    assert.strictEqual(rows.reduce((s,x)=>s+x.wins, 0), 3);
  });
  t('every active man is a row, with his tier as he was ranked THAT basho', () => {
    const rows = JSON.parse(find(ctx, 'lgA', 'ace')[11]);
    const byName = {}; rows.forEach(x => byName[x.name] = x);
    assert.strictEqual(rows.length, 2, JSON.stringify(rows.map(x=>x.name)));
    assert.strictEqual(byName.Fujinokawa.tier, 'S');
    assert.strictEqual(byName.Fujinokawa.bonus, 4);
    assert.strictEqual(byName.Fujinokawa.sansho, true);
    assert.strictEqual(byName.Kazuma.tier, 'J');
  });
  t('the bench is kept too, as what it would have scored', () => {
    const r = find(ctx, 'lgA', 'bob');
    const bench = JSON.parse(r[12]);
    assert.strictEqual(bench.length, 1);
    assert.strictEqual(bench[0].name, 'Hakunofuji');
    assert.strictEqual(Number(r[13]), bench.reduce((s,x)=>s+x.pts,0));
  });
  t('bench points are NOT in the score', () => {
    const r = find(ctx, 'lgA', 'bob');
    assert.strictEqual(Number(r[6]), 7);        // Atamifuji 7 wins, Filler1 0
  });

  t('placings are the standings order, and entrants counts the league', () => {
    const ace = find(ctx, 'lgA', 'ace'), bob = find(ctx, 'lgA', 'bob');
    assert.strictEqual(Number(ace[5]), 1, 'ace 12 should lead');
    assert.strictEqual(Number(bob[5]), 2);
    assert.strictEqual(Number(ace[10]), 2, 'two entrants, cid set no lineup');
  });
  t('a tie is broken by handle, not by sheet order', () => {
    const dot = find(ctx, 'lgB', 'dot'), eve = find(ctx, 'lgB', 'eve');
    assert.strictEqual(Number(dot[6]), Number(eve[6]));
    assert.strictEqual(Number(dot[5]), 1);
    assert.strictEqual(Number(eve[5]), 2);
  });
}

console.log('\nit agrees with the trophy minted beside it');
{
  const ctx = makeCtx(base(), OPT);
  const tiers = ctx.tierMapFor_('Aki 2026', null);
  ctx.awardChampions_('Aki 2026', tiers);
  ctx.snapshotKeeperBasho_('Aki 2026', tiers, { apply:true });
  t('the champion of a keepers league is its top row, at the same score', () => {
    const champ = ctx.__store.Champions.rows.slice(1).find(r => String(r[3]) === 'lgA');
    const top = rowsOf(ctx).filter(r => String(r[2]) === 'lgA').find(r => Number(r[5]) === 1);
    assert.ok(champ, 'no champion for lgA');
    assert.strictEqual(String(top[4]), String(champ[5]));
    assert.strictEqual(Number(top[6]), Number(champ[6]));
  });
  t('and the runner-up matches too', () => {
    const champ = ctx.__store.Champions.rows.slice(1).find(r => String(r[3]) === 'lgA');
    const second = rowsOf(ctx).filter(r => String(r[2]) === 'lgA').find(r => Number(r[5]) === 2);
    assert.strictEqual(String(second[4]), String(champ[7]));
    assert.strictEqual(Number(second[6]), Number(champ[8]));
  });
}

console.log('\nwriting it more than once');
{
  const ctx = makeCtx(base(), OPT);
  const tiers = ctx.tierMapFor_('Aki 2026', null);
  ctx.snapshotKeeperBasho_('Aki 2026', tiers, { apply:true });
  const before = JSON.stringify(rowsOf(ctx));

  t('a dry run writes nothing and says what it would do', () => {
    const c2 = makeCtx(base(), OPT);
    const dry = c2.snapshotKeeperBasho_('Aki 2026', c2.tierMapFor_('Aki 2026', null), {});
    assert.strictEqual(dry.dryRun, true);
    assert.strictEqual(dry.would, 4);
    assert.strictEqual(rowsOf(c2).length, 0);
  });
  t('a second pass leaves the record alone rather than doubling it', () => {
    const again = ctx.snapshotKeeperBasho_('Aki 2026', tiers, { apply:true });
    assert.strictEqual(again.already, true);
    assert.strictEqual(JSON.stringify(rowsOf(ctx)), before);
  });
  t('force replaces the basho instead of appending a second copy', () => {
    const f = ctx.snapshotKeeperBasho_('Aki 2026', tiers, { apply:true, force:true });
    assert.strictEqual(f.removed, 4);
    assert.strictEqual(f.written, 4);
    assert.strictEqual(rowsOf(ctx).length, 4);
  });
  t('another basho already in the sheet is untouched by a force', () => {
    const c3 = makeCtx(base(), OPT);
    c3.snapshotKeeperBasho_('Aki 2026', c3.tierMapFor_('Aki 2026', null), { apply:true });
    c3.__store.KeeperHistory.rows.push(
      ['kh_old','Natsu 2026','lgA','Stable Wars','bob',1,99,99,0,0,2,'[]','[]',0,'2026-05-30T00:00:00Z']);
    c3.snapshotKeeperBasho_('Aki 2026', c3.tierMapFor_('Aki 2026', null), { apply:true, force:true });
    const natsu = rowsOf(c3).filter(r => String(r[1]) === 'Natsu 2026');
    assert.strictEqual(natsu.length, 1);
    assert.strictEqual(Number(natsu[0][6]), 99);
  });
}

console.log('\nreading it back');
{
  const ctx = makeCtx(base(), OPT);
  ctx.snapshotKeeperBasho_('Aki 2026', ctx.tierMapFor_('Aki 2026', null), { apply:true });

  t('a league gets its own basho, in placing order', () => {
    const h = ctx.keeperHistoryFor_('lgA');
    assert.strictEqual(h.basho, 'Aki 2026');
    assert.strictEqual(h.entrants, 2);
    assert.strictEqual(JSON.stringify(h.entries.map(e => e.handle)), '["ace","bob"]');
    assert.strictEqual(h.entries[0].score, 12);
  });
  t('the read hands back parsed rows, not JSON text', () => {
    const e = ctx.keeperHistoryFor_('lgA').entries[0];
    assert.ok(Array.isArray(e.active), typeof e.active);
    assert.strictEqual(e.active[0].name, 'Fujinokawa');
  });
  t('the bench arrives as a held count and a total, not a roster', () => {
    const e = ctx.keeperHistoryFor_('lgA').entries.find(x => x.handle === 'bob');
    assert.strictEqual(e.benchCount, 1);
    assert.strictEqual(typeof e.benchPts, 'number');
    assert.strictEqual(e.bench, undefined, 'bench names should not be served');
  });
  t('a league with no record reads as nothing, not as an error', () =>
    assert.strictEqual(ctx.keeperHistoryFor_('lgZ'), null));
  t('and so does a sheet that was never created', () => {
    const empty = makeCtx(base(), OPT);
    assert.strictEqual(empty.keeperHistoryFor_('lgA'), null);
  });
  t('reading never creates the sheet — it runs on every league page load', () => {
    const empty = makeCtx(base(), OPT);
    empty.keeperHistoryFor_('lgA');
    assert.strictEqual(empty.__store.KeeperHistory, undefined);
  });

  t('with two basho recorded it serves the most recent', () => {
    const c = makeCtx(base(), OPT);
    c.snapshotKeeperBasho_('Natsu 2026', c.tierMapFor_('Aki 2026', null), { apply:true });
    c.__store.KeeperHistory.rows.forEach((r,i) => { if (i) r[14] = '2026-05-30T00:00:00Z'; });
    c.snapshotKeeperBasho_('Aki 2026', c.tierMapFor_('Aki 2026', null), { apply:true });
    const h = c.keeperHistoryFor_('lgA');
    assert.strictEqual(h.basho, 'Aki 2026');
    assert.strictEqual(h.entries.length, 2);
  });
}

console.log('\nit survives the roll-over, which is the whole point');
{
  const ctx = makeCtx(base(), OPT);
  ctx.snapshotKeeperBasho_('Aki 2026', ctx.tierMapFor_('Aki 2026', null), { apply:true });
  /* what "Start a new basho" does to the rows a keeper score comes from */
  ctx.__store.Results.rows = [['day','division','east','west','winner','kimarite']];
  t('the record still reads after Results is cleared', () => {
    const h = ctx.keeperHistoryFor_('lgA');
    assert.strictEqual(h.entries[0].score, 12);
    assert.strictEqual(h.entries[0].active.length, 2);
  });
  t('recomputing from the sheet would now give zero — which is why it is stored', () => {
    const model = ctx.serverScoreModel_(ctx.parseScoring(SCORING), ctx.tierMapFor_('Aki 2026', null));
    assert.strictEqual(ctx.serverTeamScore_(['Fujinokawa','Kazuma'], model), 5);  // sanshō only
  });
}

console.log('\nthe close pass writes it');
{
  const ctx = makeCtx(base(), OPT);
  const res = ctx.applyBashoRanking('Aki 2026', null);
  t('applyBashoRanking lays the record down in the same pass as the trophies', () => {
    assert.ok(res.ok || res.error, JSON.stringify(res));
    assert.strictEqual(rowsOf(ctx).length, 4, JSON.stringify(res));
  });
  t('and reports how many rows it wrote', () =>
    assert.strictEqual(res.keeperRows, 4));
  t('a second ranking pass does not mint a second record', () => {
    ctx.applyBashoRanking('Aki 2026', null);
    assert.strictEqual(rowsOf(ctx).length, 4);
  });
}

console.log('\nthe door is locked');
{
  const ctx = makeCtx(base(), OPT);
  t('adminSnapshotKeepers refuses a wrong key', () => {
    const r = ctx.adminSnapshotKeepers({ adminKey:'nope', basho:'Aki 2026', apply:true });
    assert.strictEqual(r.ok, false);
    assert.ok(/auth/i.test(r.error || ''), JSON.stringify(r));
    assert.strictEqual(rowsOf(ctx).length, 0);
  });
  t('the right key with no apply is only a dry run', () => {
    const r = ctx.adminSnapshotKeepers({ adminKey:'test-key', basho:'Aki 2026' });
    assert.strictEqual(r.dryRun, true);
    assert.strictEqual(rowsOf(ctx).length, 0);
  });
  t('it refuses to write a record it cannot rank the banzuke for', () => {
    const dead = makeCtx(base(), { deadApi:true });
    const r = dead.adminSnapshotKeepers({ adminKey:'test-key', basho:'Aki 2026', apply:true });
    assert.strictEqual(r.ok, false);
    assert.ok(/banzuke/i.test(r.error), r.error);
    assert.strictEqual(rowsOf(dead).length, 0);
  });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
