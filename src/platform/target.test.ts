import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTarget, isDesktopBuild, isMobileBuild, isWebBuild } from './target';

/**
 * Which packaged shape of the game is running.
 *
 * The flag decides nothing about the football, which is why the only thing worth
 * testing is that it cannot invent a shape: a build that declares nothing, or
 * declares something nobody recognises, has to behave as the browser build that
 * already ships. A packaging step that forgets to set the variable must not be
 * able to change how the game behaves.
 */

afterEach(() => {
  // Every test here stubs an environment variable, and a leaked one would decide
  // the answer for whichever test ran next.
  vi.unstubAllEnvs();
});

describe('the declared build target', () => {
  it('reads a declared target, and answers about it', () => {
    vi.stubEnv('VITE_BUILD_TARGET', 'desktop');

    expect(buildTarget()).toBe('desktop');
    expect(isDesktopBuild()).toBe(true);
    expect(isWebBuild()).toBe(false);
    expect(isMobileBuild()).toBe(false);
  });

  it('reads a declared mobile target however it was spelled', () => {
    // The value arrives from a build script, so it arrives with whatever
    // whitespace and case that script happens to have used.
    vi.stubEnv('VITE_BUILD_TARGET', '  MOBILE ');

    expect(buildTarget()).toBe('mobile');
    expect(isMobileBuild()).toBe(true);
    expect(isDesktopBuild()).toBe(false);
  });

  it('falls back to the browser build rather than leaking an unknown value', () => {
    vi.stubEnv('VITE_BUILD_TARGET', 'ps2');

    expect(buildTarget()).toBe('web');
    expect(isWebBuild()).toBe(true);
  });

  it('is the browser build when the build declared nothing at all', () => {
    vi.stubEnv('VITE_BUILD_TARGET', '');
    expect(buildTarget()).toBe('web');

    vi.stubEnv('VITE_BUILD_TARGET', '   ');
    expect(buildTarget()).toBe('web');
  });
});
