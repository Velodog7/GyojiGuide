/*  gg-roster.js  ·  gyojiguide.com
 *  ---------------------------------------------------------------------
 *  One shared loader that pulls the CURRENT banzuke (Makuuchi + Jūryō)
 *  from sumo-api.com and hands every page a fresh rank map. Each page
 *  keeps its own curated data (photos, Elo, stable, fighting styles,
 *  form/injury notes) and simply lets this module refresh the one thing
 *  the public API can actually supply reliably: who is ranked where right
 *  now, plus this basho's win–loss record where available.
 *
 *  Design goals:
 *   - LIVE-FIRST. Try the API; only fall back to the page's bundled roster
 *     if the API can't be reached (offline / CORS / bad response).
 *   - NON-DESTRUCTIVE. Never drop a page's curated fields. We update rank
 *     fields on wrestlers the page already knows, optionally add newcomers
 *     (for pages that can render a bare card), and report — but never
 *     silently delete — anyone who has dropped off the banzuke.
 *   - FRAMEWORK-FREE. Plain <script src="gg-roster.js"></script>, exposes
 *     window.GGRoster. No build step, matches the rest of the site.
 *
 *  Usage:
 *      const res = await GGRoster.load();          // {ok, live, bashoId, label, ranks, started, count}
 *      // res.started === false  -> this banzuke's basho has not been fought yet:
 *      //   ranks are real, records are null. Never write those over a real result.
 *      if (res.ok) {
 *        const summary = GGRoster.applyTo(RK, res.ranks, { codeField:"code", ... });
 *        // then re-render; summary = {updated:[], newcomers:[], missing:[]}
 *      }
 *  ------------------------------------------------------------------- */
