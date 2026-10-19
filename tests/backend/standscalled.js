/* A title that stands as called.

   Aki 2026 was crowned against the wrong banzuke (see recrown.js). Correcting
   it moves titles that had already been announced and congratulated, and a
   league may reasonably decide the called result stands. What it must NOT do
   is quietly keep the wrong number: the record has to carry BOTH answers, and
   every place the title is shown has to say so.

   So this pins down the deal:
     - a marked title keeps the announced handle and score,
     - a re-crown writes the corrected winner beside it instead of over it,
     - every other scope is still corrected normally,
     - the mark is reversible, and the note is readable back out of the record
       by the pages that show the title.

   The fixture is recrown.js's: punto is crowned 10-7 by the stale map, cafe
   wins 7-6 under the real banzuke.
*/
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const GS = process.env.GG_GS || require('path').join(__dirname, '..', '..', 'sumo-fantasy.gs');
const SRC = fs.readFileSync(GS, 'utf8');

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
  const ss = { getSheetByName(n){ return store[n] || null; },
               insertSheet(n){ store[n] = makeSheet(n, []); return store[n]; } };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet(){ return ss; }, flush(){} },
    PropertiesService: { getScriptProperties(){ return { getProperty(){ return 'test-key'; } }; } },
    LockService: { getScriptLock(){ return { waitLock(){}, tryLock(){ return true; }, releaseLock(){} }; } },
    CacheService: { getScriptCache(){ const m = {};
      return { get(k){ return m[k] || null; }, getAll(){ return {}; },
               put(k,v){ m[k] = v; }, remove(k){ delete m[k]; } }; } },
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
    console, JSON, Math, Date, Number, String, Object, Array, isNaN, parseInt, parseFloat, RegExp, Error,
    __store: store
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename:'sumo-fantasy.gs' });
  return ctx;
}

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
/* deliberately the OLD eleven-column header — the migration is part of this */
const CHAMP_HEAD_V1 = ['id','basho','scope','leagueId','leagueName','handle','score',
  'runnerUp','runnerUpScore','entrants','awardedAt'];
const LEAGUE_HEAD = ['id','name','commissioner','created','inviteCode','mode','rosterSize','draftStatus',
  'draftOrder','draftPickIdx','draftPhase','scoring','draftDate','draftAgree','benchSize','farmSize'];
const SCORING = JSON.stringify({ winPoint:1, sanyakuBonus:1, sansho:0, yusho:0 });
function base(extra){
  return Object.assign({ Results:results(), Meta:META.map(r=>r.slice()),
    TeamHistory:[HIST_HEAD, ['punto','Aki 2026','{}',10,2,15,''], ['cafe','Aki 2026','{}',7,7,15,'']],
    Champions:[CHAMP_HEAD_V1.slice()],
    Users:[['handle','name','auth','team','updated','avatar','status','warnMsg'],
      ['punto','Punto','a','{}','','','',''], ['cafe','Cafergy','a','{}','','','','']],
    Leagues: [LEAGUE_HEAD,
      ['lgK','Chanko Test','punto','','ABC','keepers',1,'complete','[]',0,'',SCORING,'','{}',0,0]],
    LeagueMembers: [['leagueId','handle','joined'], ['lgK','punto',''], ['lgK','cafe','']],
    LeagueTeams: [['leagueId','handle','team','updated']],
    KeeperRosters: [['leagueId','handle','rikishi','division','acquiredVia','acquiredAt','slot'],
      ['lgK','punto','Fujinokawa','makuuchi','draft','','active'],
      ['lgK','cafe','Atamifuji','makuuchi','draft','','active']] }, extra || {});
}
/* crown it the way it really happened: against the stale map */
function crowned(){
  const ctx = makeCtx(base(), { deadApi:true });
  ctx.awardChampions_('Aki 2026', ctx.tierMapFor_('Aki 2026', NAGOYA_TIERS));
  /* then give it a live banzuke again, as the fixed site has */
  const ctx2 = makeCtx(Object.assign(base(), { Champions: ctx.__store.Champions.rows.map(r=>r.slice()) }),
    { banzuke:{ '202609': AKI_BOARD } });
  return ctx2;
}
const champRows = c => c.__store.Champions.rows.slice(1);
const leagueRowOf = c => champRows(c).find(r => String(r[3]) === 'lgK');
const publicRowOf = c => champRows(c).find(r => String(r[2]) === 'public');
const NOTE = 'Called at the end of the basho and left to stand by the league.';

