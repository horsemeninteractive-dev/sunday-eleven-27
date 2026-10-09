/**
 * The Steamworks adapter: the one file in the game that knows Steam exists.
 *
 * It is a desktop-only seam, and it is written to three rules:
 *
 *  - **it never blocks startup.** Nothing here is awaited, nothing here loops,
 *    and every path returns a status object rather than throwing. A machine with
 *    no Steam, no client and no addon gets a game that opens exactly as it does
 *    today; the only difference is a line in the shell's own log.
 *  - **it never takes the game down with it.** Every call into the addon — the
 *    optional require, the init, an achievement, the shutdown — is inside its own
 *    `try`, because a native addon is the one dependency that can fail in ways
 *    JavaScript cannot see: a missing `steam_api64.dll`, a client that is running
 *    but not signed in, a build of the addon for a different Electron.
 *  - **it can be absent without being broken.** `steamworks.js` is deliberately
 *    *not* a dependency of this project (see `STEAM.md`), so the ordinary case on
 *    this machine is "the addon is not installed", and that has to be a status
 *    rather than a stack trace. The `require` below is a value rather than an
 *    import for exactly that reason: a static import of a package that is not
 *    installed is a compile error, and a compile error is a shell that will not
 *    build at all.
 *
 * Everything it does *decide* lives in `steamRules.ts`, which is pure and
 * tested. This file is the part that cannot be: it touches `process.env`, the
 * file system and a native module, which is why it is compiled only by
 * `tsconfig.desktop.json`. No file under `src/` imports it *as a module*: the
 * game's `tsconfig.json` has no Node types, and a module import would drag those
 * globals into the renderer's type-checking. The test reads it as text (`?raw`)
 * instead, to hold the shape of the guards below down.
 */
import { readFileSync } from 'node:fs';
import {
  achievementKnown,
  achievementNameValid,
  steamLaunchAppId,
  type SteamLaunchEnvironment,
} from './steamRules';

/**
 * What happened when the shell tried to start Steam.
 *
 * Always produced, on every path, and never an exception. `reason` is for the
 * log rather than for the screen: the manager is never shown a sentence about
 * Steam, because a single-player game does not have one to show him.
 */
export interface SteamStatus {
  readonly available: boolean;
  readonly reason: string;
  /** The app id the client supplied, when there was one. */
  readonly appId: string | null;
  /** The Steam persona name, when there is one. Empty when there is not. */
  readonly player: string | null;
}

/**
 * The whole of what the rest of the shell may ask Steam to do.
 *
 * Deliberately two calls wide. There is no arbitrary "invoke a Steamworks
 * function" here, no cloud read, no workshop, no overlay control and no remote
 * storage: the smaller this surface is, the less there is to get wrong on the
 * far side of a native addon, and the stronger the claim that a failure in it
 * cannot corrupt a career. The cloud half of Steam is not driven from here at
 * all — see `STEAM.md` for why it is a directory of files rather than an API.
 */
export interface SteamAdapter {
  readonly status: SteamStatus;
  /**
   * Unlock one achievement by its Steamworks API Name.
   *
   * Returns whether it was sent, and answers `false` — rather than throwing —
   * for a name that is not in the catalogue in `steamRules.ts`. That check is the
   * reason this method is safe to expose: the only names that can reach the
   * Steamworks call are the six this project has written down.
   *
   * **Nothing calls this yet.** The triggers it would be called from are not
   * wired, on purpose: see `PROPOSED_ACHIEVEMENTS` and `STEAM.md`.
   */
  unlockAchievement(apiName: string): boolean;
  /** Hand Steam back before the process goes. Safe to call more than once. */
  shutdown(): void;
}

export interface SteamOptions {
  /** What the environment says about Steam. Read from `process.env` when absent. */
  readonly environment?: SteamLaunchEnvironment;
  /** The path to a `steam_appid.txt` beside the executable, for a dev build. */
  readonly appIdFile?: string | null;
  /** The shell's own log. Never the manager's screen. */
  readonly log?: (message: string) => void;
}

/* ------------------------------------------------------------------ *
 * The addon, described only as far as this file uses it
 * ------------------------------------------------------------------ */

/* The three members of `steamworks.js` that this adapter touches, and nothing
 * else. Written out rather than imported from the package's own types, because
 * the package is not a dependency: it is not installed here, its types are not
 * available to the compiler, and a version of it that changed one of these names
 * should be a refusal in the log rather than a build that stops. */
