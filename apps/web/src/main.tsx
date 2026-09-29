import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './app/App';
import { queryClient } from './lib/queries';
import { registerServiceWorker } from './app/pwa';
import { TooltipProvider } from './ui';
import './styles/app.css';
import interUrl from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url';
import serifUrl from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2?url';

// Start the two main fonts downloading right away, so story text doesn't reflow when they arrive.
for (const href of [interUrl, serifUrl]) {
  const l = document.createElement('link');
  l.rel = 'preload';
  l.as = 'font';
  l.type = 'font/woff2';
  l.crossOrigin = 'anonymous';
  l.href = href;
  document.head.appendChild(l);
}


registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <TooltipProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </TooltipProvider>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
