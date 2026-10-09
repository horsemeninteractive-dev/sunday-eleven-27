import { describe, expect, it } from 'vitest';
import preloadSource from '../../desktop/preload.ts?raw';
import mainSource from '../../desktop/main.ts?raw';
import steamSource from '../../desktop/steam.ts?raw';
import {
  CLOUD_CAREER_PREFIX,
  CLOUD_CLOCK_SKEW_MS,
  HANDHELD_DISPLAY,
  PROPOSED_ACHIEVEMENTS,
  achievementKnown,
  achievementNameValid,
  isSteamAppId,
  isSyncedCareerFile,
  resolveCloudConflict,
  steamLaunchAppId,
  windowFitsHandheld,
} from '../../desktop/steamRules';
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '../../desktop/rules';

/**
 * The Steam seam, held to account where it lives.
 *
 * Two halves, and they are different kinds of test on purpose. The first half is
 * `steamRules.ts` — the launch detection, the achievement catalogue and the Steam
 * Cloud conflict policy — which is pure and is tested by calling it. The second
 * half is the *shape* of the adapter that is not testable here at all: there is no
 * Steam client and no native addon on this machine, so what can be checked is that
 * the code that would use them is written so that their absence is harmless. Those
 * are read out of the source, the same way `desktopPackaging.test.ts` reads the
 * packaging configuration, because a promise about "fails gracefully" is exactly
 * the kind of promise that is otherwise only kept by the author remembering it.
 */

describe('whether this build was launched by Steam', () => {
  it('reads the id the client sets on the processes it launches', () => {
    expect(steamLaunchAppId({ steamGameId: '1234560' })).toBe('1234560');
    expect(steamLaunchAppId({ steamAppId: '1234560' })).toBe('1234560');
  });

  it('prefers the client that launched the game to a dev file beside it', () => {
    // A `steam_appid.txt` left over from an afternoon of testing must not
    // overrule the client that actually started the game.
    expect(steamLaunchAppId({ steamGameId: '1234560', appIdFile: '999' })).toBe('1234560');
  });

  it('falls back to the dev file, and trims what it holds', () => {
    expect(steamLaunchAppId({ appIdFile: '480\n' })).toBe('480');
    expect(steamLaunchAppId({ appIdFile: '  480  ' })).toBe('480');
  });

  it('says no when nothing says Steam', () => {
    expect(steamLaunchAppId({})).toBeNull();
    expect(steamLaunchAppId({ steamGameId: '', steamAppId: null, appIdFile: null })).toBeNull();
    // A value that is not an id is not one to hand the SDK.
    expect(isSteamAppId('not-an-id')).toBe(false);
    expect(isSteamAppId('12 34')).toBe(false);
    expect(isSteamAppId('-1')).toBe(false);
    expect(steamLaunchAppId({ steamGameId: 'steam' })).toBeNull();
  });
});

