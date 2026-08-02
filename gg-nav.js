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
    { href: "banzuke.html", label: "Welcome",      match: ["banzuke.html", "banzuke"] },
    { href: "index.html",   label: "Analysis",     match: ["", "index.html", "index"] },
    { href: "dohyo.html",   label: "Simulation",   match: ["dohyo.html", "dohyo"] },
    { href: "fantasy.html", label: "Fantasy",      match: ["fantasy.html", "fantasy"] }
  ];

  var here = (location.pathname.split("/").pop() || "index.html").toLowerCase();

  function build() {
    if (document.getElementById("gg-nav")) return;
    var nav = document.createElement("nav");
    nav.id = "gg-nav";
    nav.setAttribute("aria-label", "Sumo Slapdown sections");
    nav.innerHTML =
      '<div class="ggn-inner">' +
      '<a class="ggn-brand" href="index.html">'+GGN_LOGO+'</a>' +
      '<div class="ggn-links">' +
      LINKS.map(function (l) {
        var active = l.match.indexOf(here) >= 0;
        return '<a class="ggn-link' + (active ? " active" : "") + '" href="' + l.href + '"' +
               (active ? ' aria-current="page"' : '') + '>' + l.label + '</a>';
      }).join("") +
      '</div>' +
      '<div class="ggn-right">' +
        '<button type="button" class="ggn-help" id="ggnHelp" aria-label="Help & feedback" title="Help & feedback">?</button>' +
        '<div class="ggn-acct"></div>' +
      '</div>' +
      '</div>';
    document.body.insertBefore(nav, document.body.firstChild);
    document.body.classList.add("has-gg-nav");
    var hb = document.getElementById("ggnHelp");
    if (hb) hb.onclick = openHelp;
  }

  var CSS =
    '#gg-nav{position:relative;width:100%;z-index:900;' +
      'background:rgba(20,22,30,.86);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);' +
      'border-bottom:1px solid rgba(216,178,90,.25);font-family:"Space Grotesk","Zen Kaku Gothic New",system-ui,sans-serif}' +
    '.ggn-inner{max-width:1180px;margin:0 auto;min-height:68px;padding:0 20px;' +
      'display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px}' +
    '.ggn-brand{grid-column:1;justify-self:start;display:inline-flex;align-items:center;gap:8px;' +
      'text-decoration:none;color:#f4ecd8;font-weight:700;font-size:.98rem;letter-spacing:.01em;white-space:nowrap}' +
    '.ggn-brand svg,.ggn-brand img{height:62px;width:auto;display:block}' +
    '.ggn-links{grid-column:2;justify-self:center;display:flex;gap:6px;align-items:stretch}' +
    '.ggn-link{display:flex;align-items:center;justify-content:center;' +
      'font-family:"Potta One","Space Grotesk",system-ui,sans-serif;font-weight:400;font-size:.9rem;letter-spacing:.05em;text-transform:uppercase;' +
      'text-decoration:none;color:#c7cbd9;padding:10px 18px;border-radius:10px;transition:color .15s,background .15s}' +
    '.ggn-link:hover{color:#f4ecd8;background:rgba(255,255,255,.07)}' +
    '.ggn-link.active{color:#0f1118;background:linear-gradient(180deg,#f0d590,#d8b25a);font-weight:400}' +
    '@media(max-width:640px){.ggn-inner{grid-template-columns:1fr;justify-items:center;gap:4px;padding:6px 12px}' +
      '.ggn-brand{grid-column:1}.ggn-links{grid-column:1;flex-wrap:wrap;justify-content:center}' +
      '.ggn-link{padding:7px 13px;font-size:.86rem}.ggn-right{grid-column:1}}' +
    /* right wrapper + help button */
    '.ggn-right{grid-column:3;justify-self:end;display:flex;align-items:center;gap:10px}' +
    '.ggn-help{width:30px;height:30px;flex:none;border-radius:50%;border:1px solid #39404f;background:rgba(255,255,255,.03);' +
      'color:#c7cbd9;font-family:"Space Grotesk",system-ui,sans-serif;font-weight:700;font-size:.95rem;line-height:1;cursor:pointer;' +
      'display:grid;place-items:center;transition:color .15s,border-color .15s,background .15s}' +
    '.ggn-help:hover{color:#e0a23a;border-color:#e0a23a}' +
    /* help modal */
    '.ggh-ov{position:fixed;inset:0;z-index:1100;display:none;align-items:center;justify-content:center;background:rgba(6,7,11,.72);' +
      'backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);padding:18px;font-family:"Space Grotesk","Zen Kaku Gothic New",system-ui,sans-serif}' +
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
    '.ggh-note{font-size:.78rem;color:#878da0;margin:-4px 0 12px}';

  function ensureFont() {
    if (document.getElementById("gg-nav-font")) return;   // once per page
    var pc1 = document.createElement("link"); pc1.rel = "preconnect"; pc1.href = "https://fonts.googleapis.com";
    var pc2 = document.createElement("link"); pc2.rel = "preconnect"; pc2.href = "https://fonts.gstatic.com"; pc2.crossOrigin = "anonymous";
    var css = document.createElement("link"); css.id = "gg-nav-font"; css.rel = "stylesheet";
    css.href = "https://fonts.googleapis.com/css2?family=Potta+One&display=swap";
    document.head.appendChild(pc1); document.head.appendChild(pc2); document.head.appendChild(css);
  }

  /* ============ Help & feedback modal ============ */
  var FAQ = [
    { q: "What is Sumo Slapdown?", a: "A fantasy sumo playground: draft a stable of wrestlers, run tournament simulations, and dig into per-rikishi analysis for each basho." },
    { q: "What do Welcome, Analysis, Simulation and Fantasy do?", a: "Welcome shows the full banzuke as an Edo crowd. Analysis is the per-rikishi guide and stats. Simulation is the Elo-based tournament forecast. Fantasy is where you draft a team and run leagues." },
    { q: "How do I draft a team?", a: "Open Fantasy, sign in, then pick one wrestler for each roster bracket. Your picks save to your account automatically." },
    { q: "Do I stay signed in across the site?", a: "Yes \u2014 sign in once from the account button at the top-right and your account and team follow you on every page." },
    { q: "Is the data live?", a: "Rankings and records refresh from the current banzuke via sumo-api when it's reachable; otherwise the site shows the last bundled data." }
  ];
  var HTABS = [
    { id: "faq",        label: "FAQ" },
    { id: "suggestion", label: "Suggestion" },
    { id: "bug",        label: "Report a bug" },
    { id: "abuse",      label: "Report a user" }
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
        '<span class="ggh-lab">Ask a new question</span>'+
        '<textarea class="ggh-ta" id="fqMsg" placeholder="What would you like to know?"></textarea>'+
        '<button type="button" class="ggh-send" data-kind="faq">Send question</button>'+
        '<div class="ggh-status"></div>';
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
      '<p class="ggh-sub">Browse the FAQ, ask a question, suggest an idea, report a bug, or flag a user.</p>'+
      '<div class="ggh-tabs">'+HTABS.map(function(t){ return '<button type="button" class="ggh-tab'+(t.id===htab?" on":"")+'" data-tab="'+t.id+'">'+t.label+'</button>'; }).join("")+'</div>'+
      '<div id="gghBody">'+body+'</div>';

    hmodal.querySelector(".ggh-x").onclick = closeHelp;
    hmodal.querySelectorAll(".ggh-tab").forEach(function(b){ b.onclick = function(){ htab = b.dataset.tab; renderHelp(); }; });
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
      sendFeedback(kind, pay, sb, st);
    };
  }

  function openHelp(){ ensureHelp(); if (!htab) htab = "faq"; renderHelp(); hov.classList.add("open"); document.body.style.overflow = "hidden"; }
  window.GGHelp = { open: openHelp, close: closeHelp };

  function mount() {
    ensureFont();
    var st = document.createElement("style");
    st.id = "gg-nav-css";
    st.textContent = CSS;
    document.head.appendChild(st);
    build();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
