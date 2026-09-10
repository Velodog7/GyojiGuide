/* ── gg-torikumi.js ────────────────────────────────────────────────────────
   The matchmaking engine: how a basho's day-to-day card gets built, and how a
   bout resolves. Lifted verbatim out of dohyo.html so that more than one page
   can ask "who is he likely to face?" without a second copy of the model.

   It is a factory rather than a module of globals because it needs a roster to
   reason about, and different callers hand it different ones — the simulator
   passes its own ROSTER, the rikishi page passes one built from the live
   banzuke. Everything it needs from outside arrives in `ctx`; nothing is read
   off `window`.

   ctx:
     ROSTER         name -> { d, code, elo, stable, sig }
     ROSTER_BY_DIV  { makuuchi:[names], juryo:[names] } — mutated in place, not
                    reassigned, so binding it by value here is safe
     BASHO_DAYS     15
     RANK_ORDER     { Y:0, O:1, S:2, K:3, M:4, J:5 }
     REAL_SNAP      real announced cards by day, or {} when there are none
     ELO_SCALE, FORM_PTS   the bout model's constants
     onBanzuke(n)   is this man on the current banzuke
     elo(n)         his Elo, with a default
     pairKey(a,b)   order-independent key for a pairing

   Exposes only what dohyo.html actually used across the boundary: rng32,
   runSeason and championOf. Everything else stays internal.
   ---------------------------------------------------------------------- */
