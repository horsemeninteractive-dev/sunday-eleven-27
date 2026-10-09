/**
 * The page's own life: going away, and coming back.
 *
 * The game has one piece of work that must not be lost to a closing tab — the
 * autosave still sitting in its debounce — and one thing it wants to know about
 * coming back. A browser says both through events it invented for the purpose:
 * `visibilitychange` when the page is hidden, `pagehide` when it is being
 * unloaded, `pageshow` when it is restored from the back/forward cache. A
 * native shell hands the same two ideas through its own vocabulary (Capacitor's
 * pause and resume, a desktop window being minimised or quit), and the day that
 * shell arrives it should have to say so in one place rather than in every
 * module that ever cared.
 *
 * So this is the one place, phrased in the game's words rather than the
 * browser's. It is deliberately nothing more than that — no state machine, no
 * "app lifecycle" object — and it holds one subscription rather than a set of
 * them, because there is exactly one thing the game wants to know today: that
 * the manager is leaving and a pending save should be handed over. A shell that
 * later wants to say "and he is back" asks for it then, in one place, rather
 * than being guessed at now.
 *
 * The subscription is a no-op where there is no document, which is what makes it
 * safe to call from code that also runs in a test or a build script.
 */
export type LifecycleHandler = () => void;

/**
 * The parts of a live match this module has an opinion about.
 *
 * Structural on purpose: the store's session satisfies it, and a test can hand
 * over the two fields it cares about without building a football match.
 */
export interface MatchBeingPlayed {
  phase: string;
  paused: boolean;
}

/**
 * What a match does when the application leaves the screen.
 *
 * A frame loop stops on its own while nothing is being drawn, so the football
 * was always going to stand still — but the *store* would go on claiming the
 * match was running, and the controls would come back offering to pause a clock
 * that is not moving. So it is stopped deliberately, and the three cases where
 * that is not this module's business are said out loud:
 *
 *  - no match at all, which is the ordinary case of a manager reading a table;
 *  - a match that is not in progress — the dressing room, the interval and the
 *    full-time card all already have the clock stopped;
 *  - a match the manager paused himself, because coming back must not overrule
 *    a decision he made on purpose.
 */
export function matchOnSuspend(session: MatchBeingPlayed | null): 'pause' | 'leave-alone' {
  if (!session) return 'leave-alone';
  if (session.phase !== 'in-progress') return 'leave-alone';
  if (session.paused) return 'leave-alone';
  return 'pause';
}

/**
 * Whether the pause now in force is this module's doing.
 *
 * Held here rather than in the session because it is not a fact about the
 * match: it is a fact about how the last suspension went, and it lives exactly
 * as long as the application is away.
 */
let pausedForSuspension = false;

/** Called when a suspension actually stopped a running match. */
export function noteSuspension(): void {
  pausedForSuspension = true;
}

/**
 * What a match does when the application comes back.
 *
 * The clock is restarted only if this module stopped it, and only if it is still
 * stopped: an application that is resumed twice, or resumed after the manager
 * has already tapped play, must not start a second afternoon running. Either
 * way the marker is cleared, because a new suspension is a new decision.
 */
export function matchOnForeground(session: MatchBeingPlayed | null): 'resume' | 'leave-alone' {
  const pausedBySuspension = pausedForSuspension;
  pausedForSuspension = false;
  if (!pausedBySuspension) return 'leave-alone';
  if (!session || session.phase !== 'in-progress' || !session.paused) return 'leave-alone';
  return 'resume';
}

/** Only for tests: forget how the last suspension went. */
export function resetSuspensionForTests(): void {
  pausedForSuspension = false;
}

/** True when this environment has the events a page lifecycle is made of. */
export function hasPageLifecycle(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * The manager is leaving: the page is being unloaded, put in the background or
 * hidden behind another window.
 *
 * Called for both `pagehide` and a hidden `visibilitychange`, which overlap by
 * design — a page that is closed on mobile often reports one and not the other,
 * and a handler that runs twice is a handler that should have been idempotent
 * anyway (`flushAutosave` is).
 */
export function onSuspend(handler: LifecycleHandler): () => void {
  if (!hasPageLifecycle()) return () => undefined;
  const leaving = () => handler();
  const hidden = () => {
    if (document.visibilityState === 'hidden') handler();
  };
  window.addEventListener('pagehide', leaving);
  document.addEventListener('visibilitychange', hidden);
  return () => {
    window.removeEventListener('pagehide', leaving);
    document.removeEventListener('visibilitychange', hidden);
  };
}

