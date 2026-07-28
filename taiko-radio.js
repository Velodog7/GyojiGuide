/*  TAIKO RADIO  ·  gyojiguide.com
 *  ---------------------------------------------------------------
 *  Drop-in background radio for the Gyoji Guide and Enter-the-Dohyō
 *  pages. Include once, near the end of <body>:
 *
 *      <script src="taiko-radio.js" defer></script>
 *
 *  It injects its own control bar (play/stop · volume · mute · next ·
 *  “＋” to build a song in taiko.html) and starts in radio mode,
 *  cycling a built-in playlist of taiko loops. It plays the same
 *  sample set as player.html (fetched from ./samples/), and reuses
 *  the pattern codec so songs made in the constructor can be pasted
 *  straight into PLAYLIST as { name, code }.
 *
 *  Browsers block audio until the first interaction, so if autoplay
 *  is refused the radio arms itself and begins on the first click,
 *  tap or key-press anywhere on the page.
 *
 *  Optional: override where the samples live with
 *      <script src="taiko-radio.js" data-samples="/audio/" defer></script>
 */
(function () {
  "use strict";
  if (window.__taikoRadio) return;           // never load twice
  window.__taikoRadio = true;

  var THIS = document.currentScript;
  var SAMPLE_BASE = (THIS && THIS.dataset && THIS.dataset.samples) || "samples/";

  /* ---- sample manifest (matches taiko-data.js) ---- */
  var SAMPLES=[{"name":"Deep Boom A","file":"samples/deep-boom-a.mp3"},{"name":"Deep Boom B","file":"samples/deep-boom-b.mp3"},{"name":"Deep Boom C","file":"samples/deep-boom-c.mp3"},{"name":"Deep Boom D","file":"samples/deep-boom-d.mp3"},{"name":"Big Hit A","file":"samples/big-hit-a.mp3"},{"name":"Big Hit B","file":"samples/big-hit-b.mp3"},{"name":"Big Hit C","file":"samples/big-hit-c.mp3"},{"name":"Big Hit D","file":"samples/big-hit-d.mp3"},{"name":"Big Hit E","file":"samples/big-hit-e.mp3"},{"name":"Big Hit F","file":"samples/big-hit-f.mp3"},{"name":"Big Hit G","file":"samples/big-hit-g.mp3"},{"name":"Big Hit H","file":"samples/big-hit-h.mp3"},{"name":"Big Hit I","file":"samples/big-hit-i.mp3"},{"name":"Mid Hit A","file":"samples/mid-hit-a.mp3"},{"name":"Mid Hit B","file":"samples/mid-hit-b.mp3"},{"name":"Mid Hit C","file":"samples/mid-hit-c.mp3"},{"name":"Mid Hit D","file":"samples/mid-hit-d.mp3"},{"name":"Mid Hit E","file":"samples/mid-hit-e.mp3"},{"name":"Mid Hit F","file":"samples/mid-hit-f.mp3"},{"name":"Mid Hit G","file":"samples/mid-hit-g.mp3"},{"name":"Mid Hit H","file":"samples/mid-hit-h.mp3"},{"name":"Drum 4a","file":"samples/drum-4a.mp3"},{"name":"Drum 4b","file":"samples/drum-4b.mp3"},{"name":"Drum 4c","file":"samples/drum-4c.mp3"},{"name":"Drum 4d","file":"samples/drum-4d.mp3"},{"name":"Drum 4e","file":"samples/drum-4e.mp3"},{"name":"Drum 5a","file":"samples/drum-5a.mp3"},{"name":"Drum 5b","file":"samples/drum-5b.mp3"},{"name":"Drum 5c","file":"samples/drum-5c.mp3"},{"name":"Drum 5d","file":"samples/drum-5d.mp3"},{"name":"Drum 6a","file":"samples/drum-6a.mp3"},{"name":"Drum 6b","file":"samples/drum-6b.mp3"},{"name":"Drum 6c","file":"samples/drum-6c.mp3"},{"name":"Drum 6d","file":"samples/drum-6d.mp3"},{"name":"Drum 6e","file":"samples/drum-6e.mp3"},{"name":"Taiko Forte 1","file":"samples/taiko-forte-1.mp3"},{"name":"Taiko Forte 2","file":"samples/taiko-forte-2.mp3"},{"name":"Taiko Mezzo","file":"samples/taiko-mezzo.mp3"},{"name":"Taiko Piano","file":"samples/taiko-piano.mp3"},{"name":"Taiko C5","file":"samples/taiko-c5.mp3"},{"name":"Quick Hit A","file":"samples/quick-hit-a.mp3"},{"name":"Quick Hit B","file":"samples/quick-hit-b.mp3"},{"name":"Quick Hit C","file":"samples/quick-hit-c.mp3"},{"name":"Crash A","file":"samples/crash-a.mp3"},{"name":"Crash B","file":"samples/crash-b.mp3"},{"name":"Crash C","file":"samples/crash-c.mp3"},{"name":"Crash D","file":"samples/crash-d.mp3"},{"name":"Crash E","file":"samples/crash-e.mp3"},{"name":"Sticks A","file":"samples/sticks-a.mp3"},{"name":"Sticks B","file":"samples/sticks-b.mp3"},{"name":"Sticks C","file":"samples/sticks-c.mp3"},{"name":"Sticks D","file":"samples/sticks-d.mp3"},{"name":"Sticks E","file":"samples/sticks-e.mp3"},{"name":"Sticks F","file":"samples/sticks-f.mp3"},{"name":"Sticks G","file":"samples/sticks-g.mp3"},{"name":"Lt Sticks A","file":"samples/lt-sticks-a.mp3"},{"name":"Lt Sticks B","file":"samples/lt-sticks-b.mp3"},{"name":"Lt Sticks C","file":"samples/lt-sticks-c.mp3"},{"name":"Lt Sticks D","file":"samples/lt-sticks-d.mp3"},{"name":"Lt Sticks E","file":"samples/lt-sticks-e.mp3"}];

  function sampleFile(idx) {
    var f = (SAMPLES[idx] && SAMPLES[idx].file) || "";
    return f.replace(/^samples\//, SAMPLE_BASE);   // honour the base override
  }

  /* ---- pattern codec (decode only — from taiko-data.js) ---- */
  function _unb64u(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    var b = atob(s), a = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  }
  var _STEPINV = [8, 16, 32, 64, 128];
  function decodePattern(str) {
    var buf = _unb64u(str);
    if (buf[0] !== 1) throw new Error("unsupported pattern");
    var bpm = buf[1], swing = buf[2], steps = _STEPINV[buf[3]] || 16, n = buf[4], nb = Math.ceil(steps / 8);
    var tracks = [], o = 5;
    for (var k = 0; k < n; k++) {
      var idx = buf[o++], vol = buf[o++] / 100, arr = new Array(steps).fill(false);
      for (var b = 0; b < nb; b++) {
        var byte = buf[o++];
        for (var bit = 0; bit < 8; bit++) { var s = b * 8 + bit; if (s < steps && (byte & (1 << bit))) arr[s] = true; }
      }
      tracks.push({ idx: idx, vol: vol, steps: arr });
    }
    return { bpm: bpm, swing: swing, steps: steps, tracks: tracks };
  }

  /* ---- built-in playlist ---------------------------------------
     mk(steps, [onIndices]) makes a step array. Sample indices match
     SAMPLES above. Add your own with { name:"…", code:"…" } using a
     code copied from taiko.html’s Embed button. --------------------*/
  function mk(steps, on) { var a = new Array(steps).fill(false); on.forEach(function (i) { a[i] = true; }); return a; }

  var PLAYLIST = [
    { name: "Dohyō-iri", pat: { bpm: 96, swing: 0, steps: 16, tracks: [
      { idx: 0,  vol: .95, steps: mk(16, [0, 8]) },              // Deep Boom A
      { idx: 35, vol: .85, steps: mk(16, [4, 12]) },             // Taiko Forte 1
      { idx: 13, vol: .42, steps: mk(16, [2, 6, 10, 14]) },      // Mid Hit A
      { idx: 43, vol: .5,  steps: mk(16, [0]) }                  // Crash A
    ] } },
    { name: "Matsuri", pat: { bpm: 128, swing: 12, steps: 16, tracks: [
      { idx: 1,  vol: .9,  steps: mk(16, [0, 3, 8, 11]) },        // Deep Boom B
      { idx: 6,  vol: .8,  steps: mk(16, [4, 12]) },             // Big Hit C
      { idx: 40, vol: .5,  steps: mk(16, [2, 6, 10, 14]) },      // Quick Hit A
      { idx: 50, vol: .28, steps: mk(16, [0, 2, 4, 6, 8, 10, 12, 14]) } // Sticks C
    ] } },
    { name: "Nagoya", pat: { bpm: 118, swing: 0, steps: 16, tracks: [
      { idx: 2,  vol: .95, steps: mk(16, [0, 8]) },              // Deep Boom C
      { idx: 4,  vol: .8,  steps: mk(16, [4, 12]) },             // Big Hit A
      { idx: 16, vol: .5,  steps: mk(16, [6, 14]) },             // Mid Hit D
      { idx: 48, vol: .3,  steps: mk(16, [1, 3, 5, 7, 9, 11, 13, 15]) }, // Sticks A
      { idx: 9,  vol: .6,  steps: mk(16, [15]) }                 // Big Hit F pickup
    ] } },
    { name: "Keiko", pat: { bpm: 140, swing: 0, steps: 16, tracks: [
      { idx: 51, vol: .4,  steps: mk(16, [0, 2, 4, 6, 8, 10, 12, 14]) }, // Sticks D
      { idx: 55, vol: .28, steps: mk(16, [1, 3, 5, 7, 9, 11, 13, 15]) }, // Lt Sticks A
      { idx: 0,  vol: .9,  steps: mk(16, [0, 8]) },              // Deep Boom A
      { idx: 7,  vol: .7,  steps: mk(16, [4, 12]) }              // Big Hit D
    ] } },
    { name: "Yūshō", pat: { bpm: 108, swing: 0, steps: 32, tracks: [
      { idx: 36, vol: 1,   steps: mk(32, [0, 16]) },            // Taiko Forte 2
      { idx: 3,  vol: .85, steps: mk(32, [8, 24]) },            // Deep Boom D
      { idx: 5,  vol: .7,  steps: mk(32, [4, 12, 20, 28]) },    // Big Hit B
      { idx: 14, vol: .4,  steps: mk(32, [2, 6, 10, 14, 18, 22, 26, 30]) }, // Mid Hit B
      { idx: 44, vol: .55, steps: mk(32, [0]) }                 // Crash B
    ] } }
  ].map(function (e) { if (!e.pat && e.code) { try { e.pat = decodePattern(e.code); } catch (x) { e.pat = null; } } return e; })
   .filter(function (e) { return e.pat && e.pat.tracks.length; });

  var SONG_SECONDS = 30;                      // radio moves to the next loop after this long
  var SHUFFLE = 0.88;                         // radio-mode randomness: 88% jump to a random song, 12% in order
  function chooseNext() {
    if (PLAYLIST.length <= 1) return cur;
    if (Math.random() < SHUFFLE) {
      var i; do { i = Math.floor(Math.random() * PLAYLIST.length); } while (i === cur);
      return i;
    }
    return (cur + 1) % PLAYLIST.length;
  }

  /* ---- preferences ---- */
  var prefs = { vol: 0.7, muted: false, enabled: true };
  try {
    var v = localStorage.getItem("taiko.radio.vol");     if (v !== null) prefs.vol = Math.max(0, Math.min(1, +v));
    var m = localStorage.getItem("taiko.radio.muted");   if (m !== null) prefs.muted = m === "1";
    var e = localStorage.getItem("taiko.radio.enabled"); if (e !== null) prefs.enabled = e !== "0";
  } catch (x) {}
  function savePrefs() {
    try {
      localStorage.setItem("taiko.radio.vol", String(prefs.vol));
      localStorage.setItem("taiko.radio.muted", prefs.muted ? "1" : "0");
      localStorage.setItem("taiko.radio.enabled", prefs.enabled ? "1" : "0");
    } catch (x) {}
  }

  /* ---- audio engine ---- */
  var AC = null, master = null, buffers = {}, loadingPromise = null, playing = false;
  var cur = 0, STEPS = 16, BPM = 110, SWING = 0, used = [];
  var step = 0, nextT = 0, timer = null, songStartT = 0;
  var LOOK = 25, AHEAD = 0.1;
  function sps() { return (60 / BPM) / 4; }

  function distinctIdx() {
    var set = {};
    PLAYLIST.forEach(function (e) { e.pat.tracks.forEach(function (t) { if (t.idx < SAMPLES.length) set[t.idx] = 1; }); });
    return Object.keys(set).map(Number);
  }
  function ensureAudio() {
    if (loadingPromise) return loadingPromise;
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); applyGain(); master.connect(AC.destination);
    loadingPromise = Promise.all(distinctIdx().map(function (idx) {
      return fetch(sampleFile(idx))
        .then(function (r) { return r.arrayBuffer(); })
        .then(function (b) { return AC.decodeAudioData(b); })
        .then(function (buf) { buffers[idx] = buf; })
        .catch(function () { /* a missing sample just stays silent */ });
    }));
    return loadingPromise;
  }
  function applyGain() { if (master) master.gain.value = prefs.muted ? 0 : prefs.vol; }
  function playSample(idx, when, gain) {
    var buf = buffers[idx]; if (!buf) return;
    var srcN = AC.createBufferSource(); srcN.buffer = buf;
    var g = AC.createGain(); g.gain.value = gain; srcN.connect(g); g.connect(master);
    srcN.start(when || 0);
  }

  function setSong(i) {
    cur = (i + PLAYLIST.length) % PLAYLIST.length;
    var s = PLAYLIST[cur];
    STEPS = s.pat.steps; SWING = s.pat.swing || 0;
    var jitter = Math.round((Math.random() * 2 - 1) * 16);      // ±16 BPM, fresh each play
    BPM = Math.max(40, Math.min(240, (s.pat.bpm || 110) + jitter));
    used = s.pat.tracks.filter(function (t) { return t.idx < SAMPLES.length; });
    if (nameEl) nameEl.textContent = s.name;
    if (subEl) subEl.textContent = used.length + " tracks · " + BPM + " BPM";
  }
  function scheduleStep(sName, time) {
    var hit = false;
    used.forEach(function (t) { if (t.steps[sName]) { playSample(t.idx, time, t.vol); hit = true; } });
    if (hit) beatKick = 1;                     // a struck step gives the visualizer a shove
  }

  /* ---- random, music-like visualizer ---- */
  var eqTimer = null, beatKick = 0, eqBars = null;
  function startEq() {
    if (eqTimer || !eqEl) return;
    eqBars = eqEl.children;
    eqTimer = setInterval(tickEq, 95);
  }
  function stopEq() {
    clearInterval(eqTimer); eqTimer = null;
    if (eqEl) for (var i = 0; i < eqEl.children.length; i++) eqEl.children[i].style.height = "5px";
  }
  function tickEq() {
    if (!eqBars) return;
    var kick = beatKick; beatKick = Math.max(0, beatKick - 0.34);   // decays between hits
    for (var i = 0; i < eqBars.length; i++) {
      var r = Math.random();
      // mostly low with the odd tall spike, plus a shared jump on each beat — reads like real levels
      var h = 5 + r * r * 12 + kick * (5 + Math.random() * 7);
      eqBars[i].style.height = Math.max(5, Math.min(20, h)).toFixed(1) + "px";
    }
  }
  function loop() {
    while (nextT < AC.currentTime + AHEAD) {
      var t = nextT;
      if (step % 2 === 1) t += (SWING / 100) * sps();
      scheduleStep(step, t);
      nextT += sps();
      step++;
      if (step >= STEPS) {
        step = 0;
        if (AC.currentTime - songStartT >= SONG_SECONDS) { advance(); return; }
      }
    }
    timer = setTimeout(loop, LOOK);
  }
  function begin() {
    playing = true; setState("playing");
    step = 0; nextT = AC.currentTime + 0.06; songStartT = AC.currentTime;
    startEq(); loop();
  }
  function advance() {
    setSong(chooseNext()); step = 0; songStartT = AC.currentTime;   // 88% random next in radio mode
    timer = setTimeout(loop, LOOK);            // keep the clock running seamlessly
  }
  function next() {
    if (!AC) { start(); return; }
    clearTimeout(timer); setSong(chooseNext());
    step = 0; nextT = AC.currentTime + 0.05; songStartT = AC.currentTime;
    if (!playing) { playing = true; setState("playing"); }
    startEq(); loop();
  }
  function stop() {
    playing = false; clearTimeout(timer); stopEq(); setState("paused");
  }
  function start() {
    return ensureAudio().then(function () {
      if (!AC) return;
      if (AC.resume) AC.resume();              // request resume (the browser may defer it)
      if (kickIfRunning()) return;             // autoplay allowed → straight to playing
      armGesture();                            // otherwise begin on the first interaction
      var tries = 0;                           // some browsers resume a beat later w/o a gesture — poll briefly
      var iv = setInterval(function () {
        if (kickIfRunning()) { clearInterval(iv); disarm(); }
        else if (++tries > 10) clearInterval(iv);
      }, 200);
    });
  }
  function kickIfRunning() {
    if (AC && AC.state === "running") { if (prefs.enabled && !playing) begin(); return true; }
    return false;
  }
  function toggle() {
    prefs.enabled = !playing; savePrefs();
    if (playing) stop(); else start();
  }

  /* ---- gesture arming for autoplay-blocked browsers ---- */
  var armed = false;
  function onGesture() {
    if (!AC) return;
    if (AC.resume) AC.resume().then(function () {
      if (AC.state === "running") { disarm(); if (prefs.enabled && !playing) begin(); }
    });
    else { disarm(); if (prefs.enabled && !playing) begin(); }
  }
  function disarm() {
    window.removeEventListener("pointerdown", onGesture, true);
    window.removeEventListener("keydown", onGesture, true);
    window.removeEventListener("touchstart", onGesture, true);
    armed = false;
  }
  function armGesture() {
    setState("armed");
    if (subEl && !playing) subEl.textContent = "tap to start";
    if (armed) return; armed = true;
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    window.addEventListener("touchstart", onGesture, true);
  }

  /* ---- UI ---- */
  var bar, nameEl, subEl, ppBtn, muteBtn, volInput, eqEl;
  function setState(s) { if (bar) bar.dataset.state = s; if (ppBtn) ppBtn.textContent = (s === "playing") ? "❚❚" : "▶"; }

  function buildUI() {
    var css = document.createElement("style");
    css.textContent =
      ".tkr{position:fixed;left:14px;bottom:14px;z-index:70;display:flex;align-items:center;gap:9px;" +
        "padding:8px 12px 8px 8px;border-radius:99px;background:rgba(24,20,17,.86);" +
        "border:1px solid #3a312b;box-shadow:0 10px 30px rgba(0,0,0,.5);" +
        "-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f3ece4;" +
        "user-select:none;max-width:calc(100vw - 28px)}" +
      ".tkr button,.tkr a{font:inherit;border:0;background:none;color:inherit;cursor:pointer;display:grid;place-items:center}" +
      ".tkr-pp{flex:none;width:38px;height:38px;border-radius:50%;background:#e0472c;color:#fff;font-size:14px;transition:.12s}" +
      ".tkr-pp:hover{background:#ff6a4d}" +
      ".tkr[data-state='playing'] .tkr-pp{background:#e6b453;color:#241c10}" +
      ".tkr-eq{flex:none;display:flex;gap:2px;align-items:flex-end;height:20px;width:20px}" +
      ".tkr-eq i{width:3px;background:#6b5a4c;border-radius:2px;height:5px;transition:height .1s ease,background .1s ease}" +
      ".tkr[data-state='playing'] .tkr-eq i{background:#ff6a4d}" +
      ".tkr-meta{min-width:0;display:flex;flex-direction:column;line-height:1.15;margin-right:2px}" +
      ".tkr-name{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}" +
      ".tkr-sub{font-size:10px;color:#a8998c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px}" +
      ".tkr-ico{flex:none;width:30px;height:30px;border-radius:50%;font-size:15px;color:#d8c8ba}" +
      ".tkr-ico:hover{background:rgba(255,255,255,.08);color:#fff}" +
      ".tkr-vol{flex:none;width:74px;height:4px;-webkit-appearance:none;appearance:none;background:#4a3f37;border-radius:4px;cursor:pointer}" +
      ".tkr-vol::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:#e6b453;cursor:pointer}" +
      ".tkr-vol::-moz-range-thumb{width:13px;height:13px;border:0;border-radius:50%;background:#e6b453;cursor:pointer}" +
      ".tkr-make{flex:none;width:30px;height:30px;border-radius:50%;font-size:16px;color:#e6b453;text-decoration:none}" +
      ".tkr-make:hover{background:rgba(230,180,83,.16)}" +
      ".tkr[data-state='muted'] .tkr-vol,.tkr.muted .tkr-vol{opacity:.4}" +
      "@media (max-width:640px){.tkr-vol{display:none}.tkr-sub{display:none}.tkr-name{max-width:88px}}";
    document.head.appendChild(css);

    bar = document.createElement("div");
    bar.className = "tkr"; bar.setAttribute("role", "group"); bar.setAttribute("aria-label", "Taiko radio");
    bar.innerHTML =
      '<button class="tkr-pp" title="Play / stop radio" aria-label="Play or stop">▶</button>' +
      '<div class="tkr-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
      '<div class="tkr-meta"><span class="tkr-name">Taiko Radio</span><span class="tkr-sub">starting…</span></div>' +
      '<button class="tkr-ico tkr-next" title="Next loop" aria-label="Next">⏭</button>' +
      '<button class="tkr-ico tkr-mute" title="Mute" aria-label="Mute">🔊</button>' +
      '<input class="tkr-vol" type="range" min="0" max="100" title="Volume" aria-label="Volume">' +
      '<a class="tkr-make" href="taiko.html" title="Create a loop in the constructor" aria-label="Create a loop">＋</a>';
    document.body.appendChild(bar);

    nameEl = bar.querySelector(".tkr-name");
    subEl = bar.querySelector(".tkr-sub");
    ppBtn = bar.querySelector(".tkr-pp");
    muteBtn = bar.querySelector(".tkr-mute");
    eqEl = bar.querySelector(".tkr-eq");
    volInput = bar.querySelector(".tkr-vol");

    volInput.value = Math.round(prefs.vol * 100);
    reflectMute();

    ppBtn.addEventListener("click", toggle);
    bar.querySelector(".tkr-next").addEventListener("click", next);
    muteBtn.addEventListener("click", function () { prefs.muted = !prefs.muted; savePrefs(); applyGain(); reflectMute(); });
    volInput.addEventListener("input", function () {
      prefs.vol = (+volInput.value) / 100;
      if (prefs.vol > 0 && prefs.muted) { prefs.muted = false; reflectMute(); }
      savePrefs(); applyGain();
    });
  }
  function reflectMute() {
    if (!muteBtn) return;
    muteBtn.textContent = prefs.muted ? "🔇" : "🔊";
    muteBtn.title = prefs.muted ? "Unmute" : "Mute";
    bar.classList.toggle("muted", prefs.muted);
  }

  /* ---- boot ---- */
  function boot() {
    buildUI();
    setSong(0);
    if (prefs.enabled) {
      start();                                 // radio mode on by default
    } else {
      setState("paused");
      if (subEl) subEl.textContent = "paused";
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  /* host pages can drive it too:  window.TaikoRadio.next()  etc. */
  window.TaikoRadio = {
    play: start, stop: stop, toggle: toggle, next: next,
    setVolume: function (v) { prefs.vol = Math.max(0, Math.min(1, v)); if (volInput) volInput.value = Math.round(prefs.vol * 100); savePrefs(); applyGain(); },
    mute: function (on) { prefs.muted = !!on; savePrefs(); applyGain(); reflectMute(); }
  };
})();
