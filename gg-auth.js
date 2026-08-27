/*  SUMO SLAPDOWN — shared account control  (gg-auth.js)
 *  ---------------------------------------------------------------
 *  ONE account UI for the whole site. Injects Log in / Sign up (logged
 *  out) or an avatar chip + account menu (logged in) into the shared nav
 *  (gg-nav.js, right-hand column), and owns a small login / sign-up /
 *  account modal. All state lives in the shared account store from
 *  gg-account.js (one localStorage key), so a user who signs in on any
 *  page is signed in on every page.
 *
 *  Requires (already loaded site-wide): gg-config.js, gg-account.js, gg-nav.js.
 *  Optional: gg-mawashi.js — if present, the chip shows the team's mawashi
 *  avatar and the account menu offers "Edit avatar".
 *
 *  On every sign-in / sign-up / sign-out / avatar change it dispatches a
 *  DOM event so pages can react without duplicating auth logic:
 *      document.addEventListener("gg-auth-change", function(e){
 *        e.detail.account  // the account object (or null)
 *        e.detail.res      // raw backend response on login (team, avatar…)
 *      });
 *
 *  Public: window.GGAuth = { open(view), refresh(), get() }
 *  ------------------------------------------------------------------- */
(function () {
  "use strict";
  var GG = window.GyojiGuide;
  if (!GG || !GG.account) { return; }   // gg-account.js must be present

  var A = {};
  window.GGAuth = A;

  function acct(){ return GG.account.get(); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }
  function initials(a){ return String((a && (a.name || a.handle)) || "力").trim().slice(0,1).toUpperCase(); }
  function fire(res){
    document.dispatchEvent(new CustomEvent("gg-auth-change", { detail: { account: acct(), res: res || null } }));
  }

  /* ---------------- styles ---------------- */
  var CSS =
    ".ggn-acct{grid-column:3;justify-self:end;display:flex;align-items:center;gap:8px}"+
    ".gga-btn{font:inherit;font-weight:600;font-size:.82rem;padding:0 14px;border-radius:9px;cursor:pointer;"+
      "border:1px solid #39404f;background:transparent;color:#c7cbd9;transition:color .15s,background .15s,border-color .15s;white-space:nowrap;"+
      "box-sizing:border-box;height:40px;display:inline-flex;align-items:center;justify-content:center}"+
    ".gga-btn:hover{color:#e0a23a;border-color:#e0a23a}"+
    ".gga-btn.solid{background:#e0a23a;border-color:#e0a23a;color:#141620}"+
    ".gga-btn.solid:hover{filter:brightness(1.08);color:#141620}"+
    ".gga-chip{display:flex;align-items:center;gap:8px;padding:0 10px 0 5px;border-radius:999px;cursor:pointer;"+
      "border:1px solid #39404f;background:rgba(255,255,255,.03);color:#f1f2f6;font:inherit;font-weight:600;font-size:.84rem;"+
      "box-sizing:border-box;height:40px}"+
    ".gga-chip:hover{border-color:#e0a23a}"+
    ".gga-chip{position:relative}"+
    ".gga-chip__dm{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;line-height:18px;padding:0 5px;"+
      "box-sizing:border-box;text-align:center;background:#e0554a;color:#fff;border-radius:9px;font-size:.66rem;"+
      "font-weight:700;border:2px solid #0d0f15}"+
    ".gga-chip__ava{width:28px;height:28px;border-radius:50%;overflow:hidden;background:#222633;display:grid;place-items:center;"+
      "font-size:.8rem;color:#e0a23a;flex:none}"+
    ".gga-chip__ava svg{width:100%;height:100%;display:block;transform:scale(1.331);transform-origin:center}"+
    ".gga-chip__nm{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"+
    /* very thin: match gg-nav's tight breakpoint — smaller chip, name hidden
       so the account control never crowds out the burger and help button */
    "@media(max-width:430px){"+
      ".ggn-acct{gap:6px}"+
      ".gga-btn{height:34px;padding:0 10px;font-size:.76rem}"+
      ".gga-chip{height:34px;width:34px;padding:0;gap:0;justify-content:center}"+
      ".gga-chip__ava{width:24px;height:24px}"+
      ".gga-chip__nm{display:none}"+
    "}"+
    /* modal */
    ".gga-ov{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;"+
      "background:rgba(6,7,11,.72);backdrop-filter:blur(3px);padding:18px}"+
    ".gga-ov.open{display:flex}"+
    ".gga-modal{width:min(420px,100%);max-height:90vh;overflow:auto;background:#14161d;border:1px solid #2a2d38;"+
      "border-radius:16px;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.6);font-family:'Zen Maru Gothic','Potta One',system-ui,sans-serif}"+
    ".gga-modal.wide{width:min(560px,100%)}"+
      ".gga-modal.acct{width:min(600px,100%)}"+
      /* below this the two columns have nowhere to go, so stack them */
      "@media (max-width:560px){.gga-modal.acct .gga-acctrow{flex-direction:column;align-items:center}"+
      ".gga-modal.acct .gga-acctrow__main{width:100%}"+
      ".gga-modal.acct .gga-acctrow__top{justify-content:center;text-align:center;min-height:0}}"+
    ".gga-x{float:right;background:none;border:0;color:#878da0;font-size:1.2rem;cursor:pointer;line-height:1;padding:2px 6px}"+
    ".gga-x:hover{color:#e9eaf0}"+
    ".gga-title{font-weight:700;font-size:1.15rem;color:#f1f2f6;margin:0 0 14px}"+
    ".gga-fld{display:block;margin-bottom:12px}"+
    ".gga-fld span{display:block;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:#878da0;margin-bottom:5px}"+
    ".gga-fld input{width:100%;background:#1b1e27;border:1px solid #2a2d38;color:#e9eaf0;border-radius:9px;font:inherit;font-size:.95rem;padding:10px 12px}"+
    ".gga-fld input:focus{outline:none;border-color:#e0a23a;box-shadow:0 0 0 3px rgba(224,162,58,.18)}"+
    ".gga-primary{width:100%;background:#e0a23a;border:1px solid #e0a23a;color:#141620;font:inherit;font-weight:700;"+
      "font-size:.95rem;padding:11px;border-radius:10px;cursor:pointer;margin-top:4px}"+
    ".gga-primary:hover{filter:brightness(1.08)}"+
    ".gga-switch{margin-top:12px;font-size:.85rem;color:#878da0;text-align:center}"+
    ".gga-switch a{color:#e0a23a;cursor:pointer;text-decoration:underline}"+
    ".gga-status{min-height:18px;font-size:.82rem;margin-top:10px;color:#878da0}"+
    ".gga-status.err{color:#f0655a}.gga-status.ok{color:#43c08a}"+
    ".gga-acctrow{display:flex;align-items:flex-start;gap:18px;margin-bottom:16px}"+
      /* the summary sits in the right column so it lines up with the handle */
      ".gga-acctrow__main{flex:1;min-width:0}"+
      ".gga-acctrow__top{display:flex;align-items:center;gap:10px;margin-bottom:14px;min-height:44px;padding-right:34px}"+
      ".gga-acctrow__top .gga-acctrow__id{flex:0 1 auto}"+
    ".gga-acctrow__ava{flex:none;width:120px;height:180px;border-radius:12px;overflow:hidden;"+
      "background:#0d0f15;border:1px solid #2a2d38;display:flex;align-items:center;justify-content:center}"+
    ".gga-acctrow__ava svg{display:block;width:100%;height:100%}"+
    ".gga-acctrow__initials{color:#e0a23a;font-weight:700;font-size:2.6rem}"+
    ".gga-acctrow__id{flex:1;min-width:0}"+
    ".gga-acctrow b{display:block;color:#f1f2f6;font-size:1rem}"+
    ".gga-acctrow small{color:#878da0;font-family:'WDXL Lubrifont TC',monospace;font-size:0.885rem}"+
    ".gga-editbtn{flex:none;width:30px;height:30px;border-radius:8px;border:1px solid #2a2d38;background:#1b1e27;"+
      "color:#878da0;font-size:.85rem;cursor:pointer;display:grid;place-items:center}"+
    ".gga-editbtn:hover{color:#e0a23a;border-color:#e0a23a}"+
    ".gga-handleform{background:#1b1e27;border:1px solid #2a2d38;border-radius:12px;padding:12px 13px;margin-bottom:16px}"+
    ".gga-handleform__btns{display:flex;gap:8px;margin-top:2px}"+
    ".gga-handleform__btns .gga-primary{margin-top:0;width:auto;flex:1}"+
    ".gga-handleform__btns .gga-menu-btn{margin-top:0;width:auto;flex:none;padding:11px 14px}"+
    ".gga-summary{margin-bottom:4px}"+
    ".gga-sec{margin:0 0 16px}"+
    ".gga-sec h3{margin:0 0 8px;font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:#878da0;font-weight:600}"+
    ".gga-empty{margin:0;font-size:.84rem;color:#66697a;font-style:italic}"+
    ".gga-badges{display:flex;flex-wrap:wrap;gap:7px}"+
    ".gga-badge{display:inline-flex;align-items:center;gap:5px;background:rgba(224,162,58,.12);border:1px solid rgba(224,162,58,.35);"+
      "color:#e0a23a;border-radius:999px;padding:5px 11px;font-size:.78rem;font-weight:600;white-space:nowrap}"+
    ".gga-hist{display:flex;flex-direction:column;gap:1px;border:1px solid #2a2d38;border-radius:10px;overflow:hidden}"+
    ".gga-hist__row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 12px;"+
      "background:#1b1e27;font-size:.84rem;color:#c7cbd9}"+
    ".gga-hist__row span:first-child{font-weight:600;color:#e9eaf0}"+
    ".gga-rank{margin:9px 0 0;font-size:.82rem;color:#878da0}"+
    ".gga-rank b{color:#e0a23a}"+
    ".gga-leagues{display:flex;flex-wrap:wrap;gap:7px}"+
    ".gga-leaguechip{background:#1b1e27;border:1px solid #2a2d38;color:#e9eaf0;border-radius:999px;padding:6px 13px;"+
      "font:inherit;font-size:.8rem;font-weight:500;cursor:pointer}"+
    ".gga-leaguechip:hover{border-color:#e0a23a;color:#e0a23a}"+
    ".gga-menu-btn{width:100%;text-align:left;background:#1b1e27;border:1px solid #2a2d38;color:#e9eaf0;font:inherit;"+
      "font-size:.9rem;padding:11px 13px;border-radius:10px;cursor:pointer;margin-top:8px}"+
    ".gga-menu-btn:hover{border-color:#e0a23a}"+
    ".gga-menu-btn.danger{color:#f0655a}.gga-menu-btn.danger:hover{border-color:#f0655a}"+
    /* compact action grid (Messages / Avatar / Log out) — even, tidy buttons
       instead of full-width stacked bars */
    ".gga-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:8px;margin-top:14px}"+
    ".gga-act{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;"+
      "background:#1b1e27;border:1px solid #2a2d38;color:#e9eaf0;font:inherit;font-size:.78rem;font-weight:600;"+
      "padding:12px 8px;border-radius:11px;cursor:pointer;transition:border-color .12s,background .12s}"+
    ".gga-act:hover{border-color:#e0a23a;background:#20232d}"+
    ".gga-act__ico{display:flex;line-height:0;color:#e0a23a}"+
      ".gga-act__ico svg{width:22px;height:22px;display:block}"+
    ".gga-act.danger{color:#f0655a}.gga-act.danger .gga-act__ico{color:#f0655a}"+
    ".gga-act.danger:hover{border-color:#f0655a}"+
    ".gga-act .gga-dm-badge{position:absolute;top:6px;right:8px;margin:0}"+
      ".gga-dm-badge[hidden]{display:none}"+
    /* ---- direct messages ---- */
    ".gga-dm-badge{display:inline-block;min-width:18px;padding:0 5px;height:18px;line-height:18px;text-align:center;"+
      "background:#e0554a;color:#fff;border-radius:9px;font-size:.68rem;font-weight:700;margin-left:6px;vertical-align:1px}"+
    ".gga-threads{display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto;margin:0 0 10px}"+
    ".gga-thread{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:#1b1e27;border:1px solid #2a2d38;"+
      "color:#e9eaf0;font:inherit;font-size:.88rem;padding:9px 11px;border-radius:10px;cursor:pointer}"+
    ".gga-thread:hover{border-color:#e0a23a}"+
    ".gga-thread__nm{flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"+
    ".gga-thread__nm small{display:block;font-weight:400;color:#878da0;font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"+
    ".gga-newdm{display:flex;gap:7px;margin-bottom:6px}"+
    ".gga-newdm-btn{width:100%;text-align:center;background:#1b1e27;border:1px dashed #39404f;color:#e0a23a;font:inherit;"+
      "font-size:.86rem;font-weight:600;padding:10px;border-radius:10px;cursor:pointer;margin-bottom:10px}"+
    ".gga-newdm-btn:hover{border-color:#e0a23a;background:#20232d}"+
    ".gga-picker{display:flex;flex-direction:column;gap:5px;max-height:280px;overflow-y:auto;margin-top:4px}"+
    ".gga-pick{display:flex;align-items:center;text-align:left;width:100%;background:#1b1e27;border:1px solid #2a2d38;"+
      "color:#e9eaf0;font:inherit;font-size:.88rem;padding:9px 11px;border-radius:10px;cursor:pointer}"+
    ".gga-pick:hover{border-color:#e0a23a}"+
    ".gga-pick__nm{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"+
    ".gga-pick__nm small{display:block;font-weight:400;color:#878da0;font-size:.78rem}"+
    ".gga-newdm input{flex:1;background:#1b1e27;border:1px solid #2a2d38;color:#e9eaf0;border-radius:9px;font:inherit;font-size:.86rem;padding:9px 11px}"+
    ".gga-newdm input:focus{outline:none;border-color:#e0a23a}"+
    ".gga-newdm button{flex:none;background:#1b1e27;border:1px solid #2a2d38;color:#e9eaf0;border-radius:9px;font:inherit;font-size:.86rem;padding:9px 13px;cursor:pointer}"+
    ".gga-newdm button:hover{border-color:#e0a23a}"+
    ".gga-convo{display:flex;flex-direction:column;gap:8px;max-height:260px;overflow-y:auto;padding:2px 2px 6px}"+
    ".gga-back{background:none;border:0;color:#878da0;font:inherit;font-size:.8rem;cursor:pointer;padding:0;margin-bottom:10px}"+
    ".gga-back:hover{color:#e0a23a}"+
    ".gga-bubble{max-width:80%;padding:8px 11px;border-radius:12px;font-size:.88rem;line-height:1.4;word-break:break-word;white-space:pre-wrap}"+
    ".gga-bubble.them{align-self:flex-start;background:#22262f;border-bottom-left-radius:4px}"+
    ".gga-bubble.me{align-self:flex-end;background:#e0a23a;color:#141620;border-bottom-right-radius:4px}"+
    ".gga-bubble time{display:block;font-size:.64rem;opacity:.6;margin-top:3px}"+
    ".gga-dm-compose{display:flex;gap:7px;margin-top:10px}"+
    ".gga-dm-compose textarea{flex:1;background:#1b1e27;border:1px solid #2a2d38;color:#e9eaf0;border-radius:9px;font:inherit;"+
      "font-size:.88rem;padding:9px 11px;resize:vertical;min-height:40px;max-height:120px}"+
    ".gga-dm-compose textarea:focus{outline:none;border-color:#e0a23a}"+
    ".gga-dm-compose button{flex:none;background:#e0a23a;border:1px solid #e0a23a;color:#141620;font:inherit;font-weight:700;"+
      "border-radius:9px;padding:0 15px;cursor:pointer}"+
    ".gga-dm-compose button:hover{filter:brightness(1.08)}.gga-dm-compose button:disabled{opacity:.5;cursor:default;filter:none}"+
    "#ggaMount{margin-top:6px}";

  function ensureCSS(){
    if (document.getElementById("gg-auth-css")) return;
    var st = document.createElement("style"); st.id = "gg-auth-css"; st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ---------------- avatar chip markup ---------------- */
  function avaInner(a){
    if (window.MawashiDesigner) {
      try { return window.MawashiDesigner.renderSVG((a && a.avatar) || window.MawashiDesigner.DEFAULT, { variant:"chip", size:28 }); } catch (e) {}
    }
    return esc(initials(a));
  }
  function avaFull(a){
    if (window.MawashiDesigner) {
      try { return window.MawashiDesigner.renderSVG((a && a.avatar) || window.MawashiDesigner.DEFAULT, { variant:"full", size:168 }); } catch (e) {}
    }
    return '<span class="gga-acctrow__initials">'+esc(initials(a))+'</span>';
  }

  /* ---------------- nav control ---------------- */
  var slot = null;
  function renderNav(){
    if (!slot) return;
    var a = acct();
    if (a) {
      slot.innerHTML =
        '<button type="button" class="gga-chip" id="ggaChip" aria-label="Account">'+
          '<span class="gga-chip__ava">'+avaInner(a)+'</span>'+
          '<span class="gga-chip__nm">'+esc(a.name || a.handle)+'</span>'+
          '<span class="gga-chip__dm" id="ggaChipDm" hidden>0</span>'+
        '</button>';
      slot.querySelector("#ggaChip").onclick = function(){ A.open("account"); };
      pollNavUnread();
    } else {
      slot.innerHTML =
        '<button type="button" class="gga-btn" id="ggaLogin">Log in</button>'+
        '<button type="button" class="gga-btn solid" id="ggaSignup">Sign up</button>';
      slot.querySelector("#ggaLogin").onclick = function(){ A.open("login"); };
      slot.querySelector("#ggaSignup").onclick = function(){ A.open("signup"); };
    }
  }

  /* nav chip unread badge: poll the cheap dmUnread endpoint on a light loop
     while signed in, so a reply shows up without needing a page reload. */
  var navUnreadTimer = null;
  async function pollNavUnread(){
    if (navUnreadTimer){ clearTimeout(navUnreadTimer); navUnreadTimer = null; }
    if (!acct() || !GG.dmUnread) return;
    try {
      var res = await GG.dmUnread();
      var b = slot && slot.querySelector("#ggaChipDm");
      if (b){
        var n = (res && res.ok) ? (res.unread || 0) : 0;
        if (n > 0){ b.textContent = n > 99 ? "99+" : String(n); b.hidden = false; }
        else b.hidden = true;
      }
    } catch (e){}
    if (acct()) navUnreadTimer = setTimeout(pollNavUnread, 45000);   // re-check every 45s
  }

  function mountNav(tries){
    var inner = document.querySelector("#gg-nav .ggn-inner");
    if (!inner) { if ((tries||0) < 40) return setTimeout(function(){ mountNav((tries||0)+1); }, 50); return; }
    slot = inner.querySelector(".ggn-acct");
    if (!slot) { slot = document.createElement("div"); slot.className = "ggn-acct"; inner.appendChild(slot); }
    renderNav();
  }

  /* ---------------- modal ---------------- */
  var ov = null, modal = null, mode = "login";
  function ensureModal(){
    if (ov) return;
    ov = document.createElement("div"); ov.className = "gga-ov"; ov.id = "ggaOverlay";
    modal = document.createElement("div"); modal.className = "gga-modal";
    ov.appendChild(modal); document.body.appendChild(ov);
    ov.addEventListener("click", function(e){ if (e.target === ov) A.close(); });
    document.addEventListener("keydown", function(e){ if (e.key === "Escape" && ov.classList.contains("open")) A.close(); });
  }

  function status(msg, cls){ var s = modal.querySelector(".gga-status"); if (s){ s.textContent = msg || ""; s.className = "gga-status" + (cls?" "+cls:""); } }

  function renderModal(){
    var a = acct();
    modal.classList.remove("wide"); modal.classList.remove("acct");
    if (mode === "account" && a){
      modal.classList.add("acct");
      modal.innerHTML =
        '<button class="gga-x" aria-label="Close">\u2715</button>'+
        '<div class="gga-acctrow"><span class="gga-acctrow__ava">'+avaFull(a)+'</span>'+
          '<div class="gga-acctrow__main">'+
          '<div class="gga-acctrow__top">'+
          '<span class="gga-acctrow__id"><b>'+esc(a.name || a.handle)+'</b><small>@'+esc(a.handle)+'</small></span>'+
          '<button class="gga-editbtn" id="ggaEditHandle" title="Edit handle" aria-label="Edit handle">\u270e</button></div>'+
        '<div class="gga-handleform" id="ggaHandleForm" hidden>'+
          '<label class="gga-fld"><span>New handle</span><input id="ggaNewHandle" maxlength="40" autocomplete="off" placeholder="'+esc(a.handle)+'"></label>'+
          '<label class="gga-fld"><span>Current PIN</span><input id="ggaHandlePin" type="password" maxlength="24" autocomplete="current-password" placeholder="Confirm with your PIN"></label>'+
          '<div class="gga-handleform__btns"><button class="gga-primary" id="ggaSaveHandle">Save handle</button><button class="gga-menu-btn" id="ggaCancelHandle">Cancel</button></div>'+
          '<div class="gga-status" id="ggaHandleStatus"></div>'+
        '</div>'+
        '<div class="gga-summary" id="ggaSummary"><p class="gga-empty"><span class="gg-spin"></span>Loading your stats\u2026</p></div>'+
        '</div></div>'+
        '<div class="gga-actions">'+
          '<button class="gga-act" id="ggaMessages"><span class="gga-act__ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.6" y="5" width="18.8" height="14" rx="2.6"/><path d="M3.6 7.6 12 13.3 20.4 7.6"/></svg></span><span class="gga-act__lab">Messages</span><span class="gga-dm-badge" id="ggaDmBadge" hidden>0</span></button>'+
          (window.MawashiDesigner ? '<button class="gga-act" id="ggaEdit"><span class="gga-act__ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h10a1.6 1.6 0 0 1 1.6 1.6v9.2a1.6 1.6 0 0 1-1.6 1.6H7a1.6 1.6 0 0 1-1.6-1.6V5.6A1.6 1.6 0 0 1 7 4Z"/><path d="M8.6 8.4h6.8"/><path d="M6.6 18.6v2.4M9.8 18.6v2.4M13 18.6v2.4M16.2 18.6v2.4"/></svg></span><span class="gga-act__lab">Avatar</span></button>' : '')+
          '<button class="gga-act danger" id="ggaLogout"><span class="gga-act__ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14.6 3.6h2.9A2.5 2.5 0 0 1 20 6.1v11.8a2.5 2.5 0 0 1-2.5 2.5h-2.9"/><path d="M9.8 16.4 5.4 12l4.4-4.4"/><path d="M5.4 12h9.4"/></svg></span><span class="gga-act__lab">Log out</span></button>'+
        '</div>';
      modal.querySelector(".gga-x").onclick = A.close;
      var eb = modal.querySelector("#ggaEdit"); if (eb) eb.onclick = openAvatar;
      modal.querySelector("#ggaLogout").onclick = function(){ GG.logout(); refresh(); fire(); A.close(); };
      modal.querySelector("#ggaMessages").onclick = function(){ openMessages(a); };
      wireHandleEdit(a);
      loadSummary(a);
      refreshDmBadge(a);
      return;
    }
    // login / signup
    var signup = (mode === "signup");
    modal.innerHTML =
      '<button class="gga-x" aria-label="Close">\u2715</button>'+
      '<h2 class="gga-title">'+(signup?"Create your account":"Log in")+'</h2>'+
      '<label class="gga-fld"><span>Handle</span><input id="ggaHandle" autocomplete="username" placeholder="e.g. taro_88" maxlength="40"></label>'+
      (signup?'<label class="gga-fld"><span>Display name</span><input id="ggaName" placeholder="Shown on the leaderboard" maxlength="60"></label>':'')+
      '<label class="gga-fld"><span>PIN</span><input id="ggaPin" type="password" inputmode="numeric" autocomplete="'+(signup?"new-password":"current-password")+'" placeholder="4+ characters" maxlength="40"></label>'+
      '<button class="gga-primary" id="ggaSubmit">'+(signup?"Create account":"Log in")+'</button>'+
      '<div class="gga-switch">'+(signup
        ? 'Already have an account? <a id="ggaToLogin">Log in</a>'
        : 'New here? <a id="ggaToSignup">Sign up</a> \u00b7 <a id="ggaForgot">Forgot PIN?</a>')+'</div>'+
      '<div class="gga-status"></div>';
    modal.querySelector(".gga-x").onclick = A.close;
    var sw = modal.querySelector("#ggaToLogin") || modal.querySelector("#ggaToSignup");
    if (sw) sw.onclick = function(){ mode = signup ? "login" : "signup"; renderModal(); setTimeout(focusFirst, 0); };
    modal.querySelector("#ggaSubmit").onclick = submit;
    var fp = modal.querySelector("#ggaForgot");
    if (fp) fp.onclick = async function(){
      var h = (modal.querySelector("#ggaHandle").value || "").trim();
      if (!h){ status("Enter your handle first, then tap Forgot PIN.", "err"); modal.querySelector("#ggaHandle").focus(); return; }
      status("Requesting reset\u2026");
      try {
        var r = (GG.apiPost) ? await GG.apiPost({ action:"requestPinReset", handle:h }) : null;
        if (r && r.ok) status("Reset requested \u2014 once an admin approves it, re-open Create account to set a new PIN.", "ok");
        else status((r && r.error) || "Couldn\u2019t request a reset. Try again.", "err");
      } catch(e){ status("Network error \u2014 try again.", "err"); }
    };
    modal.querySelector("#ggaPin").addEventListener("keydown", function(e){ if (e.key === "Enter") submit(); });
    setTimeout(focusFirst, 0);
  }
  function focusFirst(){ var el = modal.querySelector("#ggaHandle"); if (el) el.focus(); }

  /* ---------------- account modal: handle editor ---------------- */
  function wireHandleEdit(a){
    var editBtn = modal.querySelector("#ggaEditHandle"), form = modal.querySelector("#ggaHandleForm");
    if (editBtn) editBtn.onclick = function(){
      form.hidden = !form.hidden;
      if (!form.hidden){ modal.querySelector("#ggaNewHandle").value = a.handle; modal.querySelector("#ggaNewHandle").focus(); }
    };
    var cancel = modal.querySelector("#ggaCancelHandle");
    if (cancel) cancel.onclick = function(){ form.hidden = true; };
    var save = modal.querySelector("#ggaSaveHandle");
    if (save) save.onclick = async function(){
      var st = modal.querySelector("#ggaHandleStatus");
      var nh = (modal.querySelector("#ggaNewHandle").value || "").trim();
      var pin = modal.querySelector("#ggaHandlePin").value || "";
      if (!nh){ st.textContent = "Enter a new handle."; st.className = "gga-status err"; return; }
      st.textContent = "Saving\u2026"; st.className = "gga-status"; save.disabled = true;
      try {
        var res = await GG.changeHandle(nh, pin);
        if (res && res.ok){
          st.textContent = "Handle updated \u2713"; st.className = "gga-status ok";
          refresh(); fire(res);
          setTimeout(function(){ renderModal(); }, 500);
        } else {
          st.textContent = (res && res.error) || "Couldn\u2019t update handle."; st.className = "gga-status err"; save.disabled = false;
        }
      } catch (e){ st.textContent = "Network error \u2014 try again."; st.className = "gga-status err"; save.disabled = false; }
    };
  }

  /* ---------------- account modal: trophy case / history / leagues ---------------- */
  async function loadSummary(a){
    var box = modal.querySelector("#ggaSummary"); if (!box) return;
    var res; try { res = await GG.accountSummary(a.handle); } catch (e){ res = null; }
    box = modal.querySelector("#ggaSummary"); if (!box) return;   // modal may have moved on while this was in flight
    if (!res || !res.ok){ box.innerHTML = '<p class="gga-empty">Couldn\u2019t load your stats.</p>'; return; }
    box.innerHTML = summaryHTML(res);
    box.querySelectorAll("[data-league]").forEach(function(btn){
      btn.onclick = function(){
        var id = btn.dataset.league;
        if (typeof window.setView === "function" && typeof window.loadLeagues === "function" && document.getElementById("v-leagues")){
          window.setView("leagues"); window.loadLeagues(id); A.close();
        } else {
          location.href = "fantasy.html?league=" + encodeURIComponent(id);
        }
      };
    });
  }
  function summaryHTML(res){
    var badges = res.badges || [];
    var trophyHTML = badges.length
      ? '<div class="gga-badges">'+badges.map(function(b){ return '<span class="gga-badge" title="'+esc(b.label)+'">'+b.icon+' '+esc(b.label)+'</span>'; }).join("")+'</div>'
      : '<p class="gga-empty">No trophies yet \u2014 keep playing!</p>';
    var hist = res.history || [];
    var histHTML = hist.length
      ? '<div class="gga-hist">'+hist.map(function(h){ return '<div class="gga-hist__row"><span>'+esc(h.basho)+'</span><span>'+h.score+' pts \u00b7 '+h.wins+' wins</span></div>'; }).join("")+'</div>'
      : '<p class="gga-empty">No past basho on record yet.</p>';
    var at = res.allTime || {};
    var rankLine = at.rank ? ('<p class="gga-rank">All-time rank: <b>#'+at.rank+'</b> of '+at.of+' \u00b7 '+at.total+' total pts</p>') : '';
    var leagues = res.leagues || [];
    var leaguesHTML = leagues.length
      ? '<div class="gga-leagues">'+leagues.map(function(l){ return '<button class="gga-leaguechip" data-league="'+esc(l.id)+'">'+esc(l.name)+(l.isCommissioner?' \u2605':'')+'</button>'; }).join("")+'</div>'
      : '<p class="gga-empty">Not in any leagues yet.</p>';
    return ''+
      '<div class="gga-sec"><h3>Trophy case</h3>'+trophyHTML+'</div>'+
      '<div class="gga-sec"><h3>Historical performance</h3>'+histHTML+rankLine+'</div>'+
      '<div class="gga-sec"><h3>Active leagues</h3>'+leaguesHTML+'</div>';
  }

  async function submit(){
    var h = (modal.querySelector("#ggaHandle").value || "").trim();
    var pin = modal.querySelector("#ggaPin").value || "";
    var nameEl = modal.querySelector("#ggaName");
    var name = nameEl ? (nameEl.value || "").trim() : "";
    var btn = modal.querySelector("#ggaSubmit"); if (btn) btn.disabled = true;
    try {
      var res;
      if (mode === "signup"){ status("Creating account\u2026"); res = await GG.register(h, name || h, pin); }
      else { status("Logging in\u2026"); res = await GG.login(h, pin); }
      if (res && res.ok){
        // persist avatar onto the local account if the backend sent one
        if (res.avatar){ try { var d = JSON.parse(res.avatar); var a = acct(); if (a){ a.avatar = d; GG.account.set(a); } } catch (e) {} }
        if (res.warning){
          status("\u26a0\ufe0f " + res.warning, "err");
          refresh(); fire(res);
          // leave the modal open so the warning doesn't just flash by
        } else {
          status(mode === "signup" ? "Account created \u2713" : "Logged in \u2713", "ok");
          refresh(); fire(res);
          setTimeout(A.close, 550);
        }
      } else {
        status((res && res.error) || "Something went wrong.", "err");
        if (btn) btn.disabled = false;
      }
    } catch (e){ status("Network error \u2014 try again.", "err"); if (btn) btn.disabled = false; }
  }

  /* ---------------- avatar editor (optional) ---------------- */
  /* ---------------- account modal: direct messages ---------------- */
  var dmBadgeTimer = null;
  async function refreshDmBadge(a){
    if (!a || !GG.dmUnread) return;
    var badge = modal.querySelector("#ggaDmBadge");
    try {
      var res = await GG.dmUnread();
      badge = modal.querySelector("#ggaDmBadge"); if (!badge) return;   // modal moved on
      var n = (res && res.ok) ? (res.unread || 0) : 0;
      if (n > 0){ badge.textContent = n > 99 ? "99+" : String(n); badge.hidden = false; }
      else badge.hidden = true;
    } catch (e){}
  }

  function dmTime(iso){
    var t = Date.parse(iso || ""); if (isNaN(t)) return "";
    var d = new Date(t), now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    return sameDay ? d.toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" })
                   : d.toLocaleDateString(undefined, { month:"short", day:"numeric" }) + " " +
                     d.toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" });
  }

  function openMessages(a){
    modal.classList.remove("acct");   // account-only width
    modal.innerHTML =
      '<button class="gga-x" aria-label="Close">\u2715</button>'+
      '<button class="gga-back" id="ggaDmBack">\u2039 Back to account</button>'+
      '<h2 class="gga-title">Messages</h2>'+
      '<button class="gga-newdm-btn" id="ggaDmNew">\uff0b New message</button>'+
      '<div id="ggaDmList"><p class="gga-empty"><span class="gg-spin"></span>Loading\u2026</p></div>';
    modal.querySelector(".gga-x").onclick = A.close;
    modal.querySelector("#ggaDmBack").onclick = function(){ mode = "account"; renderModal(); };
    modal.querySelector("#ggaDmNew").onclick = function(){ openPicker(a); };
    loadThreads(a);
  }

  /* searchable directory picker: you can only pick a verified user. */
  var dirCache = null;
  async function openPicker(a){
    modal.classList.remove("acct");   // account-only width
    modal.innerHTML =
      '<button class="gga-x" aria-label="Close">\u2715</button>'+
      '<button class="gga-back" id="ggaDmBack">\u2039 All messages</button>'+
      '<h2 class="gga-title">New message</h2>'+
      '<div class="gga-newdm"><input id="ggaDmSearch" placeholder="Search users by name or handle\u2026" autocomplete="off" maxlength="40"></div>'+
      '<div class="gga-picker" id="ggaPicker"><p class="gga-empty"><span class="gg-spin"></span>Loading users\u2026</p></div>';
    modal.querySelector(".gga-x").onclick = A.close;
    modal.querySelector("#ggaDmBack").onclick = function(){ openMessages(a); };
    var search = modal.querySelector("#ggaDmSearch");
    var res = dirCache;
    if (!res){ try { res = await GG.dmDirectory(); dirCache = res; } catch (e){ res = null; } }
    var list = modal.querySelector("#ggaPicker"); if (!list) return;   // modal moved on
    var users = (res && res.ok) ? (res.users || []) : null;
    if (!users){ list.innerHTML = '<p class="gga-empty">Couldn\u2019t load the user list.</p>'; return; }
    if (!users.length){ list.innerHTML = '<p class="gga-empty">No other users yet.</p>'; return; }
    function paint(q){
      q = (q || "").toLowerCase();
      var rows = users.filter(function(u){
        return !q || u.handle.toLowerCase().indexOf(q) >= 0 || String(u.name).toLowerCase().indexOf(q) >= 0;
      });
      if (!rows.length){ list.innerHTML = '<p class="gga-empty">No users match \u201c'+esc(q)+'\u201d.</p>'; return; }
      list.innerHTML = rows.slice(0, 60).map(function(u){
        return '<button class="gga-pick" data-h="'+esc(u.handle)+'" data-n="'+esc(u.name)+'">'+
          '<span class="gga-pick__nm">'+esc(u.name)+'<small>@'+esc(u.handle)+'</small></span></button>';
      }).join("");
      Array.prototype.forEach.call(list.querySelectorAll(".gga-pick"), function(btn){
        btn.onclick = function(){ openConvo(a, btn.getAttribute("data-h"), btn.getAttribute("data-n")); };
      });
    }
    paint("");
    search.addEventListener("input", function(){ paint(search.value); });
    setTimeout(function(){ search.focus(); }, 0);
  }

  async function loadThreads(a){
    var list = modal.querySelector("#ggaDmList"); if (!list) return;
    var res; try { res = await GG.dmThreads(); } catch (e){ res = null; }
    list = modal.querySelector("#ggaDmList"); if (!list) return;
    if (!res || !res.ok){ list.innerHTML = '<p class="gga-empty">Couldn\u2019t load messages.</p>'; return; }
    var threads = res.threads || [];
    if (!threads.length){ list.innerHTML = '<p class="gga-empty">No messages yet. Start one above.</p>'; return; }
    list.innerHTML = '<div class="gga-threads">'+threads.map(function(t){
      var last = t.messages.length ? t.messages[t.messages.length-1] : null;
      var preview = last ? (last.mine ? "You: " : "") + last.body : "";
      var badge = t.unread ? '<span class="gga-dm-badge">'+(t.unread>99?"99+":t.unread)+'</span>' : "";
      return '<button class="gga-thread" data-h="'+esc(t.handle)+'" data-n="'+esc(t.name)+'">'+
        '<span class="gga-thread__nm">'+esc(t.name)+badge+'<small>'+esc(preview)+'</small></span>'+
        '<span style="color:#66697a;font-size:.72rem">'+esc(dmTime(t.lastAt))+'</span></button>';
    }).join("")+'</div>';
    Array.prototype.forEach.call(list.querySelectorAll(".gga-thread"), function(btn){
      btn.onclick = function(){ openConvo(a, btn.getAttribute("data-h"), btn.getAttribute("data-n")); };
    });
  }

  async function openConvo(a, otherHandle, otherName){
    modal.classList.remove("acct");   // account-only width
    modal.innerHTML =
      '<button class="gga-x" aria-label="Close">\u2715</button>'+
      '<button class="gga-back" id="ggaDmBack">\u2039 All messages</button>'+
      '<h2 class="gga-title">'+esc(otherName || otherHandle)+'</h2>'+
      '<div class="gga-convo" id="ggaConvo"><p class="gga-empty"><span class="gg-spin"></span>Loading\u2026</p></div>'+
      '<div class="gga-dm-compose"><textarea id="ggaDmText" placeholder="Write a message\u2026" maxlength="2000" rows="1"></textarea><button id="ggaDmSend">Send</button></div>'+
      '<div class="gga-status" id="ggaDmStatus"></div>';
    modal.querySelector(".gga-x").onclick = A.close;
    modal.querySelector("#ggaDmBack").onclick = function(){ openMessages(a); };
    var send = modal.querySelector("#ggaDmSend"), text = modal.querySelector("#ggaDmText");
    async function doSend(){
      var body = (text.value || "").trim(); if (!body) return;
      send.disabled = true;
      var res; try { res = await GG.dmSend(otherHandle, body); } catch (e){ res = null; }
      if (res && res.ok){ text.value = ""; await paintConvo(a, otherHandle); }
      else { var st = modal.querySelector("#ggaDmStatus"); if (st){ st.textContent = (res && res.error) || "Couldn\u2019t send."; st.className = "gga-status err"; } }
      send.disabled = false;
    }
    send.onclick = doSend;
    text.addEventListener("keydown", function(e){ if (e.key === "Enter" && (e.metaKey || e.ctrlKey)){ e.preventDefault(); doSend(); } });
    await paintConvo(a, otherHandle);
    // mark this thread read, then refresh the nav/account badge silently
    try { await GG.dmMarkRead(otherHandle); } catch (e){}
  }

  async function paintConvo(a, otherHandle){
    var res; try { res = await GG.dmThreads(); } catch (e){ res = null; }
    var box = modal.querySelector("#ggaConvo"); if (!box) return;
    if (!res || !res.ok){ box.innerHTML = '<p class="gga-empty">Couldn\u2019t load this conversation.</p>'; return; }
    var thread = (res.threads || []).filter(function(t){ return t.handle.toLowerCase() === String(otherHandle).toLowerCase(); })[0];
    var msgs = thread ? thread.messages : [];
    if (!msgs.length){ box.innerHTML = '<p class="gga-empty">No messages yet \u2014 say hello.</p>'; }
    else box.innerHTML = msgs.map(function(m){
      return '<div class="gga-bubble '+(m.mine?"me":"them")+'">'+esc(m.body)+'<time>'+esc(dmTime(m.created))+'</time></div>';
    }).join("");
    box.scrollTop = box.scrollHeight;
  }

  function openAvatar(){
    if (!window.MawashiDesigner) return;
    modal.classList.add("wide");
    modal.classList.remove("acct");   // account-only width
    modal.innerHTML =
      '<button class="gga-x" aria-label="Close">\u2715</button>'+
      '<h2 class="gga-title">Edit your mawashi</h2>'+
      '<div id="ggaMount"></div>'+
      '<div class="gga-status"></div>';
    modal.querySelector(".gga-x").onclick = function(){ mode = "account"; renderModal(); };
    var a = acct();
    window.MawashiDesigner.mount(modal.querySelector("#ggaMount"), {
      initial: (a && a.avatar) || window.MawashiDesigner.DEFAULT,
      saveLabel: "Save avatar",
      onSave: async function(design){
        status("Saving\u2026");
        var cur = acct(); if (cur){ cur.avatar = design; GG.account.set(cur); }   // local first
        renderNav();
        if (GG.hasAPI && GG.hasAPI() && GG.saveAvatar){
          try { var r = await GG.saveAvatar(design); if (!(r && r.ok)){ status((r && r.error) || "Saved locally; server didn\u2019t confirm.", "err"); } else status("Saved \u2713", "ok"); }
          catch (e){ status("Saved locally; network error.", "err"); }
        } else { status("Saved \u2713", "ok"); }
        fire();
        setTimeout(function(){ mode = "account"; renderModal(); }, 650);
      }
    });
  }

  /* ---------------- public ---------------- */
  A.open = function(view){
    ensureCSS(); ensureModal();
    mode = (view === "account" && acct()) ? "account" : (view === "signup" ? "signup" : (view === "login" ? "login" : (acct() ? "account" : "login")));
    renderModal();
    ov.classList.add("open"); document.body.style.overflow = "hidden";
  };
  A.close = function(){ if (ov){ ov.classList.remove("open"); document.body.style.overflow = ""; } };
  A.refresh = function(){ renderNav(); };
  /* Lets gg-nav render the account control in the same tick it builds the bar,
     so the browser never gets a chance to paint a nav whose account cluster is
     still empty (which slides the links sideways a frame later). Idempotent. */
  A.mountNav = function(){ ensureCSS(); mountNav(0); };
  A.get = function(){ return acct(); };
  function refresh(){ renderNav(); }

  /* ---------------- boot ---------------- */
  function boot(){ ensureCSS(); mountNav(0); }
  // Mount as soon as <body> exists (gg-nav has already built the .ggn-acct slot
  // synchronously by this point), so the account control appears with the bar
  // instead of popping in on DOMContentLoaded and shoving the links sideways.
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
