import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';

/**
 * The phone's own bars, told which way the lights are on.
 *
 * Android draws the application *under* its status bar and its gesture bar, so
 * the surface behind them is the game's own page — and the icons on them are the
 * one part of the window the stylesheet cannot reach. The shell can be told, but
 * only from here: the static answer in `capacitor.config.ts` is a single value
 * for the whole life of the application, and it is chosen for the game's own
 * near-black. Turn the lights on and that value is white icons on a white bar:
 * a clock nobody can read and a back gesture nobody can find.
 *
 * So the bars are told again whenever the theme is applied — at startup, when the
 * manager chooses, and when a system he is following changes — from the one
 * function that already knows which way the lights ended up (see `applyTheme` in
 * `state/preferences.ts`).
 *
 * Nothing here runs in a browser or on the desktop: `isNativePlatform()` is the
 * whole gate, so the website keeps behaving exactly as it did, and the icons it
 * does not own are never asked for.
 */

/**
 * The style that belongs to one of the game's palettes.
 *
 * Named for the background the icons sit on rather than for the icons: `Dark` is
 * *light* content on a dark bar, which is the game's own near-black, and `Light`
 * is dark content on a light one, which is what the light theme's page is. The
 * names are the shell's, and they are the wrong way round often enough to be
 * worth saying out loud once.
 */
export function systemBarStyleFor(theme: 'dark' | 'light'): SystemBarsStyle {
  return theme === 'light' ? SystemBarsStyle.Light : SystemBarsStyle.Dark;
}

/**
 * Tell the shell, quietly.
 *
 * Both bars at once — the status bar at the top and the navigation or gesture bar
 * at the foot — because the game's own surface is behind both of them and one
 * theme decides both. A shell that cannot answer is not worth an error: the game
 * is a game, and the worst case is the bars keeping the colour they had.
 */
export async function applySystemBars(theme: 'dark' | 'light'): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await SystemBars.setStyle({ style: systemBarStyleFor(theme) });
  } catch (error) {
    console.warn('The system bars could not be restyled.', error);
  }
}
