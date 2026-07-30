/*  TAIKO RADIO  ·  gyojiguide.com
 *  ---------------------------------------------------------------
 *  Drop-in background radio for the Gyoji Guide and Enter-the-Dohyō
 *  pages. Include once, near the end of <body>:
 *
 *      <script src="taiko-radio.js" defer></script>
 *
 *  It injects its own control bar (play/stop · volume · mute · next ·
 *  “＋” to build a loop in taiko.html) and plays FULL, generated
 *  taiko songs — the same structured playback as the constructor’s
 *  Radio: a fresh ensemble on a chosen meter, arranged into
 *  Intro → Verse → Chorus → Bridge → Chorus → Outro, tempo 83–112,
 *  every other song in an odd meter. When one song ends the next is
 *  composed and played automatically.
 *
 *  Uses the same drum samples as player.html (fetched from ./samples/).
 *  Browsers block audio until the first interaction, so if autoplay is
 *  refused the radio arms itself and starts on the first click/tap/key.
 *
 *  Optional: override the samples folder with
 *      <script src="taiko-radio.js" data-samples="/audio/" defer></script>
 */
(function () {
  "use strict";
  if (window.__taikoRadio) return;
  window.__taikoRadio = true;

  // Don't spawn a radio inside the dohyō ceremony header (dohyo.html?ceremony=1);
  // the host page already runs one, and two would overlap.
  try { if (new URLSearchParams(location.search).get("ceremony") === "1") return; } catch (e) {}

  var THIS = document.currentScript;
  var SAMPLE_BASE = (THIS && THIS.dataset && THIS.dataset.samples) || "samples/";

  // a fresh, silly title for whichever song is currently playing — one is
  // picked at random each time a NEW song starts, and carried along with
  // the saved progress so a song keeps its name if it continues onto the
  // next page (see PROG_KEY below).
  var SONG_TITLES = [
    "There Shikos", "Nodowa bites the dust", "Dohyo inferno", "Chanko Boogie", "Heya Jude",
    "Don't Worry, Be Abi", "Tsupari all the time", "Hotel Kotozakura", "Shishi's a Lady",
    "Shishi's My Cherry Pie", "Call me Abi", "Surfin' JSA", "Abi Road", "Basho Man",
    "Gyoji on my mind", "My Shikona", "Tachiai on the Wild Side", "Sweet Dreams (are Utcharis)",
    "Hey Now, Ura Allstar", "Bey Ya", "Every Breath you Takayasu", "Papayasu don't preach",
    "Don't Go Henka My Heart", "Rock the Basho", "Holding Out For A Yusho", "Walk Like an Ozeki",
    "Onosato-day Night", "Oyakata said knock you out", "Pour Some Chanko On Me", "I'm too Seki(tori)",
    "Makuuchi Girl", "Eye of the Tobizaru", "It's Raining Salt", "Gyoji Just Want To Have Fun",
    "Oops!… I Henka'd Again", "Gyoji in a Bottle", "Dock of the Beya", "Harite Tonight",
    "We Are The Shinpans", "Easy Like Sandanme Morning", "Welcome To The Chanko"
  ];
  function randomTitle(){ return SONG_TITLES[Math.floor(Math.random() * SONG_TITLES.length)]; }

  var SAMPLES = [{"name":"Deep Boom A","file":"samples/deep-boom-a.mp3"},{"name":"Deep Boom B","file":"samples/deep-boom-b.mp3"},{"name":"Deep Boom C","file":"samples/deep-boom-c.mp3"},{"name":"Deep Boom D","file":"samples/deep-boom-d.mp3"},{"name":"Big Hit A","file":"samples/big-hit-a.mp3"},{"name":"Big Hit B","file":"samples/big-hit-b.mp3"},{"name":"Big Hit C","file":"samples/big-hit-c.mp3"},{"name":"Big Hit D","file":"samples/big-hit-d.mp3"},{"name":"Big Hit E","file":"samples/big-hit-e.mp3"},{"name":"Big Hit F","file":"samples/big-hit-f.mp3"},{"name":"Big Hit G","file":"samples/big-hit-g.mp3"},{"name":"Big Hit H","file":"samples/big-hit-h.mp3"},{"name":"Big Hit I","file":"samples/big-hit-i.mp3"},{"name":"Mid Hit A","file":"samples/mid-hit-a.mp3"},{"name":"Mid Hit B","file":"samples/mid-hit-b.mp3"},{"name":"Mid Hit C","file":"samples/mid-hit-c.mp3"},{"name":"Mid Hit D","file":"samples/mid-hit-d.mp3"},{"name":"Mid Hit E","file":"samples/mid-hit-e.mp3"},{"name":"Mid Hit F","file":"samples/mid-hit-f.mp3"},{"name":"Mid Hit G","file":"samples/mid-hit-g.mp3"},{"name":"Mid Hit H","file":"samples/mid-hit-h.mp3"},{"name":"Drum 4a","file":"samples/drum-4a.mp3"},{"name":"Drum 4b","file":"samples/drum-4b.mp3"},{"name":"Drum 4c","file":"samples/drum-4c.mp3"},{"name":"Drum 4d","file":"samples/drum-4d.mp3"},{"name":"Drum 4e","file":"samples/drum-4e.mp3"},{"name":"Drum 5a","file":"samples/drum-5a.mp3"},{"name":"Drum 5b","file":"samples/drum-5b.mp3"},{"name":"Drum 5c","file":"samples/drum-5c.mp3"},{"name":"Drum 5d","file":"samples/drum-5d.mp3"},{"name":"Drum 6a","file":"samples/drum-6a.mp3"},{"name":"Drum 6b","file":"samples/drum-6b.mp3"},{"name":"Drum 6c","file":"samples/drum-6c.mp3"},{"name":"Drum 6d","file":"samples/drum-6d.mp3"},{"name":"Drum 6e","file":"samples/drum-6e.mp3"},{"name":"Taiko Forte 1","file":"samples/taiko-forte-1.mp3"},{"name":"Taiko Forte 2","file":"samples/taiko-forte-2.mp3"},{"name":"Taiko Mezzo","file":"samples/taiko-mezzo.mp3"},{"name":"Taiko Piano","file":"samples/taiko-piano.mp3"},{"name":"Taiko C5","file":"samples/taiko-c5.mp3"},{"name":"Quick Hit A","file":"samples/quick-hit-a.mp3"},{"name":"Quick Hit B","file":"samples/quick-hit-b.mp3"},{"name":"Quick Hit C","file":"samples/quick-hit-c.mp3"},{"name":"Crash A","file":"samples/crash-a.mp3"},{"name":"Crash B","file":"samples/crash-b.mp3"},{"name":"Crash C","file":"samples/crash-c.mp3"},{"name":"Crash D","file":"samples/crash-d.mp3"},{"name":"Crash E","file":"samples/crash-e.mp3"},{"name":"Sticks A","file":"samples/sticks-a.mp3"},{"name":"Sticks B","file":"samples/sticks-b.mp3"},{"name":"Sticks C","file":"samples/sticks-c.mp3"},{"name":"Sticks D","file":"samples/sticks-d.mp3"},{"name":"Sticks E","file":"samples/sticks-e.mp3"},{"name":"Sticks F","file":"samples/sticks-f.mp3"},{"name":"Sticks G","file":"samples/sticks-g.mp3"},{"name":"Lt Sticks A","file":"samples/lt-sticks-a.mp3"},{"name":"Lt Sticks B","file":"samples/lt-sticks-b.mp3"},{"name":"Lt Sticks C","file":"samples/lt-sticks-c.mp3"},{"name":"Lt Sticks D","file":"samples/lt-sticks-d.mp3"},{"name":"Lt Sticks E","file":"samples/lt-sticks-e.mp3"}];
  function sampleFile(idx) { return (SAMPLES[idx].file || "").replace(/^samples\//, SAMPLE_BASE); }

  /* ==== song generation (ported from the constructor’s Radio) ==== */
  function roleOf(name) {
    if (name.startsWith("Deep") || name.startsWith("Big") || name.startsWith("Taiko")) return "backbone";
    if (name.startsWith("Mid"))    return "mid";
    if (name.startsWith("Drum"))   return "drum";
    if (name.startsWith("Quick"))  return "quick";
    if (name.startsWith("Crash"))  return "crash";
    if (name.startsWith("Lt"))     return "light";
    if (name.startsWith("Sticks")) return "sticks";
    return "drum";
  }
  var VOL = { backbone:[0.80,1.00], mid:[0.60,0.85], drum:[0.58,0.85], sticks:[0.45,0.72], light:[0.32,0.60], quick:[0.60,0.85], crash:[0.70,0.92] };
  var TIME_SIGS = { "4/4":{beats:4,sub:4}, "2/4":{beats:2,sub:4}, "6/8":{beats:6,sub:2}, "3/4":{beats:3,sub:4}, "7/8":{beats:7,sub:2} };
  var _pick = function (a) { return a[(Math.random()*a.length)|0]; };
  var _rng  = function (a) { return a[0] + Math.random()*(a[1]-a[0]); };
  var _chance = function (p) { return Math.random() < p; };
  function shuffle(a){ for (var i=a.length-1;i>0;i--){ var j=(Math.random()*(i+1))|0; var t=a[i]; a[i]=a[j]; a[j]=t; } return a; }

  var ROLE_POOL = {};
  SAMPLES.forEach(function (s, i) { var r = roleOf(s.name); (ROLE_POOL[r] = ROLE_POOL[r] || []).push(i); });
  function idxByRole(r) { return (ROLE_POOL[r] || []).slice(); }

  function chooseEnsemble() {
    var target = { backbone:5, mid:3, drum:5, sticks:3, light:3, quick:1, crash:(_chance(0.6)?1:0) };
    var sum = Object.keys(target).reduce(function (a,k){ return a+target[k]; }, 0);
    var shrink = ["light","sticks","mid","quick","drum"];
    while (sum > 20) { for (var i=0;i<shrink.length;i++){ if (target[shrink[i]]>0){ target[shrink[i]]--; sum--; break; } } }
    while (sum < 20) { target.drum++; sum++; }
    var chosen = [];
    for (var role in target) { var pool = idxByRole(role); shuffle(pool); pool.slice(0,target[role]).forEach(function (idx){ chosen.push({ idx:idx, role:role }); }); }
    return chosen;
  }
  // one measure's motif for a role on the chosen meter's beat grid
  function meterMotif(role, beats, sub, spm, r) {
    var half = Math.max(1, Math.floor(sub/2));
    var beatPos = []; for (var b=0;b<beats;b++) beatPos.push(b*sub);
    var eighths = []; for (var s=0;s<spm;s+=half) eighths.push(s);
    var offs = beatPos.map(function (b){ return b+half; }).filter(function (s){ return s<spm; });
    var set = new Set(); var addAll = function (a){ a.forEach(function (s){ set.add(s); }); };
    if (role === "backbone") { set.add(0); var mid = beatPos[Math.floor(beats/2)];
      if (beats>=3 && mid && _chance(0.7)) set.add(mid); if (_chance(0.25)) addAll(beatPos); }
    else if (role === "drum") { if (_chance(0.6)) addAll(eighths); else addAll(beatPos); }
    else if (role === "mid") { if (offs.length) { set.add(offs[offs.length-1]); if (offs.length>1 && _chance(0.5)) set.add(offs[0]); } }
    else if (role === "sticks") { var c=_pick(["offs","eighths","front"]);
      if (c==="offs") addAll(offs); else if (c==="eighths") addAll(eighths); else for (var s2=0;s2<Math.min(spm,half*4);s2++) set.add(s2); }
    else if (role === "light") { for (var s3=half;s3<spm;s3+=sub) set.add(s3); }
    else if (role === "quick") { set.add(spm-1); if (_chance(0.5)) set.add(Math.max(0,spm-1-sub)); }
    else if (role === "crash") { set.add(0); }
    else addAll(beatPos);
    var arr = [].concat(Array.from(set)).filter(function (s){ return s===0 || !_chance(r*0.18); });
    var extra = Math.round(r*(role==="light"||role==="sticks"?3:role==="drum"?2:1.2));
    for (var k=0;k<extra;k++) arr.push((Math.random()*spm)|0);
    return arr;
  }
  function composeMeter(sigKey, r) {
    var m = TIME_SIGS[sigKey], beats=m.beats, sub=m.sub, spm=beats*sub, loopM=2, STEPS=spm*loopM;
    var voices = [];
    chooseEnsemble().forEach(function (c) {
      var steps = new Array(STEPS).fill(false), vol = _rng(VOL[c.role]);
      for (var mm=0; mm<loopM; mm++) meterMotif(c.role, beats, sub, spm, r).forEach(function (s) { var g=mm*spm+s; if (g<STEPS) steps[g]=true; });
      voices.push({ idx:c.idx, role:c.role, vol:vol, steps:steps });
    });
    return { voices:voices, spm:spm, sub:sub, beats:beats, STEPS:STEPS };
  }
  function chooseSig(radioIndex) { return (radioIndex % 2 === 1) ? _pick(["2/4","6/8","3/4","7/8"]) : "4/4"; }

  function generateSong(radioIndex) {
    var bpm = 83 + Math.round(Math.random()*(112-83));
    var sig = chooseSig(radioIndex);
    var r = 0.45 + Math.random()*0.25;                 // arrangement looseness
    var meta = composeMeter(sig, r);
    var voices = meta.voices, byIdx = {};
    voices.forEach(function (v){ byIdx[v.idx] = v; });
    var byRole = function (rl) { return voices.filter(function (v){ return v.role===rl; }).map(function (v){ return v.idx; }); };
    var pick = function (arr, n) { var a=arr.slice(); shuffle(a); return a.slice(0, Math.max(0, Math.min(n, a.length))); };
    var backbone=byRole("backbone"), drums=byRole("drum"), mids=byRole("mid"),
        sticks=byRole("sticks"), lights=byRole("light"), quicks=byRole("quick");
    shuffle(drums);
    var coreDrums = drums.slice(0, Math.min(3, drums.length));
    var core = backbone.concat(coreDrums);
    var extraDrums = drums.slice(coreDrums.length);
    var crashIdx = idxByRole("crash").length ? _pick(idxByRole("crash")) : null;

    var chorus = [].concat(pick(sticks,2), pick(mids,1), pick(lights,1), pick(extraDrums,1));
    var verseA = [].concat(pick(sticks,1), pick(mids,1));
    var verseB = [].concat(pick(lights,1), pick(sticks,1));
    var bridge = [].concat(pick(lights,1), pick(quicks,1));
    var outro  = [].concat(pick(sticks,1));
    var d1 = coreDrums[0], d2 = coreDrums[1]!=null?coreDrums[1]:d1, d3 = coreDrums[2]!=null?coreDrums[2]:d2;
    var introStick = sticks.length ? sticks[0] : (lights.length ? lights[0] : d1);
    // A spare opening — one drum, a second, then the sticks come in before the verse.
    var introBuild = [ {at:0,set:[d1]}, {at:4,set:[d1,d2]}, {at:8,set:[d1,d2,introStick]} ];
    var vm = function () { return 4 + 2*((Math.random()*2)|0); };
    var sections = [
      { type:"Intro",  bars:16,   layers:[d1], crash:false, build:introBuild },
      { type:"Verse",  bars:vm(), layers:verseA, crash:false },
      { type:"Chorus", bars:8,    layers:chorus, crash:true },
      { type:"Verse",  bars:vm(), layers:verseB, crash:false },
      { type:"Chorus", bars:8,    layers:chorus, crash:true },
      { type:"Bridge", bars:4,    layers:bridge, crash:false },
      { type:"Chorus", bars:8,    layers:chorus, crash:true },
      { type:"Outro",  bars:4,    layers:outro,  crash:false }
    ];
    return { bpm:bpm, sig:sig, spm:meta.spm, sub:meta.sub, STEPS:meta.STEPS,
             voices:voices, byIdx:byIdx, core:core, crashIdx:crashIdx, sections:sections };
  }

  /* ==== preferences ==== */
  var prefs = { vol:0.7, muted:false, enabled:true };
  try {
    var pv = localStorage.getItem("taiko.radio.vol");     if (pv!==null) prefs.vol = Math.max(0,Math.min(1,+pv));
    var pm = localStorage.getItem("taiko.radio.muted");   if (pm!==null) prefs.muted = pm==="1";
    var pe = localStorage.getItem("taiko.radio.enabled"); if (pe!==null) prefs.enabled = pe!=="0";
  } catch (e) {}
  function savePrefs() { try {
    localStorage.setItem("taiko.radio.vol", String(prefs.vol));
    localStorage.setItem("taiko.radio.muted", prefs.muted?"1":"0");
    localStorage.setItem("taiko.radio.enabled", prefs.enabled?"1":"0");
  } catch (e) {} }

  /* ==== audio engine ==== */
  var AC=null, master=null, buffers={}, playing=false;
  var song=null, radioIndex=0, audible=new Set();
  var stepIdx=0, nextT=0, stepTimer=null, sectionTimers=[], songT0=0, songTotalMs=0, curSection="";
  var LOOK=25, AHEAD=0.1;
  function sps() { return (60/(song?song.bpm:110))/4; }   // 16th-note grid (meter-independent)

  function applyGain() { if (master) master.gain.value = prefs.muted ? 0 : prefs.vol; }
  function ensureCtx() {
    if (AC) return;
    AC = new (window.AudioContext||window.webkitAudioContext)();
    master = AC.createGain(); applyGain(); master.connect(AC.destination);
  }
  function loadBuffers(idxs) {
    return Promise.all(idxs.filter(function (i){ return i!=null && !buffers[i]; }).map(function (i) {
      return fetch(sampleFile(i)).then(function (r){ return r.arrayBuffer(); })
        .then(function (b){ return AC.decodeAudioData(b); })
        .then(function (buf){ buffers[i]=buf; }).catch(function () {});
    }));
  }
  function playSample(idx, when, gain) {
    var buf = buffers[idx]; if (!buf) return;
    var srcN = AC.createBufferSource(); srcN.buffer = buf;
    var g = AC.createGain(); g.gain.value = gain; srcN.connect(g); g.connect(master);
    srcN.start(when||0);
  }
  /* ==== continuity across page loads ====
     A static multi-page site can't keep one <audio>/AudioContext alive across a
     real navigation — the page (and its audio graph) is destroyed either way.
     So instead of true gapless audio, the currently-playing song's full generated
     data plus how far into it we are gets persisted just before the page unloads;
     the next page reconstructs the identical song and starts scheduling from that
     same point (advanced by however much real time the navigation itself took),
     so the song picks up where it left off instead of restarting from the intro. */
  var PROG_KEY = "taiko.radio.song", saveTimer = null;
  function saveProgress() {
    if (!song || !prefs.enabled) { try { localStorage.removeItem(PROG_KEY); } catch (e) {} return; }
    var elapsedMs = playing ? (performance.now() - songT0) : (curElapsedMs || 0);
    try {
      localStorage.setItem(PROG_KEY, JSON.stringify({
        song: song, radioIndex: radioIndex, elapsedMs: elapsedMs, savedAt: Date.now(), songTitle: songTitle
      }));
    } catch (e) {}
  }
  function loadProgress() {
    var raw; try { raw = localStorage.getItem(PROG_KEY); } catch (e) { return null; }
    if (!raw) return null;
    var saved; try { saved = JSON.parse(raw); } catch (e) { return null; }
    if (!saved || !saved.song || !saved.song.sections || !saved.savedAt) return null;
    if (Date.now() - saved.savedAt > 30000) return null;          // stale — start fresh instead
    var carried = Date.now() - saved.savedAt;                     // keep the song moving through the gap itself
    return { song: saved.song, radioIndex: saved.radioIndex || 0, resumeMs: Math.max(0, (saved.elapsedMs||0) + carried), songTitle: saved.songTitle || randomTitle() };
  }
  var curElapsedMs = 0;                                            // last known position, kept fresh even while paused
  var songTitle = "";                                              // this song's silly title, picked once when it starts

  function scheduleStep(s, time) {
    var beat = false;
    song.voices.forEach(function (v) { if (v.steps[s] && audible.has(v.idx)) { playSample(v.idx, time, v.vol); beat = beat || v.role==="backbone" || v.role==="drum"; } });
    if (beat) beatKick = 1;
  }
  function stepLoop() {
    while (nextT < AC.currentTime + AHEAD) {
      scheduleStep(stepIdx, nextT);
      nextT += sps();
      stepIdx = (stepIdx + 1) % song.STEPS;
    }
    stepTimer = setTimeout(stepLoop, LOOK);
  }
  function clearTimers() { sectionTimers.forEach(clearTimeout); sectionTimers = []; clearTimeout(stepTimer); stepTimer = null; }

  function setAudible(idxSet) { audible = new Set(idxSet); }
  function applySection(si) {
    var sec = song.sections[si];
    var set = new Set(song.core); (sec.layers||[]).forEach(function (i){ if (i!=null) set.add(i); });
    setAudible(set);
    if (sec.crash && song.crashIdx!=null) playSample(song.crashIdx, 0, 0.9);
  }

  function scheduleSong(resumeMs) {
    resumeMs = resumeMs || 0;
    clearTimers();
    var barDur = song.spm * 15000 / song.bpm;
    var bar = 0;
    song.sections.forEach(function (sec, si) {
      var at = bar * barDur;
      if (sec.build && sec.build.length) {
        sec.build.forEach(function (ev) {
          var when = at + (ev.at||0) * barDur, delay = when - resumeMs;
          if (delay <= 0) setAudible(new Set(ev.set));                                   // already past → apply now
          else sectionTimers.push(setTimeout(function () { if (playing) setAudible(new Set(ev.set)); }, delay));
        });
      } else {
        var delay = at - resumeMs;
        if (delay <= 0) { if (playing || si===0) applySection(si); }                     // catch up immediately
        else sectionTimers.push(setTimeout(function () { if (playing) applySection(si); }, delay));
      }
      bar += sec.bars;
    });
    songTotalMs = bar * barDur;
    var endDelay = Math.max(0, songTotalMs - resumeMs);
    sectionTimers.push(setTimeout(function () { if (playing) onSongEnd(); }, endDelay));
  }

  function beginSong(resumeMs) {
    resumeMs = resumeMs || 0;
    playing = true; setState("playing");
    stepIdx = 0; nextT = AC.currentTime + 0.08; songT0 = performance.now() - resumeMs;
    startEq(); scheduleSong(resumeMs); stepLoop();
    if (nameEl) { nameEl.textContent = songTitle || "Taiko Radio"; nameEl.title = songTitle || "Taiko Radio"; }
    saveProgress();
  }
  function resumeSong(saved) {
    ensureCtx();
    song = saved.song; radioIndex = saved.radioIndex; songTitle = saved.songTitle || randomTitle();
    if (subEl) subEl.textContent = "loading…";
    var need = song.voices.map(function (v){ return v.idx; }).concat([song.crashIdx]);
    return loadBuffers(need).then(function () {
      if (AC.resume) AC.resume();
      if (AC.state === "running") beginSong(saved.resumeMs); else armGesture();
    });
  }
  function nextSong() {
    ensureCtx();
    song = generateSong(radioIndex++); songTitle = randomTitle();
    if (subEl) subEl.textContent = "loading…";
    var need = song.voices.map(function (v){ return v.idx; }).concat([song.crashIdx]);
    return loadBuffers(need).then(function () {
      if (AC.resume) AC.resume();
      if (AC.state === "running") beginSong(); else armGesture();
    });
  }
  function onSongEnd() {
    clearTimers(); audible = new Set();
    try { localStorage.removeItem(PROG_KEY); } catch (e) {}       // this song is over — nothing left to resume
    if (!prefs.enabled) { stopAll(); return; }
    setState("gap"); if (subEl) subEl.textContent = "…";
    sectionTimers.push(setTimeout(function () { if (prefs.enabled) nextSong(); }, 3500));
  }
  function stopAll() {
    if (playing) curElapsedMs = performance.now() - songT0;       // remember where we were, in case of a later resume
    playing = false; clearTimers(); stopEq(); audible = new Set(); setState("paused");
    if (subEl) subEl.textContent = "paused";
  }
  function next() {                                     // skip to a fresh song now
    clearTimers(); playing = false;
    prefs.enabled = true; savePrefs();
    nextSong();
  }
  function start() { prefs.enabled = true; savePrefs(); if (!song || !playing) nextSong(); }
  function toggle() { if (playing || (song && stepTimer)) { prefs.enabled=false; savePrefs(); stopAll(); } else start(); }

  /* ==== autoplay: begin on first gesture if the browser blocks it ==== */
  var armed=false;
  function onGesture() {
    if (!AC) return;
    if (AC.resume) AC.resume().then(function () { if (AC.state==="running") { disarm(); if (prefs.enabled && !playing) beginSong(); } });
    else { disarm(); if (prefs.enabled && !playing) beginSong(); }
  }
  function disarm() {
    window.removeEventListener("pointerdown", onGesture, true);
    window.removeEventListener("keydown", onGesture, true);
    window.removeEventListener("touchstart", onGesture, true);
    armed = false;
  }
  function armGesture() {
    setState("armed"); if (subEl && !playing) subEl.textContent = "tap to start";
    if (armed) return; armed = true;
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    window.addEventListener("touchstart", onGesture, true);
  }

  /* ==== visualizer (random, music-like) ==== */
  var eqTimer=null, beatKick=0, eqBars=null;
  function startEq() { if (eqTimer || !eqEl) return; eqBars = eqEl.children; eqTimer = setInterval(tickEq, 95); }
  function stopEq() { clearInterval(eqTimer); eqTimer=null; if (eqEl) for (var i=0;i<eqEl.children.length;i++) eqEl.children[i].style.height="5px"; }
  function tickEq() {
    if (!eqBars) return;
    var kick = beatKick; beatKick = Math.max(0, beatKick - 0.34);
    for (var i=0;i<eqBars.length;i++) { var r=Math.random(); var h=5 + r*r*12 + kick*(5+Math.random()*7); eqBars[i].style.height = Math.max(5,Math.min(20,h)).toFixed(1)+"px"; }
  }

  /* ==== UI ==== */
  var bar, nameEl, subEl, ppBtn, muteBtn, volInput, eqEl, tickInt=null;
  function setState(s) { if (bar) bar.dataset.state=s; if (ppBtn) ppBtn.textContent = (s==="playing"||s==="gap") ? "❚❚" : "▶"; }
  function fmt(ms){ ms=Math.max(0,ms); var s=Math.round(ms/1000); return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); }
  function tickNow() {
    if (!bar) return;
    if (playing && song && songTotalMs) {
      var t = performance.now() - songT0, bar2 = song.spm*15000/song.bpm, cum=0, cur="";
      for (var i=0;i<song.sections.length;i++){ var sec=song.sections[i]; var st=cum*bar2, en=(cum+sec.bars)*bar2; if (t>=st && t<en) cur=sec.type; cum+=sec.bars; }
      curSection = cur;
      if (subEl) subEl.textContent = song.sig + " · " + (cur?cur+" · ":"") + fmt(t) + " / " + fmt(songTotalMs);
    }
  }

  function buildUI() {
    var css = document.createElement("style");
    css.textContent =
      ".tkr{position:fixed;left:14px;bottom:14px;z-index:70;display:flex;align-items:center;gap:9px;" +
        "padding:8px 12px 8px 8px;border-radius:99px;background:rgba(24,20,17,.86);border:1px solid #3a312b;" +
        "box-shadow:0 10px 30px rgba(0,0,0,.5);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);" +
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f3ece4;user-select:none;max-width:calc(100vw - 28px)}" +
      ".tkr button,.tkr a{font:inherit;border:0;background:none;color:inherit;cursor:pointer;display:grid;place-items:center}" +
      ".tkr-pp{flex:none;width:38px;height:38px;border-radius:50%;background:#e0472c;color:#fff;font-size:14px;transition:.12s}" +
      ".tkr-pp:hover{background:#ff6a4d}" +
      ".tkr[data-state='playing'] .tkr-pp,.tkr[data-state='gap'] .tkr-pp{background:#e6b453;color:#241c10}" +
      ".tkr-eq{flex:none;display:flex;gap:2px;align-items:flex-end;height:20px;width:20px}" +
      ".tkr-eq i{width:3px;background:#6b5a4c;border-radius:2px;height:5px;transition:height .1s ease,background .1s ease}" +
      ".tkr[data-state='playing'] .tkr-eq i{background:#ff6a4d}" +
      ".tkr-meta{min-width:0;display:flex;flex-direction:column;line-height:1.15;margin-right:2px}" +
      ".tkr-name{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px}" +
      ".tkr-sub{font-size:10px;color:#a8998c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px}" +
      ".tkr-ico{flex:none;width:30px;height:30px;border-radius:50%;font-size:15px;color:#d8c8ba}" +
      ".tkr-ico:hover{background:rgba(255,255,255,.08);color:#fff}" +
      ".tkr-vol{flex:none;width:74px;height:4px;-webkit-appearance:none;appearance:none;background:#4a3f37;border-radius:4px;cursor:pointer}" +
      ".tkr-vol::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;border-radius:50%;background:#e6b453;cursor:pointer}" +
      ".tkr-vol::-moz-range-thumb{width:13px;height:13px;border:0;border-radius:50%;background:#e6b453;cursor:pointer}" +
      ".tkr-make{flex:none;width:30px;height:30px;border-radius:50%;font-size:16px;color:#e6b453;text-decoration:none}" +
      ".tkr-make:hover{background:rgba(230,180,83,.16)}" +
      "@media (max-width:640px){.tkr-vol{display:none}.tkr-name{max-width:130px}.tkr-sub{max-width:100px}}";
    document.head.appendChild(css);

    bar = document.createElement("div");
    bar.className = "tkr"; bar.setAttribute("role","group"); bar.setAttribute("aria-label","Taiko radio");
    bar.innerHTML =
      '<button class="tkr-pp" title="Play / stop radio" aria-label="Play or stop">▶</button>' +
      '<div class="tkr-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' +
      '<div class="tkr-meta"><span class="tkr-name">Taiko Radio</span><span class="tkr-sub">starting…</span></div>' +
      '<button class="tkr-ico tkr-next" title="Next song" aria-label="Next song">⏭</button>' +
      '<button class="tkr-ico tkr-mute" title="Mute" aria-label="Mute">🔊</button>' +
      '<input class="tkr-vol" type="range" min="0" max="100" title="Volume" aria-label="Volume">' +
      '<a class="tkr-make" href="taiko.html" title="Create a loop in the constructor" aria-label="Create a loop">＋</a>';
    document.body.appendChild(bar);

    nameEl = bar.querySelector(".tkr-name"); subEl = bar.querySelector(".tkr-sub");
    ppBtn = bar.querySelector(".tkr-pp"); muteBtn = bar.querySelector(".tkr-mute");
    eqEl = bar.querySelector(".tkr-eq"); volInput = bar.querySelector(".tkr-vol");
    volInput.value = Math.round(prefs.vol*100); reflectMute();

    ppBtn.addEventListener("click", toggle);
    bar.querySelector(".tkr-next").addEventListener("click", next);
    muteBtn.addEventListener("click", function () { prefs.muted=!prefs.muted; savePrefs(); applyGain(); reflectMute(); });
    volInput.addEventListener("input", function () { prefs.vol=(+volInput.value)/100; if (prefs.vol>0 && prefs.muted){ prefs.muted=false; reflectMute(); } savePrefs(); applyGain(); });
    tickInt = setInterval(tickNow, 400);
  }
  function reflectMute() { if (!muteBtn) return; muteBtn.textContent = prefs.muted?"🔇":"🔊"; muteBtn.title = prefs.muted?"Unmute":"Mute"; }

  window.addEventListener("pagehide", saveProgress);
  window.addEventListener("beforeunload", saveProgress);
  document.addEventListener("visibilitychange", function () { if (document.hidden) saveProgress(); });
  saveTimer = setInterval(function () { if (playing) saveProgress(); }, 2500);

  function boot() {
    buildUI();
    if (prefs.enabled) {
      var saved = loadProgress();
      if (saved) resumeSong(saved); else start();
    }
    else { setState("paused"); if (subEl) subEl.textContent = "paused"; }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.TaikoRadio = {
    play: start, stop: stopAll, toggle: toggle, next: next,
    setVolume: function (v) { prefs.vol=Math.max(0,Math.min(1,v)); if (volInput) volInput.value=Math.round(prefs.vol*100); savePrefs(); applyGain(); },
    mute: function (on) { prefs.muted=!!on; savePrefs(); applyGain(); reflectMute(); }
  };
})();
