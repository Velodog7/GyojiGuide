/*  GYOJI GUIDE — Kashō Mawashi avatar designer
 *  ---------------------------------------------------------------
 *  A small self-contained module for designing a team's avatar as a
 *  stylised mawashi (sumo belt), built from layered vector elements:
 *
 *    Layer 1  kanji         — a single sumo-flavoured kanji, front and centre
 *    Layer 2  emblem        — a foreground icon (starter set, or your own
 *                             image URL)
 *    Layer 3  sky           — sun / moon / cloud motifs
 *    Layer 4  pattern       — basic geometric shapes & simple vector patterns
 *    Layer 6  interior      — the belt's interior colour
 *    Layer 7  frill         — the belt's exterior trim / frill colour
 *
 *  Every positional layer (1–4) can be scaled, rotated, and nudged in
 *  place; layers 2–4 can also be removed entirely ("None").
 *
 *  Usage:
 *    MawashiDesigner.DEFAULT                          // a starter design
 *    MawashiDesigner.renderSVG(design, {variant,size}) // -> svg markup string
 *    MawashiDesigner.mount(el, { initial, onChange, onSave })
 */
(function () {
  "use strict";
  var MD = {};
  window.MawashiDesigner = MD;

  /* ============================================================
     ASSET LIBRARY
     Every positional asset is authored centred on (0,0) in a local
     box roughly ±20 units, so it can be wrapped in a single
     translate → rotate → scale transform.
     ============================================================ */

  MD.KANJI = [
    { ch: "火", label: "Fire" },
    { ch: "水", label: "Water" },
    { ch: "氷", label: "Ice" },
    { ch: "風", label: "Wind" },
    { ch: "猛", label: "Fearless" },
    { ch: "強", label: "Strong" },
    { ch: "堅", label: "Steady" },
    { ch: "力", label: "Power" },
    { ch: "勝", label: "Victory" },
    { ch: "魂", label: "Spirit" },
    { ch: "龍", label: "Dragon" },
    { ch: "虎", label: "Tiger" },
    { ch: "雷", label: "Thunder" },
    { ch: "山", label: "Mountain" },
    { ch: "侍", label: "Samurai" },
    { ch: "昇", label: "Rising" },
    { ch: "疾", label: "Swift" },
    { ch: "心", label: "Heart" }
  ];

  // Layer 2 — foreground emblem starter set. Single-colour silhouettes
  // (fill uses currentColor so the picked colour applies), each centred
  // on (0,0), extents roughly ±18. Sean can add his own SVGs/URLs later.
  MD.EMBLEMS = [
    { id: "fist",  label: "Fist",
      svg: '<path d="M-10,-2 L-10,-10 Q-10,-14 -6,-14 L-2,-14 Q2,-14 2,-10 L2,-9 L6,-9 Q10,-9 10,-5 L10,6 Q10,14 2,14 L-4,14 Q-11,14 -13,7 L-15,0 Q-16,-4 -12,-5 Q-9,-6 -8,-2 Z" fill="currentColor"/>' },
    { id: "flame", label: "Flame",
      svg: '<path d="M0,-17 Q7,-8 5,-1 Q9,-3 9,2 Q9,13 0,17 Q-9,13 -9,2 Q-9,-3 -5,-1 Q-3,-6 0,-17 Z M0,4 Q-3,7 -3,10 Q-3,13 0,14 Q3,13 3,10 Q3,7 0,4 Z" fill="currentColor" fill-rule="evenodd"/>' },
    { id: "wave",  label: "Wave",
      svg: '<path d="M-18,6 Q-13,-6 -8,2 Q-3,10 2,0 Q7,-9 12,1 Q15,6 18,3 L18,14 L-18,14 Z M13,-4 Q16,-8 14,-13 Q18,-11 18,-6 Q17,-4 13,-4 Z" fill="currentColor"/>' },
    { id: "peak",  label: "Mountain",
      svg: '<path d="M-18,12 L-6,-13 L-1,-4 L3,-9 L18,12 Z M-6,-13 L-3,-8 L-8,-1 L-11,-5 Z" fill="currentColor" fill-rule="evenodd"/>' },
    { id: "bolt",  label: "Bolt",
      svg: '<path d="M3,-17 L-11,2 L-2,2 L-4,17 L12,-4 L2,-4 Z" fill="currentColor"/>' },
    { id: "claw",  label: "Claw marks",
      svg: '<path d="M-14,-15 L-7,15 L-4,15 L-9,-15 Z M-3,-16 L2,15 L5,15 L2,-16 Z M8,-15 L14,14 L17,13 L10,-16 Z" fill="currentColor"/>' }
  ];

  // Layer 3 — sun / moon / cloud. Traditional colouring baked in via
  // currentColor + a couple of fixed accents; kept intentionally simple.
  MD.SKY = [
    { id: "sun", label: "Sun",
      svg: '<g fill="currentColor">' +
        '<path d="M-0.91,-12.97 L0,-21 L0.91,-12.97 Z M8.53,-9.81 L14.85,-14.85 L9.81,-8.53 Z M12.97,-0.91 L21,0 L12.97,0.91 Z ' +
             'M9.81,8.53 L14.85,14.85 L8.53,9.81 Z M0.91,12.97 L0,21 L-0.91,12.97 Z M-8.53,9.81 L-14.85,14.85 L-9.81,8.53 Z ' +
             'M-12.97,0.91 L-21,0 L-12.97,-0.91 Z M-9.81,-8.53 L-14.85,-14.85 L-8.53,-9.81 Z"/>' +
        '<circle r="9"/></g>' },
    { id: "moon-crescent", label: "Crescent moon",
      svg: '<path d="M6,-15 A15,15 0 1 0 6,15 A11.5,11.5 0 1 1 6,-15 Z" fill="currentColor"/>' },
    { id: "moon-full", label: "Full moon",
      svg: '<g fill="currentColor"><circle r="14"/><circle cx="-5" cy="-4" r="2.4" opacity=".35"/><circle cx="4" cy="6" r="1.6" opacity=".3"/><circle cx="6" cy="-6" r="1.2" opacity=".3"/></g>' },
    { id: "cloud", label: "Cloud (kumo)",
      svg: '<path d="M-16,4 Q-16,-6 -7,-6 Q-6,-13 3,-12 Q11,-13 12,-5 Q19,-5 19,3 Q19,9 12,9 L-11,9 Q-16,9 -16,4 Z" fill="currentColor"/>' },
    { id: "cloud-wisp", label: "Cloud wisps",
      svg: '<g fill="currentColor"><path d="M-18,-6 Q-18,-12 -11,-12 Q-9,-16 -3,-14 Q3,-16 4,-10 Q9,-10 9,-5 Q9,-2 5,-2 L-14,-2 Q-18,-2 -18,-6 Z"/>' +
        '<path d="M-2,10 Q-2,6 2,6 Q3,3 7,4 Q11,3 12,7 Q16,7 16,10 Q16,12 13,12 L1,12 Q-2,12 -2,10 Z" opacity=".8"/></g>' }
  ];

  // Layer 4 — basic geometric shapes & simple vector patterns.
  MD.PATTERNS = [
    { id: "circle", label: "Circle", svg: '<circle r="15" fill="none" stroke="currentColor" stroke-width="3.5"/>' },
    { id: "square", label: "Square", svg: '<rect x="-12" y="-12" width="24" height="24" fill="none" stroke="currentColor" stroke-width="3.5"/>' },
    { id: "diamond", label: "Diamond", svg: '<polygon points="0,-17 17,0 0,17 -17,0" fill="none" stroke="currentColor" stroke-width="3.5"/>' },
    { id: "triangle", label: "Triangle", svg: '<polygon points="0,-16 14,10 -14,10" fill="none" stroke="currentColor" stroke-width="3.5"/>' },
    { id: "hexagram", label: "Asanoha star", svg: '<polygon points="0,-17 3.5,-6.06 14.72,-8.5 7,0 14.72,8.5 3.5,6.06 0,17 -3.5,6.06 -14.72,8.5 -7,0 -14.72,-8.5 -3.5,-6.06" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/>' },
    { id: "seigaiha", label: "Waves (seigaiha)",
      svg: '<g fill="none" stroke="currentColor" stroke-width="2.4"><path d="M-6,4 A6,6 0 0 1 6,4"/><path d="M-12,4 A12,12 0 0 1 12,4"/><path d="M-18,4 A18,18 0 0 1 18,4"/></g>' },
    { id: "shippou", label: "Shippō circles",
      svg: '<g fill="none" stroke="currentColor" stroke-width="2.4"><circle cy="-8" r="8"/><circle cx="6.93" cy="-4" r="8"/><circle cx="6.93" cy="4" r="8"/><circle cy="8" r="8"/><circle cx="-6.93" cy="4" r="8"/><circle cx="-6.93" cy="-4" r="8"/></g>' },
    { id: "dot-ring", label: "Dot ring",
      svg: '<g fill="currentColor">' + Array.from({length:8}, function(_,i){ var a=i*45*Math.PI/180; var x=(15*Math.sin(a)).toFixed(2), y=(-15*Math.cos(a)).toFixed(2); return '<circle cx="'+x+'" cy="'+y+'" r="2.2"/>'; }).join("") + '</g>' }
  ];

  // curated colour presets shared by belt colours + recolourable layers
  MD.PALETTE = [
    "#7458b3","#241a3f","#c9932f","#402b0d","#b83a3a","#360f0f",
    "#bb5a34","#37180c","#c25a86","#361323","#2f6f5e","#123028",
    "#2a5aa0","#12233f","#d8b25a","#3a2c12","#e8e2d2","#1c1e26",
    "#f4ecd8","#0d0f15"
  ];

  MD.DEFAULT = {
    v: 1,
    kanji: { ch: "力", color: "#f4ecd8", x: 50, y: 50, s: 1, r: 0 },
    fg: null,
    supp: { id: "sun", color: "#e7c65a", x: 50, y: 22, s: 0.6, r: 0 },
    pat: null,
    interior: "#7458b3",
    frill: "#241a3f"
  };

  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }
  function byId(list, id){ for (var i=0;i<list.length;i++) if (list[i].id===id) return list[i]; return null; }

  // wrap a local (0,0)-centred asset's markup in a positioning transform.
  // x,y are 0-100 (percent of the 100x100 belt box); s is a scale
  // multiplier around 1; r is degrees.
  function place(innerSVG, layer){
    var tx = layer.x != null ? layer.x : 50, ty = layer.y != null ? layer.y : 50;
    var s = layer.s != null ? layer.s : 1, r = layer.r || 0;
    return '<g transform="translate(' + tx + ',' + ty + ') rotate(' + r + ') scale(' + s + ')">' + innerSVG + '</g>';
  }

  /* ============================================================
     RENDER — compose a full mawashi SVG string from a design object
     ============================================================ */
  MD.renderSVG = function (design, opts) {
    design = design || MD.DEFAULT;
    opts = opts || {};
    var variant = opts.variant || "chip";      // 'chip' (circle only) | 'full' (+ sagari tassels)
    var size = opts.size || 64;
    var vbH = variant === "full" ? 132 : 100;
    var cx = 50, cy = 50, rOuter = 47, rInner = 39;

    var layers = "";

    if (design.pat) {
      var p = byId(MD.PATTERNS, design.pat.id);
      if (p) layers += '<g color="' + esc(design.pat.color || "#f4ecd8") + '" opacity=".85">' + place(p.svg, design.pat) + '</g>';
    }
    if (design.supp) {
      var sk = byId(MD.SKY, design.supp.id);
      if (sk) layers += '<g color="' + esc(design.supp.color || "#e7c65a") + '">' + place(sk.svg, design.supp) + '</g>';
    }
    if (design.fg) {
      if (design.fg.src && design.fg.src.indexOf("url:") === 0) {
        var url = design.fg.src.slice(4);
        var fx = design.fg.x != null ? design.fg.x : 50, fy = design.fg.y != null ? design.fg.y : 50;
        var fs = (design.fg.s != null ? design.fg.s : 1) * 32, fr = design.fg.r || 0;
        layers += '<g transform="translate(' + fx + ',' + fy + ') rotate(' + fr + ')">' +
          '<image href="' + esc(url) + '" x="' + (-fs/2) + '" y="' + (-fs/2) + '" width="' + fs + '" height="' + fs + '" ' +
          'preserveAspectRatio="xMidYMid meet"/></g>';
      } else {
        var em = byId(MD.EMBLEMS, (design.fg.src || "").replace("lib:", ""));
        if (em) layers += '<g color="' + esc(design.fg.color || "#f4ecd8") + '">' + place(em.svg, design.fg) + '</g>';
      }
    }
    if (design.kanji && design.kanji.ch) {
      var k = design.kanji;
      var kx = k.x != null ? k.x : 50, ky = k.y != null ? k.y : 50, ks = k.s != null ? k.s : 1, kr = k.r || 0;
      layers += '<g transform="translate(' + kx + ',' + ky + ') rotate(' + kr + ') scale(' + ks + ')">' +
        '<text x="0" y="0" text-anchor="middle" dominant-baseline="central" ' +
        'font-family="\'Zen Kaku Gothic New\',\'Hiragino Kaku Gothic ProN\',serif" font-weight="900" ' +
        'font-size="34" fill="' + esc(k.color || "#f4ecd8") + '">' + esc(k.ch) + '</text></g>';
    }

    var sagari = "";
    if (variant === "full") {
      var n = 7, cordsStart = cy + rInner - 2;
      for (var i=0;i<n;i++){
        var sx = cx - 24 + i*8;
        sagari += '<line x1="' + sx + '" y1="' + cordsStart + '" x2="' + sx + '" y2="' + (cordsStart + 26) + '" ' +
          'stroke="' + esc(design.frill || "#241a3f") + '" stroke-width="3" stroke-linecap="round"/>';
        sagari += '<circle cx="' + sx + '" cy="' + (cordsStart + 27) + '" r="2" fill="' + esc(design.frill || "#241a3f") + '"/>';
      }
    }

    var clipId = "mwClip" + Math.random().toString(36).slice(2,8);
    return '<svg viewBox="0 0 100 ' + vbH + '" width="' + size + '" height="' + Math.round(size*vbH/100) + '" ' +
      'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Team mawashi avatar">' +
      '<defs><clipPath id="' + clipId + '"><circle cx="' + cx + '" cy="' + cy + '" r="' + rInner + '"/></clipPath></defs>' +
      sagari +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + rOuter + '" fill="none" stroke="' + esc(design.frill || "#241a3f") + '" stroke-width="9" stroke-dasharray="3.2 2.4"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + rInner + '" fill="' + esc(design.interior || "#7458b3") + '"/>' +
      '<g clip-path="url(#' + clipId + ')">' + layers + '</g>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + rInner + '" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1"/>' +
      '</svg>';
  };

  /* ============================================================
     INTERACTIVE DESIGNER
     ============================================================ */
  var CSS_ID = "mwd-css";
  var CSS =
    '.mwd{ display:flex; flex-direction:column; gap:16px; font-family:"Space Grotesk",sans-serif }' +
    '.mwd-preview{ display:flex; justify-content:center; padding:10px 0 4px }' +
    '.mwd-preview svg{ filter:drop-shadow(0 8px 20px rgba(0,0,0,.35)) }' +
    '.mwd-tabs{ display:flex; gap:6px; flex-wrap:wrap; border-bottom:1px solid var(--line,#2a2e3a) }' +
    '.mwd-tab{ background:none; border:0; color:var(--dim,#a7adbe); font-weight:700; font-size:.82rem; cursor:pointer;' +
      ' padding:8px 12px; border-bottom:2px solid transparent }' +
    '.mwd-tab.on{ color:var(--ink,#f1f2f6); border-color:var(--sun,#d8b25a) }' +
    '.mwd-panel{ display:none } .mwd-panel.on{ display:block }' +
    '.mwd-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(56px,1fr)); gap:8px; margin-bottom:12px }' +
    '.mwd-opt{ aspect-ratio:1; border-radius:10px; border:1px solid var(--line2,#3a4050); background:var(--surface-2,#20232e);' +
      ' cursor:pointer; display:grid; place-items:center; color:var(--ink,#f1f2f6); font-size:1.1rem; position:relative }' +
    '.mwd-opt:hover{ border-color:var(--sun,#d8b25a) }' +
    '.mwd-opt.on{ border-color:var(--sun,#d8b25a); background:rgba(216,178,90,.14) }' +
    '.mwd-opt svg{ width:60%; height:60%; color:var(--ink,#f1f2f6) }' +
    '.mwd-opt.none{ font-size:.66rem; color:var(--faint,#6b7180); font-weight:700 }' +
    '.mwd-kanji{ font-family:"Zen Kaku Gothic New",serif; font-weight:900; font-size:1.5rem }' +
    '.mwd-lbl{ position:absolute; bottom:-18px; left:0; right:0; text-align:center; font-size:.6rem; color:var(--faint,#6b7180);' +
      ' white-space:nowrap; overflow:hidden; text-overflow:ellipsis }' +
    '.mwd-controls{ display:flex; flex-direction:column; gap:10px; padding-top:6px; border-top:1px dashed var(--line,#2a2e3a) }' +
    '.mwd-row{ display:flex; align-items:center; gap:10px; font-size:.78rem; color:var(--dim,#a7adbe) }' +
    '.mwd-row input[type=range]{ flex:1; accent-color:var(--sun,#d8b25a) }' +
    '.mwd-row label{ width:60px; flex:none }' +
    '.mwd-swatches{ display:flex; gap:6px; flex-wrap:wrap; align-items:center }' +
    '.mwd-sw{ width:24px; height:24px; border-radius:50%; border:2px solid transparent; cursor:pointer; padding:0 }' +
    '.mwd-sw.on{ border-color:var(--ink,#f1f2f6) }' +
    '.mwd-custom{ display:flex; gap:8px; align-items:center; margin-top:4px }' +
    '.mwd-custom input[type=color]{ width:30px; height:30px; border:0; background:none; padding:0; cursor:pointer }' +
    '.mwd-url{ display:flex; gap:8px; margin-top:8px }' +
    '.mwd-url input{ flex:1; background:var(--surface-2,#20232e); border:1px solid var(--line,#2a2e3a); border-radius:8px;' +
      ' color:var(--ink,#f1f2f6); font:inherit; font-size:.82rem; padding:8px 10px }' +
    '.mwd-url button{ font-family:inherit; font-weight:700; font-size:.8rem; padding:8px 12px; border-radius:8px; border:1px solid var(--line2,#3a4050);' +
      ' background:none; color:var(--dim,#a7adbe); cursor:pointer }' +
    '.mwd-url button:hover{ border-color:var(--sun,#d8b25a); color:var(--ink,#f1f2f6) }' +
    '.mwd-foot{ display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:4px }' +
    '.mwd-dice{ background:none; border:1px solid var(--line2,#3a4050); color:var(--dim,#a7adbe); border-radius:8px;' +
      ' padding:8px 12px; font-size:.8rem; cursor:pointer; font-family:inherit }' +
    '.mwd-dice:hover{ border-color:var(--sun,#d8b25a); color:var(--ink,#f1f2f6) }';

  function ensureCSS(){
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement("style"); st.id = CSS_ID; st.textContent = CSS;
    document.head.appendChild(st);
  }

  var TABS = [
    { id: "kanji", label: "Kanji" },
    { id: "fg",    label: "Emblem" },
    { id: "supp",  label: "Sky" },
    { id: "pat",   label: "Pattern" },
    { id: "belt",  label: "Belt colours" }
  ];

  MD.mount = function (el, options) {
    ensureCSS();
    options = options || {};
    var design = clone(options.initial || MD.DEFAULT);
    var activeTab = "kanji";

    el.innerHTML =
      '<div class="mwd">' +
        '<div class="mwd-preview" id="mwdPreview"></div>' +
        '<div class="mwd-tabs" id="mwdTabs">' + TABS.map(function(t){ return '<button type="button" class="mwd-tab" data-tab="' + t.id + '">' + t.label + '</button>'; }).join("") + '</div>' +
        '<div id="mwdPanels"></div>' +
        '<div class="mwd-foot">' +
          '<button type="button" class="mwd-dice" id="mwdDice">🎲 Surprise me</button>' +
          (options.saveLabel !== false ? '<button type="button" class="btn" id="mwdSave">' + (options.saveLabel || "Save avatar") + '</button>' : '') +
        '</div>' +
      '</div>';

    var previewEl = el.querySelector("#mwdPreview");
    var panelsEl = el.querySelector("#mwdPanels");
    var tabsEl = el.querySelector("#mwdTabs");

    function repaint(){
      previewEl.innerHTML = MD.renderSVG(design, { variant: "full", size: 148 });
      renderPanel();
      if (options.onChange) options.onChange(clone(design));
    }

    function colorSwatches(current, onPick, extraId){
      var html = '<div class="mwd-swatches" id="' + extraId + '">' +
        MD.PALETTE.map(function(c){
          return '<button type="button" class="mwd-sw' + (c.toLowerCase()===String(current).toLowerCase()?" on":"") + '" style="background:' + c + '" data-color="' + c + '" title="' + c + '"></button>';
        }).join("") +
        '<span class="mwd-custom"><input type="color" value="' + (current || "#f4ecd8") + '" data-customcolor="1"></span>' +
        '</div>';
      return html;
    }
    function wireSwatches(container, onPick){
      container.querySelectorAll("[data-color]").forEach(function(b){
        b.onclick = function(){ onPick(b.dataset.color); };
      });
      var custom = container.querySelector("[data-customcolor]");
      if (custom) custom.oninput = function(){ onPick(custom.value); };
    }

    function transformControls(layerKey, allowPosition){
      var layer = design[layerKey];
      if (!layer) return "";
      var s = layer.s != null ? layer.s : 1, r = layer.r || 0;
      var x = layer.x != null ? layer.x : 50, y = layer.y != null ? layer.y : 50;
      return '<div class="mwd-controls">' +
        '<div class="mwd-row"><label>Scale</label><input type="range" min="0.3" max="2" step="0.05" value="' + s + '" data-ctl="s"><span>' + s.toFixed(2) + 'x</span></div>' +
        '<div class="mwd-row"><label>Rotate</label><input type="range" min="0" max="359" step="1" value="' + r + '" data-ctl="r"><span>' + r + '°</span></div>' +
        (allowPosition ? (
          '<div class="mwd-row"><label>Left/Right</label><input type="range" min="15" max="85" step="1" value="' + x + '" data-ctl="x"><span></span></div>' +
          '<div class="mwd-row"><label>Up/Down</label><input type="range" min="15" max="85" step="1" value="' + y + '" data-ctl="y"><span></span></div>'
        ) : "") +
        '</div>';
    }
    function wireTransform(container, layerKey){
      container.querySelectorAll("[data-ctl]").forEach(function(inp){
        inp.oninput = function(){
          var v = parseFloat(inp.value);
          design[layerKey][inp.dataset.ctl] = v;
          var span = inp.nextElementSibling;
          if (span && inp.dataset.ctl==="s") span.textContent = v.toFixed(2)+"x";
          if (span && inp.dataset.ctl==="r") span.textContent = v+"°";
          previewEl.innerHTML = MD.renderSVG(design, { variant: "full", size: 148 });
          if (options.onChange) options.onChange(clone(design));
        };
      });
    }

    function renderPanel(){
      tabsEl.querySelectorAll(".mwd-tab").forEach(function(b){ b.classList.toggle("on", b.dataset.tab===activeTab); });
      var html = "";

      if (activeTab === "kanji") {
        html += '<div class="mwd-grid">' + MD.KANJI.map(function(k){
          var on = design.kanji && design.kanji.ch === k.ch;
          return '<button type="button" class="mwd-opt' + (on?" on":"") + '" data-kanji="' + esc(k.ch) + '" title="' + esc(k.label) + '">' +
            '<span class="mwd-kanji">' + esc(k.ch) + '</span><span class="mwd-lbl">' + esc(k.label) + '</span></button>';
        }).join("") + '</div>' +
        '<div class="mwd-swatches-wrap"><div style="font-size:.72rem;color:var(--faint,#6b7180);margin-bottom:6px">Kanji colour</div>' +
        colorSwatches(design.kanji ? design.kanji.color : "#f4ecd8", null, "kanjiSw") + '</div>' +
        transformControls("kanji", true);
      }

      if (activeTab === "fg") {
        html += '<div class="mwd-grid">' +
          '<button type="button" class="mwd-opt none' + (!design.fg?" on":"") + '" data-fgnone="1">None</button>' +
          MD.EMBLEMS.map(function(e){
            var on = design.fg && design.fg.src === "lib:"+e.id;
            return '<button type="button" class="mwd-opt' + (on?" on":"") + '" data-emblem="' + e.id + '" title="' + esc(e.label) + '">' +
              '<svg viewBox="-20 -20 40 40" style="color:var(--ink,#f1f2f6)">' + e.svg + '</svg><span class="mwd-lbl">' + esc(e.label) + '</span></button>';
          }).join("") + '</div>' +
          '<div class="mwd-url"><input type="text" id="mwdFgUrl" placeholder="Paste an image URL (png, jpg, svg)…"><button type="button" id="mwdFgUrlBtn">Add</button></div>';
        if (design.fg && design.fg.src && design.fg.src.indexOf("lib:")===0) {
          html += '<div class="mwd-swatches-wrap" style="margin-top:10px"><div style="font-size:.72rem;color:var(--faint,#6b7180);margin-bottom:6px">Emblem colour</div>' +
            colorSwatches(design.fg.color, null, "fgSw") + '</div>';
        }
        html += transformControls("fg", true);
      }

      if (activeTab === "supp") {
        html += '<div class="mwd-grid">' +
          '<button type="button" class="mwd-opt none' + (!design.supp?" on":"") + '" data-suppnone="1">None</button>' +
          MD.SKY.map(function(s){
            var on = design.supp && design.supp.id === s.id;
            return '<button type="button" class="mwd-opt' + (on?" on":"") + '" data-sky="' + s.id + '" title="' + esc(s.label) + '">' +
              '<svg viewBox="-20 -20 40 40" style="color:var(--ink,#f1f2f6)">' + s.svg + '</svg><span class="mwd-lbl">' + esc(s.label) + '</span></button>';
          }).join("") + '</div>';
        if (design.supp) {
          html += '<div class="mwd-swatches-wrap"><div style="font-size:.72rem;color:var(--faint,#6b7180);margin-bottom:6px">Colour</div>' +
            colorSwatches(design.supp.color, null, "suppSw") + '</div>';
        }
        html += transformControls("supp", true);
      }

      if (activeTab === "pat") {
        html += '<div class="mwd-grid">' +
          '<button type="button" class="mwd-opt none' + (!design.pat?" on":"") + '" data-patnone="1">None</button>' +
          MD.PATTERNS.map(function(p){
            var on = design.pat && design.pat.id === p.id;
            return '<button type="button" class="mwd-opt' + (on?" on":"") + '" data-pat="' + p.id + '" title="' + esc(p.label) + '">' +
              '<svg viewBox="-20 -20 40 40" style="color:var(--ink,#f1f2f6)">' + p.svg + '</svg><span class="mwd-lbl">' + esc(p.label) + '</span></button>';
          }).join("") + '</div>';
        if (design.pat) {
          html += '<div class="mwd-swatches-wrap"><div style="font-size:.72rem;color:var(--faint,#6b7180);margin-bottom:6px">Colour</div>' +
            colorSwatches(design.pat.color, null, "patSw") + '</div>';
        }
        html += transformControls("pat", true);
      }

      if (activeTab === "belt") {
        html += '<div style="font-size:.72rem;color:var(--faint,#6b7180);margin-bottom:6px">Interior (layer 6)</div>' +
          colorSwatches(design.interior, null, "interiorSw") +
          '<div style="font-size:.72rem;color:var(--faint,#6b7180);margin:14px 0 6px">Frill &amp; exterior (layer 7)</div>' +
          colorSwatches(design.frill, null, "frillSw");
      }

      panelsEl.innerHTML = html;
      wireOnce();
    }

    function wireOnce(){
      // kanji
      panelsEl.querySelectorAll("[data-kanji]").forEach(function(b){
        b.onclick = function(){
          if (!design.kanji) design.kanji = clone(MD.DEFAULT.kanji);
          design.kanji.ch = b.dataset.kanji; repaint();
        };
      });
      var kanjiSw = panelsEl.querySelector("#kanjiSw");
      if (kanjiSw) wireSwatches(kanjiSw, function(c){ if (design.kanji) { design.kanji.color = c; repaint(); } });

      // emblem
      var fgNone = panelsEl.querySelector("[data-fgnone]");
      if (fgNone) fgNone.onclick = function(){ design.fg = null; repaint(); };
      panelsEl.querySelectorAll("[data-emblem]").forEach(function(b){
        b.onclick = function(){ design.fg = { src: "lib:"+b.dataset.emblem, color: (design.fg&&design.fg.color)||"#f4ecd8", x:50,y:50,s:1,r:0 }; repaint(); };
      });
      var fgUrlBtn = panelsEl.querySelector("#mwdFgUrlBtn");
      if (fgUrlBtn) fgUrlBtn.onclick = function(){
        var v = panelsEl.querySelector("#mwdFgUrl").value.trim();
        if (!/^https?:\/\/.+/i.test(v)) return;
        design.fg = { src: "url:"+v, x:50,y:50,s:1,r:0 }; repaint();
      };
      var fgSw = panelsEl.querySelector("#fgSw");
      if (fgSw) wireSwatches(fgSw, function(c){ if (design.fg) { design.fg.color = c; repaint(); } });

      // sky
      var suppNone = panelsEl.querySelector("[data-suppnone]");
      if (suppNone) suppNone.onclick = function(){ design.supp = null; repaint(); };
      panelsEl.querySelectorAll("[data-sky]").forEach(function(b){
        b.onclick = function(){ design.supp = { id: b.dataset.sky, color:(design.supp&&design.supp.color)||"#e7c65a", x:50,y:22,s:0.6,r:0 }; repaint(); };
      });
      var suppSw = panelsEl.querySelector("#suppSw");
      if (suppSw) wireSwatches(suppSw, function(c){ if (design.supp) { design.supp.color = c; repaint(); } });

      // pattern
      var patNone = panelsEl.querySelector("[data-patnone]");
      if (patNone) patNone.onclick = function(){ design.pat = null; repaint(); };
      panelsEl.querySelectorAll("[data-pat]").forEach(function(b){
        b.onclick = function(){ design.pat = { id: b.dataset.pat, color:(design.pat&&design.pat.color)||"#f4ecd8", x:50,y:50,s:1,r:0 }; repaint(); };
      });
      var patSw = panelsEl.querySelector("#patSw");
      if (patSw) wireSwatches(patSw, function(c){ if (design.pat) { design.pat.color = c; repaint(); } });

      // belt colours
      var interiorSw = panelsEl.querySelector("#interiorSw");
      if (interiorSw) wireSwatches(interiorSw, function(c){ design.interior = c; repaint(); });
      var frillSw = panelsEl.querySelector("#frillSw");
      if (frillSw) wireSwatches(frillSw, function(c){ design.frill = c; repaint(); });

      // transform sliders for whichever layer panel is showing
      var layerForTab = { kanji:"kanji", fg:"fg", supp:"supp", pat:"pat" }[activeTab];
      if (layerForTab) wireTransform(panelsEl, layerForTab);
    }

    tabsEl.querySelectorAll(".mwd-tab").forEach(function(b){
      b.onclick = function(){ activeTab = b.dataset.tab; renderPanel(); };
    });

    var diceBtn = el.querySelector("#mwdDice");
    if (diceBtn) diceBtn.onclick = function(){
      var pick = function(a){ return a[Math.floor(Math.random()*a.length)]; };
      var k = pick(MD.KANJI), sky = Math.random()>0.25 ? pick(MD.SKY) : null, pat = Math.random()>0.4 ? pick(MD.PATTERNS) : null;
      var fg = Math.random()>0.5 ? pick(MD.EMBLEMS) : null;
      design = {
        v:1,
        kanji: { ch:k.ch, color: pick(MD.PALETTE.concat(["#f4ecd8"])), x:50,y:50, s: 0.9+Math.random()*0.3, r: Math.random()>0.7?(Math.floor(Math.random()*20)-10):0 },
        fg: fg ? { src:"lib:"+fg.id, color: pick(MD.PALETTE), x:50,y:50, s:1, r:0 } : null,
        supp: sky ? { id: sky.id, color: pick(MD.PALETTE), x:50, y:22, s:0.55+Math.random()*0.3, r:0 } : null,
        pat: pat ? { id: pat.id, color: pick(MD.PALETTE), x:50,y:50, s:0.9+Math.random()*0.4, r: Math.floor(Math.random()*360) } : null,
        interior: pick(MD.PALETTE),
        frill: pick(MD.PALETTE)
      };
      repaint();
    };

    var saveBtn = el.querySelector("#mwdSave");
    if (saveBtn) saveBtn.onclick = function(){ if (options.onSave) options.onSave(clone(design)); };

    repaint();
    return {
      getDesign: function(){ return clone(design); },
      setDesign: function(d){ design = clone(d); repaint(); }
    };
  };
})();
