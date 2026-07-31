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
 *      const res = await GGRoster.load();          // {ok, live, bashoId, label, ranks, count}
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
            var ranks = {};
            mak.concat(jur).forEach(function (w) { ranks[w.name] = w; });
            return { ok: true, live: true, bashoId: id, label: label(id), ranks: ranks,
                     count: { makuuchi: mak.length, juryo: jur.length } };
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

  window.GGRoster = {
    load: load, applyTo: applyTo,
    bashoCandidates: bashoCandidates, deriveFromRank: deriveFromRank, label: label,
    _fetchBanzuke: fetchBanzuke
  };
})();
