import { describe, expect, it, vi } from 'vitest';

/**
 * The phone's bars, from the outside.
 *
 * The bug this guards against was invisible in a browser and obvious on a
 * phone: the shell's own setting is a single answer for the whole life of the
 * application, chosen for the game's near-black — so the moment a manager turned
 * the lights on, the clock and the back gesture were white on a white bar. What
 * is tested here is that the one function that knows which way the lights ended
 * up tells the shell, and tells it the *other* answer for the light theme.
 *
 * The shell is mocked rather than driven, for the reason `desktop.test.ts` gives:
 * there is no Android bridge in a test, and what is worth checking is the request
 * the game makes, not the platform's response to it.
 */
const shell = vi.hoisted(() => ({ native: true, setStyle: vi.fn() }));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => shell.native },
  SystemBars: { setStyle: (options: unknown) => shell.setStyle(options) },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT', Default: 'DEFAULT' },
}));

const { applySystemBars, systemBarStyleFor } = await import('./systemBars');

describe('the style that belongs to a theme', () => {
  it('is named for the background the icons sit on, not for the icons', () => {
    // `Dark` is light content on a dark bar — the game's own near-black — and
    // `Light` is dark content on a light one. Reading these the other way round
    // is the whole defect: white icons on the light theme's page.
    expect(systemBarStyleFor('dark')).toBe('DARK');
    expect(systemBarStyleFor('light')).toBe('LIGHT');
  });
});

describe('telling the shell which way the lights are on', () => {
  it('sets both bars, to the answer the theme asks for', async () => {
    shell.native = true;
    shell.setStyle.mockReset();
    shell.setStyle.mockResolvedValue(undefined);

    await applySystemBars('light');
    expect(shell.setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' });

    await applySystemBars('dark');
    expect(shell.setStyle).toHaveBeenLastCalledWith({ style: 'DARK' });

    // No bar is named, which is exactly how the shell is told "both of you": the
    // game is drawn under the status bar and the gesture bar alike, so a light
    // theme with one set of readable icons is not a light theme.
    expect(shell.setStyle).toHaveBeenCalledTimes(2);
    expect(shell.setStyle.mock.calls.every(([options]) => !('bar' in (options as object)))).toBe(true);
  });

  it('asks a browser for nothing at all', async () => {
    shell.native = false;
    shell.setStyle.mockReset();

    await applySystemBars('light');

    // The website keeps behaving exactly as it did: the icons are not the
    // game's to colour there, and the call would only reach the web shim.
    expect(shell.setStyle).not.toHaveBeenCalled();
    shell.native = true;
  });

  it('keeps the game running when the shell will not answer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    shell.setStyle.mockReset();
    shell.setStyle.mockRejectedValueOnce(new Error('the shell is not having it'));

    // A theme is not worth an unhandled rejection: the worst case is the bars
    // keeping the colour they already had.
    await expect(applySystemBars('light')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/system bars could not be restyled/), expect.anything());
    warn.mockRestore();
  });
});
