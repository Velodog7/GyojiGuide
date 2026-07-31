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
    { href: "banzuke.html", label: "The Banzuke",  match: ["banzuke.html", "banzuke"] },
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
      '</div></div>';
    document.body.insertBefore(nav, document.body.firstChild);
    document.body.classList.add("has-gg-nav");
  }

  var CSS =
    '#gg-nav{position:relative;width:100%;z-index:900;' +
      'background:rgba(20,22,30,.86);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);' +
      'border-bottom:1px solid rgba(216,178,90,.25);font-family:"Space Grotesk","Zen Kaku Gothic New",system-ui,sans-serif}' +
    '.ggn-inner{max-width:1100px;margin:0 auto;min-height:68px;padding:0 16px;' +
      'display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px}' +
    '.ggn-brand{grid-column:1;justify-self:start;display:inline-flex;align-items:center;gap:8px;' +
      'text-decoration:none;color:#f4ecd8;font-weight:700;font-size:.98rem;letter-spacing:.01em;white-space:nowrap}' +
    '.ggn-brand svg,.ggn-brand img{height:48px;width:auto;display:block}' +
    '.ggn-links{grid-column:2;justify-self:center;display:flex;gap:6px;align-items:stretch}' +
    '.ggn-link{display:flex;align-items:center;justify-content:center;' +
      'font-family:"Space Grotesk",system-ui,sans-serif;font-weight:600;font-size:.94rem;letter-spacing:.01em;' +
      'text-decoration:none;color:#c7cbd9;padding:10px 18px;border-radius:10px;transition:color .15s,background .15s}' +
    '.ggn-link:hover{color:#f4ecd8;background:rgba(255,255,255,.07)}' +
    '.ggn-link.active{color:#0f1118;background:linear-gradient(180deg,#f0d590,#d8b25a);font-weight:700}' +
    '@media(max-width:640px){.ggn-inner{grid-template-columns:1fr;justify-items:center;gap:4px;padding:6px 12px}' +
      '.ggn-brand{grid-column:1}.ggn-links{grid-column:1;flex-wrap:wrap;justify-content:center}' +
      '.ggn-link{padding:7px 13px;font-size:.86rem}}';

  function mount() {
    var st = document.createElement("style");
    st.id = "gg-nav-css";
    st.textContent = CSS;
    document.head.appendChild(st);
    build();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
