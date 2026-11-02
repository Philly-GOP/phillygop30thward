/* phillygop30thward.com · © 2026 30th Ward Republican Committee. All rights reserved. Site by Shirah M. Brown. */
/*
  Visit-count gate for phillygop30thward.com (GoatCounter)
  - Skips obvious automation (headless browsers, crawlers, webdriver, link previews).
  - Counts only devices set to a continental US time zone.
  - Counts a visit only after a real interaction (scroll, tap, mouse move, key press)
    AND at least 3 seconds on the page. Visits shorter than that aren't counted.
  - Page names include the site's address (location.host), so a copy of the site
    served from another address shows up under that address.
  - Visit any page with ?notrack=1 once on a device to stop counting it; ?notrack=0 undoes it.
*/
(function () {
  var ENDPOINT = 'https://phillygop30thward.goatcounter.com/count';
  window.goatcounter = {
    no_onload: true,
    endpoint: ENDPOINT,
    path: function (p) { return location.host + p; }
  };

  try {
    var q = new URLSearchParams(location.search).get('notrack');
    if (q === '1') localStorage.setItem('w30_notrack', '1');
    if (q === '0') localStorage.removeItem('w30_notrack');
    if (localStorage.getItem('w30_notrack') === '1') return;
  } catch (e) {}

  var ua = navigator.userAgent || '';
  if (navigator.webdriver) return;
  if (/bot|crawl|spider|slurp|headless|phantom|lighthouse|pingdom|uptime|monitor|python|curl|wget|httpclient|scrapy|preview/i.test(ua)) return;
  if (!navigator.languages || navigator.languages.length === 0) return;

  // Continental US only, judged by the device's time zone (excludes Alaska, Hawaii, territories, abroad)
  try {
    var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    var conus = /^America\/(New_York|Detroit|Chicago|Denver|Boise|Phoenix|Los_Angeles|Menominee|Indiana\/.+|Kentucky\/.+|North_Dakota\/.+)$|^US\/(Eastern|Central|Mountain|Pacific|Arizona|East-Indiana|Michigan|Indiana-Starke)$/;
    if (!conus.test(tz)) return;
  } catch (e) {}

  var MIN_MS = 3000;
  var start = Date.now();
  var counted = false;
  var events = ['scroll', 'pointermove', 'pointerdown', 'touchstart', 'keydown'];

  function countVisit() {
    if (counted) return;
    counted = true;
    events.forEach(function (ev) { window.removeEventListener(ev, onInteract, true); });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://gc.zgo.at/count.js';
    s.setAttribute('data-goatcounter', ENDPOINT);
    s.onload = function () {
      if (window.goatcounter && typeof window.goatcounter.count === 'function') window.goatcounter.count();
    };
    (document.head || document.documentElement).appendChild(s);
  }

  function onInteract() {
    var wait = MIN_MS - (Date.now() - start);
    if (wait <= 0) countVisit(); else setTimeout(countVisit, wait);
  }

  events.forEach(function (ev) {
    window.addEventListener(ev, onInteract, { capture: true, passive: true });
  });
})();
