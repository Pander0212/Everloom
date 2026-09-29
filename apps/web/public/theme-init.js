// Apply the saved theme before first paint (external file: the CSP forbids inline scripts).
(function () {
  try {
    var t = localStorage.getItem('everloom.theme') || 'system';
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    var m = localStorage.getItem('everloom.motion');
    if (m === 'reduced') document.documentElement.dataset.motion = 'reduced';
    var s = localStorage.getItem('everloom.textSize');
    if (s) document.documentElement.dataset.textSize = s;
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
