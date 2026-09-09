/* ── gg-notify.js ─────────────────────────────────────────────
   The site's notifier: a toast stack, and an opt-in bridge to the browser's
   own notifications for when the tab is open but not the one you're looking at.

   Two rules shape everything here.

   1. NEVER announce state, only CHANGES. Every caller hands over a current
      value and this module compares it with the last one it saw. The baseline
      is seeded silently on the first call, so opening a page with nine unread
      messages does not fire nine toasts — and the baseline is persisted per
      account, so a reload doesn't re-announce what you already saw.

   2. In-page and OS notifications are alternatives, not both. A toast is right
      when you are looking at the page; an OS notification is right when you
      are not. Sending both means every alert arrives twice for anyone who
      opted in.

   Permission can only be asked from a user gesture, and only once per origin
   in practice — so it is behind an explicit control rather than fired on load.
   ------------------------------------------------------------------------ */
(function () {
  var GG = (window.GyojiGuide = window.GyojiGuide || {});
  var PREF = "gg.notify.os";        // "1" once the reader opts in
  var SEEN = "gg.notify.seen";      // per-handle baselines

  /* ---------- the toast stack ---------- */
  var host = null;
  function ensureHost() {
    if (host && document.body.contains(host)) return host;
    host = document.createElement("div");
    host.className = "ggn-toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");   // announced, never interrupting
    document.body.appendChild(host);
    return host;
  }

  var STYLE_ID = "gg-notify-css";
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = [
      ".ggn-toasts{position:fixed;right:16px;bottom:16px;z-index:9999;",
      "  display:flex;flex-direction:column;gap:8px;align-items:flex-end;",
      "  max-width:min(360px,calc(100vw - 32px));pointer-events:none}",
      ".ggn-toast{pointer-events:auto;display:flex;gap:10px;align-items:flex-start;",
      "  width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;",
      "  background:#1b1622;border:1px solid rgba(231,222,208,.22);",
      "  box-shadow:0 8px 26px rgba(0,0,0,.55);color:#e7ded0;",
      "  font:14px/1.4 'Zen Maru Gothic',system-ui,sans-serif;",
      "  text-decoration:none;opacity:0;transform:translateY(6px);",
      "  transition:opacity .22s ease,transform .22s ease}",
      ".ggn-toast.in{opacity:1;transform:none}",
      ".ggn-toast:is(a):hover{border-color:rgba(216,178,90,.6)}",
      ".ggn-toast__dot{flex:none;width:8px;height:8px;border-radius:50%;",
      "  margin-top:5px;background:#d8b25a}",
      ".ggn-toast__b{min-width:0;flex:1}",
      ".ggn-toast__t{font-weight:700;display:block}",
      ".ggn-toast__s{display:block;color:#878da0;font-size:12.5px;margin-top:1px}",
      ".ggn-toast__x{flex:none;background:none;border:0;color:#878da0;cursor:pointer;",
      "  font:inherit;line-height:1;padding:2px 4px;border-radius:4px}",
      ".ggn-toast__x:hover{color:#e7ded0}",
      "@media (prefers-reduced-motion:reduce){.ggn-toast{transition:none}}"
    ].join("");
    document.head.appendChild(st);
  }

  var MAX_ON_SCREEN = 4;
  function toast(n) {
    ensureStyle();
    var wrap = ensureHost();
    var el = document.createElement(n.href ? "a" : "div");
    el.className = "ggn-toast";
    if (n.href) el.href = n.href;
    var esc = function (s) {
      return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    };
    el.innerHTML =
      '<span class="ggn-toast__dot"></span>' +
      '<span class="ggn-toast__b"><b class="ggn-toast__t">' + esc(n.title) + "</b>" +
      (n.body ? '<span class="ggn-toast__s">' + esc(n.body) + "</span>" : "") +
      "</span>";
    var x = document.createElement("button");
    x.className = "ggn-toast__x";
    x.type = "button";
    x.setAttribute("aria-label", "Dismiss");
    x.textContent = "✕";
    x.onclick = function (ev) { ev.preventDefault(); ev.stopPropagation(); drop(el); };
    el.appendChild(x);
    wrap.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("in"); });

    /* oldest out first, so a burst can't fill the screen */
    var all = wrap.querySelectorAll(".ggn-toast");
    for (var i = 0; i < all.length - MAX_ON_SCREEN; i++) drop(all[i]);

    var ms = n.sticky ? 0 : (n.ms || 7000);
    if (ms) setTimeout(function () { drop(el); }, ms);
    return el;
  }
  function drop(el) {
    if (!el || !el.parentNode) return;
    el.classList.remove("in");
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 240);
  }

  /* ---------- the browser's own notifications ---------- */
  function osSupported() { return typeof window.Notification === "function"; }
  function osAllowed() {
    return osSupported() && Notification.permission === "granted" && osWanted();
  }
  function osWanted() {
    try { return localStorage.getItem(PREF) === "1"; } catch (e) { return false; }
  }
  function setWanted(v) {
    try { v ? localStorage.setItem(PREF, "1") : localStorage.removeItem(PREF); } catch (e) {}
  }

  /* Must be called from a click. Resolves to the resulting permission string;
     "denied" is final for the origin, so the caller should say so plainly
     rather than offering the button again. */
  function askOS() {
    if (!osSupported()) return Promise.resolve("unsupported");
    if (Notification.permission === "granted") { setWanted(true); return Promise.resolve("granted"); }
    if (Notification.permission === "denied") return Promise.resolve("denied");
    return Notification.requestPermission().then(function (p) {
      if (p === "granted") setWanted(true);
      return p;
    }).catch(function () { return "denied"; });
  }

  function osNotify(n) {
    try {
      var note = new Notification(n.title, {
        body: n.body || "",
        tag: n.tag || n.key || undefined,   // same tag replaces, never stacks
        renotify: false
      });
      note.onclick = function () {
        try { window.focus(); } catch (e) {}
        if (n.href) location.href = n.href;
        note.close();
      };
      return true;
    } catch (e) { return false; }
  }

  /* ---------- the one entry point ---------- */
  /* Looking at the page → toast. Looking elsewhere → the OS, if allowed and
     supported. Never both: two alerts for one event reads as a bug. */
  function push(n) {
    if (!n || !n.title) return;
    var hidden = document.visibilityState === "hidden";
    if (hidden && osAllowed() && osNotify(n)) return;
    if (hidden && !osAllowed()) { queue.push(n); return; }  // shown on return
    toast(n);
  }

  /* Anything that happened while the tab was hidden and could not go to the OS
     is held and shown on return — otherwise it is simply lost, which for "your
     turn to pick" is the worst possible outcome. */
  var queue = [];
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    var held = queue.splice(0, MAX_ON_SCREEN);
    queue.length = 0;                        // older than that is just noise
    held.forEach(toast);
  });

  /* ---------- change detection ---------- */
  /* Callers hand over the CURRENT value of something; this reports whether it
     moved, and silently seeds the baseline the first time it sees a key. */
  function seenAll() {
    try { return JSON.parse(localStorage.getItem(SEEN) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function scope() {
    var a = (GG.account && GG.account.get && GG.account.get()) || null;
    return a && a.handle ? String(a.handle).toLowerCase() : "anon";
  }
  function baselineKey(key) { return scope() + "|" + key; }

  function changed(key, value) {
    var all = seenAll(), k = baselineKey(key);
    var had = Object.prototype.hasOwnProperty.call(all, k);
    var prev = all[k];
    if (prev !== value) {
      all[k] = value;
      try { localStorage.setItem(SEEN, JSON.stringify(all)); } catch (e) {}
    }
    if (!had) return { first: true, changed: false, prev: undefined };
    return { first: false, changed: prev !== value, prev: prev };
  }

  /* changed(), but only counts upward movement — an unread count going DOWN
     because you read something is not news. */
  function rose(key, value) {
    var r = changed(key, value);
    return !r.first && r.changed && Number(value) > Number(r.prev);
  }

  GG.notify = {
    push: push,
    toast: toast,
    changed: changed,
    rose: rose,
    askOS: askOS,
    osWanted: osWanted,
    setWanted: setWanted,
    osSupported: osSupported,
    osPermission: function () { return osSupported() ? Notification.permission : "unsupported"; },
    /* tests and the settings toggle need to start from a clean slate */
    forget: function () { try { localStorage.removeItem(SEEN); } catch (e) {} },
    _queue: queue
  };
})();
