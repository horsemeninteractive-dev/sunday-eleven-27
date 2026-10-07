/**
 * Whether this browser has already been introduced to the game.
 *
 * Launching SE27 with no career to open shows a short Touchline startup
 * sequence before the main menu. It is a first impression, so it is worth making
 * once — and, once made, worth never making again, because the second time it is
 * only something standing between the manager and the menu.
 *
 * The answer belongs to the browser rather than to a career: a manager who
 * starts a new game, or who quits one and comes back to the menu, has still seen
 * the sequence, and starting a second career should not replay the introduction
 * to the first. So it lives in `localStorage` beside the manager profiles, in
 * its own key.
 *
 * It is deliberately *not* a `Preferences` field. Nothing here is a choice the
 * manager made, and the settings screen has no business offering to switch it on
 * or off — a preference is a thing he can ask for, and this is a thing that has
 * happened.
 *
 * None of it can stop the game opening. A browser with no storage, a refused
 * write, a value that makes no sense: the worst each of them costs is one extra
 * showing of an animation, never a career and never the menu.
 */

const KEY = 'slfm26.firstBoot';

/** The one value written, and the only one that reads back as "seen". */
const SEEN = '1';

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** True once the startup sequence has been played, skipped or dismissed. */
export function hasSeenFirstBoot(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    return store.getItem(KEY) === SEEN;
  } catch {
    return false;
  }
}

/**
 * Whether the Touchline sequence should take the screen.
 *
 * Three questions, and all three have to answer yes:
 *
 *  - **Has this browser been introduced?** Once is a first impression; twice is
 *    an unskippable advert in front of the menu.
 *  - **Is there anything saved here?** A manager with a season on disk has
 *    already met the game, whether or not anything was reopened for him — he
 *    cleared the resume mark by quitting to the menu, and that is not the same
 *    as never having played.
 *  - **Is the game on the menu?** Reaching the profile step or the club designer
 *    means the menu has been left behind, and nothing should pull him back to
 *    the beginning of a flow he is already in the middle of.
 *
 * Kept as a function rather than as an `if` inside the screen for the same
 * reason the flag is kept out of the preferences: it is the one decision this
 * whole feature turns on, and it is worth being able to read it and test it
 * without a browser.
 */
export function shouldShowFirstBoot(options: {
  /** Whether the sequence has been played, skipped or dismissed before. */
  seen: boolean;
  /** Whether any career is saved in this browser at all. */
  hasSaves: boolean;
  /** Whether the game is sitting on the main menu, rather than mid-setup. */
  atMenu: boolean;
}): boolean {
  return !options.seen && !options.hasSaves && options.atMenu;
}

/**
 * Remember that it has been seen.
 *
 * Written when the sequence ends, whichever way it ends — it running out, the
 * manager skipping it, or Escape — because all three mean the same thing: he has
 * had the introduction and does not want it again.
 */
export function markFirstBootSeen(): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, SEEN);
  } catch {
    // A browser that will not remember costs him the sequence once more, and
    // that is the whole of it. It is never worth refusing to open the menu over.
  }
}
