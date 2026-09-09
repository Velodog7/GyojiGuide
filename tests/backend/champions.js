/* Node harness for the champion-awarding logic in sumo-fantasy.gs.
   Loads the real .gs into a vm with a fake Sheet backend so awardChampions_,
   championsFrom_ and the server scoring mirror run for real. */
const fs = require('fs'), vm = require('vm'), assert = require('assert');

const GS = process.env.GG_GS ||
  require('path').join(__dirname, '..', '..', 'sumo-fantasy.gs');
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
    insertSheet(){}, deleteRow(){}
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
    SpreadsheetApp: { getActiveSpreadsheet(){ return ss; } },
    PropertiesService: { getScriptProperties(){ return { getProperty(){ return 'test'; } }; } },
    LockService: { getScriptLock(){ return { waitLock(){}, releaseLock(){} }; } },
    UrlFetchApp: { fetch(){ throw new Error('no net'); } },
    ContentService: { createTextOutput(){ return { setMimeType(){ return this; } }; }, MimeType:{ JSON:'json' } },
    Utilities: { formatDate(){ return ''; } },
    console, JSON, Math, Date, Number, String, Object, Array, isNaN, parseInt, parseFloat, RegExp,
    __store: store
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename:'sumo-fantasy.gs' });
  return ctx;
}

/* ---- fixtures ---- */
const HIST_HEAD = ['handle','basho','team','score','wins','rows','savedAt'];
const LEAGUE_HEAD = ['id','name','commissioner','created','inviteCode','mode','rosterSize','draftStatus',
  'draftOrder','draftPickIdx','draftPhase','scoring','draftDate','draftAgree','benchSize','farmSize'];
const CHAMP_HEAD = ['id','basho','scope','leagueId','leagueName','handle','score',
  'runnerUp','runnerUpScore','entrants','awardedAt'];

// two bouts per day is plenty: Terao(M) beats Hoshoryu(Y) -> +4 gap bonus
function results(){
  return [['day','division','east','west','winner','kimarite'],
    [1,'Makuuchi','Hoshoryu','Terao','Terao','yorikiri'],
    [2,'Makuuchi','Hoshoryu','Terao','Hoshoryu','oshidashi'],
    [3,'Makuuchi','Onosato','Terao','Terao','hatakikomi'],
    [4,'Makuuchi','Onosato','Aki','Onosato','yorikiri']];
}
function meta(extra){
  const m = [['key','value'],['basho','Aki 2026'],['lastDay',15],['yusho','Onosato'],['sansho','Terao']];
  (extra||[]).forEach(r=>m.push(r));
  return m;
}
const TIERS = { Hoshoryu:'Y', Onosato:'Y', Terao:'M', Aki:'M' };

