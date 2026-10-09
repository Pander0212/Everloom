// Apply the saved theme before first paint (external file: the CSP forbids inline scripts).
(function () {
  try {
    var t = localStorage.getItem('everloom.theme') || 'system';
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    // The theme in force last time, with its background, so the first paint is already right.
    var b = JSON.parse(localStorage.getItem('everloom.lookBoot') || 'null');
    if (b && b.look) {
      document.documentElement.dataset.look = b.look;
      if (b.look !== 'everloom') {
        document.documentElement.dataset.theme = b.scheme;
        document.documentElement.style.backgroundColor = b.bg;
      }
    }
    var m = localStorage.getItem('everloom.motion');
    if (m === 'reduced') document.documentElement.dataset.motion = 'reduced';
    var s = localStorage.getItem('everloom.textSize');
    if (s) document.documentElement.dataset.textSize = s;
    var p = localStorage.getItem('everloom.palette');
    if (p && p !== 'amber' && (!b || b.look === 'everloom')) document.documentElement.dataset.palette = p;
    var v = JSON.parse(localStorage.getItem('everloom:view') || '{}');
    if (v.hud === false) document.documentElement.dataset.hideHud = '';
    if (v.chips === false) document.documentElement.dataset.hideChips = '';
    if (v.avatars === false) document.documentElement.dataset.hideAvatars = '';
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
