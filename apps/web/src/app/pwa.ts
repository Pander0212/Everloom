export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    import('workbox-window')
      .then(({ Workbox }) => {
        const wb = new Workbox('/sw.js');
        void wb.register();
      })
      .catch(() => {});
  });
}