interface SteamworksClient {
  readonly achievement?: { activate(name: string): boolean };
  readonly localplayer?: { getName(): string };
  shutdown?: () => void;
}

interface SteamworksModule {
  init(appId?: number): SteamworksClient;
  /** `steamworks.js`'s own hook, which must run before the overlay can attach. */
  electronEnableSteamOverlay?: (disableLegacyMode?: boolean) => void;
}

/**
 * The optional addon, or null when it is not there.
 *
 * `module.require` with the name as a *value*: the compiler is not asked to
 * resolve a package that is not installed, so the shell builds and runs on a
 * machine that has never heard of Steam. A thrown error — no package, a package
 * whose native binary was built for another Electron, a missing Steam client —
 * is the answer "no addon", which is a game that opens.
 */
function loadAddon(): SteamworksModule | null {
  try {
    return module.require('steamworks.js') as SteamworksModule;
  } catch {
    return null;
  }
}

/** A file's contents, or null — no file, an unreadable one, and a directory all alike. */
function readAppIdFile(path: string | null | undefined): string | null {
  if (typeof path !== 'string' || path === '') return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The adapter for every path that did not reach Steam. */
function unavailable(reason: string, appId: string | null): SteamAdapter {
  return {
    status: { available: false, reason, appId, player: null },
    unlockAchievement: () => false,
    shutdown: () => undefined,
  };
}

/* ------------------------------------------------------------------ *
 * Starting it
 * ------------------------------------------------------------------ */

/**
 * Start Steam, if this is a Steam launch, and say what happened.
 *
 * Called once, from the main process, before the window exists — the overlay is
 * a DLL injected into the process, so the earlier it is loaded the more likely
 * it is to attach — and it returns either way. A launch with no Steam on it is
 * not a degraded game: it is the game.
 */
export function startSteam(options: SteamOptions = {}): SteamAdapter {
  const log = options.log ?? ((): void => undefined);

  const appId = steamLaunchAppId({
    ...options.environment,
    appIdFile: readAppIdFile(options.appIdFile),
  });

  const adapter = appId === null ? unavailable('this build was not started by Steam', null) : connect(appId, log);

  if (adapter.status.available) {
    log(`steam: running through Steam as ${adapter.status.player ?? 'an unnamed player'} (app ${adapter.status.appId})`);
  } else {
    log(`steam: not running through Steam — ${adapter.status.reason}`);
  }
  return adapter;
}

/** The paths that actually reach the addon. Nothing here throws. */
function connect(appId: string, log: (message: string) => void): SteamAdapter {
  const addon = loadAddon();
  if (!addon) {
    return unavailable('steamworks.js is not installed in this build', appId);
  }

  // Before `init`, which is what the package's own documentation asks for: the
  // overlay attaches to a window that does not exist yet. A failure here is
  // noted and survived — an overlay that will not draw is not a game that will
  // not run.
  try {
    addon.electronEnableSteamOverlay?.();
  } catch (error) {
    log(`steam: the overlay hook could not be enabled (${message(error)})`);
  }

  let client: SteamworksClient;
  try {
    client = addon.init(Number(appId));
  } catch (error) {
    // The client running, signed out, or not running at all all arrive here.
    return unavailable(`Steam would not start (${message(error)})`, appId);
  }

  let player: string | null = null;
  try {
    player = client.localplayer?.getName() ?? null;
  } catch {
    // A persona name is a nicety; a game that will not start because it could not
    // read one would be a poor trade.
    player = null;
  }

  return {
    status: { available: true, reason: 'running through Steam', appId, player },

    unlockAchievement(apiName: string): boolean {
      if (!achievementNameValid(apiName) || !achievementKnown(apiName)) {
        log(`steam: refused an achievement that is not this game's (${String(apiName)})`);
        return false;
      }
      try {
        if (!client.achievement) return false;
        return client.achievement.activate(apiName) === true;
      } catch (error) {
        log(`steam: the achievement ${apiName} could not be unlocked (${message(error)})`);
        return false;
      }
    },

    shutdown(): void {
      try {
        client.shutdown?.();
      } catch (error) {
        log(`steam: shutting down did not go cleanly (${message(error)})`);
      }
    },
  };
}
