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
    ".gga-btn{font:inherit;font-weight:600;font-size:.82rem;padding:8px 14px;border-radius:9px;cursor:pointer;"+
      "border:1px solid #39404f;background:transparent;color:#c7cbd9;transition:color .15s,background .15s,border-color .15s;white-space:nowrap}"+
    ".gga-btn:hover{color:#e0a23a;border-color:#e0a23a}"+
    ".gga-btn.solid{background:#e0a23a;border-color:#e0a23a;color:#141620}"+
    ".gga-btn.solid:hover{filter:brightness(1.08);color:#141620}"+
    ".gga-chip{display:flex;align-items:center;gap:8px;padding:5px 10px 5px 5px;border-radius:999px;cursor:pointer;"+
      "border:1px solid #39404f;background:rgba(255,255,255,.03);color:#f1f2f6;font:inherit;font-weight:600;font-size:.84rem}"+
    ".gga-chip:hover{border-color:#e0a23a}"+
    ".gga-chip__ava{width:28px;height:28px;border-radius:50%;overflow:hidden;background:#222633;display:grid;place-items:center;"+
      "font-size:.8rem;color:#e0a23a;flex:none}"+
    ".gga-chip__ava svg{width:100%;height:100%;display:block}"+
    ".gga-chip__nm{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"+
    /* modal */
    ".gga-ov{position:fixed;inset:0;z-index:1000;display:none;align-items:center;justify-content:center;"+
      "background:rgba(6,7,11,.72);backdrop-filter:blur(3px);padding:18px}"+
    ".gga-ov.open{display:flex}"+
    ".gga-modal{width:min(420px,100%);max-height:90vh;overflow:auto;background:#14161d;border:1px solid #2a2d38;"+
      "border-radius:16px;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.6);font-family:'Space Grotesk','Zen Kaku Gothic New',system-ui,sans-serif}"+
    ".gga-modal.wide{width:min(560px,100%)}"+
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
    ".gga-acctrow{display:flex;align-items:center;gap:12px;margin-bottom:16px}"+
    ".gga-acctrow .gga-chip__ava{width:46px;height:46px;font-size:1.1rem}"+
    ".gga-acctrow b{display:block;color:#f1f2f6;font-size:1rem}"+
    ".gga-acctrow small{color:#878da0;font-family:'IBM Plex Mono',monospace;font-size:.75rem}"+
    ".gga-menu-btn{width:100%;text-align:left;background:#1b1e27;border:1px solid #2a2d38;color:#e9eaf0;font:inherit;"+
      "font-size:.9rem;padding:11px 13px;border-radius:10px;cursor:pointer;margin-top:8px}"+
    ".gga-menu-btn:hover{border-color:#e0a23a}"+
    ".gga-menu-btn.danger{color:#f0655a}.gga-menu-btn.danger:hover{border-color:#f0655a}"+
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
        '</button>';
      slot.querySelector("#ggaChip").onclick = function(){ A.open("account"); };
    } else {
      slot.innerHTML =
        '<button type="button" class="gga-btn" id="ggaLogin">Log in</button>'+
        '<button type="button" class="gga-btn solid" id="ggaSignup">Sign up</button>';
      slot.querySelector("#ggaLogin").onclick = function(){ A.open("login"); };
      slot.querySelector("#ggaSignup").onclick = function(){ A.open("signup"); };
    }
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
    modal.classList.remove("wide");
    if (mode === "account" && a){
      modal.innerHTML =
        '<button class="gga-x" aria-label="Close">\u2715</button>'+
        '<div class="gga-acctrow"><span class="gga-chip__ava">'+avaInner(a)+'</span>'+
          '<span><b>'+esc(a.name || a.handle)+'</b><small>@'+esc(a.handle)+'</small></span></div>'+
        (window.MawashiDesigner ? '<button class="gga-menu-btn" id="ggaEdit">Edit mawashi avatar</button>' : '')+
        '<button class="gga-menu-btn danger" id="ggaLogout">Log out</button>';
      modal.querySelector(".gga-x").onclick = A.close;
      var eb = modal.querySelector("#ggaEdit"); if (eb) eb.onclick = openAvatar;
      modal.querySelector("#ggaLogout").onclick = function(){ GG.logout(); refresh(); fire(); A.close(); };
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
        : 'New here? <a id="ggaToSignup">Sign up</a>')+'</div>'+
      '<div class="gga-status"></div>';
    modal.querySelector(".gga-x").onclick = A.close;
    var sw = modal.querySelector("#ggaToLogin") || modal.querySelector("#ggaToSignup");
    if (sw) sw.onclick = function(){ mode = signup ? "login" : "signup"; renderModal(); setTimeout(focusFirst, 0); };
    modal.querySelector("#ggaSubmit").onclick = submit;
    modal.querySelector("#ggaPin").addEventListener("keydown", function(e){ if (e.key === "Enter") submit(); });
    setTimeout(focusFirst, 0);
  }
  function focusFirst(){ var el = modal.querySelector("#ggaHandle"); if (el) el.focus(); }

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
  function openAvatar(){
    if (!window.MawashiDesigner) return;
    modal.classList.add("wide");
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
  A.get = function(){ return acct(); };
  function refresh(){ renderNav(); }

  /* ---------------- boot ---------------- */
  function boot(){ ensureCSS(); mountNav(0); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
