/**
 * How the manager wants the game to behave, as opposed to how the game works.
 *
 * These are the things that are true of the person playing rather than of the
 * world he is playing in, so they are held apart from the career, survive
 * quitting to the menu and starting a new game, and belong to the browser
 * rather than to any save.
 *
 * Nothing here needs a career to exist, so the settings are also reachable
 * before one is started.
 */

export type MotionPreference = 'system' | 'reduced' | 'full';

/**
 * How the match is drawn.
 *
 * `2d` is the pitch the game has always had. `3d` is reserved: the selector can
 * name it, and a future renderer can be built to satisfy it, but choosing it
 * today simply falls back to the 2D renderer. The choice is a preference, not a
 * match control, because it describes how the manager likes to watch rather than
 * anything about the match being watched — so it is remembered across careers
 * and, crucially, switching it never touches the simulation.
 */
export type RendererPreference = '2d' | '3d';

/**
 * Which way the lights are on.
 *
 * The game was drawn for one, and it is the near-black one: a grassroots
 * ground under floodlights, printed rather than painted. Light mode is the same
 * building with the lights on, and it is offered rather than assumed — the
 * default is deliberately still `dark`, because the boot placeholder, the
 * manifest's theme colour and every screenshot of this game are near-black, and
 * a manager whose computer happens to be in light mode should not open a game
 * that looks like a different product. `system` is there for the manager who
 * wants the two to agree.
 */
export type ThemePreference = 'system' | 'dark' | 'light';

/**
 * The speeds a match can be watched at, as multiples of real time.
 *
 * `1x` is the pace a match is actually watched at: one second of football on
 * screen for one second on the clock, so a player's legs move at the speed the
 * simulation gives them and a pass is struck at the speed a pass is struck.
 * Everything above it compresses the same minute into less real time; nothing
 * here changes the football.
 */
export const MATCH_SPEEDS = [1, 2, 4, 8] as const;

/** What each speed is called on the controls. */
export const MATCH_SPEED_LABEL: Record<number, string> = {
  1: 'Normal',
  2: 'Quick',
  4: 'Fast',
  8: 'Very fast',
};

export interface Preferences {
  /** Reduced motion: follow the system, or be told either way. */
  motion: MotionPreference;
  /** Which way the lights are on: follow the system, or be told either way. */
  theme: ThemePreference;
  /** The speed a match opens at. Changing it mid-match is a match control. */
  defaultMatchSpeed: number;
  /** Which renderer draws the match. Presentation only; never the football. */
  renderer: RendererPreference;
}

export const DEFAULT_PREFERENCES: Preferences = {
  motion: 'system',
  theme: 'dark',
  defaultMatchSpeed: 1,
  renderer: '2d',
};

/**
 * The colour a browser paints its own chrome with, per theme.
 *
 * Read by `applyTheme` into the page's `theme-color`, so a phone's status bar
 * is the colour of the page under it rather than a black band above a light
 * one. These two are the `--bg` of each palette in the stylesheet, which a test
 * in `src/ui/theme.test.ts` holds to it — the one place the same colour is
 * written down twice, and only because the browser's chrome is outside the
 * document that could have told it.
 */
export const THEME_COLOUR: Record<'dark' | 'light', string> = {
  dark: '#08090b',
  light: '#e2e5e9',
};

const KEY = 'slfm26.preferences';
/** The attribute the stylesheet reads, so CSS never has to ask JavaScript. */
const MOTION_ATTRIBUTE = 'data-motion';
/** The same arrangement for the lights, on the same element, for the same reason. */
const THEME_ATTRIBUTE = 'data-theme';

/** The system's own answer about the lights, asked the same way motion asks it. */
function systemPrefersLight(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)').matches
    : false;
}

