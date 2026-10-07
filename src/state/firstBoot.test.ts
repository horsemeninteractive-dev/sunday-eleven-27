import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasSeenFirstBoot, markFirstBootSeen, shouldShowFirstBoot } from './firstBoot';

/**
 * The first-boot flag.
 *
 * It has exactly two jobs: to stop the Touchline startup sequence appearing a
 * second time, and to never be the reason the game does not open. So what is
 * checked here is that it remembers, that it starts out saying "not yet", and
 * that a browser which refuses to remember — or has no storage at all — is
 * simply a browser that will see the sequence again.
 */

function installStorage(seed?: string): Map<string, string> {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set('slfm26.firstBoot', seed);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, String(value)),
    removeItem: (key: string) => map.delete(key),
  });
  return map;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('first boot', () => {
  it('says the sequence has not been seen on a browser that has never run it', () => {
    installStorage();
    expect(hasSeenFirstBoot()).toBe(false);
  });

  it('remembers that it has been seen, and says so next time', () => {
    installStorage();
    markFirstBootSeen();
    expect(hasSeenFirstBoot()).toBe(true);
  });

  it('writes its own key, and does not touch the preferences', () => {
    const map = installStorage();
    markFirstBootSeen();
    expect([...map.keys()]).toEqual(['slfm26.firstBoot']);
  });

  it('reads anything that is not its own value as not seen yet', () => {
    // An older build, a hand-edited key, half a write: all of them mean the
    // sequence has not been shown, which is the answer that costs an animation
    // rather than one that hides it.
    installStorage('null');
    expect(hasSeenFirstBoot()).toBe(false);
    installStorage(JSON.stringify({ seen: true }));
    expect(hasSeenFirstBoot()).toBe(false);
    installStorage('1');
    expect(hasSeenFirstBoot()).toBe(true);
  });

  it('opens as a first boot when there is no storage to ask', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(hasSeenFirstBoot()).toBe(false);
    expect(() => markFirstBootSeen()).not.toThrow();
  });

  it('survives a browser that refuses to write', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => markFirstBootSeen()).not.toThrow();
    expect(hasSeenFirstBoot()).toBe(false);
  });
});

/**
 * The routing this feature turns on: who gets introduced to Touchline, and who
 * goes straight to the menu.
 *
 * The four cases below are the four ways into the game, and each of them has a
 * different right answer — which is the reason this is a function with a test
 * rather than a condition buried in a screen.
 */
describe('who gets the first boot', () => {
  it('introduces Touchline to a browser that has nothing saved and has never seen it', () => {
    expect(shouldShowFirstBoot({ seen: false, hasSaves: false, atMenu: true })).toBe(true);
  });

  it('never shows it twice, however it was dismissed the first time', () => {
    expect(shouldShowFirstBoot({ seen: true, hasSaves: false, atMenu: true })).toBe(false);
  });

  it('leaves a manager with a season on disk alone', () => {
    // Quitting to the menu clears the resume mark and keeps the career. The save
    // list is what tells the two apart, so it is the list that decides this.
    expect(shouldShowFirstBoot({ seen: false, hasSaves: true, atMenu: true })).toBe(false);
  });

  it('stays out of the way of a setup already under way', () => {
    // The profile step and the club designer are reached from the menu, and a
    // manager in the middle of either is not at the beginning of anything.
    expect(shouldShowFirstBoot({ seen: false, hasSaves: false, atMenu: false })).toBe(false);
  });

  it('says no on every other combination of the three', () => {
    const answers = [true, false].flatMap((seen) =>
      [true, false].flatMap((hasSaves) =>
        [true, false].map((atMenu) => shouldShowFirstBoot({ seen, hasSaves, atMenu })),
      ),
    );
    // Exactly one of the eight combinations is a first boot.
    expect(answers.filter(Boolean)).toHaveLength(1);
  });
});
