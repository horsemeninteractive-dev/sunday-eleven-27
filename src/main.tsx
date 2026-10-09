import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { bootStore, flushAutosave, useGameStore } from './state/gameStore';
import { applyMotion, loadPreferences } from './state/preferences';
import { initialise, resumeSlot } from './state/persistence';
import { onSuspend } from './platform/lifecycle';
import { startNativeShell } from './platform/native';
import { startDesktopShell } from './platform/desktop';
import { captureInstallPrompt, startServiceWorker } from './pwa';
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
// only thing that knows it is going away, so it flushes a pending save itself —
// and it asks the platform to tell it, rather than the browser, because a
// packaged build says the same thing in its own words and this is the line that
// will not have to change when it does.
onSuspend(flushAutosave);

// A phone says the same two things in its own words — a back gesture, and the
// application being put away and picked up again — and neither arrives as a
// browser event. That vocabulary is in `platform/native.ts`, and it does
// nothing at all unless there is a native shell around the game.
startNativeShell();

// And a desktop window says one thing of its own: it is about to close, and it
// will wait to be told that the last save landed. That, and the host a career
// file is written through, are in `platform/desktop.ts` — likewise inert in any
// build that is not the desktop one.
startDesktopShell();

// The install offer and the worker are both one-shot things that fire on the
// browser's schedule rather than the game's, and both have to be caught before
// React has mounted to be caught at all. They are set up here, at the top of the
// program, for that reason — see pwa.ts.
captureInstallPrompt();
startServiceWorker();

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing from index.html');

// Storage opens before anything is drawn, and old careers are brought across
// before it is decided which screen to open. Rendering first and catching up
// afterwards would show the manager a menu claiming he has no careers, and then
// contradict it a moment later — so the first frame waits on the database
// instead, and the loading state it shows is honest about why.
// The placeholder starts neutral. Only a real resume marker makes it a career
// loader; first-boot branding is still decided by App after storage is ready.
async function openApplication() {
  await initialise();
  const slot = await resumeSlot();
  const note = document.querySelector('.booting__note');
  if (slot && note) note.textContent = 'Opening your career…';
  await bootStore();
}
void openApplication()
  // Opening cannot be allowed to fail silently. Everything this touches already
  // handles its own troubles — a browser with no storage opens the game and says
  // so — but if anything unforeseen comes out of the sequence above, the manager
  // is owed a screen that says what happened rather than one that waits forever
  // behind a placeholder. The game is still playable from here; what is lost is
  // the ability to remember, which is announced rather than hidden.
  .catch((error: unknown) => {
    console.error('The game could not finish opening.', error);
    useGameStore.setState({
      ready: true,
      game: null,
      view: 'start',
      bootError:
        'The game could not finish opening. Nothing has been deleted — saved careers are still on disk — and you can play on, but this session may not be able to save.',
    });
  })
  .finally(() => {
    // The placeholder in the document is only ever a placeholder: it is taken off
    // as the real screen arrives, so there is never a moment where both are shown
    // or neither is.
    document.getElementById('booting')?.remove();
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
