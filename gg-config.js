/*  SUMO SLAPDOWN — shared site config
 *  ---------------------------------------------------------------
 *  One source of truth for the Fantasy Sumo backend. Include this on
 *  every page, BEFORE the page's own scripts:
 *
 *      <script src="gg-config.js"></script>
 *
 *  Any page can then read the endpoint or talk to the Sheet:
 *
 *      GyojiGuide.API_URL                       // the /exec URL, or "" if unset
 *      await GyojiGuide.apiGet("data")          // { ok, users, results, meta }
 *      await GyojiGuide.apiPost({ action:"save", ... })
 *
 *  If you ever re-deploy the Apps Script and get a NEW /exec URL, change
 *  it here once — not in each page.
 */
(function () {
  var GG = (window.GyojiGuide = window.GyojiGuide || {});

  // The deployed Apps Script web app (Google Sheet backend).
  GG.API_URL = "https://script.google.com/macros/s/AKfycbwn2ssF6Wqh0FNJyDJPg40kvGMurp-022erQ07xPS2jr3wK1taW_V4DcOr4zue86pmJlg/exec";

  GG.hasAPI = function () { return !!GG.API_URL; };

  // Read leaderboard data. action = "data" | "list" | "results".
  GG.apiGet = async function (action) {
    if (!GG.API_URL) return null;
    var r = await fetch(GG.API_URL + "?action=" + encodeURIComponent(action || "data"), { method: "GET" });
    return await r.json();
  };

  // GET with extra query params, e.g. apiGetQ("leagues", {handle:"tom"})
  GG.apiGetQ = async function (action, params) {
    if (!GG.API_URL) return null;
    var q = "?action=" + encodeURIComponent(action || "data");
    if (params) for (var k in params) q += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    var r = await fetch(GG.API_URL + q, { method: "GET" });
    return await r.json();
  };

  // Write (register / login / save). Uses a CORS-safelisted content type
  // so the browser sends no preflight — the pattern Apps Script needs.
  GG.apiPost = async function (payload) {
    if (!GG.API_URL) return { ok: true, local: true };
    var r = await fetch(GG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload || {})
    });
    return await r.json();
  };
})();