describe('the achievements this game could honestly have', () => {
  it('is a short list, and every name is one Steamworks would accept', () => {
    // The task is explicit that a catalogue invented to fill a checklist is
    // worse than none, so the size is asserted rather than hoped for.
    expect(PROPOSED_ACHIEVEMENTS.length).toBeGreaterThan(0);
    expect(PROPOSED_ACHIEVEMENTS.length).toBeLessThanOrEqual(8);
    for (const achievement of PROPOSED_ACHIEVEMENTS) {
      expect(achievementNameValid(achievement.apiName), achievement.apiName).toBe(true);
      // Every one reads state the simulation already keeps.
      expect(achievement.source.length, achievement.apiName).toBeGreaterThan(0);
      expect(achievement.title.length, achievement.apiName).toBeGreaterThan(0);
    }
  });

  it('has no two achievements with the same name', () => {
    const names = PROPOSED_ACHIEVEMENTS.map((achievement) => achievement.apiName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('refuses a name that is not in the catalogue, whatever it looks like', () => {
    for (const achievement of PROPOSED_ACHIEVEMENTS) {
      expect(achievementKnown(achievement.apiName)).toBe(true);
    }
    // The gate that matters: a name that got here by a bug, or from something
    // that is not the game, is refused rather than sent to Steamworks.
    expect(achievementKnown('NOT_AN_ACHIEVEMENT')).toBe(false);
    expect(achievementKnown('')).toBe(false);
    expect(achievementKnown('first_match')).toBe(false);
    expect(achievementKnown('FIRST MATCH')).toBe(false);
    expect(achievementKnown('A'.repeat(65))).toBe(false);
  });
});

describe('what Steam Cloud is asked to carry', () => {
  it('carries careers, and names them the way the game does', () => {
    expect(CLOUD_CAREER_PREFIX).toBe('sunday-eleven-27-career');
    expect(isSyncedCareerFile('sunday-eleven-27-career-bramford-rovers-2026-10-09.json')).toBe(true);
  });

  it('carries nothing else the application writes', () => {
    // The cloud root is the careers folder, and this is the rule that keeps it
    // from becoming a bucket of everything: window state, logs and the shell's
    // own files are not careers.
    for (const name of [
      'window-state.json',
      'career.json',
      'notes.txt',
      'sunday-eleven-27-career-bramford.json.part',
      'sunday-eleven-27-career-bramford.json.bak',
      '',
    ]) {
      expect(isSyncedCareerFile(name), name).toBe(false);
    }
  });

  it('refuses a name that could mean somewhere else, or a hidden file', () => {
    for (const name of [
      '../../sunday-eleven-27-career-x.json',
      'C:\\Users\\alex\\sunday-eleven-27-career-x.json',
      'sub/sunday-eleven-27-career-x.json',
      '.sunday-eleven-27-career-x.json',
    ]) {
      expect(isSyncedCareerFile(name), name).toBe(false);
    }
  });
});

describe('which of two copies of a career to keep', () => {
  const older = { savedAt: '2026-10-01T10:00:00.000Z', version: 16 };
  const newer = { savedAt: '2026-10-09T10:00:00.000Z', version: 16 };

  it('takes the only copy there is, and backs nothing up', () => {
    expect(resolveCloudConflict(null, null)).toEqual({ action: 'keep-local', backup: false });
    expect(resolveCloudConflict(older, null)).toEqual({ action: 'upload-local', backup: false });
    expect(resolveCloudConflict(null, older)).toEqual({ action: 'take-remote', backup: false });
  });

  it('sends the newer copy, and only ever in that direction', () => {
    // The rule the whole feature turns on: a stale local autosave must never
    // overwrite a newer career that is already in the cloud.
    expect(resolveCloudConflict(newer, older)).toEqual({ action: 'upload-local', backup: true });
    expect(resolveCloudConflict(older, newer)).toEqual({ action: 'take-remote', backup: true });
  });

  it('backs up the copy it is about to replace, on every branch that replaces one', () => {
    expect(resolveCloudConflict(newer, older).backup).toBe(true);
    expect(resolveCloudConflict(older, newer).backup).toBe(true);
    // Nothing replaced, nothing to recover from.
    expect(resolveCloudConflict(newer, newer).backup).toBe(false);
  });

  it('does not order two copies on a clock difference that means nothing', () => {
    // Two machines do not share a clock, and Steam Cloud copies files rather
    // than ordering events. Inside the window the two are indistinguishable, and
    // the answer that never eats a season is to change nothing.
    const a = { savedAt: '2026-10-09T10:00:00.000Z', version: 16 };
    const b = { savedAt: '2026-10-09T10:00:30.000Z', version: 16 };
    expect(resolveCloudConflict(a, b)).toEqual({ action: 'keep-local', backup: false });
    expect(resolveCloudConflict(b, a)).toEqual({ action: 'keep-local', backup: false });
    expect(CLOUD_CLOCK_SKEW_MS).toBeGreaterThan(1000);
  });

  it('changes nothing when a timestamp cannot be read', () => {
    // A file that does not say when it was written has told us nothing about
    // which copy is newer, and guessing here is the worst thing this could do.
    const unreadable = { savedAt: 'not a date', version: 16 };
    expect(resolveCloudConflict(unreadable, older)).toEqual({ action: 'keep-local', backup: false });
    expect(resolveCloudConflict(older, unreadable)).toEqual({ action: 'keep-local', backup: false });
    expect(resolveCloudConflict(unreadable, unreadable)).toEqual({ action: 'keep-local', backup: false });
  });
});

describe('what can be said about a handheld screen', () => {
  it('fits the game\'s own smallest window inside a Steam Deck', () => {
    // A resolution fact and nothing more: the floor the game will ever present at
    // is inside the Deck's 1280 × 800. Touch targets, legibility, the on-screen
    // keyboard, the controller and the overlay are all unverified, and no
    // `Steam Deck Verified` claim is made anywhere.
    expect(windowFitsHandheld(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)).toBe(true);
    expect(HANDHELD_DISPLAY).toEqual({ width: 1280, height: 800 });
  });

  it('says no to a window that would not fit', () => {
    expect(windowFitsHandheld(1920, 1080)).toBe(false);
    expect(windowFitsHandheld(1280, 900)).toBe(false);
  });
});

/**
 * A source file with its comments taken out.
 *
 * The assertions below are about what the code *does*, and this file's comments
 * deliberate on what it does not do — "no workshop, no cloud API" — so a check
 * for the absence of those words has to be a check on the code and not on the
 * prose that explains the code.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the adapter that cannot be run here', () => {
  it('never imports the addon statically, so a machine without it still builds and starts', () => {
    // `steamworks.js` is deliberately not a dependency: a static import of a
    // package that is not installed is a compile error, and a compile error here
    // is a shell that will not build at all.
    expect(steamSource).not.toMatch(/from\s+'steamworks\.js'/);
    expect(steamSource).not.toMatch(/^\s*import\s+[^;]*steamworks\.js/m);
    // It is loaded as a value, through `module.require`, inside a guard.
    expect(steamSource).toMatch(/module\.require\('steamworks\.js'\)/);
  });

  it('guards every call into the native addon', () => {
    // The require, the overlay hook, the init, the persona name, the achievement
    // and the shutdown are six independent ways a native dependency can fail, and
    // none of them may reach the manager as an exception.
    const guards = steamSource.match(/\btry\s*\{/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(5);
    expect(steamSource).toMatch(/catch\s*\{/);
  });

  it('offers two calls and no way to reach Steamworks generally', () => {
    // No arbitrary API surface, no cloud API, no workshop, no overlay control:
    // the smaller the seam, the stronger the claim that a failure in it cannot
    // corrupt a career.
    const code = withoutComments(steamSource);
    expect(code).toMatch(/unlockAchievement\(apiName: string\): boolean/);
    expect(code).toMatch(/shutdown\(\): void/);
    expect(code).not.toMatch(/workshop/i);
    expect(code).not.toMatch(/remoteStorage|ISteamRemoteStorage/i);
  });

  it('is started by the shell before the window exists, and never waited on', () => {
    // The overlay is a library loaded into the process and attaches to a window
    // it has to be loaded ahead of; and `startSteam` returning a status rather
    // than a promise is what makes "Steam can never block startup" structural
    // rather than a promise.
    const started = mainSource.indexOf('startSteam(');
    const ready = mainSource.indexOf('app.whenReady()');
    expect(started).toBeGreaterThan(-1);
    expect(ready).toBeGreaterThan(-1);
    expect(started).toBeLessThan(ready);
    expect(mainSource).not.toMatch(/await\s+startSteam/);
    // And handed back on the way out, so the client can settle its own state.
    expect(mainSource).toMatch(/app\.on\('will-quit', \(\) => steam\.shutdown\(\)\)/);
  });

  it('carries no application id of its own', () => {
    // The id belongs to the Steamworks app record and to the client that launched
    // the game; one invented in the source would be worse than none, because it
    // would attach to whatever app happened to own that number.
    expect(mainSource).not.toMatch(/appId\s*:\s*['"]?\d/);
    expect(mainSource).toMatch(/steam_appid\.txt/);
  });

  it('is not reachable from the game', () => {
    // Steam is a desktop-only seam behind the shell's main process. The renderer
    // has the same three bridge members it had before, and nothing about Steam
    // crosses to it.
    expect(preloadSource).not.toMatch(/steam/i);
  });
});
