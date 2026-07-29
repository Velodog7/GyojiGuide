/*  GYOJI GUIDE — shared accounts + prediction-game scoring
 *  ---------------------------------------------------------------
 *  Builds on gg-config.js (needs GyojiGuide.apiGet / apiPost). Include
 *  it AFTER gg-config.js on any page that wants accounts or standings:
 *
 *      <script src="gg-config.js"></script>
 *      <script src="gg-account.js"></script>
 *
 *  Fantasy Sumo is a PREDICTION game for the upcoming basho. You draft
 *  seven rikishi (one per rank band) before the tournament and can't
 *  swap them for injuries. Points accrue from the live day-by-day
 *  results in the Sheet:
 *
 *    · +1 for every match a wrestler wins (15 days)
 *    · beating a SANYAKU opponent adds a bonus = the rank gap:
 *        levels  M/J 0 · Komusubi 1 · Sekiwake 2 · Ozeki 3 · Yokozuna 4
 *        bonus = loserLevel - winnerLevel   (only when positive)
 *        e.g. a Maegashira over a Yokozuna = +4; Sekiwake over Ozeki = +1
 *    · +5 for each Sanshō (special prize)
 *    · +5 for the Makuuchi Yūshō
 *
 *  Ranks come from the embedded banzuke below (name -> tier). UPDATE it
 *  to the new banzuke when it's published each basho, or the sanyaku
 *  bonus will use stale ranks. Yūshō and Sanshō are read from the Meta
 *  tab of the Sheet (keys "yusho" and "sansho") once the basho ends.
 */
