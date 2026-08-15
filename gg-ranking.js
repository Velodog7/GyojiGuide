/* ============================================================================
   Sumo Slap Down — long-term ranking ladder (JSA-style banzuke)

   SCORE for the curve = a team's win rate this basho: actual wins / possible
   wins (0..1). Each basho every active player's win rate becomes a percentile p
   against the whole field (p=1 top, p=0 bottom). Movement is median-relative:
     • above the curve's bar for your rank  -> climb (two ranks in the low
       divisions when you're dominant, otherwise one)
     • around the middle                    -> hold
     • below your rank's floor              -> fall, and the lower your win rate
       the further down the banzuke you drop
   The bars rise steeply with rank, so climbing into Juryo is easy, into Makuuchi
   harder, and up through the sanyaku very hard — while a genuinely good player
   sits inside a wide "hold" band and keeps their Makuuchi rank.

   Fresh players enter at Jonokuchi (idx 0). Returning players carry rankIdx /
   bashoCount / topStreak forward, so they climb and fall from where they left off.

   The leaderboard UI uses RANKS/rankOf for labels; the SAME applyBasho logic is
   mirrored server-side (sumo-fantasy.gs) so promotions are computed once.
   ------------------------------------------------------------------------- */
(function () {
  var RANKS = [
    { key:"jonokuchi",  label:"Jonokuchi",  jp:"\u5e8f\u30ce\u53e3", div:"jonokuchi", sekitori:false },
    { key:"jonidan",    label:"Jonidan",    jp:"\u5e8f\u4e8c\u6bb5", div:"jonidan",   sekitori:false },
    { key:"sandanme",   label:"Sandanme",   jp:"\u4e09\u6bb5\u76ee", div:"sandanme",  sekitori:false },
    { key:"makushita",  label:"Makushita",  jp:"\u5e55\u4e0b",       div:"makushita", sekitori:false },
    { key:"juryo",      label:"J\u016bry\u014d", jp:"\u5341\u4e21",  div:"juryo",     sekitori:true  },
    { key:"maegashira", label:"Maegashira", jp:"\u524d\u982d",       div:"makuuchi",  sekitori:true  },
    { key:"komusubi",   label:"Komusubi",   jp:"\u5c0f\u7d50",       div:"makuuchi",  sekitori:true, sanyaku:true },
    { key:"sekiwake",   label:"Sekiwake",   jp:"\u95a2\u8107",       div:"makuuchi",  sekitori:true, sanyaku:true },
    { key:"ozeki",      label:"\u014czeki", jp:"\u5927\u95a2",       div:"makuuchi",  sekitori:true, sanyaku:true },
    { key:"yokozuna",   label:"Yokozuna",   jp:"\u6a2a\u7db1",       div:"makuuchi",  sekitori:true, sanyaku:true, pinnacle:true }
  ];

  /* up   = percentile at/above which you climb from this rank
     down = percentile below which you fall from this rank (hold in between)
     jump = max ranks you can leap upward in one basho (only the low divisions) */
  var CFG = [
    /*0 jonokuchi */ { up:0.50, down:-1,    jump:2 },  // top half climbs; can't fall off the bottom
    /*1 jonidan   */ { up:0.50, down:0.15,  jump:2 },
    /*2 sandanme  */ { up:0.52, down:0.18,  jump:2 },
    /*3 makushita */ { up:0.56, down:0.22,  jump:1 },  // gateway to sekitori
    /*4 juryo     */ { up:0.66, down:0.30,  jump:1 },  // harder to break into Makuuchi
    /*5 maegashira*/ { up:0.85, down:0.35,  jump:1 },  // wide hold band -> good players keep Makuuchi; only the top climb to sanyaku
    /*6 komusubi  */ { up:0.90, down:0.60,  jump:1 },
    /*7 sekiwake  */ { up:0.94, down:0.72,  jump:1 },
    /*8 ozeki     */ { up:0.98, down:0.86,  jump:1 },  // + the Yokozuna run gate below
    /*9 yokozuna  */ { up:2,    down:0.90,  jump:0 }   // holds only while still near the very top of the curve
  ];
  var YOKOZUNA_MIN_BASHO = 6;    // hard floor: no Yokozuna before your 6th completed basho
  var TOP_PCTL           = 0.985;// a "dominant" finish; two in a row at Ozeki earns Yokozuna
  var MAX_FALL           = 3;    // a truly awful basho can drop up to 1+MAX_FALL ranks

  function clampIdx(i){ i = i|0; return i<0?0:(i>9?9:i); }

  /* users: [{ handle, score(win-rate 0..1)|null, rankIdx, bashoCount, topStreak }] — mutates & returns. */
  function applyBasho(users){
    var active = users.filter(function(u){ return typeof u.score === "number"; });
    var N = active.length;
    if (!N) return users;
    active.forEach(function(u){                 // percentile of the win rate vs the whole field
      var below=0, eq=0, i;
      for (i=0;i<N;i++){ if (active[i].score < u.score) below++; else if (active[i].score === u.score) eq++; }
      u._p = N>1 ? (below + 0.5*(eq-1)) / (N-1) : 1;
    });
    active.forEach(function(u){
      var idx = clampIdx(u.rankIdx||0), cfg = CFG[idx], p = u._p;
      var bashoCount = (u.bashoCount||0) + 1;
      u.topStreak = (p >= TOP_PCTL) ? (u.topStreak||0) + 1 : 0;
      var next = idx;
      if (idx === 9){                                            // Yokozuna
        if (p < cfg.down) next = 8;
      } else if (idx === 8){                                     // Ozeki — the gate to Yokozuna
        if (p >= cfg.up && u.topStreak >= 2 && bashoCount >= YOKOZUNA_MIN_BASHO) next = 9;
        else if (p < cfg.down) next = 7;
      } else if (p >= cfg.up){                                   // climb
        var steps = 1;
        if (cfg.jump > 1){ var over=(p-cfg.up)/(1-cfg.up+1e-9); steps = Math.min(cfg.jump, 1 + Math.floor(over*cfg.jump)); }
        next = idx + steps;
        if (next >= 9 && !(bashoCount >= YOKOZUNA_MIN_BASHO && u.topStreak >= 2)) next = 8;
      } else if (p < cfg.down){                                  // fall — steeper the worse the record
        var depth = (cfg.down - p) / (cfg.down + 1e-9);          // 0..1 how far below the floor
        next = idx - (1 + Math.floor(depth * MAX_FALL));
      }
      u.rankIdx = clampIdx(next);
      u.bashoCount = bashoCount;
      delete u._p;
    });
    return users;
  }

  function rankOf(idx){ return RANKS[clampIdx(idx)]; }

  var API = { RANKS:RANKS, CFG:CFG, YOKOZUNA_MIN_BASHO:YOKOZUNA_MIN_BASHO, TOP_PCTL:TOP_PCTL,
              applyBasho:applyBasho, rankOf:rankOf, clampIdx:clampIdx };
  if (typeof module!=="undefined" && module.exports) module.exports = API;
  if (typeof window!=="undefined") window.GGRank = API;
})();
