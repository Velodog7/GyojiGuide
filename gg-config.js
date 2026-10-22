/*  SUMO SLAPDOWN — shared site config
 *  ---------------------------------------------------------------
 *  One source of truth for the Fantasy Sumo backend. Include this on
 *  every page, BEFORE the page's own scripts:
 *
 *      <script src="gg-config.js"></script>
 *
 *  Any page can then read the endpoint or talk to the backend:
 *
 *      GyojiGuide.API_URL                       // the backend's URL, or "" if unset
 *      await GyojiGuide.apiGet("data")          // { ok, users, results, meta }
 *      await GyojiGuide.apiPost({ action:"save", ... })
 *
 *  The backend can run in two places, Supabase and the original Apps Script
 *  web app, and the site can be moved between them (apps-script/migrate.gs).
 *  Pages start on Apps Script until Supabase says it is live; this file
 *  then asks in the background, at most every few minutes, and the next
 *  page load follows the answer. While Supabase is live the Apps Script
 *  URL forwards to it, so a browser that hasn't switched yet still sees
 *  the same data. A dev box (localhost, 127.0.0.1, file://) never asks.
 */
(function () {
  var GG = (window.GyojiGuide = window.GyojiGuide || {});

  var APPS_SCRIPT = "https://script.google.com/macros/s/AKfycbyrhng3sZoNNpgDA2JApz2Z0xx01x9N1TwnGhqkMfbmXCR-q11NIqlB_i3krHPZ3yZ7GA/exec";
  var SUPABASE = "https://ulzbcqnvltbioajvgvrr.supabase.co/functions/v1/api";
  var CHOICE = "gg.api", ASKED = "gg.api.asked", EVERY_MS = 5 * 60 * 1000;
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  GG.API_URL = read(CHOICE) === "supabase" ? SUPABASE : APPS_SCRIPT;
  GG.API_BACKENDS = { appsScript: APPS_SCRIPT, supabase: SUPABASE };

  var devBox = /^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(location.hostname);
  if (!devBox && window.fetch && Date.now() - Number(read(ASKED) || 0) > EVERY_MS) {
    write(ASKED, String(Date.now()));
    fetch(SUPABASE + "?action=__health", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (h) { if (h && h.ok) write(CHOICE, h.live && !h.maintenance ? "supabase" : "appsScript"); })
      .catch(function () {});
  }
  // a paused backend (mid-move) means the answer above is about to change
  function noteMaintenance(j) { if (j && j.maintenance) write(ASKED, "0"); return j; }

  GG.hasAPI = function () { return !!GG.API_URL; };

  // Read leaderboard data. action = "data" | "list" | "results".
  GG.apiGet = async function (action) {
    if (!GG.API_URL) return null;
    var r = await fetch(GG.API_URL + "?action=" + encodeURIComponent(action || "data"), { method: "GET" });
    return noteMaintenance(await r.json());
  };

  // GET with extra query params, e.g. apiGetQ("leagues", {handle:"tom"})
  GG.apiGetQ = async function (action, params) {
    if (!GG.API_URL) return null;
    var q = "?action=" + encodeURIComponent(action || "data");
    if (params) for (var k in params) q += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    var r = await fetch(GG.API_URL + q, { method: "GET" });
    return noteMaintenance(await r.json());
  };

  // Write (register / login / save). Uses a CORS-safelisted content type
  // so the browser sends no preflight, which both backends rely on.
  GG.apiPost = async function (payload) {
    if (!GG.API_URL) return { ok: true, local: true };
    var r = await fetch(GG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload || {})
    });
    return noteMaintenance(await r.json());
  };
})();
