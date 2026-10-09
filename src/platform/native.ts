import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { flushAutosave, useGameStore } from '@/state/gameStore';
import { backActionFor } from '@/ui/back';
import { closeTopLayer, layerDepth } from '@/ui/layers';
import { matchOnForeground, matchOnSuspend, noteSuspension } from './lifecycle';
import { installNativeFileHost } from './nativeFiles';

/**
 * The native shell, and the three things a phone asks of the game.
 *
 * Everything in this file is about the *application* rather than about the
 * football, and every one of the three is something a browser was already
 * saying in its own words:
 *
 *  - **The back gesture.** Android's system UI has one, and an application that
 *    ignores it either closes when it should not or does nothing when it should.
 *    The decision of what it means is in `ui/back.ts`, where it can be read and
 *    tested; this file only finds out that it happened and does it.
 *  - **Being put away and picked up again.** A phone suspends an application
 *    that leaves the screen. The page's own vocabulary for that is `pagehide`
 *    and `visibilitychange`, which `lifecycle.ts` already listens to on the web;
 *    a Capacitor build is told directly, and this is where that is translated
 *    into the same two ideas.
 *  - **The keyboard.** A soft keyboard is not a browser's problem until it
 *    covers the field the manager is typing in. The shell reports when it has
 *    appeared, and the one thing that must then happen is that the field he is
 *    looking at is on the screen.
 *
 * Nothing here runs in a browser or in an installed PWA: `isNativePlatform()`
 * is the whole gate, so the web build keeps behaving exactly as it did. That is
 * also why the plugins' own web shims never get a chance to throw — the methods
 * this file calls (minimising the application above all) are `unimplemented` on
 * the web, and on the web none of them is reached.
 *
 * Listeners are registered once per application and taken off again when the
 * shell is stopped, because an application that is suspended and resumed many
 * times must not accumulate a handler per resume.
 */

let started: (() => void) | null = null;

/** The application has gone off the screen. */
function wentAway(): void {
  const session = useGameStore.getState().session;
  const action = matchOnSuspend(session);
  if (action === 'pause') {
    // Paused deliberately rather than implicitly: a frame loop stops on its own
    // while the application is not being drawn, but nothing about the store
    // would say so, and the controls would come back offering to pause a match
    // that is already standing still.
    noteSuspension();
    useGameStore.setState({
      session: session ? { ...session, paused: true, revision: session.revision + 1 } : null,
    });
  }
  // A career is written out in the background; a pending write is handed over
  // now rather than trusted to a timer that a suspended application does not
  // get to fire. It is not awaited, and nothing is blocked on it: see
  // `flushAutosave`.
  flushAutosave();
}

/** The application is on the screen again. */
function cameBack(): void {
  const session = useGameStore.getState().session;
  const action = matchOnForeground(session);
  if (action === 'resume') {
    useGameStore.setState({
      session: session ? { ...session, paused: false, revision: session.revision + 1 } : null,
    });
  }
}

/**
 * The back gesture, turned into the action the policy chose.
 *
 * Exported because it is the whole of the behaviour — the listener below does
 * nothing but call this — and because a browser has no back gesture to fire, so
 * this is the only way any of it can be tested. See `native.test.ts`.
 */
export function handleBackGesture(): void {
  const store = useGameStore.getState();
  const action = backActionFor({
    layers: layerDepth(),
    view: store.view,
    matchPhase: store.session?.phase ?? null,
  });

  switch (action.kind) {
    case 'close-layer':
      closeTopLayer();
      return;
    case 'ask-to-leave-match':
      store.askToLeaveMatch();
      return;
    case 'finish-match':
      store.finishMatchSession();
      return;
    case 'leave-replay':
      store.closeReplay();
      return;
    case 'abandon-draft':
      store.abandonDraft();
      return;
    case 'navigate':
      store.setView(action.to);
      return;
    case 'background':
      void standAside();
  }
}

/**
 * The manager is at the dashboard with nothing open and has asked to leave.
 *
 * Android's own answer is to put the task away rather than to kill it — the
 * afternoon is still in the recents list, exactly where he left it — and that
 * is what `minimizeApp` does. It is Android only, so iOS is left alone: there is
 * no back gesture to arrive from there, and an application that ends its own
 * process is an application that looks like a crash.
 */
async function standAside(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    await App.minimizeApp();
  } catch (error) {
    // The plugin is missing or was not synced into the build. Ending the
    // application is the honest fallback for a back gesture the manager has
    // made twice, and it is said out loud rather than swallowed.
    console.warn('Could not put the application aside; closing it instead.', error);
    await App.exitApp();
  }
}

/**
 * Bring the field the manager is typing in back onto the screen.
 *
 * This is the whole of the keyboard's client-side work. Android resizes the
 * WebView when the keyboard appears — Capacitor's system-bar handling reserves
 * the keyboard's height for us — so the *layout* needs nothing; what it cannot
 * know is that the field inside a scrolling dialog body is now below the fold.
 * One scroll, aimed at the focused element, and every text input in the game is
 * visible while it is being typed in, including the ones at the bottom of the
 * longest dialog.
 */
function revealFocusedField(): void {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement)) return;
  if (field === document.body) return;
  // A field the game is not actually showing is not worth scrolling to — and a
  // scroll aimed at one would move a screen the manager is not typing on.
  if (field.getClientRects().length === 0) return;
  field.scrollIntoView({ block: 'center', behavior: 'auto' });
}

/**
 * Wire the shell up. Safe to call once, and returns the way to take it down.
 *
 * Calling it twice returns the first registration's disposer rather than adding
 * a second set of listeners: both `main.tsx` and a test may reasonably ask for
 * the shell to be running, and neither should be able to end up with two back
 * handlers deciding what one gesture meant.
 */
export function startNativeShell(): () => void {
  if (started) return started;
  if (!Capacitor.isNativePlatform()) {
    started = () => undefined;
    return started;
  }

  // The shell is also what writes a career file out to the device: a WebView has
  // no download manager, so an exported career has nowhere to go without this.
  // Installed here, at the one moment the application is known to be a packaged
  // one, rather than on the screen that offers an export — a screen asking is a
  // capability test, and this is the capability.
  installNativeFileHost();

  const handles: Array<{ remove: () => Promise<void> }> = [];
  const keep = (handle: { remove: () => Promise<void> }): void => {
    handles.push(handle);
  };

  void App.addListener('backButton', () => handleBackGesture()).then(keep);
  void App.addListener('appStateChange', ({ isActive }) => (isActive ? cameBack() : wentAway())).then(keep);
  // Both moments are wanted: `didShow` is after the keyboard has taken its
  // room, which is when scrolling to the field actually keeps it on screen.
  void Keyboard.addListener('keyboardDidShow', () => revealFocusedField()).then(keep);

  const dispose = (): void => {
    for (const handle of handles.splice(0)) void handle.remove();
    started = null;
  };
  started = dispose;
  return dispose;
}

/** Only for tests: tear the shell down between cases. */
export function resetNativeShellForTests(): void {
  started = null;
}