function store(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** The nearest allowed speed, so a hand-edited value cannot break a match. */
export function clampSpeed(speed: unknown): number {
  const value = typeof speed === 'number' ? speed : Number(speed);
  if (!Number.isFinite(value)) return DEFAULT_PREFERENCES.defaultMatchSpeed;
  if (MATCH_SPEEDS.includes(value as (typeof MATCH_SPEEDS)[number])) return value;
  return MATCH_SPEEDS.reduce((best, option) => (Math.abs(option - value) < Math.abs(best - value) ? option : best), 1);
}

function clean(raw: unknown): Preferences {
  const candidate = (raw ?? {}) as Partial<Preferences>;
  const motion: MotionPreference =
    candidate.motion === 'reduced' || candidate.motion === 'full' || candidate.motion === 'system'
      ? candidate.motion
      : DEFAULT_PREFERENCES.motion;
  // A renderer that does not exist is replaced by the one that does, so a
  // hand-edited "3d" on a build with no 3D renderer still watches a match.
  const renderer: RendererPreference =
    candidate.renderer === '3d' || candidate.renderer === '2d' ? candidate.renderer : DEFAULT_PREFERENCES.renderer;
  const theme: ThemePreference =
    candidate.theme === 'light' || candidate.theme === 'dark' || candidate.theme === 'system'
      ? candidate.theme
      : DEFAULT_PREFERENCES.theme;
  return {
    motion,
    theme,
    defaultMatchSpeed: clampSpeed(candidate.defaultMatchSpeed ?? DEFAULT_PREFERENCES.defaultMatchSpeed),
    renderer,
  };
}

/**
 * Read the settings, and never fail because of them.
 *
 * A game that will not open because a preference is corrupt is a worse game
 * than one that opens with its defaults, so anything unreadable is replaced
 * rather than reported.
 */
export function loadPreferences(): Preferences {
  const backing = store();
  if (!backing) return { ...DEFAULT_PREFERENCES };
  try {
    const raw = backing.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    return clean(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences: Preferences): boolean {
  const backing = store();
  if (!backing) return false;
  try {
    backing.setItem(KEY, JSON.stringify(clean(preferences)));
    return true;
  } catch {
    return false;
  }
}

/**
 * What the page should actually do, given the setting and the system.
 *
 * The manager's own preference wins in both directions: somebody who asks for
 * reduced motion gets it on a machine that never asked for it, and somebody who
 * asks for full motion gets it on a machine that did.
 */
export function resolveMotion(preference: MotionPreference, systemPrefersReduced: boolean): 'reduced' | 'full' {
  if (preference === 'reduced') return 'reduced';
  if (preference === 'full') return 'full';
  return systemPrefersReduced ? 'reduced' : 'full';
}

/** Put that decision where the stylesheet can read it. */
export function applyMotion(preference: MotionPreference = loadPreferences().motion): 'reduced' | 'full' {
  const prefersReduced =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  const resolved = resolveMotion(preference, prefersReduced);
  if (typeof document !== 'undefined') document.documentElement.setAttribute(MOTION_ATTRIBUTE, resolved);
  return resolved;
}

/** Which way the page is currently set, as the stylesheet sees it. */
export function currentMotion(): 'reduced' | 'full' {
  if (typeof document === 'undefined') return 'full';
  return document.documentElement.getAttribute(MOTION_ATTRIBUTE) === 'reduced' ? 'reduced' : 'full';
}

// ---------------------------------------------------------------------------
// The lights
//
// The same arrangement as motion, for the same reason: the stylesheet decides
// the whole palette from one attribute on the page, so CSS never has to ask
// JavaScript what the manager chose, and there is no second copy of the
// palette living in a script. What is decided here is which way the lights are
// on, not what the lights are.
// ---------------------------------------------------------------------------

/**
 * What the page should actually be, given the setting and the system.
 *
 * The manager's own choice wins in both directions, exactly as it does for
 * motion: somebody who asks for light gets light on a machine that never asked
 * for it, and somebody who asks for dark gets dark on a machine that did.
 */
export function resolveTheme(preference: ThemePreference, systemIsLight: boolean): 'dark' | 'light' {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return systemIsLight ? 'light' : 'dark';
}

/**
 * Put that decision where the stylesheet can read it, and where a browser's own
 * chrome can too.
 *
 * The attribute holds what the page *is* rather than what was asked for —
 * `light` or `dark`, never `system` — so the stylesheet has one comparison to
 * make and cannot be handed a value no palette answers to.
 */
export function applyTheme(preference: ThemePreference = loadPreferences().theme): 'dark' | 'light' {
  const resolved = resolveTheme(preference, systemPrefersLight());
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, resolved);
    // The browser paints the status bar and the tab with this, and it is the
    // one part of the window the stylesheet cannot reach: a black bar above a
    // light page is the light theme's own bright seam.
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', THEME_COLOUR[resolved]);
  }
  return resolved;
}

/** Which way the page is currently lit, as the stylesheet sees it. */
export function currentTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute(THEME_ATTRIBUTE) === 'light' ? 'light' : 'dark';
}

// ---------------------------------------------------------------------------
// Fullscreen
//
// Not a preference in the same sense — it is a state of the window, and the
// browser owns it. What is remembered is that the manager asked for it, in the
// sense that the toggle reflects the truth rather than assuming it.
// ---------------------------------------------------------------------------

export function fullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const element = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  return typeof document.exitFullscreen === 'function' && (typeof element.requestFullscreen === 'function' || typeof element.webkitRequestFullscreen === 'function');
}

export function isFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null);
}

export async function setFullscreen(wanted: boolean): Promise<boolean> {
  if (!fullscreenSupported()) return false;
  try {
    if (wanted && !isFullscreen()) {
      const element = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
      if (typeof element.requestFullscreen === 'function') await element.requestFullscreen();
      else await element.webkitRequestFullscreen?.();
    } else if (!wanted && isFullscreen()) {
      await document.exitFullscreen();
    }
    return isFullscreen();
  } catch {
    // A browser can refuse, and a game is not worth arguing with one about it.
    return isFullscreen();
  }
}

/** Told when the window enters or leaves fullscreen by any route, Escape included. */
export function watchFullscreen(handler: (fullscreen: boolean) => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const listener = () => handler(isFullscreen());
  document.addEventListener('fullscreenchange', listener);
  document.addEventListener('webkitfullscreenchange', listener);
  return () => {
    document.removeEventListener('fullscreenchange', listener);
    document.removeEventListener('webkitfullscreenchange', listener);
  };
}
