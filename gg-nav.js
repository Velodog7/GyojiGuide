/*  SUMO SLAPDOWN — shared top navigation
 *  ---------------------------------------------------------------
 *  One centered nav bar, identical in placement and style on every page,
 *  linking the three sections together. Include near the top of <body>:
 *
 *      <script src="gg-nav.js"></script>
 *
 *  It injects its own styles, marks the current page active (by filename),
 *  and pins itself to the top of the viewport.
 */
(function () {
  "use strict";
  var GGN_LOGO="<img src=\"SumoSlapdown-logowide.svg\" alt=\"Sumo Slapdown\" class=\"ggn-logo-img\">";
  var LINKS = [
    { href: "index.html",    label: "About",      match: ["", "index.html", "index", "banzuke.html", "banzuke"] },
    { href: "analysis.html", label: "Analysis",     match: ["analysis.html", "analysis"] },
    { href: "dohyo.html",   label: "Simulation",   match: ["dohyo.html", "dohyo"] },
    { href: "fantasy.html", label: "Fantasy",      match: ["fantasy.html", "fantasy"] }
  ];

  var here = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  /* MINIMAL MODE — for a page you are *inside* rather than browsing: the draft
     room, where wandering off to Analysis mid-pick or opening the account modal
     over a running clock is a way to lose your turn, not a feature. Declare it
     on the body tag, which exists before this script builds:

       <body data-gg-nav="minimal" data-gg-back="fantasy.html"
             data-gg-back-label="Back to Fantasy">

     Same logo, same bar, same radio — the section links, the help button and
     the account cluster are simply not built. */
  function navMode(){ return (document.body && document.body.getAttribute("data-gg-nav")) || "full"; }
  function backTarget(){ return (document.body && document.body.getAttribute("data-gg-back")) || "index.html"; }
  function backLabel(){ return (document.body && document.body.getAttribute("data-gg-back-label")) || "Back"; }

  function buildMinimal() {
    var nav = document.createElement("nav");
    nav.id = "gg-nav";
    nav.className = "ggn-min";
    nav.setAttribute("aria-label", "Sumo Slapdown");
    nav.innerHTML =
      '<div class="ggn-inner">' +
      '<a class="ggn-brand" href="index.html">'+GGN_LOGO+'<span class="ggn-beta">beta</span></a>' +
      '<div class="ggn-panel">' +
      '<div class="ggn-links">' +
        '<button type="button" class="ggn-back" id="ggnBack">' +
          '<span class="ggn-back-ico" aria-hidden="true">\u2190</span>' + hesc(backLabel()) +
        '</button>' +
      '</div>' +
      '<div class="ggn-right"><div class="ggn-slot" id="ggnRadioSlot"></div></div>' +
      '</div>' +
      '</div>';
    document.body.insertBefore(nav, document.body.firstChild);
    document.body.classList.add("has-gg-nav");
    var bb = document.getElementById("ggnBack");
    if (bb) bb.onclick = function () {
      /* Prefer the real back step — it restores the Fantasy page's scroll and
         open league. Only fall back to a hard link when there is nothing to go
         back to (opened in a fresh tab, or arrived from off-site). */
      var sameSite = false;
      try { sameSite = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch (e) {}
      if (sameSite && history.length > 1) history.back();
      else location.href = backTarget();
    };
  }

  function build() {
    if (document.getElementById("gg-nav")) return;
    if (navMode() === "minimal") return buildMinimal();
    var nav = document.createElement("nav");
    nav.id = "gg-nav";
    nav.setAttribute("aria-label", "Sumo Slapdown sections");
    nav.innerHTML =
      '<div class="ggn-inner">' +
      '<a class="ggn-brand" href="index.html">'+GGN_LOGO+'<span class="ggn-beta">beta</span></a>' +
      '<button type="button" class="ggn-burger" id="ggnBurger" aria-label="Menu" aria-expanded="false" aria-controls="ggnPanel">' +
        '<span></span><span></span><span></span>' +
      '</button>' +
      '<div class="ggn-panel" id="ggnPanel">' +
      '<div class="ggn-links" id="ggnLinks">' +
      LINKS.map(function (l) {
        var active = l.match.indexOf(here) >= 0;
        return '<a class="ggn-link' + (active ? " active" : "") + '" href="' + l.href + '"' +
               (active ? ' aria-current="page"' : '') + '>' + l.label + '</a>';
      }).join("") +
      '</div>' +
      '<div class="ggn-right">' +
        /* taiko-radio.js is deferred, so it lands ~150ms after this bar is
           built. Reserving its slot here means it drops into a space that
           already exists instead of widening the cluster and dragging the
           whole nav sideways on every page load. */
        '<div class="ggn-slot" id="ggnRadioSlot"></div>' +
        '<button type="button" class="ggn-help" id="ggnHelp" aria-label="Help & feedback" title="Help & feedback">?</button>' +
        '<div class="ggn-acct"></div>' +
      '</div>' +
      '</div>' +
      '</div>';
    document.body.insertBefore(nav, document.body.firstChild);
    document.body.classList.add("has-gg-nav");
    // Fill the account cluster now, in this same tick, rather than leaving it
    // empty until gg-auth.js boots — otherwise a paint can land in between and
    // the whole bar visibly shifts when the control finally arrives. If
    // gg-auth hasn't loaded yet its own boot still handles it.
    try { if (window.GGAuth && window.GGAuth.mountNav) window.GGAuth.mountNav(); } catch (e) {}
    var hb = document.getElementById("ggnHelp");
    if (hb) hb.onclick = openHelp;
    wireBurger();
  }

  /* the hamburger toggles the links panel open on narrow screens; it closes
     on outside-click, on Escape, on link tap, and whenever the viewport
     grows back past the breakpoint. */
  function wireBurger() {
    var burger = document.getElementById("ggnBurger");
    var nav = document.getElementById("gg-nav");
    if (!burger || !nav) return;
    function setOpen(open) {
      nav.classList.toggle("ggn-open", open);
      burger.setAttribute("aria-expanded", String(open));
    }
    burger.onclick = function (e) { e.stopPropagation(); setOpen(!nav.classList.contains("ggn-open")); };
    var panel = document.getElementById("ggnPanel");
    if (panel) panel.addEventListener("click", function (e) {
      // a link navigates away; help / account open a modal over the top — either
      // way the dropdown has done its job and should get out of the way
      if (e.target.closest(".ggn-link,.ggn-help,.ggn-acct button,.gga-btn,.gga-chip")) setOpen(false);
    });
    document.addEventListener("click", function (e) {
      if (nav.classList.contains("ggn-open") && !e.target.closest("#gg-nav")) setOpen(false);
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 820 && nav.classList.contains("ggn-open")) setOpen(false);
    });
  }

  var CSS =
    /* smooth cross-fade between page loads where the browser supports it
       (same-origin MPA navigations; ignored gracefully elsewhere) */
    '@view-transition{navigation:auto}' +
    '#gg-nav{position:relative;width:100%;z-index:900;' +
      'background:rgba(20,22,30,.86);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);' +
      'border-bottom:1px solid rgba(216,178,90,.25);font-family:"Zen Maru Gothic","Potta One",system-ui,sans-serif}' +
    '.ggn-inner{max-width:1180px;margin:0 auto;min-height:68px;padding:0 20px;' +
      'display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:12px}' +
    '.ggn-brand{grid-column:1;justify-self:start;display:inline-flex;align-items:center;gap:8px;' +
      'text-decoration:none;color:#f4ecd8;font-weight:700;font-size:.98rem;letter-spacing:.01em;white-space:nowrap}' +
    /* aspect-ratio reserves the logo's width before the SVG decodes; with
       width:auto alone the brand box starts at 0 and everything after it
       jumps sideways the moment it lands. 1240x240 is its viewBox. */
    '.ggn-brand svg,.ggn-brand img{height:68px;width:auto;aspect-ratio:1240/240;display:block}' +
    '.ggn-beta{align-self:flex-start;margin-top:14px;margin-left:-2px;font-family:"Zen Maru Gothic",system-ui,sans-serif;' +
      'font-weight:600;font-size:.62rem;letter-spacing:.14em;text-transform:lowercase;color:#d8b25a;opacity:.85}' +
    /* the panel is a wrapper only so the phone dropdown can hold the links AND
   the radio/help/account cluster. display:contents keeps the desktop grid
   exactly as it was. */
    '.ggn-panel{display:contents}'+
    '.ggn-links{grid-column:2;justify-self:end;display:flex;gap:6px;align-items:stretch}' +
    '.ggn-link{display:flex;align-items:center;justify-content:center;box-sizing:border-box;height:40px;' +
      'font-family:"Potta One","Zen Maru Gothic",system-ui,sans-serif;font-weight:400;font-size:.9rem;letter-spacing:.05em;text-transform:uppercase;' +
      'text-decoration:none;color:#c7cbd9;padding:0 18px;border-radius:10px;transition:color .15s,background .15s}' +
    '.ggn-link:hover{color:#f4ecd8;background:rgba(255,255,255,.07)}' +
    '.ggn-link.active{color:#0f1118;background:linear-gradient(180deg,#f0d590,#d8b25a);font-weight:400}' +
    /* hamburger button — hidden on desktop, shown when the links collapse */
    '.ggn-burger{display:none;grid-column:2;justify-self:center;flex-direction:column;justify-content:center;gap:5px;' +
      'width:42px;height:40px;padding:0 10px;box-sizing:border-box;background:none;border:1px solid #39404f;border-radius:10px;cursor:pointer}' +
    '.ggn-burger span{display:block;height:2px;width:100%;background:#c7cbd9;border-radius:2px;transition:transform .2s,opacity .2s}' +
    '.ggn-burger:hover span{background:#f4ecd8}' +
    '#gg-nav.ggn-open .ggn-burger span:nth-child(1){transform:translateY(7px) rotate(45deg)}' +
    '#gg-nav.ggn-open .ggn-burger span:nth-child(2){opacity:0}' +
    '#gg-nav.ggn-open .ggn-burger span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}' +
    /* right wrapper + help button */
    '.ggn-right{grid-column:3;justify-self:end;display:flex;align-items:center;gap:10px}' +
    '.ggn-slot{flex:none;width:40px;height:40px;display:flex;align-items:center;justify-content:center}' +
    /* minimal bar: no burger, so the panel is always laid out inline */
    '.ggn-min .ggn-panel{display:flex;align-items:center;gap:12px}' +
    '.ggn-back{display:inline-flex;align-items:center;gap:7px;background:none;border:1px solid rgba(216,178,90,.3);' +
      'border-radius:999px;color:#f4ecd8;font:inherit;font-size:.9rem;padding:7px 15px;cursor:pointer;' +
      'white-space:nowrap;transition:border-color .15s,color .15s,background .15s}' +
    '.ggn-back:hover{border-color:rgba(216,178,90,.75);background:rgba(216,178,90,.1)}' +
    '.ggn-back:focus-visible{outline:2px solid rgba(216,178,90,.8);outline-offset:2px}' +
    '.ggn-back-ico{font-size:1.05rem;line-height:1}' +
    '.ggn-help{width:40px;height:40px;flex:none;border-radius:50%;border:1px solid #39404f;background:rgba(255,255,255,.03);' +
      'color:#c7cbd9;font-family:"Zen Maru Gothic",system-ui,sans-serif;font-weight:700;font-size:.95rem;line-height:1;cursor:pointer;' +
      'display:grid;place-items:center;transition:color .15s,border-color .15s,background .15s}' +
    '.ggn-help:hover{color:#e0a23a;border-color:#e0a23a}' +
    /* ── links collapse into the burger; the radio/help/account cluster still
       fits beside the logo down to about 820px ── */
    '@media(max-width:1200px){' +
      '.ggn-inner{grid-template-columns:auto 1fr auto;gap:10px;padding:0 14px;min-height:60px}' +
      '.ggn-brand{grid-column:1}' +
      '.ggn-brand svg,.ggn-brand img{height:52px}' +
      '.ggn-beta{margin-top:10px;font-size:.56rem}' +
      '.ggn-burger{display:flex;justify-self:end}' +
      '.ggn-right{grid-column:3}' +
      '.ggn-links{grid-column:1 / -1;flex-direction:column;align-items:stretch;gap:4px;' +
        'position:absolute;left:0;right:0;top:100%;padding:8px 14px 14px;' +
        'background:rgba(20,22,30,.98);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);' +
        'border-bottom:1px solid rgba(216,178,90,.25);box-shadow:0 18px 40px rgba(0,0,0,.5);' +
        'max-height:0;overflow:hidden;opacity:0;pointer-events:none;transition:max-height .25s ease,opacity .2s ease}' +
      '#gg-nav.ggn-open .ggn-links{max-height:60vh;opacity:1;pointer-events:auto}' +
      '.ggn-link{height:auto;justify-content:flex-start;padding:12px 14px;font-size:1rem}' +
    '}' +
    /* ── phone: the bar is just the logo and the burger. Radio, help and the
       account control move into the dropdown with the page links, because on a
       390px screen the logo alone eats 45% of the width and the cluster cannot
       fit beside it without running off the page. ── */
    '@media(max-width:820px){' +
      '.ggn-inner{grid-template-columns:1fr auto;gap:8px;padding:0 12px;min-height:56px}' +
      '.ggn-brand{grid-column:1;min-width:0}' +
      '.ggn-brand svg,.ggn-brand img{height:44px;max-width:100%}' +
      '.ggn-beta{display:none}' +
      '.ggn-burger{display:flex;grid-column:2;justify-self:end;width:38px;height:36px;padding:0 9px}' +
      /* the menu sits IN THE FLOW so it pushes the page down instead of
         covering it, and it never clips: the radio popup opens out of it. That
         rules out a max-height transition (which needs overflow:hidden), so the
         open/close is a display swap with a short slide-in. */
      '.ggn-panel{display:none;grid-column:1 / -1;position:static;background:#12141b;' +
        'border-bottom:1px solid rgba(216,178,90,.25);box-shadow:0 18px 40px rgba(0,0,0,.5)}' +
      '#gg-nav.ggn-open .ggn-panel{display:block;animation:ggn-drop .18s ease}' +
      '@keyframes ggn-drop{from{opacity:0;transform:translateY(-6px)}}' +
      /* inside the panel the links are just a stacked list again */
      '.ggn-links{position:static;grid-column:auto;justify-self:stretch;width:100%;box-sizing:border-box;' +
        'display:flex;flex-direction:column;align-items:stretch;gap:4px;' +
        'padding:10px 12px 4px;background:none;border:0;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;' +
        'max-height:none;overflow:visible;opacity:1;pointer-events:auto;transition:none}' +
      '#gg-nav.ggn-open .ggn-links{max-height:none}' +
      '.ggn-right{grid-column:auto;justify-self:stretch;width:auto;box-sizing:border-box;justify-content:flex-start;gap:10px;flex-wrap:wrap;' +
        'padding:12px;margin:6px 12px 12px;border-top:1px solid rgba(255,255,255,.08)}' +
      '.ggn-help{width:38px;height:38px}' +
      '.ggn-slot{width:38px;height:38px}' +
      '.ggn-acct{margin-left:auto;display:flex;gap:8px;align-items:center}' +
    '}' +
    /* ── very thin ── */
    '@media(max-width:400px){' +
      '.ggn-inner{gap:6px;padding:0 10px;min-height:52px}' +
      '.ggn-brand svg,.ggn-brand img{height:34px}' +
    '}' +
    /* help modal */
    '.ggh-ov{position:fixed;inset:0;z-index:1100;display:none;align-items:center;justify-content:center;background:rgba(6,7,11,.72);' +
      'backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);padding:18px;font-family:"Zen Maru Gothic","Potta One",system-ui,sans-serif}' +
    '.ggh-ov.open{display:flex}' +
    '.ggh-modal{width:min(560px,100%);max-height:88vh;overflow:auto;background:#14161d;border:1px solid #2a2d38;border-radius:16px;' +
      'padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.6);color:#e9eaf0}' +
    '.ggh-x{float:right;background:none;border:0;color:#878da0;font-size:1.25rem;cursor:pointer;line-height:1;padding:2px 6px}' +
    '.ggh-x:hover{color:#e9eaf0}' +
    '.ggh-title{font-weight:700;font-size:1.2rem;margin:0 0 4px;color:#f1f2f6}' +
    '.ggh-sub{color:#878da0;font-size:.85rem;margin:0 0 16px}' +
    '.ggh-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px}' +
    '.ggh-tab{flex:1 1 auto;min-width:96px;padding:8px 10px;border:1px solid #2a2d38;background:#171922;color:#c3c8d4;border-radius:9px;' +
      'font:inherit;font-size:.8rem;cursor:pointer}' +
    '.ggh-tab.on{border-color:#e0a23a;color:#e0a23a;background:rgba(224,162,58,.1)}' +
    '.ggh-faq{margin:0 0 16px;border:1px solid #23262f;border-radius:11px;overflow:hidden}' +
    '.ggh-q{border-top:1px solid #23262f}.ggh-q:first-child{border-top:0}' +
    '.ggh-q>button{width:100%;text-align:left;background:none;border:0;color:#e9eaf0;font:inherit;font-weight:600;font-size:.9rem;' +
      'padding:12px 14px;cursor:pointer;display:flex;justify-content:space-between;gap:10px;align-items:center}' +
    '.ggh-q>button:hover{background:rgba(255,255,255,.03)}' +
    '.ggh-q .ico{color:#878da0;transition:transform .2s}' +
    '.ggh-q.open .ico{transform:rotate(45deg);color:#e0a23a}' +
    '.ggh-a{max-height:0;overflow:hidden;transition:max-height .25s ease;color:#b6bccb;font-size:.86rem;line-height:1.55}' +
    '.ggh-a>div{padding:0 14px 13px}' +
    '.ggh-lab{display:block;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:#878da0;margin:0 0 5px}' +
    '.ggh-in,.ggh-ta{width:100%;background:#1b1e27;border:1px solid #2a2d38;color:#e9eaf0;border-radius:9px;font:inherit;' +
      'font-size:.92rem;padding:10px 12px;margin-bottom:12px}' +
    '.ggh-ta{min-height:110px;resize:vertical}' +
    '.ggh-in:focus,.ggh-ta:focus{outline:none;border-color:#e0a23a;box-shadow:0 0 0 3px rgba(224,162,58,.18)}' +
    '.ggh-send{width:100%;background:#e0a23a;border:1px solid #e0a23a;color:#141620;font:inherit;font-weight:700;font-size:.95rem;' +
      'padding:11px;border-radius:10px;cursor:pointer}' +
    '.ggh-send:hover{filter:brightness(1.08)}.ggh-send:disabled{opacity:.5;cursor:default;filter:none}' +
    '.ggh-status{min-height:18px;font-size:.83rem;margin-top:10px;color:#878da0}' +
    '.ggh-status.err{color:#f0655a}.ggh-status.ok{color:#43c08a}' +
    '.ggh-note{font-size:.78rem;color:#878da0;margin:-4px 0 12px}' +
    /* welcome tour (first-visit "how to use" modal) — reuses .ggh-ov/.ggh-modal/.ggh-x/.ggh-title/.ggh-send */
    '.ggw-dots{display:flex;gap:6px;margin-bottom:14px}' +
    '.ggw-dot{width:7px;height:7px;border-radius:50%;background:#2a2d38}' +
    '.ggw-dot.on{background:#e0a23a}' +
    '.ggw-body{color:#b6bccb;font-size:.95rem;line-height:1.6;margin:0 0 22px}' +
    '.ggw-nav{display:flex;align-items:center;justify-content:space-between;gap:10px}' +
    '.ggw-back{background:none;border:1px solid #2a2d38;color:#c3c8d4;font:inherit;font-size:.85rem;padding:11px 16px;border-radius:9px;cursor:pointer}' +
    '.ggw-back:hover{border-color:#e0a23a;color:#e0a23a}' +
    '.ggw-next,.ggw-finish{width:auto;padding:11px 22px}' +
    '.ggw-skip{display:block;margin:14px auto 0;background:none;border:0;color:#5c6272;font:inherit;font-size:.78rem;cursor:pointer;text-decoration:underline}' +
    '.ggw-skip:hover{color:#878da0}' +
    '.ggw-replay{width:100%;background:none;border:1px solid #2a2d38;color:#c3c8d4;font:inherit;font-size:.85rem;' +
      'padding:11px;border-radius:9px;cursor:pointer;margin-bottom:16px}' +
    '.ggw-replay:hover{border-color:#e0a23a;color:#e0a23a}' +
    /* shared loading spinner — site-wide (see spinner.html). A gunbai (the
       gyoji's war fan) turning on its Y axis between its red face and its
       black crest face. Both faces are inline SVG data URIs on ::before /
       ::after of the SAME element, so no call site's markup changes. Block
       form (.gg-spinner) fills any positioned container; inline form
       (.gg-spin) is the same artwork at half scale, for status lines. */
    '/* the two gunbai faces, shared by the block and inline loaders */' +
    ':root{--gg-fan-a:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20120%20226%22%3E%3Cpath%20d=%22M60,10%20C32,10%2012,28%2010,56%20C8,80%2011,104%2020,121%20C29,137%2043,145%2060,145%20C77,145%2091,137%20100,121%20C109,104%20112,80%20110,56%20C108,28%2088,10%2060,10%20Z%22%20fill=%22%23b3352a%22/%3E%3Cpath%20d=%22M60,10%20C32,10%2012,28%2010,56%20C8,80%2011,104%2020,121%20C29,137%2043,145%2060,145%20C77,145%2091,137%20100,121%20C109,104%20112,80%20110,56%20C108,28%2088,10%2060,10%20Z%22%20fill=%22none%22%20stroke=%22%23d9a94e%22%20stroke-width=%223.4%22/%3E%3Cg%20transform=%22translate(34,50)%20scale(0.85)%22%20fill=%22%23c9a227%22%3E%3Cpath%20d=%22M-17,2%20C-21,-4%20-14,-9%20-9,-6%20C-8,-12%201,-13%203,-7%20C8,-12%2016,-7%2015,0%20C19,0%2020,7%2015,8%20L-14,8%20C-19,8%20-20,3%20-17,2%20Z%22/%3E%3C/g%3E%3Ccircle%20cx=%2233%22%20cy=%2237%22%20r=%2211.5%22%20fill=%22%23dcb047%22/%3E%3Cg%20transform=%22translate(88,50)%20scale(0.85)%22%20fill=%22%23c9a227%22%3E%3Cpath%20d=%22M-17,2%20C-21,-4%20-14,-9%20-9,-6%20C-8,-12%201,-13%203,-7%20C8,-12%2016,-7%2015,0%20C19,0%2020,7%2015,8%20L-14,8%20C-19,8%20-20,3%20-17,2%20Z%22/%3E%3C/g%3E%3Cpath%20d=%22M82,28%20a12.5,12.5%200%201,0%2011,16%20a9.5,9.5%200%201,1%20-11,-16%20z%22%20fill=%22%235a72ab%22/%3E%3Cg%20stroke=%22%2331140f%22%20stroke-width=%223%22%20stroke-linecap=%22round%22%20fill=%22none%22%20opacity=%22.92%22%3E%3Cpath%20d=%22M25,66%20h18%22/%3E%3Cpath%20d=%22M22,74%20h24%22/%3E%3Cpath%20d=%22M34,74%20v3%22/%3E%3Cpath%20d=%22M34,77%20l-9,12%22/%3E%3Cpath%20d=%22M34,77%20l9,12%22/%3E%3Cpath%20d=%22M23,105%20h22%22/%3E%3Cpath%20d=%22M34,105%20v20%22/%3E%3Cpath%20d=%22M34,112%20l7,5%22/%3E%3Cpath%20d=%22M77,62%20h18%22/%3E%3Cpath%20d=%22M75,69%20h22%22/%3E%3Cpath%20d=%22M86,57%20v13%22/%3E%3Cpath%20d=%22M86,70%20l-9,10%22/%3E%3Cpath%20d=%22M86,70%20l9,10%22/%3E%3Cpath%20d=%22M86,82%20v10%22/%3E%3Cpath%20d=%22M79,85%20l-4,6%22/%3E%3Cpath%20d=%22M93,85%20l4,6%22/%3E%3Cpath%20d=%22M75,107%20h22%22/%3E%3Cpath%20d=%22M86,101%20v24%22/%3E%3Cpath%20d=%22M80,114%20l-4,-6%22/%3E%3Cpath%20d=%22M92,114%20l4,-6%22/%3E%3Cpath%20d=%22M77,117%20h18%22/%3E%3C/g%3E%3Crect%20x=%2253.5%22%20y=%2213%22%20width=%2213%22%20height=%22163%22%20rx=%223.5%22%20fill=%22%235d4232%22/%3E%3Crect%20x=%2253.5%22%20y=%2213%22%20width=%225%22%20height=%22163%22%20rx=%222.5%22%20fill=%22%23412d21%22%20opacity=%22.6%22/%3E%3Crect%20x=%2262.5%22%20y=%2213%22%20width=%222.5%22%20height=%22163%22%20rx=%221.2%22%20fill=%22%2384624a%22%20opacity=%22.55%22/%3E%3Cg%20fill=%22%23d6a743%22%3E%3Cpath%20d=%22M51,4%20h18%20v18%20l-4.5,8%20-4.5,-5.5%20-4.5,5.5%20-4.5,-8%20z%22/%3E%3Cpath%20d=%22M51,88%20l4.5,-8%204.5,5.5%204.5,-5.5%204.5,8%20l-4.5,8%20-4.5,-5.5%20-4.5,5.5%20z%22/%3E%3Cpath%20d=%22M51,152%20l4.5,-8%204.5,5.5%204.5,-5.5%204.5,8%20v12%20h-18%20z%22/%3E%3Cpath%20d=%22M51,176%20l4.5,-7%204.5,5%204.5,-5%204.5,7%20v16%20h-18%20z%22/%3E%3C/g%3E%3Cg%20fill=%22%23f2d283%22%20opacity=%22.7%22%3E%3Crect%20x=%2251%22%20y=%224%22%20width=%224.5%22%20height=%2218%22/%3E%3Crect%20x=%2251%22%20y=%22152%22%20width=%224.5%22%20height=%2212%22/%3E%3Crect%20x=%2251%22%20y=%22176%22%20width=%224.5%22%20height=%2216%22/%3E%3C/g%3E%3Ccircle%20cx=%2260%22%20cy=%2211%22%20r=%221.8%22%20fill=%22%238a6a2c%22/%3E%3Ccircle%20cx=%2260%22%20cy=%22158%22%20r=%221.8%22%20fill=%22%238a6a2c%22/%3E%3Cpath%20d=%22M55,190%20C46,200%2047,214%2060,222%20C73,214%2074,200%2065,190%22%20fill=%22none%22%20stroke=%22%235b4b3d%22%20stroke-width=%224%22%20stroke-linecap=%22round%22/%3E%3Cpath%20d=%22M49,188%20C57,184%2063,184%2071,188%22%20fill=%22none%22%20stroke=%22%234a3d31%22%20stroke-width=%225%22%20stroke-linecap=%22round%22/%3E%3C/svg%3E");--gg-fan-b:url("data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20120%20226%22%3E%3Cpath%20d=%22M60,10%20C32,10%2012,28%2010,56%20C8,80%2011,104%2020,121%20C29,137%2043,145%2060,145%20C77,145%2091,137%20100,121%20C109,104%20112,80%20110,56%20C108,28%2088,10%2060,10%20Z%22%20fill=%22%2332312e%22/%3E%3Cpath%20d=%22M60,10%20C32,10%2012,28%2010,56%20C8,80%2011,104%2020,121%20C29,137%2043,145%2060,145%20C77,145%2091,137%20100,121%20C109,104%20112,80%20110,56%20C108,28%2088,10%2060,10%20Z%22%20fill=%22none%22%20stroke=%22%23d9a94e%22%20stroke-width=%223.4%22/%3E%3Cg%20transform=%22translate(30,40)%22%3E%3Ccircle%20r=%227.5%22%20fill=%22none%22%20stroke=%22%23d9a94e%22%20stroke-width=%221.28%22/%3E%3Cg%20fill=%22%23dcae52%22%20transform=%22scale(0.395)%22%3E%3Cg%20transform=%22rotate(0)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3Cg%20transform=%22rotate(120)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3Cg%20transform=%22rotate(240)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3C/g%3E%3C/g%3E%3Cg%20transform=%22translate(89,39)%22%3E%3Ccircle%20r=%2212%22%20fill=%22none%22%20stroke=%22%23d9a94e%22%20stroke-width=%222.04%22/%3E%3Cg%20fill=%22%23dcae52%22%20transform=%22scale(0.632)%22%3E%3Cg%20transform=%22rotate(0)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3Cg%20transform=%22rotate(120)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3Cg%20transform=%22rotate(240)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3C/g%3E%3C/g%3E%3Cg%20transform=%22translate(29,78)%22%3E%3Ccircle%20r=%2214%22%20fill=%22none%22%20stroke=%22%23d9a94e%22%20stroke-width=%222.38%22/%3E%3Cg%20fill=%22%23dcae52%22%20transform=%22scale(0.737)%22%3E%3Cg%20transform=%22rotate(0)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3Cg%20transform=%22rotate(120)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3Cg%20transform=%22rotate(240)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3C/g%3E%3C/g%3E%3Cg%20transform=%22translate(91,80)%22%3E%3Ccircle%20r=%2213%22%20fill=%22none%22%20stroke=%22%23d9a94e%22%20stroke-width=%222.21%22/%3E%3Cg%20fill=%22%23dcae52%22%20transform=%22scale(0.684)%22%3E%3Cg%20transform=%22rotate(0)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3Cg%20transform=%22rotate(120)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3Cg%20transform=%22rotate(240)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3C/g%3E%3C/g%3E%3Cg%20transform=%22translate(32,117)%22%3E%3Ccircle%20r=%2210.5%22%20fill=%22none%22%20stroke=%22%23d9a94e%22%20stroke-width=%221.79%22/%3E%3Cg%20fill=%22%23dcae52%22%20transform=%22scale(0.553)%22%3E%3Cg%20transform=%22rotate(0)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3Cg%20transform=%22rotate(120)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3Cg%20transform=%22rotate(240)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3C/g%3E%3C/g%3E%3Cg%20transform=%22translate(90,120)%22%3E%3Ccircle%20r=%227.5%22%20fill=%22none%22%20stroke=%22%23d9a94e%22%20stroke-width=%221.28%22/%3E%3Cg%20fill=%22%23dcae52%22%20transform=%22scale(0.395)%22%3E%3Cg%20transform=%22rotate(0)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3Cg%20transform=%22rotate(120)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3Cg%20transform=%22rotate(240)%20translate(0,-3)%22%3E%3Cpath%20d=%22M0,-14%20C7,-14%2010,-9%209,-3.5%20C8,1.5%204,4%200,4%20C-4,4%20-8,1.5%20-9,-3.5%20C-10,-9%20-7,-14%200,-14%20Z%22/%3E%3C/g%3E%3C/g%3E%3C/g%3E%3Crect%20x=%2253.5%22%20y=%2213%22%20width=%2213%22%20height=%22163%22%20rx=%223.5%22%20fill=%22%235d4232%22/%3E%3Crect%20x=%2253.5%22%20y=%2213%22%20width=%225%22%20height=%22163%22%20rx=%222.5%22%20fill=%22%23412d21%22%20opacity=%22.6%22/%3E%3Crect%20x=%2262.5%22%20y=%2213%22%20width=%222.5%22%20height=%22163%22%20rx=%221.2%22%20fill=%22%2384624a%22%20opacity=%22.55%22/%3E%3Cg%20fill=%22%23d6a743%22%3E%3Cpath%20d=%22M51,4%20h18%20v18%20l-4.5,8%20-4.5,-5.5%20-4.5,5.5%20-4.5,-8%20z%22/%3E%3Cpath%20d=%22M51,88%20l4.5,-8%204.5,5.5%204.5,-5.5%204.5,8%20l-4.5,8%20-4.5,-5.5%20-4.5,5.5%20z%22/%3E%3Cpath%20d=%22M51,152%20l4.5,-8%204.5,5.5%204.5,-5.5%204.5,8%20v12%20h-18%20z%22/%3E%3Cpath%20d=%22M51,176%20l4.5,-7%204.5,5%204.5,-5%204.5,7%20v16%20h-18%20z%22/%3E%3C/g%3E%3Cg%20fill=%22%23f2d283%22%20opacity=%22.7%22%3E%3Crect%20x=%2251%22%20y=%224%22%20width=%224.5%22%20height=%2218%22/%3E%3Crect%20x=%2251%22%20y=%22152%22%20width=%224.5%22%20height=%2212%22/%3E%3Crect%20x=%2251%22%20y=%22176%22%20width=%224.5%22%20height=%2216%22/%3E%3C/g%3E%3Ccircle%20cx=%2260%22%20cy=%2211%22%20r=%221.8%22%20fill=%22%238a6a2c%22/%3E%3Ccircle%20cx=%2260%22%20cy=%22158%22%20r=%221.8%22%20fill=%22%238a6a2c%22/%3E%3Cpath%20d=%22M55,190%20C46,200%2047,214%2060,222%20C73,214%2074,200%2065,190%22%20fill=%22none%22%20stroke=%22%235b4b3d%22%20stroke-width=%224%22%20stroke-linecap=%22round%22/%3E%3Cpath%20d=%22M49,188%20C57,184%2063,184%2071,188%22%20fill=%22none%22%20stroke=%22%234a3d31%22%20stroke-width=%225%22%20stroke-linecap=%22round%22/%3E%3C/svg%3E")}' +
    '.gg-spinner{position:absolute;top:0;right:0;bottom:0;left:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;pointer-events:none;z-index:5;perspective:480px}' +
    '.gg-spinner__ring{position:relative;width:56px;height:104px;border:0;border-radius:0;background:none;transform-style:preserve-3d;animation:gg-gunbai 2.9s ease-in-out infinite}' +
    '.gg-spinner__ring::before,.gg-spinner__ring::after{content:"";position:absolute;inset:0;background-repeat:no-repeat;background-position:center;background-size:contain;-webkit-backface-visibility:hidden;backface-visibility:hidden}' +
    '.gg-spinner__ring::before{background-image:var(--gg-fan-a)}' +
    '.gg-spinner__ring::after{background-image:var(--gg-fan-b);transform:rotateY(180deg)}' +
    '.gg-spinner__label{font-family:"WDXL Lubrifont TC",ui-monospace,monospace;font-size:0.732rem;letter-spacing:.22em;text-transform:uppercase;color:#878da0;animation:gg-pulse 1.4s ease-in-out infinite}' +
    '.gg-spin{display:inline-block;position:relative;width:28px;height:52px;flex:none;border:0;border-radius:0;background:none;transform-style:preserve-3d;animation:gg-gunbai-i 2.9s ease-in-out infinite;vertical-align:middle;margin-right:10px}' +
    '.gg-spin::before,.gg-spin::after{content:"";position:absolute;inset:0;border:0;border-radius:0;background-repeat:no-repeat;background-position:center;background-size:contain;-webkit-backface-visibility:hidden;backface-visibility:hidden}' +
    '.gg-spin::before{background-image:var(--gg-fan-a)}' +
    '.gg-spin::after{background-image:var(--gg-fan-b);transform:rotateY(180deg)}' +
    /* the inline fan has no perspective ancestor, so it carries its own */
    '@keyframes gg-gunbai-i{0%,10%{transform:perspective(220px) rotateY(0deg)}40%,60%{transform:perspective(220px) rotateY(180deg)}90%,100%{transform:perspective(220px) rotateY(360deg)}}' +
    '@keyframes gg-gunbai{0%,10%{transform:rotateY(0deg)}40%,60%{transform:rotateY(180deg)}90%,100%{transform:rotateY(360deg)}}' +
    '@keyframes gg-spin{to{transform:rotate(360deg)}}' +
    '@keyframes gg-pulse{0%,100%{opacity:.45}50%{opacity:1}}' +
    '@media (prefers-reduced-motion:reduce){.gg-spinner__ring,.gg-spin{animation-duration:7s}.gg-spinner__label{animation:none}}' +
    /* ── minimal bar, last so it wins the breakpoints above ──
       There is no burger to open, so nothing may be tucked behind one: the
       Back button and the radio stay in the bar at every width. Below 820px
       the logo is given room by letting the pair shrink rather than wrap. ── */
    '#gg-nav.ggn-min .ggn-inner{grid-template-columns:1fr auto;gap:10px;align-items:center}' +
    '#gg-nav.ggn-min .ggn-panel{display:flex;position:static;grid-column:2;justify-self:end;width:auto;' +
      'background:none;border:0;box-shadow:none;padding:0;animation:none}' +
    '#gg-nav.ggn-min .ggn-links{position:static;display:flex;flex-direction:row;align-items:center;width:auto;' +
      'grid-column:auto;padding:0;margin:0;background:none;border:0;box-shadow:none;backdrop-filter:none;' +
      '-webkit-backdrop-filter:none;max-height:none;overflow:visible;opacity:1;pointer-events:auto;transition:none}' +
    '#gg-nav.ggn-min .ggn-right{grid-column:auto;justify-self:auto;width:auto;padding:0;margin:0;border:0;' +
      'display:flex;align-items:center;gap:10px}' +
    '@media(max-width:820px){' +
      '#gg-nav.ggn-min .ggn-brand svg,#gg-nav.ggn-min .ggn-brand img{height:40px}' +
      '#gg-nav.ggn-min .ggn-back{padding:6px 11px;font-size:.82rem}' +
      '#gg-nav.ggn-min .ggn-back-ico{font-size:.95rem}' +
    '}';

  function ensureFont() {
    if (document.getElementById("gg-nav-font")) return;   // once per page
    var pc1 = document.createElement("link"); pc1.rel = "preconnect"; pc1.href = "https://fonts.googleapis.com";
    var pc2 = document.createElement("link"); pc2.rel = "preconnect"; pc2.href = "https://fonts.gstatic.com"; pc2.crossOrigin = "anonymous";
    var css = document.createElement("link"); css.id = "gg-nav-font"; css.rel = "stylesheet";
    css.href = "https://fonts.googleapis.com/css2?family=Potta+One&family=WDXL+Lubrifont+TC&family=Zen+Maru+Gothic:wght@400;500;700&display=swap";
    document.head.appendChild(pc1); document.head.appendChild(pc2); document.head.appendChild(css);
  }

  /* ============ Help & feedback modal ============ */
  var FAQ = [
    { q: "What is Sumo Slap Down?", a: "A fantasy sumo hub built for sumo-obsessed friends and family: analyze every rikishi, simulate the tournament, and run private fantasy leagues \u2014 all built around the real, current banzuke." },
    { q: "What's on each page?", a: "About has the Welcome banzuke crowd, a Learn tab that teaches the sport (with a quiz), and Resources for sumo creators and shows worth following. Analysis is the deep dive: browse and compare rikishi, a health watch, a practice mock draft, sortable analytics, and tier lists. Simulation lets you build a team and run a day-by-day Elo tournament forecast, saved right in your browser \u2014 no sign-in needed. Fantasy is where you sign in, join the public league or start a private one, and draft a real team against other people." },
    { q: "What's the difference between the Analysis mock draft and a Fantasy draft?", a: "The Mock Draft tab on Analysis is a private practice run \u2014 no sign-in, saved locally, just for trying out picks. A Fantasy draft is the real thing: you sign in, join a league, and draft against actual people (Keepers leagues even get their own practice mock draft before the live one)." },
    { q: "How do fantasy leagues work?", a: "Sign in on Fantasy to join the public Sumo Slap Down League or start a private one. Classic leagues let everyone build their roster by hand; Keepers leagues run one live snake draft with persistent rosters, trades, and waivers between bashos. Every league gets its own message board for members." },
    { q: "Do I stay signed in across the site?", a: "Yes \u2014 sign in once from the account button at the top-right and your account, team, and leagues follow you on every page. From there you can also customize your mawashi avatar and send other players a direct message." },
    { q: "Is the data live?", a: "Rankings and records refresh from the current banzuke via sumo-api when it's reachable; otherwise the site shows the last bundled data." }
  ];
  var HTABS = [
    { id: "faq",        label: "FAQ" },
    { id: "resources",  label: "Resources" },
    { id: "community",  label: "Community" },
    { id: "suggestion", label: "Suggestion" },
    { id: "bug",        label: "Report a bug" },
    { id: "abuse",      label: "Report a user" },
    { id: "contact",    label: "Contact" }
  ];
  function hesc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }

  var hov = null, hmodal = null, htab = "faq";
  function ensureHelp(){
    if (hov) return;
    hov = document.createElement("div"); hov.className = "ggh-ov"; hov.id = "ggHelpOverlay";
    hmodal = document.createElement("div"); hmodal.className = "ggh-modal";
    hov.appendChild(hmodal); document.body.appendChild(hov);
    hov.addEventListener("click", function(e){ if (e.target === hov) closeHelp(); });
    document.addEventListener("keydown", function(e){ if (e.key === "Escape" && hov.classList.contains("open")) closeHelp(); });
  }
  function closeHelp(){ if (hov){ hov.classList.remove("open"); document.body.style.overflow = ""; } }

  function currentUser(){
    var G = window.GyojiGuide;
    try { return (G && G.account && G.account.get()) || null; } catch (e) { return null; }
  }
  function pageName(){ return (location.pathname.split("/").pop() || "index.html"); }

  function sendFeedback(kind, payload, btn, statusEl){
    var G = window.GyojiGuide;
    var u = currentUser();
    var data = { action: "feedback", kind: kind, handle: u ? u.handle : "", page: pageName(),
                 subject: payload.subject || "", message: payload.message || "", targetUser: payload.targetUser || "" };
    if (statusEl){ statusEl.className = "ggh-status"; statusEl.textContent = "Sending\u2026"; }
    if (btn) btn.disabled = true;
    function done(ok, msg){
      if (btn) btn.disabled = false;
      if (!statusEl) return;
      statusEl.className = "ggh-status " + (ok ? "ok" : "err");
      statusEl.textContent = msg;
    }
    if (G && G.hasAPI && G.hasAPI() && G.apiPost){
      G.apiPost(data).then(function(r){
        if (r && r.ok){ done(true, "Thanks \u2014 sent. We read every note."); clearForm(kind); }
        else done(false, (r && r.error) || "Couldn\u2019t send \u2014 please try again.");
      }).catch(function(){ done(false, "Network error \u2014 please try again later."); });
    } else {
      done(false, "Sending isn\u2019t available right now \u2014 please try again later.");
    }
  }
  function clearForm(kind){
    if (!hmodal) return;
    var ids = { faq:["fqMsg"], suggestion:["sgSub","sgMsg"], bug:["bgSub","bgMsg"], abuse:["abUser","abMsg"] }[kind] || [];
    ids.forEach(function(id){ var el = hmodal.querySelector("#"+id); if (el) el.value = ""; });
  }

  function renderHelp(){
    hmodal.querySelector(".ggh-tabs") && 0;
    var body;
    if (htab === "faq"){
      body =
        '<div class="ggh-faq">' + FAQ.map(function(f, i){
          return '<div class="ggh-q" data-q="'+i+'"><button type="button"><span>'+hesc(f.q)+'</span><span class="ico">+</span></button>'+
                 '<div class="ggh-a"><div>'+hesc(f.a)+'</div></div></div>';
        }).join("") + '</div>' +
        '<button type="button" class="ggw-replay">Replay the welcome tour</button>'+
        '<span class="ggh-lab">Ask a new question</span>'+
        '<textarea class="ggh-ta" id="fqMsg" placeholder="What would you like to know?"></textarea>'+
        '<button type="button" class="ggh-send" data-kind="faq">Send question</button>'+
        '<div class="ggh-status"></div>';
    } else if (htab === "resources"){
      body =
        '<p class="ggh-note">Sumo Slapdown runs on live rankings, records, and banzuke data pulled straight from <strong>sumo-api</strong> — a free, open API for sumo data. This site simply wouldn’t exist without it. A special thank you to the people building and maintaining it.</p>'+
        '<span class="ggh-lab">Check it out</span>'+
        '<a href="https://www.sumo-api.com/" target="_blank" rel="noopener" '+
          'style="display:inline-flex;align-items:center;justify-content:center;padding:12px 18px;border-radius:9px;background:var(--sun,#d8b25a);color:#141620;font-weight:700;text-decoration:none;margin-top:6px;font-size:.95rem">'+
          'Visit sumo-api.com</a>';
    } else if (htab === "community"){
      body =
        '<p class="ggh-note">Sumo Slapdown is meant to be fun for everyone — fair play and good sportsmanship apply here just like they do in the ring.</p>'+
        '<p class="ggh-note">Any inappropriate behavior will be met with a swift warning from the Slap Down Association, followed by the resignation of your user data for repeat offenders.</p>'+
        '<p class="ggh-note">Have a concern about another user? Use the <strong>Report a user</strong> tab, or reach us directly on <strong>Contact</strong>.</p>';
    } else if (htab === "suggestion"){
      body =
        '<span class="ggh-lab">Subject (optional)</span><input class="ggh-in" id="sgSub" maxlength="160" placeholder="A short summary">'+
        '<span class="ggh-lab">Your suggestion</span><textarea class="ggh-ta" id="sgMsg" placeholder="What would make the site better?"></textarea>'+
        '<button type="button" class="ggh-send" data-kind="suggestion">Send suggestion</button>'+
        '<div class="ggh-status"></div>';
    } else if (htab === "bug"){
      body =
        '<p class="ggh-note">We\u2019ll automatically note which page you\u2019re on ('+hesc(pageName())+').</p>'+
        '<span class="ggh-lab">Subject (optional)</span><input class="ggh-in" id="bgSub" maxlength="160" placeholder="What went wrong, in a few words">'+
        '<span class="ggh-lab">What happened?</span><textarea class="ggh-ta" id="bgMsg" placeholder="Steps to reproduce, what you expected, what you saw\u2026"></textarea>'+
        '<button type="button" class="ggh-send" data-kind="bug">Send bug report</button>'+
        '<div class="ggh-status"></div>';
    } else if (htab === "contact"){
      body =
        '<p class="ggh-note">For anything the tabs above don\u2019t cover \u2014 account questions, or any other issue or concern \u2014 email us directly. We read every message.</p>'+
        '<span class="ggh-lab">Email us</span>'+
        '<a href="mailto:sumoslapdown@gmail.com?subject=Sumo%20Slap%20Down%20%E2%80%94%20Contact" '+
          'style="display:inline-flex;align-items:center;justify-content:center;padding:12px 18px;border-radius:9px;background:var(--sun,#d8b25a);color:#141620;font-weight:700;text-decoration:none;margin-top:6px;font-size:.95rem">'+
          'Email sumoslapdown@gmail.com</a>';
    } else {
      body =
        '<span class="ggh-lab">User\u2019s handle</span><input class="ggh-in" id="abUser" maxlength="40" placeholder="e.g. their @handle">'+
        '<span class="ggh-lab">What\u2019s the concern?</span><textarea class="ggh-ta" id="abMsg" placeholder="Describe what happened. Reports are private and reviewed by the team."></textarea>'+
        '<button type="button" class="ggh-send" data-kind="abuse">Submit report</button>'+
        '<div class="ggh-status"></div>';
    }
    hmodal.innerHTML =
      '<button class="ggh-x" aria-label="Close">\u2715</button>'+
      '<h2 class="ggh-title">Help &amp; feedback</h2>'+
      '<p class="ggh-sub">Browse the FAQ, see who makes this possible, check the community guidelines, suggest an idea, report a bug, flag a user, or email us directly.</p>'+
      '<div class="ggh-tabs">'+HTABS.map(function(t){ return '<button type="button" class="ggh-tab'+(t.id===htab?" on":"")+'" data-tab="'+t.id+'">'+t.label+'</button>'; }).join("")+'</div>'+
      '<div id="gghBody">'+body+'</div>';

    hmodal.querySelector(".ggh-x").onclick = closeHelp;
    hmodal.querySelectorAll(".ggh-tab").forEach(function(b){ b.onclick = function(){ htab = b.dataset.tab; renderHelp(); }; });
    var replay = hmodal.querySelector(".ggw-replay");
    if (replay) replay.onclick = function(){ closeHelp(); openTour(true); };
    // FAQ accordions
    hmodal.querySelectorAll(".ggh-q>button").forEach(function(b){
      b.onclick = function(){
        var q = b.parentNode, a = q.querySelector(".ggh-a");
        var open = q.classList.toggle("open");
        a.style.maxHeight = open ? (a.scrollHeight + "px") : "0";
      };
    });
    // send buttons
    var sb = hmodal.querySelector(".ggh-send");
    if (sb) sb.onclick = function(){
      var kind = sb.dataset.kind, st = hmodal.querySelector(".ggh-status"), pay = {};
      function val(id){ var el = hmodal.querySelector("#"+id); return el ? el.value.trim() : ""; }
      if (kind === "faq"){ pay.message = val("fqMsg"); }
      else if (kind === "suggestion"){ pay.subject = val("sgSub"); pay.message = val("sgMsg"); }
      else if (kind === "bug"){ pay.subject = val("bgSub"); pay.message = val("bgMsg"); }
      else if (kind === "abuse"){ pay.targetUser = val("abUser"); pay.message = val("abMsg"); }
      if (!pay.message){ st.className = "ggh-status err"; st.textContent = "Please add a little detail first."; return; }
      if (kind === "abuse" && !pay.targetUser){ st.className = "ggh-status err"; st.textContent = "Please enter the user\u2019s handle."; return; }
      var apiKind = kind === "faq" ? "question" : kind;   // backend expects 'question', UI tab is 'faq'
      sendFeedback(apiKind, pay, sb, st);
    };
  }

  function openHelp(){ ensureHelp(); if (!htab) htab = "faq"; renderHelp(); hov.classList.add("open"); document.body.style.overflow = "hidden"; }
  window.GGHelp = { open: openHelp, close: closeHelp };

  /* ============ Welcome tour (first-visit "how to use" modal) ============ */
  var TOUR = [
    { title: "Welcome to Sumo Slap Down",
      body: "A fantasy sumo hub built on real rankings and live tournament data — draft rikishi, simulate the basho, and go head-to-head with friends. Here’s a quick look at what’s on each page — you can replay this anytime from the FAQ tab in the ❓ menu." },
    { title: "About",
      body: "See the current banzuke laid out as a full Edo-style crowd, learn the sport from scratch in the Learn tab (rules, ranks, and a quiz), and check Resources for sumo creators and shows worth following." },
    { title: "Analysis",
      body: "Browse and compare every rikishi’s stats and health status, try a private practice mock draft, sort the full analytics table, and build your own tier lists." },
    { title: "Simulation",
      body: "Build a team and run a day-by-day Elo-based forecast of the whole tournament — saved right in your browser, no sign-in needed." },
    { title: "Fantasy",
      body: "Sign in to join the public league or start a private one. Classic lets everyone build their own roster; Keepers runs a live snake draft with trades and waivers between bashos. Every league gets its own message board, and your team follows you across the site." },
    { title: "You’re ready",
      body: "That’s the whole site. Questions, ideas, or something to report? The ❓ button in the corner has FAQs and ways to reach us." }
  ];
  var wov = null, wmodal = null, tstep = 0;
  function ensureTour(){
    if (wov) return;
    wov = document.createElement("div"); wov.className = "ggh-ov"; wov.id = "ggTourOverlay";
    wmodal = document.createElement("div"); wmodal.className = "ggh-modal";
    wov.appendChild(wmodal); document.body.appendChild(wov);
    wov.addEventListener("click", function(e){ if (e.target === wov) closeTour(); });
    document.addEventListener("keydown", function(e){ if (e.key === "Escape" && wov.classList.contains("open")) closeTour(); });
  }
  function closeTour(){ if (wov){ wov.classList.remove("open"); document.body.style.overflow = ""; } }
  function renderTour(){
    var s = TOUR[tstep], first = tstep === 0, last = tstep === TOUR.length - 1;
    wmodal.innerHTML =
      '<button class="ggh-x" aria-label="Close">✕</button>'+
      '<div class="ggw-dots">'+TOUR.map(function(_, i){ return '<span class="ggw-dot'+(i === tstep ? " on" : "")+'"></span>'; }).join("")+'</div>'+
      '<h2 class="ggh-title">'+hesc(s.title)+'</h2>'+
      '<p class="ggw-body">'+hesc(s.body)+'</p>'+
      '<div class="ggw-nav">'+
        (first ? '<span></span>' : '<button type="button" class="ggw-back">Back</button>')+
        (last ? '<button type="button" class="ggh-send ggw-finish">Let’s go</button>' : '<button type="button" class="ggh-send ggw-next">Next</button>')+
      '</div>'+
      (last ? '' : '<button type="button" class="ggw-skip">Skip tour</button>');
    wmodal.querySelector(".ggh-x").onclick = closeTour;
    var back = wmodal.querySelector(".ggw-back"); if (back) back.onclick = function(){ tstep = Math.max(0, tstep - 1); renderTour(); };
    var next = wmodal.querySelector(".ggw-next"); if (next) next.onclick = function(){ tstep = Math.min(TOUR.length - 1, tstep + 1); renderTour(); };
    var fin = wmodal.querySelector(".ggw-finish"); if (fin) fin.onclick = closeTour;
    var skip = wmodal.querySelector(".ggw-skip"); if (skip) skip.onclick = closeTour;
  }
  function openTour(reset){ ensureTour(); if (reset) tstep = 0; renderTour(); wov.classList.add("open"); document.body.style.overflow = "hidden"; }
  window.GGTour = { open: function(){ openTour(true); }, close: closeTour };

  /* fire-and-forget pageview beacon for the admin dashboard's analytics tab.
     One anonymous id per browser (localStorage), never tied to an account.
     Also reports the browser's own IANA timezone (no permission prompt,
     no IP/geolocation lookup) so the dashboard can show a rough region +
     time-of-day breakdown. */
  function trackPageview() {
    try {
      var GG = window.GyojiGuide;
      if (!GG || !GG.hasAPI || !GG.hasAPI()) return;
      var KEY = "gg.visitorId", vid = localStorage.getItem(KEY);
      if (!vid) {
        vid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ("v" + Date.now() + Math.random().toString(16).slice(2));
        try { localStorage.setItem(KEY, vid); } catch (e) {}
      }
      var tz = "";
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
      GG.apiPost({ action: "logPageview", page: here, visitorId: vid, tz: tz });
    } catch (e) {}
  }

  function mount() {
    ensureFont();
    var st = document.createElement("style");
    st.id = "gg-nav-css";
    st.textContent = CSS;
    document.head.appendChild(st);
    build();
    trackPageview();
  }
  // Mount as soon as <body> exists rather than waiting for DOMContentLoaded.
  // The gg-nav script sits at the top of <body>, so building now inserts the
  // bar before the rest of the page renders — no downward content shift (jump)
  // on each page load.
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
