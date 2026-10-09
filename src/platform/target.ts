/**
 * What this build is packaged as.
 *
 * The game is one application, and this is the one place that knows which shape
 * of it is running. A browser build is what ships today; a Capacitor build sets
 * `VITE_BUILD_TARGET=mobile` when it bundles, and the desktop (Electron) build
 * sets `VITE_BUILD_TARGET=desktop`. Nothing switches on it to change how the
 * football works — the simulation is the same game everywhere — and the flag
 * exists so the handful of places that genuinely differ can ask a question
 * rather than infer it from what the browser says it is, which is a habit that
 * goes wrong quietly and often.
 *
 * The default is `web`, deliberately: a build that declares nothing is the
 * build that already works, so no packaging step can change how the game
 * behaves by forgetting to say something.
 */
export type BuildTarget = 'web' | 'mobile' | 'desktop';

const KNOWN: readonly string[] = ['web', 'mobile', 'desktop'];

/** The declared target, or `web` when the build did not declare a usable one. */
export function buildTarget(): BuildTarget {
  const declared = import.meta.env?.VITE_BUILD_TARGET;
  const cleaned = typeof declared === 'string' ? declared.trim().toLowerCase() : '';
  return KNOWN.includes(cleaned) ? (cleaned as BuildTarget) : 'web';
}

export function isWebBuild(): boolean {
  return buildTarget() === 'web';
}

export function isMobileBuild(): boolean {
  return buildTarget() === 'mobile';
}

export function isDesktopBuild(): boolean {
  return buildTarget() === 'desktop';
}

/**
 * Whether there is a browser behind the game that could install or update it.
 *
 * True for the website and its installed PWA, false for a packaged application —
 * mobile or desktop — where the game is already installed, its assets are already
 * local, and there is therefore nothing to offer and nothing to fetch a new
 * version of. It is the single question the browser-only features ask, so that
 * one source ships to every target without any of them carrying a copy of the
 * other's plumbing:
 *
 *   - no service worker is registered, because the assets are on the device;
 *   - no install offer is caught, because there is nothing left to install and
 *     a WebView's user agent is a phone's, which the install logic would
 *     otherwise read as "this is Safari on iOS" and offer Share → Add to Home
 *     Screen from inside the installed application;
 *   - no update bar is shown, because a packaged build is updated by its store
 *     and there is no second copy of the game waiting to take over.
 */
export function hasWebShell(): boolean {
  return isWebBuild();
}
