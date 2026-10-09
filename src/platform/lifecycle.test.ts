import { afterEach, describe, expect, it } from 'vitest';
import {
  hasPageLifecycle,
  matchOnForeground,
  matchOnSuspend,
  noteSuspension,
  onSuspend,
  resetSuspensionForTests,
  type LifecycleHandler,
} from './lifecycle';

/**
 * The one lifecycle subscription the game has.
 *
 * What it is for is a pending autosave being handed over as the page goes away,
 * so the two things that matter are that it hears both of the ways a page says
 * it is leaving, and that it stops hearing once it has been unsubscribed. The
 * environment under test has no document at all, which is deliberate: the same
 * module is imported by build scripts and tests, and signing up there must be a
 * no-op rather than a crash.
 */

interface FakeHost {
  addEventListener: (type: string, listener: LifecycleHandler) => void;
  removeEventListener: (type: string, listener: LifecycleHandler) => void;
}

interface FakeListeners {
  host: FakeHost;
  /** How many listeners are currently registered for one event. */
  count: (type: string) => number;
  /** Fire an event, as the browser would. */
  fire: (type: string) => void;
  /** Every listener that was taken off, in order. */
  removed: Array<{ type: string; handler: LifecycleHandler }>;
}

/** A window or a document reduced to the listener bookkeeping the game uses. */
function fakeListeners(): FakeListeners {
  const registered = new Map<string, LifecycleHandler[]>();
  const removed: Array<{ type: string; handler: LifecycleHandler }> = [];
  return {
    host: {
      addEventListener: (type, listener) => {
        registered.set(type, [...(registered.get(type) ?? []), listener]);
      },
      removeEventListener: (type, listener) => {
        removed.push({ type, handler: listener });
        registered.set(type, (registered.get(type) ?? []).filter((entry) => entry !== listener));
      },
    },
    count: (type) => (registered.get(type) ?? []).length,
    fire: (type) => {
      for (const listener of [...(registered.get(type) ?? [])]) listener();
    },
    removed,
  };
}

interface InstalledPage extends FakeListeners {
  document: FakeListeners;
  setVisibility: (state: DocumentVisibilityState) => void;
}

/** Put a window and a document in place, with the visibility a test asks for. */
function installPage(): InstalledPage {
  const window = fakeListeners();
  const document = fakeListeners();
  const view = { visibilityState: 'hidden' as DocumentVisibilityState };
  const documentObject = {
    ...document.host,
    get visibilityState() {
      return view.visibilityState;
    },
  };
  globalThis.window = window.host as unknown as typeof globalThis.window;
  globalThis.document = documentObject as unknown as typeof globalThis.document;
  return {
    ...window,
    document,
    setVisibility: (state) => {
      view.visibilityState = state;
    },
  };
}

