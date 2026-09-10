/* Shared fixture: one invented career with numbers small enough to check by
   hand. Bouts are declared per opponent, so the rivalry totals and the
   technique totals come from the same 27 rows and cannot silently disagree. */
const BOUTS = [
  // opponent,   [won, kimarite] ...
  ['Kirishima',  [1,'yorikiri'], [1,'yorikiri'], [1,'oshidashi'], [1,'fusen']],
  ['Daieisho',   [1,'yorikiri'], [1,'uwatenage'], [1,'hatakikomi'], [0,'oshidashi']],
  ['Hoshoryu',   [1,'yorikiri'], [0,'oshidashi'], [0,'shitatenage'], [0,'hansoku']],
  ['Takayasu',   [0,'oshidashi'], [0,'shitatenage'], [0,'katasukashi']],
  ['Oho',        [1,'oshidashi'], [1,'isamiashi'], [0,'koshikudake'], [1,'hatakikomi']],
  ['Ura',        [1,'uwatenage'], [1,'sotogake']],                    // only 2 — below the rivalry floor
  ['Roga',       [1,'oshidashi'], [1,'tsukiotoshi'], [1,'uwatenage']],
  ['Tokihayate', [1,'yorikiri'], [1,'oshidashi'], [1,'fusen']],
  ['Kotoshoho',  [1,'yorikiri'], [0,'oshidashi'], [1,'sukuinage'], [0,'shitatenage']],  // 2–2, even
  /* a real win with no kimarite on the record — mae-zumo is never given one,
     and nor is a day-16 championship playoff. Live data has both. */
  ['Kinbozan',   [1,'']]
];

/* Which basho each bout belongs to. The first four rows land in 202511, a
   basho with NO rankHistory entry — mae-zumo. They must count as technique
   and rivalry history and must NOT appear on the career chart. */
const MAEZUMO_BASHO = '202511';
const CHART_BASHO = ['202601','202603','202605','202607'];

const ME = 8850;
const OPP_ID = {};
BOUTS.forEach((b,i)=>{ OPP_ID[b[0]] = 9000 + i; });

function records(){
  const out = [];
  let n = 0;
  BOUTS.forEach(([opp, ...bs])=>{
    bs.forEach(([won, kimarite])=>{
      /* the blank-kimarite bout goes where blanks really come from */
      const basho = (n < 4 || !kimarite) ? MAEZUMO_BASHO : CHART_BASHO[n % CHART_BASHO.length];
      const east = n % 2 === 0;
      out.push({
        bashoId: basho, day: (n % 15) + 1, division: 'Makuuchi', matchNo: n + 1,
        eastId:  east ? ME : OPP_ID[opp],
        westId:  east ? OPP_ID[opp] : ME,
        eastShikona: east ? 'Onosato' : opp,
        westShikona: east ? opp : 'Onosato',
        eastRank: 'Yokozuna 1 East', westRank: 'Maegashira 1 East',
        kimarite,
        winnerId: won ? ME : OPP_ID[opp],
        winnerEn: won ? 'Onosato' : opp,
        /* the real feed sometimes puts an <img> tag in this field rather than
           a name — it is in the fixture so that anything reaching innerHTML
           with it would show up as markup on the page */
        winnerJp: '<img src="/img/x.jpg" onerror="window.__XSS=1">'
      });
      n++;
    });
  });
  return out;
}

/* A second man in the same feed, so a records array that is not filtered by
   id would produce visibly wrong totals rather than merely different ones. */
function noise(){
  return [
    { bashoId:'202601', day:1, division:'Makuuchi', eastId:7001, westId:7002,
      eastShikona:'Someone', westShikona:'Another', kimarite:'yorikiri',
      winnerId:7001, winnerEn:'Someone', winnerJp:'x' },
    { bashoId:'202603', day:2, division:'Makuuchi', eastId:7002, westId:7001,
      eastShikona:'Another', westShikona:'Someone', kimarite:'uwatenage',
      winnerId:7002, winnerEn:'Another', winnerJp:'x' }
  ];
}

const RANK_HISTORY = [
  { bashoId:'202609', rikishiId:ME, rankValue:101, rank:'Yokozuna 1 East' },
  { bashoId:'202607', rikishiId:ME, rankValue:101, rank:'Yokozuna 1 West' },
  { bashoId:'202605', rikishiId:ME, rankValue:201, rank:'Ozeki 1 East' },
  { bashoId:'202603', rikishiId:ME, rankValue:301, rank:'Sekiwake 1 East' },
  { bashoId:'202601', rikishiId:ME, rankValue:501, rank:'Maegashira 1 East' },
  /* mae-zumo: rankValue >= 2000, deliberately excluded from the chart */
  { bashoId:'202511', rikishiId:ME, rankValue:2000, rank:'Mae-zumo' }
];

const STATS = {
  absenceByDivision:{ Makuuchi: 4 },
  basho: 5,
  bashoByDivision:{ Juryo: 1, Makuuchi: 4 },
  lossByDivision:{ Juryo: 1, Makuuchi: 7 },
  sansho:{ 'Gino-sho': 2, 'Kanto-sho': 0, 'Shukun-sho': 1 },   // Kanto-sho zero on purpose
  totalAbsences: 4, totalLosses: 8, totalMatches: 27, totalWins: 19,
  winsByDivision:{ Juryo: 2, Makuuchi: 17 },
  yusho: 3, yushoByDivision:{ Makuuchi: 3 }
};

module.exports = { BOUTS, ME, OPP_ID, records, noise, RANK_HISTORY, STATS,
                   MAEZUMO_BASHO, CHART_BASHO };