(function () {
  function create(ctx) {
    var ROSTER        = ctx.ROSTER,
        ROSTER_BY_DIV = ctx.ROSTER_BY_DIV,
        BASHO_DAYS    = ctx.BASHO_DAYS,
        RANK_ORDER    = ctx.RANK_ORDER,
        REAL_SNAP     = ctx.REAL_SNAP || {},
        ELO_SCALE     = ctx.ELO_SCALE,
        FORM_PTS      = ctx.FORM_PTS,
        onBanzuke     = ctx.onBanzuke,
        elo           = ctx.elo,
        pairKey       = ctx.pairKey;

    /* Banzuke position, from the rank code. These live IN the module rather
       than being injected: they are pure functions of ROSTER and RANK_ORDER,
       and a matchmaking engine that cannot order a banzuke by itself is not a
       module, it is a fragment. dohyo.html keeps its own copies for its UI
       (bandOf / eligible), which is a different job. */
    function rankOf(name){
      const c = (ROSTER[name] && ROSTER[name].code) || "M99e";
      return { tier: c[0], num: parseInt(c.slice(1, -1)) || 0 };
    }
    function rankSort(a, b){
      const ra = rankOf(a), rb = rankOf(b);
      const ta = RANK_ORDER[ra.tier] ?? 9, tb = RANK_ORDER[rb.tier] ?? 9;
      if (ta !== tb) return ta - tb;
      if (ra.num !== rb.num) return ra.num - rb.num;
      const sa = ROSTER[a].code.slice(-1), sb = ROSTER[b].code.slice(-1);
      return sa === sb ? 0 : (sa === "e" ? -1 : 1);
    }

    function rng32(seed){
      let a = seed >>> 0;
      return () => { a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    }
    function winProbE(eE, eW, fE, fW){
      const dE = eE + FORM_PTS * fE, dW = eW + FORM_PTS * fW;
      return 1 / (1 + Math.pow(10, (dW - dE) / ELO_SCALE));
    }

    const H2H_PTS = 14;   // Elo-equivalent tilt per net all-time head-to-head win (capped)
    function clampN(v, lo, hi){ return v < lo ? lo : v > hi ? hi : v; }

    /* Health/condition — drawn fresh at the start of each simulated basho, so it
       shifts run to run. Most men arrive around normal; a minority carry a knock
       (negative) or come in peak shape (positive). It's an Elo-equivalent modifier
       applied for the whole tournament. */
    function drawConditions(rng){
      const c = {};
      for (const n of Object.keys(ROSTER)){
        const r = rng();
        c[n] = r < 0.15 ? -(18 + Math.floor(rng() * 62))   // ~15% nicked up:  -18…-80
             : r < 0.27 ?  (10 + Math.floor(rng() * 28))   // ~12% peak form:  +10…+38
             : 0;
      }
      return c;
    }

    /* P(east wins), from Elo + current form + all-time head-to-head + condition.
       The random roll against this in matchDay/realDay is what keeps outcomes
       uncertain — a favourite is likely, never guaranteed. */
    function boutProb(e, w, st, h2h, cond){
      let hE = 0, hW = 0;
      const m = /^(\d+)-(\d+)$/.exec(String(h2h || ""));
      if (m) { hE = +m[1]; hW = +m[2]; }
      const tilt = H2H_PTS * clampN(hE - hW, -6, 6);          // cap so old rivalries don't dominate
      const eE = elo(e) + (cond ? cond[e] || 0 : 0) + tilt;
      const eW = elo(w) + (cond ? cond[w] || 0 : 0);
      return winProbE(eE, eW, st[e].w - st[e].l, st[w].w - st[w].l);
    }

    /* kimarite: each man wins with his OWN technique. His signature style tags
       (sig, from Sumo Slapdown) map to the finishing moves they imply; the primary
       style dominates, so his most-common kimarite is the modal outcome, with a
       light tail for the occasional off-technique win. */
    const SIG2KIM = {
      oshi:["oshidashi","oshitaoshi"],  tsuppari:["tsukidashi","oshidashi"],
      tsuki:["tsukidashi","tsukiotoshi"], yori:["yorikiri","yoritaoshi"],
      yotsu:["yorikiri","yoritaoshi"],  zashi:["yorikiri","yoritaoshi"],
      nage:["uwatenage","shitatenage","sukuinage"],
      uwatenage:["uwatenage"], shitatenage:["shitatenage"], shitatehineri:["shitatehineri"],
      sukuinage:["sukuinage"], kotenage:["kotenage"],
      hatakikomi:["hatakikomi"], hikiotoshi:["hikiotoshi"], tsukiotoshi:["tsukiotoshi"],
      katasukashi:["katasukashi"], inashi:["tsukiotoshi","hatakikomi"], ashitori:["ashitori"],
    };
    const SIG_KEYS  = Object.keys(SIG2KIM).sort((a,b) => b.length - a.length);  // specific before generic
    const SIG_POS_W = [6, 3, 1.6, 0.9];   // weight a style by where it sits in his signature list
    const KIM_TAIL  = { oshidashi:.5, yorikiri:.5, hatakikomi:.5, tsukiotoshi:.5, uwatenage:.35, sukuinage:.25 };
    function pickKimarite(rng, sig){
      if (rng() < 0.045) return "henka";              // the rare sidestep at the tachiai
      const w = {};
      (sig || []).forEach((s, i) => {
        const key = SIG_KEYS.find(k => s.includes(k));
        if (!key) return;
        const base = SIG_POS_W[i] ?? 0.6;
        SIG2KIM[key].forEach((k, j) => { w[k] = (w[k] || 0) + base * (j === 0 ? 1 : 0.5); });
      });
      for (const [k,v] of Object.entries(KIM_TAIL))   // the occasional off-technique win
        w[k] = (w[k] || 0) + v;
      const total = Object.values(w).reduce((a,b) => a+b, 0);
      let x = rng() * total;
      for (const [k,v] of Object.entries(w)) if ((x -= v) < 0) return k;
      return "oshidashi";
    }

    function freshStandings(){
      const st = {};
      for (const n of Object.keys(ROSTER)) st[n] = { w:0, l:0 };   // nobody has fought yet
      return st;
    }
    function seedMet(){
      const met = new Set();
      for (const day of Object.values(REAL_SNAP))
        for (const div of ["makuuchi","juryo"])
          for (const b of day[div]) met.add(pairKey(b[1], b[5]));
      return met;
    }

    /* ── torikumi: how the shinpan-bu actually build a card ────────────────────
       Real matchmaking is rank-driven early and record-driven late:

       • Days 1–~9    Everyone fights inside their own rank neighbourhood. The
                      sanyaku work through the joi (the top maegashira); the
                      rank-and-file meet men ranked near them. Two sanyaku are
                      essentially never paired this early.
       • Days ~10–15  The card turns into a leaderboard. Equal records are matched,
                      a maegashira on a tear gets pulled up into the sanyaku, and
                      the marquee bouts are spent one per day.
       • Senshuraku   The biggest pairing the banzuke can offer — Yokozuna vs
                      Yokozuna where there are two — is held back for the last day
                      as the musubi no ichiban.

       Everything below keys off banzuke position and win count. Nothing keys off
       who a wrestler is.
       ───────────────────────────────────────────────────────────────────────── */

    /* Ordered banzuke position within a division. 0 = Yokozuna east. */
    const _rankPos = {};
    function rankPosMap(divName){
      if (_rankPos[divName]) return _rankPos[divName];
      const m = {};
      ROSTER_BY_DIV[divName].slice().sort(rankSort).forEach((n, i) => { m[n] = i; });
      return (_rankPos[divName] = m);
    }
    const tierOf = n => RANK_ORDER[rankOf(n).tier] ?? 9;      // Y0 O1 S2 K3 M4 J5

    /* The earliest day the schedulers would put two sanyaku together. The marquee
       pairings are spent from the back of the basho forwards, so the biggest bout
       on the banzuke lands on the final day and nothing above komusubi meets in
       the first week. Expressed against the basho length, not hard-coded days. */
    function sanyakuGate(a, b, days){
      const ta = tierOf(a), tb = tierOf(b);
      if (ta > 3 || tb > 3) return 1;                          // a maegashira: no gate
      const hi = Math.min(ta, tb), lo = Math.max(ta, tb);
      if (hi === 0 && lo === 0) return days;                   // Y v Y     → senshuraku
      if (lo <= 1)              return days - 4;               // Y/Ō v Y/Ō → day 11+
      /* S/K bouts are NOT marquee — a yokozuna's fifteen opponents are roughly the
         eight other sanyaku plus seven joi maegashira, so these have to start in
         week one. Gate them any later and the top of the banzuke runs out of legal
         opponents and starts reaching down to M14, which never happens for real. */
      if (hi <= 1)              return Math.max(1, days - 10); // Y/Ō v S/K → day 5+
      return Math.max(1, days - 11);                           // S/K v S/K → day 4+
    }

    /* The gate only says a pairing *may* happen. The shinpan-bu also don't wait
       for the leaderboard to throw the big ones together — they hold them back and
       spend them one a day over the closing stretch, most senior last. Without this
       two Yokozuna can simply never be sorted next to each other and the basho ends
       without its musubi no ichiban. */
    function reserveBout(divName, met, D, days){
      if (D < days - 4) return null;                           // last five days only
      const san = ROSTER_BY_DIV[divName].filter(n => tierOf(n) <= 3);
      let best = null;
      for (let i = 0; i < san.length; i++){
        for (let j = i + 1; j < san.length; j++){
          const a = san[i], b = san[j];
          if (met.has(pairKey(a, b))) continue;
          if (ROSTER[a].stable === ROSTER[b].stable) continue;
          const gate = sanyakuGate(a, b, days);
          if (D < gate) continue;
          const seniority = tierOf(a) + tierOf(b);             // lower = bigger bout
          if (!best || seniority < best.seniority
                   || (seniority === best.seniority && gate > best.gate)) {
            best = { a, b, seniority, gate };
          }
        }
      }
      return best;
    }

    function matchDay(divName, st, met, rng, cond, D){
      const days = BASHO_DAYS;
      const pos  = rankPosMap(divName);
      const pool = ROSTER_BY_DIV[divName].slice();
      const N    = pool.length;

      /* The sort key slides from rank to record across the fifteen days. A win is
         worth almost nothing on day 1 and several rank slots by senshuraku, which
         is what turns the card from a banzuke into a leaderboard — and what pulls
         a hot low-ranker up the sheet without ever naming him. */
      const t    = (D - 1) / Math.max(1, days - 1);
      const perW = 1.2 + 7.0 * t * t;                          // rank slots per net win
      const key  = n => pos[n] - perW * (st[n].w - st[n].l) / 2;
      pool.sort((a, b) => key(a) - key(b) || pos[a] - pos[b]);

      /* Fold pairing inside a block, which is how a Swiss draw works and how a
         rank block actually gets matched: split the block in half and play the top
         half against the bottom half. Nobody faces the man immediately beside them
         on the banzuke — that alone is what keeps the two Yokozuna apart on day 1
         — and the offset rotates by day so a block never reproduces its own card. */
      const BLOCK = Math.max(4, Math.min(16, N));
      function foldTarget(i){
        const s   = Math.floor(i / BLOCK) * BLOCK;
        const blk = Math.min(BLOCK, N - s);
        if (blk < 2) return i;
        const h = Math.max(1, blk >> 1), k = i - s, r = (D - 1);
        const j = k < h ? h + ((k + r) % Math.max(1, blk - h))
                        : (((k - h) - r) % h + h) % h;
        return s + j;
      }

      const gateOK   = (x, y) => D >= sanyakuGate(x, y, days);
      const stableOK = (x, y) => ROSTER[x].stable !== ROSTER[y].stable;
      const freshOK  = (x, y) => !met.has(pairKey(x, y));
      /* A big jump up the banzuke has to be earned. The schedulers pull a
         maegashira up because he is winning, never because the card ran out of
         neighbours — so a wide gap needs a winning record from the man below. */
      const gapOK = (x, y) => {
        const g = Math.abs(pos[x] - pos[y]);
        if (g <= 14) return true;
        const low = pos[x] > pos[y] ? x : y;
        return (st[low].w - st[low].l) >= Math.max(2, Math.round((D - 1) * 0.34));
      };
      const hardOK = (x, y) => x !== y && freshOK(x, y) && stableOK(x, y) && gateOK(x, y);
      const legal  = (x, y) => hardOK(x, y) && gapOK(x, y);

      const used = new Set(), pairs = [];

      /* Today's reserved marquee bout goes on the card before anything else. */
      const rsv = reserveBout(divName, met, D, days);
      if (rsv){ used.add(rsv.a); used.add(rsv.b); pairs.push([rsv.a, rsv.b]); }

      /* Closest legal partner to the fold target, so a blocked pairing slides a
         rank or two rather than falling back to whoever is left over. */
      function nearest(i, allowGap, allowRe, allowGate, allowStable){
        const a = pool[i], want = foldTarget(i);
        let best = -1, bestD = Infinity;
        for (let j = 0; j < N; j++){
          if (j === i) continue;
          const b = pool[j]; if (used.has(b)) continue;
          if (!allowGap    && !gapOK(a, b))    continue;
          if (!allowRe     && !freshOK(a, b))  continue;
          if (!allowStable && !stableOK(a, b)) continue;
          if (!allowGate   && !gateOK(a, b))   continue;
          const d = Math.abs(j - want);
          if (d < bestD){ bestD = d; best = j; }
        }
        return best;
      }
      for (let i = 0; i < N; i++){
        const a = pool[i]; if (used.has(a)) continue;
        /* Give way in the order the schedulers would: an unearned pull-up first,
           then a rematch, then an early marquee bout, and only ever a stablemate
           pairing if the card is otherwise impossible. */
        let j = nearest(i, false, false, false, false);
        if (j < 0) j = nearest(i, true,  false, false, false);
        if (j < 0) j = nearest(i, true,  true,  false, false);
        if (j < 0) j = nearest(i, true,  true,  true,  false);
        if (j < 0) j = nearest(i, true,  true,  true,  true);
        if (j < 0) continue;
        used.add(a); used.add(pool[j]); pairs.push([a, pool[j]]);
      }

      /* 2-opt repair: swap partners between two bouts to clear a rematch, a
         stablemate pairing, or a marquee bout that has come up too early. */
      const locked = rsv ? 1 : 0;              // pairs[0] is the reserved bout — leave it alone

      /* 2-opt repair, run twice with different bars. A rematch or a stablemate
         pairing simply never happens in a real basho, so the first pass clears
         those and will accept a wider rank gap to do it. The second pass then
         tidies the gaps, refusing any swap that would reintroduce the first. */
      function repair(bad, bars){
        for (let pass = 0; pass < 8; pass++){
          let fixed = 0;
          for (let i = locked; i < pairs.length; i++){
            if (!bad(pairs[i][0], pairs[i][1])) continue;
            let done = false;
            for (const ok of bars){                 // tightest bar first, then give ground
              for (let j = locked; j < pairs.length; j++){
                if (j === i) continue;
                const [a, b] = pairs[i], [c, d] = pairs[j];
                if (ok(a, c) && ok(b, d)) { pairs[i] = [a, c]; pairs[j] = [b, d]; done = true; break; }
                if (ok(a, d) && ok(b, c)) { pairs[i] = [a, d]; pairs[j] = [b, c]; done = true; break; }
              }
              if (done) break;
            }
            if (done) fixed++;
          }
          if (!fixed) break;
        }
      }
      /* Rematches and stablemate bouts never happen in a real basho, so clear those
         first — preferring a swap that also keeps the rank gap sensible, and only
         widening the gap if that is the sole way out. Then tidy the gaps. */
      repair((x, y) => !hardOK(x, y), [legal, hardOK]);
      repair((x, y) => !legal(x, y),  [legal]);

      for (const [a, b] of pairs) met.add(pairKey(a, b));

      /* Card order: lowest ranks open the day, the most senior pairing closes it
         as the musubi no ichiban. */
      const prestige = p => Math.min(pos[p[0]], pos[p[1]]);
      pairs.sort((p, q) => prestige(q) - prestige(p));

      return pairs.map(([x, y]) => {
        let e = x, w = y;                                          // east/west placement
        const sx = ROSTER[x].code.slice(-1), sy = ROSTER[y].code.slice(-1);
        if (sx === sy) { if (elo(y) > elo(x)) { e = y; w = x; } }
        else if (sx === "w") { e = y; w = x; }
        const pe = boutProb(e, w, st, "0-0", cond);
        const eastWins = rng() < pe;
        if (eastWins) { st[e].w++; st[w].l++; } else { st[w].w++; st[e].l++; }
        const sig = ROSTER[eastWins ? e : w].sig;
        return [ROSTER[e].code, e, eastWins ? "e" : "w", pickKimarite(rng, sig), ROSTER[w].code, w, "0-0"];
      });
    }

    function realDay(D, st, rng, cond){                                  // real announced card → project every bout
      const src = REAL_SNAP[String(D)], out = {};
      const fought = new Set();
      for (const div of ["makuuchi","juryo"]) {
        out[div] = src[div].map(b => {
          const t = b.slice();
          const e = t[1], w = t[5];                                // keep matchup + all-time h2h (t[6])
          const pe = boutProb(e, w, st, t[6], cond);
          const eastWins = rng() < pe;
          t[2] = eastWins ? "e" : "w";
          t[3] = pickKimarite(rng, ROSTER[eastWins ? e : w].sig);
          if (st[e]) (eastWins ? st[e] : st[w]).w++;
          if (st[w]) (eastWins ? st[w] : st[e]).l++;
          fought.add(e); fought.add(w);
          return t;
        });
      }
      /* Fusenpai. An announced card is 21 Makuuchi bouts drawn from 41 Makuuchi men
         plus a Jūryō visitor, so somebody is always left off it — and in sumo a man
         who doesn't appear takes a default loss. Without this he finishes the basho
         on fewer than fifteen decided bouts, which makes his record incomparable
         with everyone else's and quietly puts the yūshō out of his reach. */
      for (const div of ["makuuchi","juryo"])
        for (const n of ROSTER_BY_DIV[div])
          if (!fought.has(n) && st[n]) st[n].l++;
      return out;
    }

    function championOf(st, rng){                                  // Makuuchi yūshō
      const mk = ROSTER_BY_DIV.makuuchi;
      const top = Math.max(...mk.map(n => st[n].w));
      const tied = mk.filter(n => st[n].w === top);
      if (tied.length === 1) return tied[0];
      const wts = tied.map(n => Math.pow(10, elo(n) / 400));       // playoff, Elo-weighted
      let x = rng() * wts.reduce((a,b)=>a+b,0);
      for (let i = 0; i < tied.length; i++) if ((x -= wts[i]) < 0) return tied[i];
      return tied[0];
    }
    function runSeason(rng, fill){
      const st = freshStandings(), met = seedMet(), days = {};
      const cond = drawConditions(rng);                            // this run's health/condition draw
      for (let D = 1; D <= BASHO_DAYS; D++){                        // the whole tournament, Day 1 → 15
        const day = REAL_SNAP[String(D)]                            // real announced opening cards where known
          ? realDay(D, st, rng, cond)
          : { makuuchi: matchDay("makuuchi", st, met, rng, cond, D), juryo: matchDay("juryo", st, met, rng, cond, D) };
        if (fill) days[String(D)] = { label:`Day ${D}`, sub:`Day ${D} · Simulation`,
                                      makuuchi:day.makuuchi, juryo:day.juryo };
      }
      return { st, days };
    }
    return { rng32: rng32, runSeason: runSeason, championOf: championOf,
             matchDay: matchDay, rankPosMap: rankPosMap, sanyakuGate: sanyakuGate };
  }
  window.GGTorikumi = { create: create };
})();