(function () {
  "use strict";

  var API_BASE = "https://www.sumo-api.com/api";

  // full rank words (as the banzuke returns them) -> tier letter
  var RANK_WORD = {
    yokozuna: "Y", ozeki: "O", "\u014dzeki": "O", sekiwake: "S", komusubi: "K",
    maegashira: "M", juryo: "J", "j\u016bry\u014d": "J", jury: "J"
  };
  var TIER_NAME = { Y: "sanyaku", O: "sanyaku", S: "sanyaku", K: "sanyaku", M: "maegashira", J: "juryo" };
  var MONTH_NAME = { "01": "Hatsu", "03": "Haru", "05": "Natsu", "07": "Nagoya", "09": "Aki", "11": "Ky\u016bsh\u016b" };

  // Candidate basho ids (YYYYMM), newest first, walking back ~2 years.
  // We start one basho AHEAD of "now" so that the instant a new banzuke is
  // published, pages pick it up on their own; unpublished ids just return
  // empty and we fall through to the most recent real one.
  function bashoCandidates(d) {
    d = d || new Date();
    var odd = [1, 3, 5, 7, 9, 11];
    var y = d.getFullYear(), m = d.getMonth() + 1;
    var recent, ry = y, i;
    for (i = odd.length - 1; i >= 0; i--) { if (odd[i] <= m) { recent = odd[i]; break; } }
    if (recent === undefined) { recent = 11; ry = y - 1; }
    var ui = odd.indexOf(recent) + 1, uy = ry;          // one ahead = upcoming basho
    if (ui >= odd.length) { ui = 0; uy = ry + 1; }
    var out = [], ci = ui, cy = uy, k;
    for (k = 0; k < 8; k++) {
      out.push("" + cy + (odd[ci] < 10 ? "0" + odd[ci] : odd[ci]));
      ci--; if (ci < 0) { ci = odd.length - 1; cy--; }
    }
    return out;
  }

  function label(id) {
    return (MONTH_NAME[id.slice(4)] || id.slice(4)) + " " + id.slice(0, 4);
  }

  /* The basho before this one. Banzuke ids are YYYYMM on the six odd months, so
     stepping back is minus two months with a year wrap — no date arithmetic and
     no dependence on today, which matters because the id we are stepping back
     from was itself found by walking backwards until a banzuke was published. */
  function prevBashoId(id) {
    /* Shape-check the whole id rather than trusting parseInt, which happily
       reads "20xx09" as the year 20 and would answer "2007" — a basho id that
       looks plausible enough to fetch and is nonsense. */
    if (!/^\d{6}$/.test(String(id))) return "";
    var y = parseInt(String(id).slice(0, 4), 10), m = parseInt(String(id).slice(4, 6), 10);
    if (m < 1 || m > 12) return "";
    m -= 2; if (m < 1) { m += 12; y -= 1; }
    return "" + y + (m < 10 ? "0" + m : m);
  }

  /* Lower is better, mirroring sumo-api's own rankValue scheme: one division
     every hundred, position within it after. Only the ORDER is ever used, so
     the absolute numbers do not need to match theirs.

     Side is deliberately NOT part of it. M5e does outrank M5w, but nobody calls
     that a promotion, and counting it as one would print "▼ M5→M5" — a pill
     that contradicts itself. */
  var TIER_STEP = { Y: 0, O: 1, S: 2, K: 3, M: 4, J: 5 };
  function rankOrdinal(w) {
    var t = TIER_STEP[w.tier];
    return (t === undefined ? 9 : t) * 100 + (w.num || 0);
  }

  /* What changed for this banzuke, computed by diffing two banzuke.

     Not from each man's rankHistory, because the bulk /rikishis endpoint that
     carries it returns only the first hundred rikishi by id and ignores `skip`
     entirely — it echoes the value back and sends the same rows. More than five
     hundred men, Onosato and Aonishiki among them, cannot be reached through it
     at all, so a pill built that way is correct for whoever happens to fall in
     that window and silently stale for everyone else.

     The banzuke has no such cap, and it is the same document the rank printed
     beside the pill comes from — so the two can never disagree. */
  function attachChange(ranks, prev) {
    var name, cur, was, a, b;
    for (name in ranks) {
      if (!Object.prototype.hasOwnProperty.call(ranks, name)) continue;
      cur = ranks[name]; was = prev[name];
      if (!was) {
        /* Absent from BOTH divisions last time, so he was Makushita or below.
           Whether that is a debut or a return is not knowable from two banzuke,
           and this label does not guess at it. */
        cur.chg = { d: "new", t: "up to sekitori", from: "", to: cur.rk };
        continue;
      }
      a = rankOrdinal(was); b = rankOrdinal(cur);
      cur.chg = { d: b < a ? "up" : (b > a ? "down" : "same"),
                  t: was.rk + "\u2192" + cur.rk, from: was.rk, to: cur.rk };
    }
  }

  // "Maegashira 5 West" / "Yokozuna 1 East" / "Juryo 3 East" -> structured rank
  function deriveFromRank(rankStr, divisionHint) {
    var s = String(rankStr || "").trim();
    var first = (s.split(/\s+/)[0] || "").toLowerCase().replace(/[^a-z\u0101\u014d\u016b]/g, "");
    var tier = RANK_WORD[first] || (divisionHint === "Juryo" ? "J" : "M");
    var numM = s.match(/\d+/);
    var num = numM ? parseInt(numM[0], 10) : 0;
    var side = /west/i.test(s) ? "w" : "e";
    var hasNum = (tier === "M" || tier === "J");
    var code = tier + (hasNum && num ? num : "") + side;   // "Ye", "M5w", "J3e"
    var rk = tier + (hasNum && num ? num : "");            // "Y", "M5", "J3"
    return {
      tier: tier, num: num, side: side, sideCap: side.toUpperCase(),
      code: code, rk: rk, tierName: TIER_NAME[tier] || "maegashira",
      div: tier === "J" ? "juryo" : "makuuchi", rankStr: s
    };
  }

  function fetchBanzuke(bashoId, division) {
    var url = API_BASE + "/basho/" + bashoId + "/banzuke/" + division;
    return fetch(url, { headers: { "Accept": "application/json" } }).then(function (res) {
      if (!res.ok) throw new Error(division + " " + res.status);
      return res.json();
    }).then(function (data) {
      var rows = [].concat(data.east || [], data.west || []);
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var e = rows[i];
        var name = e.shikonaEn || e.shikona || e.Rikishi || "";
        if (!name) continue;
        var d = deriveFromRank(e.rank || "", division);
        var wins = (typeof e.wins === "number") ? e.wins : null;
        var losses = (typeof e.losses === "number") ? e.losses : null;
        out.push({
          name: name, rikishiId: e.rikishiID || e.rikishiId || e.id || null,
          code: d.code, rk: d.rk, tier: d.tier, num: d.num,
          side: d.side, sideCap: d.sideCap, tierName: d.tierName,
          div: division === "Juryo" ? "juryo" : "makuuchi",
          rankStr: e.rank || "", wins: wins, losses: losses,
          record: (wins !== null && losses !== null) ? (wins + "-" + losses) : null
        });
      }
      return out;
    });
  }

  // Try each candidate basho until one returns a full banzuke.
  function load(opts) {
    opts = opts || {};
    var cands = opts.bashoId ? [opts.bashoId] : bashoCandidates(opts.date);
    var idx = 0;
    function tryNext() {
      if (idx >= cands.length) return { ok: false, live: false, error: "unreachable" };
      var id = cands[idx++];
      return Promise.all([fetchBanzuke(id, "Makuuchi"), fetchBanzuke(id, "Juryo")])
        .then(function (pair) {
          var mak = pair[0], jur = pair[1];
          if (mak.length >= 20 && jur.length >= 10) {
            var all = mak.concat(jur);
            /* A banzuke is published ~2 weeks before its basho, so the newest
               one we find is usually for a tournament that hasn't been fought
               yet. sumo-api still sends wins/losses on those rows — as 0 — and
               a caller doing `if (w.record)` would happily overwrite the last
               basho's real result with a meaningless 0-0. So decide here, once:
               if not a single bout has been recorded across the whole banzuke,
               the basho hasn't started, and we hand back NO records at all
               rather than a set of zeroes that look like results. */
            var bouts = 0;
            all.forEach(function (w) { bouts += (w.wins || 0) + (w.losses || 0); });
            var started = bouts > 0;
            if (!started) all.forEach(function (w) { w.record = null; w.wins = null; w.losses = null; });
            var ranks = {};
            all.forEach(function (w) { ranks[w.name] = w; });
            function done(changed) {
              return { ok: true, live: true, bashoId: id, label: label(id), ranks: ranks,
                       started: started, upcoming: !started, change: !!changed,
                       count: { makuuchi: mak.length, juryo: jur.length } };
            }
            /* Opt-in: two more requests, and only analysis.html wants them.
               Every other page reads ranks and records only, and should not pay
               for a rank-change pill it does not draw. */
            if (!opts.change) return done(false);
            var pid = prevBashoId(id);
            if (!pid) return done(false);
            return Promise.all([fetchBanzuke(pid, "Makuuchi"), fetchBanzuke(pid, "Juryo")])
              .then(function (pp) {
                /* Same published-banzuke floor as above. A thin or missing
                   previous banzuke means no pill at all — absent beats
                   present-and-wrong, and a wrong one here reads as a demotion
                   for a man who was just promoted. */
                if (pp[0].length < 20 || pp[1].length < 10) return done(false);
                var prev = {};
                pp[0].concat(pp[1]).forEach(function (w) { prev[w.name] = w; });
                attachChange(ranks, prev);
                return done(true);
              })
              .catch(function () { return done(false); });
          }
          return tryNext();                    // published-but-empty (future basho) → walk back
        })
        .catch(function () { return tryNext(); });
    }
    return Promise.resolve().then(tryNext);
  }

  /* Non-destructively patch a name-keyed roster object.
   *   obj      : the page's roster, e.g. RK   { "Hoshoryu": {code, kanji, ...}, ... }
   *   ranks    : res.ranks from load()        { "Hoshoryu": {code, rk, div, ...}, ... }
   *   opts:
   *     codeField   field to write the long code into (default "code")
   *     divField    field to write division into (e.g. "d"); omit to leave alone
   *     addNewcomers  if true, add wrestlers present live but missing from obj
   *     makeEntry(w)  builds a new entry object for a newcomer (required to add)
   *     onEntry(entry, w)  hook to update extra per-page fields (rk/side/num/record…)
   * Returns { updated:[names], newcomers:[names], missing:[names] }.
   */
  function applyTo(obj, ranks, opts) {
    opts = opts || {};
    var codeField = opts.codeField || "code";
    var divField = opts.divField || null;
    var summary = { updated: [], newcomers: [], missing: [] };
    var name, w;
    for (name in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, name)) continue;
      if (ranks[name]) {
        w = ranks[name];
        obj[name][codeField] = w.code;
        if (divField) obj[name][divField] = w.div;
        if (opts.onEntry) opts.onEntry(obj[name], w);
        summary.updated.push(name);
      } else {
        summary.missing.push(name);
      }
    }
    if (opts.addNewcomers && typeof opts.makeEntry === "function") {
      for (name in ranks) {
        if (!Object.prototype.hasOwnProperty.call(ranks, name)) continue;
        if (!(name in obj)) { obj[name] = opts.makeEntry(ranks[name]); summary.newcomers.push(name); }
      }
    }
    return summary;
  }

  /* Head-to-head record between two rikishi, from sumo-api's
   * /rikishi/:id/matches/:oppId endpoint. Returns { a, b, total } where
   * a = wins for idA, b = wins for idB — or null if it can't be fetched.
   * The endpoint's win-count keys have varied across versions, so we read
   * defensively (rikishiWins/opponentWins, and a matches[] fallback). */
  function headToHead(idA, idB) {
    if (!idA || !idB) return Promise.resolve(null);
    var url = API_BASE + "/rikishi/" + encodeURIComponent(idA) + "/matches/" + encodeURIComponent(idB);
    return fetch(url, { headers: { "Accept": "application/json" } })
      .then(function (res) { if (!res.ok) throw new Error("h2h " + res.status); return res.json(); })
      .then(function (d) {
        if (!d) return null;
        var a = pickNum(d, ["rikishiWins", "kachi", "aWins", "wins"]);
        var b = pickNum(d, ["opponentWins", "make", "bWins", "losses"]);
        // fall back to counting the matches[] array by winnerId
        if ((a == null || b == null) && Array.isArray(d.matches)) {
          var ca = 0, cb = 0, sA = String(idA);
          d.matches.forEach(function (m) {
            var w = String(m.winnerId || m.winnerID || m.winner_id || "");
            if (!w) return;
            if (w === sA) ca++; else cb++;
          });
          a = ca; b = cb;
        }
        if (a == null && b == null) return null;
        a = a || 0; b = b || 0;
        return { a: a, b: b, total: (typeof d.total === "number" ? d.total : a + b) };
      })
      .catch(function () { return null; });
  }
  function pickNum(obj, keys) {
    for (var i = 0; i < keys.length; i++) if (typeof obj[keys[i]] === "number") return obj[keys[i]];
    return null;
  }

  /* ---- BULK BIO/CAREER ENRICHMENT from /api/rikishis ----------------------
   * One paginated call fetches every rikishi's bio (heya, shusshin, height,
   * weight, birthDate, debut, shikonaJp) + rankHistory. parseBio() maps each to
   * the analysis card's fields. Pass { names:[...] } to keep only your roster and
   * stop early. Returns { ok, count, byName:{ shikonaEn: {stable,from,pref,
   * country,ht,wt,dob,age,debut,kanji,high,chg} } }. Editorial fields (form,
   * inj, lv, grade, elo, sig) are never touched — those stay curated. */
  function ageFrom(d){ var t=new Date(),a=t.getFullYear()-d.getFullYear(),m=t.getMonth()-d.getMonth(); if(m<0||(m===0&&t.getDate()<d.getDate()))a--; return a; }
  var JPREF=/(hokkaido|aomori|iwate|miyagi|akita|yamagata|fukushima|ibaraki|tochigi|gunma|saitama|chiba|tokyo|kanagawa|niigata|toyama|ishikawa|fukui|yamanashi|nagano|gifu|shizuoka|aichi|mie|shiga|kyoto|osaka|hyogo|nara|wakayama|tottori|shimane|okayama|hiroshima|yamaguchi|tokushima|kagawa|ehime|kochi|fukuoka|saga|nagasaki|kumamoto|oita|miyazaki|kagoshima|okinawa)/i;
  function parseShusshin(s){
    s=String(s||"").trim(); if(!s) return {from:"",country:"",pref:""};
    var isJP=/-ken|-fu|-to\b|-d[o\u014d]\b/i.test(s)||JPREF.test(s);
    if(isJP){ var pref=s.split(",")[0].replace(/-(ken|fu|to|d[o\u014d])$/i,"").trim(); pref=pref.charAt(0).toUpperCase()+pref.slice(1); return {from:pref+", Japan",country:"Japan",pref:pref}; }
    var parts=s.split(",").map(function(x){return x.trim();}).filter(Boolean);
    return { from:s, country:parts[parts.length-1]||s, pref:"" };
  }
  function highCode(r){ var d=deriveFromRank(r); return d.tier+(d.num?d.num:""); }
  function parseBio(e){
    var b={};
    if(e.heya) b.stable=e.heya;
    if(typeof e.height==="number"&&e.height) b.ht=e.height;
    if(typeof e.weight==="number"&&e.weight) b.wt=e.weight;
    if(e.shikonaJp) b.kanji=String(e.shikonaJp).split(/[\s\u3000]/)[0];
    if(e.debut&&/^\d{6}$/.test(String(e.debut))){ var dv=String(e.debut); b.debut=dv.slice(0,4)+"-"+dv.slice(4,6); }
    if(e.birthDate){ var bd=new Date(e.birthDate); if(!isNaN(bd.getTime())){ b.dob=String(e.birthDate).slice(0,10); b.age=ageFrom(bd); } }
    if(e.shusshin){ var o=parseShusshin(e.shusshin); b.from=o.from; b.country=o.country; b.pref=o.pref; }
    if(Array.isArray(e.rankHistory)&&e.rankHistory.length){
      var hist=e.rankHistory.slice().filter(function(r){return r&&r.rank;});
      var hi=null; hist.forEach(function(r){ if(typeof r.rankValue==="number"&&(hi===null||r.rankValue<hi.rankValue)) hi=r; });
      if(hi) b.high=highCode(hi.rank);
      hist.sort(function(a,c){ return String(c.bashoId).localeCompare(String(a.bashoId)); });
      if(hist.length>=2){ var cur=hist[0],prev=hist[1]; var d=(cur.rankValue<prev.rankValue)?"up":(cur.rankValue>prev.rankValue?"down":"same"); b.chg={d:d,t:deriveFromRank(prev.rank).rk+"\u2192"+deriveFromRank(cur.rank).rk}; }
    }
    return b;
  }
  /* The bulk endpoint returns AT MOST a hundred rikishi, lowest id first, and
     cannot be paged past that: `skip` is echoed back in the response and then
     ignored, `offset` returns nothing, and every sort parameter answers 400.
     As of Aki 2026 that reaches 53 of the 70 sekitori — Onosato (8850) and
     Aonishiki (8854) are among the seventeen it cannot.

     The old code asked for limit=1000, got 100, read that as a short final page
     and stopped, so those seventeen silently kept whatever the calling page had
     bundled. So: the bulk call is a cheap first pass, and anyone still wanted
     afterwards is fetched by id. Callers have those ids already — they ride on
     the banzuke rows load() hands back. */
  var BULK_CAP = 100;
  var LOOKUP_WIDTH = 4;

  function bioById(name, id){
    var url = API_BASE + "/rikishi/" + encodeURIComponent(id) +
              "?ranks=true&measurements=true&shikonas=true";
    return fetch(url, { headers: { "Accept": "application/json" } })
      .then(function (res) { if (!res.ok) throw new Error("rikishi " + res.status); return res.json(); })
      .then(function (e) {
        if (!e || !e.shikonaEn) return null;
        /* The id came from the banzuke row for this name, so they should agree.
           Checking costs nothing and catches an id pointing at the wrong man —
           which is exactly how head-to-head once shipped reading a photo id and
           got a confident, wrong answer for every pair. */
        if (String(e.shikonaEn).toLowerCase() !== String(name).toLowerCase()) return null;
        return parseBio(e);
      })
      .catch(function () { return null; });
  }

  /* a few at a time: seventeen parallel requests at sumo-api is rude, and the
     caller repaints when the whole batch lands either way */
  function inSeries(jobs, width) {
    var i = 0;
    function next() { return i >= jobs.length ? Promise.resolve() : jobs[i++]().then(next); }
    var lanes = [], k;
    for (k = 0; k < Math.min(width, jobs.length); k++) lanes.push(next());
    return Promise.all(lanes);
  }

  /* bios({ names, ids, maxLookups }) ->
       { ok, count, byName, bulk, lookedUp, missing:[names] }
     `ids` is optional {name: rikishiId}; without it this is the bulk pass alone
     and `missing` names everyone it could not reach, rather than pretending. */
  function bios(opts){
    opts = opts || {};
    var names = (opts.names && opts.names.length) ? opts.names.slice() : null;
    var want = null;
    if (names){ want = {}; names.forEach(function(n){ want[String(n).toLowerCase()] = 1; }); }
    var ids = opts.ids || {};
    var byName = {}, bulk = 0, lookedUp = 0;

    var url = API_BASE + "/rikishis?limit=" + BULK_CAP + "&measurements=true&ranks=true&shikonas=true";
    return fetch(url, { headers: { "Accept": "application/json" } })
      .then(function (res) { if (!res.ok) throw new Error("rikishis " + res.status); return res.json(); })
      .then(function (data) {
        (data.records || []).forEach(function (e) {
          var name = e.shikonaEn; if (!name) return;
          if (want && !want[name.toLowerCase()]) return;
          if (!byName[name]) { byName[name] = parseBio(e); bulk++; }
        });
      })
      .catch(function () { /* bulk unreachable — the per-id pass still stands */ })
      .then(function () {
        if (!names) return null;
        var missing = names.filter(function (n) { return !byName[n] && ids[n]; });
        var cap = (opts.maxLookups == null) ? 40 : opts.maxLookups;
        var jobs = missing.slice(0, cap).map(function (n) {
          return function () {
            return bioById(n, ids[n]).then(function (b) { if (b) { byName[n] = b; lookedUp++; } });
          };
        });
        return inSeries(jobs, LOOKUP_WIDTH);
      })
      .then(function () {
        return { ok: true, count: Object.keys(byName).length, bulk: bulk, lookedUp: lookedUp,
                 byName: byName,
                 missing: names ? names.filter(function (n) { return !byName[n]; }) : [] };
      })
      .catch(function (e) { return { ok: false, error: String(e) }; });
  }

  window.GGRoster = {
    load: load, bios: bios, applyTo: applyTo, headToHead: headToHead,
    bashoCandidates: bashoCandidates, deriveFromRank: deriveFromRank, label: label,
    prevBashoId: prevBashoId, _fetchBanzuke: fetchBanzuke
  };
})();
