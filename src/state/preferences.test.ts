import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyMotion,
  clampSpeed,
  currentMotion,
  DEFAULT_PREFERENCES,
  loadPreferences,
  resolveMotion,
  savePreferences,
} from './preferences';

/**
 * Settings.
 *
 * They belong to the person playing rather than to the career, so they have to
 * outlive a save, survive a hostile value wedged into browser storage, and mean
 * what they say: a manager who asks for reduced motion gets reduced motion even
 * on a machine that never asked for it, and one who asks for full motion gets
 * full motion even on a machine that did.
 */

function installStorage(seed?: string): void {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set('slfm26.preferences', seed);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, String(value)),
    removeItem: (key: string) => map.delete(key),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('preferences', () => {
  it('starts from the defaults when nothing has been chosen', () => {
    installStorage();
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    expect(loadPreferences().defaultMatchSpeed).toBe(1);
  });

  it('remembers what was chosen, and gives it back next time', () => {
    installStorage();
    savePreferences({ motion: 'reduced', defaultMatchSpeed: 4 });
    expect(loadPreferences()).toEqual({ motion: 'reduced', defaultMatchSpeed: 4 });
  });

  it('opens with the defaults rather than failing on rubbish', () => {
    installStorage('{ not json at all');
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    installStorage(JSON.stringify({ motion: 'sideways', defaultMatchSpeed: 37 }));
    const recovered = loadPreferences();
    expect(recovered.motion).toBe('system');
    // 37 is not a speed the match runs at, so it becomes the nearest one.
    expect(recovered.defaultMatchSpeed).toBe(4);
  });

  it('takes a speed only from the speeds a match is actually watched at', () => {
    expect(clampSpeed(1)).toBe(1);
    expect(clampSpeed(2)).toBe(2);
    expect(clampSpeed(4)).toBe(4);
    // 3 is exactly between 2x and 4x, and the slower of the two is the safer guess.
    expect(clampSpeed(3)).toBe(2);
    expect(clampSpeed(3.5)).toBe(4);
    expect(clampSpeed(0)).toBe(1);
    expect(clampSpeed('nonsense')).toBe(1);
    expect(clampSpeed(undefined)).toBe(1);
  });

  it('lets the manager overrule the system in either direction', () => {
    // Asked for reduced motion: reduced, whether or not the system agrees.
    expect(resolveMotion('reduced', false)).toBe('reduced');
    expect(resolveMotion('reduced', true)).toBe('reduced');
    // Asked for full motion: the system does not get to insist.
    expect(resolveMotion('full', true)).toBe('full');
    expect(resolveMotion('full', false)).toBe('full');
    // Following the system means following the system.
    expect(resolveMotion('system', true)).toBe('reduced');
    expect(resolveMotion('system', false)).toBe('full');
  });

  it('writes the decision where the stylesheet reads it', () => {
    installStorage();
    const attributes = new Map<string, string>();
    vi.stubGlobal('document', {
      documentElement: {
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        getAttribute: (name: string) => attributes.get(name) ?? null,
      },
    });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });

    expect(applyMotion('reduced')).toBe('reduced');
    expect(document.documentElement.getAttribute('data-motion')).toBe('reduced');
    expect(currentMotion()).toBe('reduced');

    expect(applyMotion('full')).toBe('full');
    expect(currentMotion()).toBe('full');
  });
});
