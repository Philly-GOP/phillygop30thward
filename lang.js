/* Language menu. Adds a small "Language" picker to the header and opens the
   current page through Google's free page-translation proxy (translate.goog).
   No account or key needed. English is the site's official version.
   To add a language, add a line to LANGS: [code, name shown in that language]. */
(function () {
  var _rev = 'w30-kojtq';
  var LANGS = [
    ['en', 'English'],
    ['es', 'Español'],
    ['zh-CN', '中文 (简体)'],
    ['vi', 'Tiếng Việt'],
    ['ru', 'Русский'],
    ['ar', 'العربية'],
    ['ht', 'Kreyòl Ayisyen'],
    ['pt', 'Português'],
    ['fr', 'Français'],
    ['ko', '한국어']
  ];
  var HOST = 'phillygop30thward.com';
  var PROXY = HOST.replace(/-/g, '--').replace(/\./g, '-') + '.translate.goog';

  var onProxy = location.hostname === PROXY;
  var params = new URLSearchParams(location.search);
  var current = onProxy ? (params.get('_x_tr_tl') || 'en') : 'en';

  function go(code) {
    var path = location.pathname + location.hash;
    if (code === 'en') {
      location.href = 'https://' + HOST + path;
      return;
    }
    location.href = 'https://' + PROXY + location.pathname +
      '?_x_tr_sl=en&_x_tr_tl=' + encodeURIComponent(code) +
      '&_x_tr_hl=' + encodeURIComponent(code) + '&_x_tr_pto=wapp' + location.hash;
  }

  var css = document.createElement('style');
  css.textContent =
    '.lang{position:relative;display:inline-flex;align-items:center}' +
    '.lang select{appearance:none;-webkit-appearance:none;font:500 14px var(--sans);color:var(--on-navy-body,#F4EEE1);' +
    'background:transparent;border:1.5px solid rgba(244,238,225,.45);border-radius:0;padding:7px 28px 7px 10px;cursor:pointer;max-width:150px}' +
    '.lang select:focus{outline:2px solid var(--cream);outline-offset:2px}' +
    '.lang select option{color:#16305C;background:#F4EEE1}' +
    '.lang:after{content:"";position:absolute;right:10px;top:50%;margin-top:-3px;border:5px solid transparent;border-top-color:currentColor;color:var(--cream);pointer-events:none}' +
    '.lang-note{font-size:13px;line-height:1.5;opacity:.8;margin:0}' +
    '.m-panel .lang{margin:6px 0}' +
    '@media (max-width:820px){nav .lang{display:none}}';
  document.head.appendChild(css);

  function build() {
    var wrap = document.createElement('label');
    wrap.className = 'lang';
    var sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = 'Language';
    var sel = document.createElement('select');
    sel.setAttribute('aria-label', 'Language / Idioma');
    sel.setAttribute('translate', 'no');
    sel.className = 'notranslate';
    LANGS.forEach(function (l) {
      var o = document.createElement('option');
      o.value = l[0];
      o.textContent = l[1];
      o.lang = l[0];
      if (l[0] === current) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { go(sel.value); });
    wrap.appendChild(sr);
    wrap.appendChild(sel);
    return wrap;
  }

  var nav = document.querySelector('nav[aria-label="Main"]');
  if (nav) {
    var menuBtn = nav.querySelector('.menu-btn');
    nav.insertBefore(build(), menuBtn || null);
  }
  var panel = document.getElementById('m-panel');
  if (panel) panel.insertBefore(build(), panel.firstChild);

  var foot = document.querySelector('footer .wrap');
  if (foot && current !== 'en') {
    var p = document.createElement('p');
    p.className = 'lang-note';
    p.textContent = 'This page was translated automatically. The English version is the official one.';
    foot.appendChild(p);
  }
})();