let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e){ fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('\n— the fixture —');
{
  const c = crowned();
  t('the called title is the wrong one, as it was on the night', () => {
    const row = leagueRowOf(c);
    assert.ok(row, 'no league title');
    assert.strictEqual(row[5], 'punto');
    assert.strictEqual(row[6], 10);
  });
  t('and the corrected scoring would hand it to cafe', () => {
    const dry = c.recrownBasho_({ basho:'Aki 2026' });
    const lg = dry.changes.find(x => x.leagueId === 'lgK');
    assert.strictEqual(dry.dryRun, true);
    assert.deepStrictEqual([...lg.nowHandles], ['cafe']);
    assert.strictEqual(lg.nowScore, 7);
    assert.strictEqual(lg.titleMoves, true);
  });
}

console.log('\n— marking a title as standing —');
{
  const c = crowned();
  t('an old eleven-column Champions sheet gains the four it needs', () => {
    c.champSheet_();
    const head = c.__store.Champions.rows[0];
    assert.strictEqual(head[11], 'standsAsCalled');
    assert.strictEqual(head[12], 'note');
    assert.strictEqual(head[13], 'correctedHandle');
    assert.strictEqual(head[14], 'correctedScore');
  });
  t('marking stamps when and why, and nothing else', () => {
    const n = c.standTitle_('Aki 2026', 'league', 'lgK', NOTE);
    assert.strictEqual(n, 1);
    const row = leagueRowOf(c);
    assert.ok(row[11], 'no timestamp');
    assert.strictEqual(row[12], NOTE);
    assert.strictEqual(row[5], 'punto', 'the called winner was touched');
    assert.strictEqual(row[6], 10, 'the called score was touched');
  });
  t('the public title is NOT marked by a league mark', () => {
    assert.strictEqual(String(publicRowOf(c)[11] || ''), '');
  });
  t('the pages can read the mark back', () => {
    const r = c.reigningChampion_('lgK');
    assert.strictEqual(r.stands, true);
    assert.strictEqual(r.note, NOTE);
    /* punto holds the public title too, awarded in the same pass — the mark
       must ride on the league trophy only */
    const trophies = c.championsOf_('punto');
    const lg = trophies.find(x => x.leagueId === 'lgK');
    const pub = trophies.find(x => x.scope === 'public');
    assert.strictEqual(lg.stands, true);
    assert.strictEqual(lg.note, NOTE);
    assert.strictEqual(pub.stands, false, 'the mark leaked onto another trophy');
  });
  t('a league with no title on record is an error, not a silent no-op', () => {
    const r = c.adminStandTitle({ adminKey:'test-key', basho:'Aki 2026', scope:'league', leagueId:'lgNOPE', note:'x' });
    assert.ok(r && !r.ok, JSON.stringify(r));
  });
  t('and the admin key is required', () => {
    const r = c.adminStandTitle({ adminKey:'wrong', basho:'Aki 2026', scope:'league', leagueId:'lgK', note:'x' });
    assert.ok(r && !r.ok, JSON.stringify(r));
  });
}

console.log('\n— re-crowning around it —');
{
  const c = crowned();
  c.standTitle_('Aki 2026', 'league', 'lgK', NOTE);
  const dry = c.recrownBasho_({ basho:'Aki 2026' });
  t('the preview flags it rather than hiding it', () => {
    const lg = dry.changes.find(x => x.leagueId === 'lgK');
    assert.strictEqual(lg.stands, true);
    assert.deepStrictEqual([...lg.wasHandles], ['punto']);
    assert.deepStrictEqual([...lg.nowHandles], ['cafe'], 'the preview must still say who really won');
    assert.strictEqual(dry.standing, 1);
    assert.strictEqual(dry.titlesMoving, 0, 'a standing title is not counted as moving');
  });

  const res = c.recrownBasho_({ basho:'Aki 2026', apply:true });
  t('applying keeps the called winner on the standing title', () => {
    assert.ok(res.ok && !res.dryRun);
    const rows = champRows(c).filter(r => String(r[3]) === 'lgK');
    assert.strictEqual(rows.length, 1, 'the standing title was duplicated or dropped');
    assert.strictEqual(rows[0][5], 'punto');
    assert.strictEqual(rows[0][6], 10);
  });
  t('and records the corrected result beside it, for everyone to see', () => {
    const row = leagueRowOf(c);
    assert.strictEqual(row[13], 'cafe');
    assert.strictEqual(row[14], 7);
    assert.strictEqual(row[12], NOTE, 'the note survived the re-crown');
    const r = c.reigningChampion_('lgK');
    assert.strictEqual(r.correctedHandle, 'cafe');
    assert.strictEqual(r.correctedScore, 7);
    assert.strictEqual(r.handles[0], 'punto');
  });
  t('every other scope is corrected as normal', () => {
    const pub = publicRowOf(c);
    assert.ok(pub, 'the public title vanished');
    assert.strictEqual(String(pub[11] || ''), '', 'the public title should not be standing');
    assert.strictEqual(pub[5], 'punto', 'public board is scored off TeamHistory, which is unchanged');
  });
  t('a second apply is stable — no second trophy, no drift', () => {
    const again = c.recrownBasho_({ basho:'Aki 2026', apply:true });
    assert.ok(again.ok);
    const rows = champRows(c).filter(r => String(r[3]) === 'lgK');
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0][5], 'punto');
    assert.strictEqual(rows[0][13], 'cafe');
  });
}

console.log('\n— taking the mark off again —');
{
  const c = crowned();
  c.standTitle_('Aki 2026', 'league', 'lgK', NOTE);
  c.recrownBasho_({ basho:'Aki 2026', apply:true });
  t('undo clears the stamp, the note and the corrected copy', () => {
    const n = c.standTitle_('Aki 2026', 'league', 'lgK', '', true);
    assert.strictEqual(n, 1);
    const row = leagueRowOf(c);
    assert.strictEqual(String(row[11] || ''), '');
    assert.strictEqual(String(row[12] || ''), '');
    assert.strictEqual(String(row[13] || ''), '');
    assert.strictEqual(c.reigningChampion_('lgK').stands, false);
  });
  t('and the next re-crown then treats it like any other title', () => {
    c.recrownBasho_({ basho:'Aki 2026', apply:true });
    const row = leagueRowOf(c);
    assert.strictEqual(row[5], 'cafe');
    assert.strictEqual(row[6], 7);
  });
}

console.log('\n— a basho with nothing marked is untouched by any of this —');
{
  const c = crowned();
  const res = c.recrownBasho_({ basho:'Aki 2026', apply:true });
  t('the corrected winner simply takes the title', () => {
    assert.strictEqual(res.standing, 0);
    assert.strictEqual(res.titlesMoving, 1);
    assert.strictEqual(leagueRowOf(c)[5], 'cafe');
  });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
