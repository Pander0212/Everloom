import type { Settings } from '@everloom/engine';

export function applyTheme(theme: Settings['theme']) {
  try {
    localStorage.setItem('everloom.theme', theme);
  } catch {
    /* private mode */
  }
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelectorAll('meta[name="theme-color"]');
  meta.forEach((m) => m.setAttribute('content', dark ? '#0E0F11' : '#F6F5F2'));
}

export function applyMotion(motion: Settings['motion']) {
  try {
    localStorage.setItem('everloom.motion', motion);
  } catch {
    /* private mode */
  }
  if (motion === 'reduced') document.documentElement.dataset.motion = 'reduced';
  else delete document.documentElement.dataset.motion;
}

export function applyTextSize(size: Settings['textSize']) {
  try {
    localStorage.setItem('everloom.textSize', size);
  } catch {
    /* private mode */
  }
  document.documentElement.dataset.textSize = size;
}

export function watchSystemTheme(get: () => Settings['theme']) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const fn = () => get() === 'system' && applyTheme('system');
  mq.addEventListener('change', fn);
  return () => mq.removeEventListener('change', fn);
}
