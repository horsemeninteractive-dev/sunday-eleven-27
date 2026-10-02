import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { flushAutosave, useGameStore } from './state/gameStore';
import { applyMotion, loadPreferences } from './state/preferences';
import './ui/styles.css';

// Reduced motion is settled before the first paint, not after it: the stylesheet
// decides what to animate from one attribute on the page, and a stripe that has
// already started drifting before the preference is read is a stripe that had
// to be stopped. If the manager is following his system, changes to it are
// followed too, while he plays.
applyMotion();
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
    if (loadPreferences().motion === 'system') applyMotion('system');
  });
}

// Development convenience: lets the store be inspected and driven from the
// browser console. Never exposed in a production build.
if (import.meta.env.DEV) {
  (window as unknown as { slfm: typeof useGameStore }).slfm = useGameStore;
}

// The career is written out as it is played, but a tab can be reloaded, closed
// or pushed into the background inside the debounce window. The page is the
// only thing that knows it is going away, so it flushes a pending save itself.
window.addEventListener('pagehide', flushAutosave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushAutosave();
});

// What makes the game installable, and playable on a train. Registered only in
// a production build: a worker in front of the dev server would serve one
// session's cached index.html to the next, which is a mystifying way to lose an
// afternoon. The registration is deliberately not awaited — the game must not
// wait on it, and it must not care whether it succeeded.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      // Offline play is a bonus, not a promise. Anything that stops here
      // (private browsing, an unsupported origin) costs the manager nothing but
      // the feature, so it is reported and swallowed.
      console.warn('Service worker registration failed; running online-only.', error);
    });
  });
}

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