let pass = 0, fail = 0;
function t(name, fn){
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e){ fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('\nserver scoring mirrors gg-account.js');
{
  const ctx = makeCtx({ Results:results(), Meta:meta(), TeamHistory:[HIST_HEAD] });
  const model = ctx.serverScoreModel_(ctx.defaultScoring(), TIERS);

  t('counts wins', () => assert.strictEqual(model.wins['Terao'], 2));
  t('sanyaku bonus = rank gap, winner-side only', () => {
    // Terao (M,0) beat Hoshoryu (Y,4) and Onosato (Y,4) -> 4 + 4 = 8
    assert.strictEqual(model.bonus['Terao'], 8);
    assert.strictEqual(model.bonus['Hoshoryu'], undefined);   // beating a lower rank pays nothing
  });
  t('sansho + yusho read from Meta', () => {
    assert.ok(model.sansho['Terao']); assert.strictEqual(model.yusho, 'Onosato');
  });
  t('teamScore = wins*winPoint + bonus + sansho + yusho', () => {
    // Terao: 2 wins*1 + 8 bonus + 5 sansho = 15 ; Onosato: 1 win*1 + 5 yusho = 6
    assert.strictEqual(ctx.serverTeamScore_(['Terao'], model), 15);
    assert.strictEqual(ctx.serverTeamScore_(['Onosato'], model), 6);
    assert.strictEqual(ctx.serverTeamScore_(['Terao','Onosato'], model), 21);
  });
  t('custom scoring changes the answer', () => {
    const m2 = ctx.serverScoreModel_(ctx.normalizeScoring({ winPoint:3, sanyakuBonus:0, sansho:0, yusho:20 }), TIERS);
    assert.strictEqual(ctx.serverTeamScore_(['Terao'], m2), 6);        // 2*3, no bonus, no sansho
    assert.strictEqual(ctx.serverTeamScore_(['Onosato'], m2), 23);     // 1*3 + 20
  });
  t('unknown rikishi scores zero, does not throw', () =>
    assert.strictEqual(ctx.serverTeamScore_(['Nobody','', null], model), 0));
}

console.log('\nchampionsFrom_ — who takes a title');
{
  const ctx = makeCtx({ Results:results(), Meta:meta(), TeamHistory:[HIST_HEAD] });
  const C = ctx.championsFrom_;
  t('needs two entrants', () => assert.strictEqual(C([{handle:'a',score:50}]), null));
  t('needs a score above zero', () =>
    assert.strictEqual(C([{handle:'a',score:0},{handle:'b',score:0}]), null));
  t('crowns the top score', () => {
    const r = C([{handle:'a',score:10},{handle:'b',score:30},{handle:'c',score:20}]);
    assert.strictEqual(JSON.stringify(r.winners.map(w=>w.handle)), '["b"]');
    assert.strictEqual(r.runnerUp.handle, 'c');
    assert.strictEqual(r.entrants, 3);
  });
  t('a tie crowns co-champions', () => {
    const r = C([{handle:'a',score:30},{handle:'b',score:30},{handle:'c',score:5}]);
    assert.strictEqual(JSON.stringify(r.winners.map(w=>w.handle).sort()), '["a","b"]');
    assert.strictEqual(r.runnerUp.handle, 'c');
  });
  t('everyone tied means no runner-up, still champions', () => {
    const r = C([{handle:'a',score:7},{handle:'b',score:7}]);
    assert.strictEqual(r.winners.length, 2);
    assert.strictEqual(r.runnerUp, null);
  });
  t('negative scores cannot win', () =>
    assert.strictEqual(C([{handle:'a',score:-5},{handle:'b',score:-1}]), null));
}

console.log('\nawardChampions_ — the public title');
{
  const hist = [HIST_HEAD,
    ['ayame','Aki 2026','{}',88,40,'[]','2026-09-28T00:00:00Z'],
    ['bunta','Aki 2026','{}',95,44,'[]','2026-09-28T00:00:00Z'],
    ['chiyo','Aki 2026','{}',71,33,'[]','2026-09-28T00:00:00Z'],
    ['ayame','Natsu 2026','{}',999,90,'[]','2026-05-28T00:00:00Z']];
  const ctx = makeCtx({ Results:results(), Meta:meta(), TeamHistory:hist,
    Leagues:[LEAGUE_HEAD], LeagueMembers:[['leagueId','handle','joined']],
    LeagueTeams:[['leagueId','handle','team','updated']],
    KeeperRosters:[['leagueId','handle','rikishi','division','acquiredVia','acquiredAt','slot']],
    Champions:[CHAMP_HEAD] });
  const res = ctx.awardChampions_('Aki 2026', TIERS);
  const rows = ctx.__store.Champions.rows;

  t('awards exactly one public title', () => assert.strictEqual(res.awarded, 1));
  t('crowns the top archived score', () => assert.strictEqual(rows[1][5], 'bunta'));
  t('records score, runner-up and field size', () => {
    assert.strictEqual(rows[1][6], 95);
    assert.strictEqual(rows[1][7], 'ayame');
    assert.strictEqual(rows[1][8], 88);
    assert.strictEqual(rows[1][9], 3);
  });
  t('ignores other basho', () => assert.strictEqual(rows.length, 2));
  t('is idempotent — a second run awards nothing', () => {
    const again = ctx.awardChampions_('Aki 2026', TIERS);
    assert.strictEqual(again.already, true);
    assert.strictEqual(ctx.__store.Champions.rows.length, 2);
  });
}

console.log('\nawardChampions_ — private leagues');
{
  const sc = JSON.stringify({ winPoint:1, sanyakuBonus:1, sansho:5, yusho:5 });
  const leagues = [LEAGUE_HEAD,
    ['lg1','Stable Wars','ayame','','ABC','classic',6,'none','[]',0,'',sc,'','{}',0,6],
    ['lg2','Solo Club','chiyo','','DEF','classic',6,'none','[]',0,'',sc,'','{}',0,6],
    ['lg3','Keeper Cup','ayame','','GHI','keepers',2,'complete','[]',0,'',sc,'','{}',1,0]];
  const members = [['leagueId','handle','joined'],
    ['lg1','ayame',''],['lg1','bunta',''],['lg1','dozo',''],
    ['lg2','chiyo',''],['lg2','ghost',''],
    ['lg3','ayame',''],['lg3','bunta','']];
  const teams = [['leagueId','handle','team','updated'],
    ['lg1','ayame',JSON.stringify({ Y:'Onosato' }),''],          // 6
    ['lg1','bunta',JSON.stringify({ M:'Terao' }),''],            // 15
    ['lg2','chiyo',JSON.stringify({ M:'Terao' }),'']];           // only one team in lg2
  const rosters = [['leagueId','handle','rikishi','division','acquiredVia','acquiredAt','slot'],
    ['lg3','ayame','Terao','makuuchi','draft','','bench'],       // benched: must not score
    ['lg3','ayame','Onosato','makuuchi','draft','','active'],    // 6
    ['lg3','bunta','Aki','makuuchi','draft','','active'],        // 0 wins
    ['lg3','bunta','Hoshoryu','makuuchi','draft','','active']];  // 1 win, no bonus -> 1
  const ctx = makeCtx({ Results:results(), Meta:meta(), TeamHistory:[HIST_HEAD],
    Leagues:leagues, LeagueMembers:members, LeagueTeams:teams, KeeperRosters:rosters,
    Champions:[CHAMP_HEAD] });
  ctx.awardChampions_('Aki 2026', TIERS);
  const rows = ctx.__store.Champions.rows.slice(1);
  const byLeague = {}; rows.forEach(r => { byLeague[r[3]] = r; });

  t('classic league crowns its highest scorer', () => {
    assert.ok(byLeague['lg1'], 'lg1 got no title');
    assert.strictEqual(byLeague['lg1'][5], 'bunta');
    assert.strictEqual(byLeague['lg1'][6], 15);
  });
  t('members who never set a team are not entrants', () =>
    assert.strictEqual(byLeague['lg1'][9], 2));                  // dozo excluded
  t('a league with one scored team crowns nobody', () =>
    assert.strictEqual(byLeague['lg2'], undefined));
  t('keepers score the active lineup only', () => {
    assert.ok(byLeague['lg3'], 'lg3 got no title');
    assert.strictEqual(byLeague['lg3'][5], 'ayame');
    assert.strictEqual(byLeague['lg3'][6], 6);                   // 6, not 21 — Terao is benched
  });
  t('league name and scope are recorded', () => {
    assert.strictEqual(byLeague['lg1'][2], 'league');
    assert.strictEqual(byLeague['lg1'][4], 'Stable Wars');
  });
  t('a league scores under ITS OWN rules', () => {
    const wild = JSON.stringify({ winPoint:1, sanyakuBonus:0, sansho:0, yusho:20 });
    const lg = [LEAGUE_HEAD, ['lgX','House Rules','ayame','','XYZ','classic',6,'none','[]',0,'',wild,'','{}',0,6]];
    const c2 = makeCtx({ Results:results(), Meta:meta(), TeamHistory:[HIST_HEAD], Leagues:lg,
      LeagueMembers:[['leagueId','handle','joined'],['lgX','ayame',''],['lgX','bunta','']],
      LeagueTeams:[['leagueId','handle','team','updated'],
        ['lgX','ayame',JSON.stringify({ Y:'Onosato' }),''],      // 1 + 20 = 21
        ['lgX','bunta',JSON.stringify({ M:'Terao' }),'']],       // 2 wins, no bonus/sansho
      KeeperRosters:[['leagueId','handle','rikishi','division','acquiredVia','acquiredAt','slot']],
      Champions:[CHAMP_HEAD] });
    c2.awardChampions_('Aki 2026', TIERS);
    const r = c2.__store.Champions.rows[1];
    assert.strictEqual(r[5], 'ayame');   // loses under default scoring, wins under these
    assert.strictEqual(r[6], 21);
  });
}

console.log('\nreigningChampion_ and championsOf_');
{
  const champs = [CHAMP_HEAD,
    ['c1','Natsu 2026','public','','Sumo Slap Down League','ayame',80,'bunta',70,4,'2026-05-30T00:00:00Z'],
    ['c2','Aki 2026','public','','Sumo Slap Down League','bunta',95,'ayame',88,3,'2026-09-28T00:00:00Z'],
    ['c3','Aki 2026','public','','Sumo Slap Down League','chiyo',95,'ayame',88,3,'2026-09-28T00:00:00Z'],
    ['c4','Aki 2026','league','lg1','Stable Wars','ayame',15,'bunta',7,2,'2026-09-28T00:00:00Z']];
  const ctx = makeCtx({ Champions:champs, Users:[['handle','name','auth','team','updated','avatar','status','warnMsg']],
    Results:results(), Meta:meta(), TeamHistory:[HIST_HEAD] });

  t('public reign is the newest basho, co-champions included', () => {
    const c = ctx.reigningChampion_('');
    assert.strictEqual(c.basho, 'Aki 2026');
    assert.strictEqual(JSON.stringify(c.handles.sort()), '["bunta","chiyo"]');
  });
  t('league reign is scoped to that league', () => {
    const c = ctx.reigningChampion_('lg1');
    assert.strictEqual(JSON.stringify(c.handles), '["ayame"]');
  });
  t('a league with no titles reigns nobody', () =>
    assert.strictEqual(ctx.reigningChampion_('lg-none'), null));
  t('trophy case collects every scope, newest first', () => {
    const ts = ctx.championsOf_('ayame');
    assert.strictEqual(ts.length, 2);
    assert.strictEqual(ts[0].basho, 'Aki 2026');
    assert.strictEqual(ts[0].scope, 'league');
    assert.strictEqual(ts[1].scope, 'public');
  });
  t('handle match is case-insensitive', () =>
    assert.strictEqual(ctx.championsOf_('AYAME').length, 2));
}

console.log('\ntierMapFor_ fallbacks');
{
  const hist = [HIST_HEAD,
    ['ayame','Aki 2026','{}',10,5, JSON.stringify([{name:'Terao',tier:'M'},{name:'Onosato',tier:'Y'}]),'']];
  const ctx = makeCtx({ TeamHistory:hist, Meta:meta(), Results:results(),
    Champions:[CHAMP_HEAD] });
  t('a posted map wins and is persisted to Meta', () => {
    const m = ctx.tierMapFor_('Aki 2026', { Terao:'S' });
    assert.strictEqual(m['Terao'], 'S');
    assert.ok(ctx.__store.Meta.rows.some(r => r[0] === 'tiers:Aki 2026'));
  });
  t('falls back to tiers embedded in archived rows', () => {
    const c2 = makeCtx({ TeamHistory:hist, Meta:meta(), Results:results(), Champions:[CHAMP_HEAD] });
    const m = c2.tierMapFor_('Aki 2026', null);
    assert.strictEqual(m['Onosato'], 'Y');
  });
  t('unknown name scores as Maegashira, like the client', () =>
    assert.strictEqual(ctx.tierLevel_('Nobody', {}), 0));
}

console.log('\napplyBashoRanking — the one basho-close pass');
{
  const sc = JSON.stringify({ winPoint:1, sanyakuBonus:1, sansho:5, yusho:5 });
  function world(histRows){
    return makeCtx({ Results:results(), Meta:meta(), TeamHistory:[HIST_HEAD].concat(histRows),
      Leagues:[LEAGUE_HEAD, ['lg1','Stable Wars','ayame','','ABC','classic',6,'none','[]',0,'',sc,'','{}',0,6]],
      LeagueMembers:[['leagueId','handle','joined'],['lg1','ayame',''],['lg1','bunta','']],
      LeagueTeams:[['leagueId','handle','team','updated'],
        ['lg1','ayame',JSON.stringify({ M:'Terao' }),''],
        ['lg1','bunta',JSON.stringify({ Y:'Onosato' }),'']],
      KeeperRosters:[['leagueId','handle','rikishi','division','acquiredVia','acquiredAt','slot']],
      Champions:[CHAMP_HEAD],
      Rankings:[['handle','rankIdx','bashoCount','topStreak','lastBasho']] });
  }
  t('ranks and crowns in one call', () => {
    const ctx = world([['ayame','Aki 2026',JSON.stringify({M:'Terao'}),15,2,'[]','2026-09-28T00:00:00Z'],
                       ['bunta','Aki 2026',JSON.stringify({Y:'Onosato'}),6,1,'[]','2026-09-28T00:00:00Z']]);
    const r = ctx.applyBashoRanking('Aki 2026', TIERS);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.ranked, 2);
    assert.strictEqual(r.champions, 2);              // one public + one league
    assert.strictEqual(r.championError, '');
  });
  t('leagues still get titles when nobody archived publicly', () => {
    const ctx = world([]);
    const r = ctx.applyBashoRanking('Aki 2026', TIERS);
    assert.strictEqual(r.ok, false);                 // no ranking without archives
    assert.strictEqual(r.champions, 1);              // but the league title still lands
    const rows = ctx.__store.Champions.rows.slice(1);
    assert.strictEqual(rows[0][2], 'league');
    assert.strictEqual(rows[0][5], 'ayame');         // Terao 15 beats Onosato 6
  });
  t('a second full run crowns nothing new', () => {
    const ctx = world([['ayame','Aki 2026',JSON.stringify({M:'Terao'}),15,2,'[]','2026-09-28T00:00:00Z'],
                       ['bunta','Aki 2026',JSON.stringify({Y:'Onosato'}),6,1,'[]','2026-09-28T00:00:00Z']]);
    ctx.applyBashoRanking('Aki 2026', TIERS);
    const before = ctx.__store.Champions.rows.length;
    const again = ctx.applyBashoRanking('Aki 2026', TIERS);
    assert.strictEqual(again.already, true);
    assert.strictEqual(ctx.__store.Champions.rows.length, before);
  });
  t('every trophy id is unique', () => {
    const ctx = world([['ayame','Aki 2026',JSON.stringify({M:'Terao'}),15,2,'[]','2026-09-28T00:00:00Z'],
                       ['bunta','Aki 2026',JSON.stringify({Y:'Onosato'}),6,1,'[]','2026-09-28T00:00:00Z']]);
    ctx.applyBashoRanking('Aki 2026', TIERS);
    const ids = ctx.__store.Champions.rows.slice(1).map(r => r[0]);
    assert.strictEqual(new Set(ids).size, ids.length);
  });
}

console.log('\n' + (fail ? `${fail} FAILED, ${pass} passed` : `all ${pass} passed`) + '\n');
process.exit(fail ? 1 : 0);