afterEach(() => {
  // Neither of these exists in this environment, so putting it back means taking
  // it away again — and a page left installed would decide the next test's
  // answer.
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

describe('suspending the page', () => {
  it('is a no-op where there is no page to listen to', () => {
    expect(hasPageLifecycle()).toBe(false);

    let called = 0;
    const unsubscribe = onSuspend(() => {
      called += 1;
    });

    expect(() => unsubscribe()).not.toThrow();
    expect(called).toBe(0);
  });

  it('signs up for both of the ways a page says it is leaving', () => {
    const page = installPage();

    onSuspend(() => undefined);

    // Both, rather than either: a page closed on a phone often reports one and
    // not the other, and the work being handed over is idempotent anyway.
    expect(page.count('pagehide')).toBe(1);
    expect(page.document.count('visibilitychange')).toBe(1);
  });

  it('hands the work over when the page is unloaded or hidden', () => {
    const page = installPage();
    let called = 0;
    onSuspend(() => {
      called += 1;
    });

    page.fire('pagehide');
    expect(called).toBe(1);

    page.setVisibility('hidden');
    page.document.fire('visibilitychange');
    expect(called).toBe(2);
  });

  it('does not hand the work over when the page merely becomes visible', () => {
    const page = installPage();
    let called = 0;
    onSuspend(() => {
      called += 1;
    });

    page.setVisibility('visible');
    page.document.fire('visibilitychange');

    expect(called).toBe(0);
  });

  it('stops listening once it has been unsubscribed', () => {
    const page = installPage();
    let called = 0;
    const unsubscribe = onSuspend(() => {
      called += 1;
    });

    unsubscribe();

    // Both registrations go, each from the host it was made on: one event on the
    // window and one on the document, which is why they are asserted separately.
    expect(page.removed.map((entry) => entry.type)).toEqual(['pagehide']);
    expect(page.document.removed.map((entry) => entry.type)).toEqual(['visibilitychange']);
    expect(page.count('pagehide')).toBe(0);
    expect(page.document.count('visibilitychange')).toBe(0);

    page.fire('pagehide');
    page.setVisibility('hidden');
    page.document.fire('visibilitychange');
    expect(called).toBe(0);
  });
});

/**
 * What a match does while the application is away.
 *
 * The football stands still either way — nothing is being drawn, so nothing is
 * being played — but the *store* has to agree, or the manager comes back to
 * controls offering to pause a clock that is not moving. What must not happen
 * is the other direction: coming back must never start an afternoon the
 * manager had stopped himself, and it must never start a second one.
 */
describe('a match and the application being put away', () => {
  const running = { phase: 'in-progress', paused: false };
  /** The same match after a suspension stopped it. */
  const stopped = { phase: 'in-progress', paused: true };

  afterEach(() => {
    resetSuspensionForTests();
  });

  it('stops a match that was running', () => {
    expect(matchOnSuspend(running)).toBe('pause');
  });

  it('leaves alone a match the manager paused himself', () => {
    // Coming back must not overrule a decision he made on purpose: the match is
    // already stopped, so the suspension did not stop it, and the marker is
    // never set — which is what the second half of this asserts.
    expect(matchOnSuspend(stopped)).toBe('leave-alone');
    expect(matchOnForeground(stopped)).toBe('leave-alone');
  });

  it('leaves alone everything that is not a match in progress', () => {
    // No match at all, a dressing room, an interval and a full-time card all
    // already have the clock stopped.
    expect(matchOnSuspend(null)).toBe('leave-alone');
    for (const phase of ['pre-match', 'half-time', 'full-time']) {
      expect(matchOnSuspend({ phase, paused: false }), phase).toBe('leave-alone');
    }
  });

  it('starts the match again only when it was this that stopped it', () => {
    noteSuspension();
    expect(matchOnForeground(stopped)).toBe('resume');

    // A suspension during which nothing was running does not start anything on
    // the way back: a manager reading a table must not find a match running.
    expect(matchOnForeground(stopped)).toBe('leave-alone');
  });

  it('leaves a match that is not stopped exactly as it is', () => {
    // Nothing to start: a match that is already running is not resumed a second
    // time, which is the difference between coming back and setting the
    // afternoon going again.
    noteSuspension();
    expect(matchOnForeground(running)).toBe('leave-alone');
  });

  it('does not start a second afternoon when it is resumed twice', () => {
    noteSuspension();
    expect(matchOnForeground(stopped)).toBe('resume');
    expect(matchOnForeground(stopped)).toBe('leave-alone');
  });

  it('does not resume a match that is no longer there', () => {
    noteSuspension();
    expect(matchOnForeground(null)).toBe('leave-alone');
    // Nor one that has moved on: the interval takes over from the clock.
    noteSuspension();
    expect(matchOnForeground({ phase: 'half-time', paused: true })).toBe('leave-alone');
    noteSuspension();
    expect(matchOnForeground({ phase: 'full-time', paused: true })).toBe('leave-alone');
  });
});
