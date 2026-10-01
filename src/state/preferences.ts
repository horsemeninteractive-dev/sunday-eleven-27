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

/** The speeds a match can be watched at, in minutes of football per second. */
export const MATCH_SPEEDS = [1, 2, 4] as const;

export interface Preferences {
  /** Reduced motion: follow the system, or be told either way. */
  motion: MotionPreference;
  /** The speed a match opens at. Changing it mid-match is a match control. */
  defaultMatchSpeed: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  motion: 'system',
  defaultMatchSpeed: 1,
};

const KEY = 'slfm26.preferences';
/** The attribute the stylesheet reads, so CSS never has to ask JavaScript. */
const MOTION_ATTRIBUTE = 'data-motion';

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
  return { motion, defaultMatchSpeed: clampSpeed(candidate.defaultMatchSpeed ?? DEFAULT_PREFERENCES.defaultMatchSpeed) };
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