(function () {
  var GG = (window.GyojiGuide = window.GyojiGuide || {});

  /* ---- banzuke tiers (name -> Y/O/S/K/M/J). Refresh each basho. ---- */
  var RANKS = {"Hoshoryu":"Y","Onosato":"Y","Kirishima":"O","Kotozakura":"O","Atamifuji":"S","Kotoshoho":"S","Wakatakakage":"S","Aonishiki":"S","Yoshinofuji":"K","Oho":"K","Fujinokawa":"M","Takanosho":"M","Gonoyama":"M","Churanoumi":"M","Hiradoumi":"M","Hakunofuji":"M","Daieisho":"M","Ichiyamamoto":"M","Ura":"M","Oshoma":"M","Shodai":"M","Fujiseiun":"M","Kotoeiho":"M","Takayasu":"M","Wakamotoharu":"M","Roga":"M","Fujiryoga":"M","Tobizaru":"M","Asanoyama":"M","Chiyoshoma":"M","Wakanosho":"M","Mitakeumi":"M","Asahakuryu":"M","Abi":"M","Nishikifuji":"M","Takerufuji":"M","Kinbozan":"M","Shishi":"M","Onokatsu":"M","Kazuma":"M","Daiseizan":"M","Asakoryu":"M","Asasuiryu":"J","Kyokukaiyu":"J","Tokihayate":"J","Sadanoumi":"J","Ryuden":"J","Dewanoryu":"J","Tomokaze":"J","Toshinofuji":"J","Kitanowaka":"J","Oshoumi":"J","Shonanoumi":"J","Kazekeno":"J","Tamawashi":"J","Meisei":"J","Midorifuji":"J","Hatsuyama":"J","Shirokuma":"J","Nishinoryu":"J","Hitoshi":"J","Tamashoho":"J","Kagayaki":"J","Enho":"J","Tohakuryu":"J","Kayo":"J","Arashifuji":"J","Hakuyozan":"J","Tochitaikai":"J","Nishikigi":"J"};
  var LEVEL = { Y:4, O:3, S:2, K:1, M:0, J:0 };
  GG.RANKS = RANKS;
  // The page can hand us the current banzuke (e.g. from its own roster) so
  // the bonus math always matches what players actually drafted.
  GG.setRanks = function (map) { if (map) { RANKS = {}; for (var k in map) RANKS[k] = map[k]; GG.RANKS = RANKS; } };
  function tierOf(n) { return RANKS[n] || "M"; }
  function levelOf(n) { return LEVEL[tierOf(n)] || 0; }

  function parseList(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.map(function (x) { return String(x).trim(); }).filter(Boolean);
    return String(v).split(/[,;/]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* Build a scoring model from the Sheet payload ({ results, meta }). */
  GG.scoreModel = function (data) {
    data = data || {};
    var results = data.results || [], meta = data.meta || {};
    var wins = {}, bonus = {};
    results.forEach(function (b) {
      if (!b.winner) return;
      var w = b.winner, loser = (w === b.east) ? b.west : b.east;
      wins[w] = (wins[w] || 0) + 1;
      var diff = levelOf(loser) - levelOf(w);          // + only when the loser outranks in sanyaku
      if (diff > 0) bonus[w] = (bonus[w] || 0) + diff;
    });
    var sansho = {}; parseList(meta.sansho).forEach(function (n) { sansho[n] = 1; });
    var yusho = String(meta.yusho || "").trim();
    var lastDay = Number(meta.lastDay || results.reduce(function (m, r) { return Math.max(m, r.day || 0); }, 0));
    return {
      wins: wins, bonus: bonus, sansho: sansho, yusho: yusho,
      lastDay: lastDay, basho: meta.basho || "Fantasy Sumo",
      started: results.length > 0
    };
  };

  /* Score one team ({ band: name }) against a model. */
  GG.teamScore = function (team, model) {
    var pts = 0, rows = [];
    Object.keys(team || {}).forEach(function (k) {
      var n = team[k]; if (!n) return;
      var w = model.wins[n] || 0, bn = model.bonus[n] || 0;
      var sa = model.sansho[n] ? 5 : 0, yu = (model.yusho && model.yusho === n) ? 5 : 0;
      var p = w + bn + sa + yu; pts += p;
      rows.push({ name: n, tier: tierOf(n), w: w, bonus: bn, sansho: !!sa, yusho: !!yu, pts: p });
    });
    rows.sort(function (a, b) { return b.pts - a.pts; });
    return { pts: pts, rows: rows };
  };

  GG.standings = async function () {
    var data = null;
    try { data = await GG.apiGet("data"); } catch (e) {}
    var users = (data && data.users) || [];
    var model = GG.scoreModel(data || {});
    var rows = users.map(function (u) {
      var s = GG.teamScore(u.team || {}, model);
      return { handle: u.handle, name: u.name || u.handle, pts: s.pts, rows: s.rows };
    }).sort(function (a, b) { return b.pts - a.pts || String(a.name).localeCompare(String(b.name)); });
    return { rows: rows, model: model, count: users.length };
  };

  /* ---- accounts (shared across pages via one localStorage key) ---- */
  GG.pinAuth = async function (h, pin) {
    var msg = String(h).toLowerCase() + ":" + pin + ":tachiai.v1";
    if (window.crypto && crypto.subtle) {
      var d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(msg));
      return Array.prototype.map.call(new Uint8Array(d), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    }
    var x = 5381; for (var i = 0; i < msg.length; i++) x = ((x << 5) + x + msg.charCodeAt(i)) >>> 0;
    return "x" + x.toString(16);
  };
  GG.account = {
    KEY: "fantasy.acct",
    get: function () { try { return JSON.parse(localStorage.getItem(this.KEY) || "null"); } catch (e) { return null; } },
    set: function (a) { try { a ? localStorage.setItem(this.KEY, JSON.stringify(a)) : localStorage.removeItem(this.KEY); } catch (e) {} }
  };
  function validHandle(h) { return /^[A-Za-z0-9_.\-]{2,40}$/.test(h); }

  GG.register = async function (handle, name, pin) {
    handle = String(handle || "").trim();
    if (!validHandle(handle)) return { ok: false, error: "Handle: 2\u201340 letters, digits, _ . -" };
    if (String(pin || "").length < 4) return { ok: false, error: "PIN needs at least 4 characters." };
    name = (String(name || "").trim() || handle).slice(0, 60);
    var auth = await GG.pinAuth(handle, pin);
    if (!GG.hasAPI()) {
      var lk = "fantasy.acct.local." + handle.toLowerCase();
      if (localStorage.getItem(lk)) return { ok: false, error: "That handle already exists on this device \u2014 sign in." };
      try { localStorage.setItem(lk, auth); } catch (e) {}
      GG.account.set({ handle: handle, name: name, auth: auth });
      return { ok: true, created: true };
    }
    var res = await GG.apiPost({ action: "register", handle: handle, name: name, auth: auth });
    if (res && res.ok) GG.account.set({ handle: handle, name: name, auth: auth });
    return res;
  };
  GG.login = async function (handle, pin) {
    handle = String(handle || "").trim();
    if (!validHandle(handle)) return { ok: false, error: "Handle: 2\u201340 letters, digits, _ . -" };
    var auth = await GG.pinAuth(handle, pin);
    if (!GG.hasAPI()) {
      var lk = "fantasy.acct.local." + handle.toLowerCase();
      var stored = localStorage.getItem(lk);
      if (!stored) return { ok: false, error: "No account with that handle on this device \u2014 create one." };
      if (stored !== auth) return { ok: false, error: "Wrong PIN." };
      GG.account.set({ handle: handle, name: handle, auth: auth });
      return { ok: true, handle: handle, name: handle };
    }
    var res = await GG.apiPost({ action: "login", handle: handle, auth: auth });
    if (res && res.ok) GG.account.set({ handle: res.handle || handle, name: res.name || handle, auth: auth });
    return res;
  };
  GG.logout = function () { GG.account.set(null); };
  GG.saveTeam = async function (team) {
    var a = GG.account.get();
    if (!a) return { ok: false, error: "Sign in first." };
    return GG.apiPost({ action: "save", handle: a.handle, name: a.name, auth: a.auth, team: team || {} });
  };
})();
