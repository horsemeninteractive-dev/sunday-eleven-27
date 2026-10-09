/**
 * The Steam decisions, where they can be read and tested.
 *
 * The same rule as `rules.ts`, for the same reason: everything here is an
 * *answer* rather than a side effect, so it can be held to account in the game's
 * own `vitest` run, on this machine, with no Steam client, no native addon and
 * no window. `steam.ts` is the only thing that acts on these answers, and it is
 * the only file in the shell that knows a Steamworks SDK exists.
 *
 * This module therefore **imports nothing and touches no global**. No `process`,
 * no `fs`, no `require`, no Electron: it is imported by `steam.ts` (compiled by
 * `tsconfig.desktop.json`) *and* by `src/platform/steamRules.test.ts` (checked by
 * the game's own `tsconfig.json`, which has no Node types at all), and it has to
 * be valid under both. One `process.env` read here would take the whole file out
 * of the test suite — so the environment is *handed in* instead.
 *
 * Nothing in this file is written yet for a Steam release that does not exist: the
 * application id comes from the client that launched the game, the achievement
 * catalogue is a *proposal* (see `PROPOSED_ACHIEVEMENTS`), and the Steam Cloud
 * policy is the half of the feature that can be decided and tested before the
 * Steamworks app record exists. See `STEAM.md` for what that leaves out.
 */

/* ------------------------------------------------------------------ *
 * Was this build launched by Steam?
 * ------------------------------------------------------------------ */

/**
 * Whether a string could be a Steam application id.
 *
 * Steam ids are decimal and short. This is deliberately a *shape* test rather
 * than a lookup: the id is only ever used to tell the SDK which app it is
 * running as, and a value that is not a number is not one to hand it.
 */
export function isSteamAppId(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^\d{1,10}$/.test(value.trim());
}

/**
 * What the environment says about Steam, handed in rather than read.
 *
 * `steamGameId` and `steamAppId` are the variables the Steam client sets on the
 * processes it launches (`SteamGameId` and `SteamAppId`). `appIdFile` is the
 * contents of a `steam_appid.txt` beside the executable, which is how a *dev*
 * build works: run from a terminal, with no client involved, the file is what
 * tells the SDK which app record to attach to. A build with none of the three is
 * a build that was not started by Steam, which is the ordinary case for everyone
 * who is not playing through Steam.
 */
export interface SteamLaunchEnvironment {
  readonly steamAppId?: string | null;
  readonly steamGameId?: string | null;
  /** The trimmed contents of `steam_appid.txt`, or null when there is no file. */
  readonly appIdFile?: string | null;
}

/**
 * The application id to hand the SDK, or null when this is not a Steam launch.
 *
 * The order matters. `SteamGameId` is the client's own answer for the game
 * itself and wins over everything; `SteamAppId` is next; the dev file is last,
 * because a file left beside an executable from an afternoon of testing must not
 * be able to overrule the client that actually launched the game.
 */
export function steamLaunchAppId(environment: SteamLaunchEnvironment): string | null {
  for (const candidate of [environment.steamGameId, environment.steamAppId, environment.appIdFile]) {
    if (isSteamAppId(candidate)) return (candidate as string).trim();
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Achievements
 * ------------------------------------------------------------------ */

/**
 * One achievement, proposed.
 *
 * `apiName` is the identifier the game and the Steamworks app record must agree
 * on — it is what `SetAchievement` is called with — and `source` says which piece
 * of the game's own state a trigger would read. The `source` is written down
 * because the trigger is *not implemented*: this stage ships the adapter and the
 * catalogue, and wiring a trigger to a real milestone is a change to the game's
 * own code that needs a playtest rather than a guess.
 *
 * The list is short on purpose. An achievement exists to mark something a
 * manager would tell somebody about, and this game has a handful of those — a
 * first afternoon, a trophy, the ladder — rather than a checklist of fifty.
 */
export interface AchievementDefinition {
  /** The Steamworks API Name. Uppercase, digits and underscores. */
  readonly apiName: string;
  /** What the manager would see, if the app record and the game agree on it. */
  readonly title: string;
  /** The game state a trigger would read. Prose, because nothing reads it yet. */
  readonly source: string;
}

/**
 * The achievements this game could honestly have, and no more.
 *
 * Every one of them reads something the simulation already keeps: a completed
 * fixture, a result, a season that archived its champion, `state.promotionHistory`,
 * and the cup's own `winnerClubId`. None of them needs a new counter or a new
 * event, which is the test an achievement has to pass before it is worth having —
 * an achievement whose trigger had to be invented is a checkbox, not a milestone.
 *
 * **These are not configured in Steamworks and nothing unlocks them.** See
 * `STEAM.md`: the app record does not exist, `unlockAchievement` is the seam they
 * would arrive through, and the triggers are deliberately unwired.
 */
export const PROPOSED_ACHIEVEMENTS: readonly AchievementDefinition[] = [
  {
    apiName: 'FIRST_MATCH',
    title: 'Take Charge',
    source: 'The first fixture played to full time in a career.',
  },
  {
    apiName: 'FIRST_WIN',
    title: 'Three Points',
    source: 'The first competitive win — a league or cup result the manager\'s club won.',
  },
  {
    apiName: 'SEASON_COMPLETE',
    title: 'A Full Season',
    source: 'A season that archived, which is where the champion is crowned.',
  },
  {
    apiName: 'PROMOTED',
    title: 'Up the Ladder',
    source: 'A `promoted` record in `state.promotionHistory` for the manager\'s club.',
  },
  {
    apiName: 'CHAMPIONS',
    title: 'Champions',
    source: 'A league title: the manager\'s club holding the division\'s champion place.',
  },
  {
    apiName: 'CUP_WINNER',
    title: 'A Trophy for the Cabinet',
    source: 'A cup whose `winnerClubId` is the manager\'s club.',
  },
];

/**
 * The shape Steamworks accepts for an achievement API Name.
 *
 * Uppercase letters, digits and underscores, one to sixty-four of them. This is
 * the project's own rule rather than a transcription of Steam's validator: the
 * value is an *identifier* used as a key on both sides, so the constraint that
 * actually matters is that the two sides agree — which is why `achievementKnown`
 * below refuses anything that is not in the catalogue, whatever it looks like.
 */
const ACHIEVEMENT_NAME = /^[A-Z0-9_]{1,64}$/;

/** Whether an identifier is one this project would put in an app record. */
export function achievementNameValid(apiName: string): boolean {
  return typeof apiName === 'string' && ACHIEVEMENT_NAME.test(apiName);
}

/**
 * Whether this catalogue knows the identifier.
 *
 * The real gate on the unlock path. A name that reaches the adapter and is not
 * one of the six above is refused rather than sent, because the only two ways it
 * could have got there are a bug and something that is not the game — and a
 * Steamworks call made with a name the app record has never heard of is an error
 * in a log rather than a missing achievement, which is worse.
 */
export function achievementKnown(apiName: string): boolean {
  return PROPOSED_ACHIEVEMENTS.some((achievement) => achievement.apiName === apiName);
}

/* ------------------------------------------------------------------ *
 * Steam Cloud
 * ------------------------------------------------------------------ */

/**
 * The folder, under whatever root Steam Cloud is configured to carry, that the
 * careers live in.
 *
 * Steam Cloud carries *files and directories*, not a browser database, so this
 * is the whole point of the feature: what syncs is a folder of career files.
 * `STEAM.md` says what has to exist before that folder is the game's canonical
 * save — the careers IndexedDB holds today are not a file and cannot be synced.
 */
export const CLOUD_CAREER_FOLDER = 'careers';

/** The prefix every career file this game writes begins with. */
export const CLOUD_CAREER_PREFIX = 'sunday-eleven-27-career';

/** The extension a career file is read back by. */
export const CLOUD_CAREER_SUFFIX = '.json';

/**
 * Whether a file in the careers folder is one Steam Cloud should carry.
 *
 * Narrow on purpose, and it is the rule that keeps a cloud root from becoming a
 * bucket of everything the application happens to have written. A synced file is
 * a career and nothing else: it carries the prefix the game itself names careers
 * with, it is not hidden, it names a file rather than a path, and it is not the
 * `.part` file a save is written *through* — a half-written career is the one
 * file that must never reach a second machine, because it is exactly what the
 * temporary-name-and-rename in `main.ts` exists to prevent anyone observing.
 */
export function isSyncedCareerFile(name: string): boolean {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed === '' || trimmed.startsWith('.')) return false;
  if (trimmed.includes('/') || trimmed.includes('\\')) return false;
  if (trimmed.includes('..')) return false;
  if (!trimmed.startsWith(CLOUD_CAREER_PREFIX)) return false;
  if (!trimmed.toLowerCase().endsWith(CLOUD_CAREER_SUFFIX)) return false;
  // Redundant with the extension rule, and kept because it names the failure it
  // is about rather than relying on a reader noticing that `.part` is not `.json`.
  if (trimmed.endsWith('.part')) return false;
  return true;
}

/**
 * What a career file says about when it was written.
 *
 * `savedAt` is the ISO timestamp the game's own `exportCareer` writes, and
 * `version` is the save schema the file carries. Both are read from the file's
 * own text by the caller; this module never parses a file.
 */
export interface CareerStamp {
  readonly savedAt: string;
  readonly version: number;
}

/**
 * How far apart two clocks may be before the difference means anything.
 *
 * Two machines' own clocks are not a shared clock, and Steam Cloud copies files
 * rather than ordering events: a laptop with a clock a minute fast would
 * otherwise look like the newer save every single time. Within this window the
 * two copies are treated as *indistinguishable* rather than ordered, which is the
 * answer that never overwrites a career on the strength of a clock.
 */
export const CLOUD_CLOCK_SKEW_MS = 2 * 60 * 1000;

/**
 * What to do about a career that exists on both sides.
 *
 * Three answers, and the asymmetry between them is the point:
 *
 *   - `keep-local` — change nothing. Two copies that are indistinguishable, or a
 *     timestamp that cannot be read, are not evidence that one is newer, and a
 *     sync that guesses is a sync that eats a season.
 *   - `upload-local` — the local copy is newer by more than the clock skew, so it
 *     is the one to keep, and the copy being replaced is backed up first.
 *   - `take-remote` — the remote copy is newer, so it is the one to keep and the
 *     local copy is backed up first.
 *
 * The rule the task actually turns on — *a stale autosave must never overwrite a
 * newer career* — is the first branch: an upload is only ever chosen when the
 * remote copy is missing or provably older, and never when it is newer or when
 * the two cannot be told apart. `backup` is true on every branch that replaces
 * one file with the other, so the other branch's recovery path is a file on the
 * disk rather than a hope.
 */
export type CloudVerdict =
  | { readonly action: 'keep-local'; readonly backup: false }
  | { readonly action: 'upload-local'; readonly backup: boolean }
  | { readonly action: 'take-remote'; readonly backup: boolean };

/** When a stamp says it was written, or null when it does not say. */
function stampTime(stamp: CareerStamp | null): number | null {
  if (!stamp) return null;
  const time = Date.parse(stamp.savedAt);
  return Number.isFinite(time) ? time : null;
}

/**
 * Which of two copies of the same career to keep.
 *
 * Pure, total, and never throws: every combination of present, absent and
 * unreadable is answered, because the caller is deciding whether to overwrite
 * something a manager has played for months.
 */
export function resolveCloudConflict(
  local: CareerStamp | null,
  remote: CareerStamp | null,
  skewMs: number = CLOUD_CLOCK_SKEW_MS,
): CloudVerdict {
  // Nothing on one side: the other is the only copy, so it is the one to keep.
  if (local === null && remote === null) return { action: 'keep-local', backup: false };
  if (remote === null) return { action: 'upload-local', backup: false };
  if (local === null) return { action: 'take-remote', backup: false };

  const localTime = stampTime(local);
  const remoteTime = stampTime(remote);

  // A file whose timestamp cannot be read has told us nothing about which copy is
  // newer, and overwriting either one on that basis is the single worst thing
  // this function could do.
  if (localTime === null || remoteTime === null) return { action: 'keep-local', backup: false };

  const difference = localTime - remoteTime;
  if (difference > skewMs) return { action: 'upload-local', backup: true };
  if (difference < -skewMs) return { action: 'take-remote', backup: true };
  return { action: 'keep-local', backup: false };
}

/* ------------------------------------------------------------------ *
 * Steam Deck, and what can be said about it without a deck
 * ------------------------------------------------------------------ */

/**
 * The Steam Deck's display, and the two that share its resolution.
 *
 * 1280 × 800 is the Deck's own panel and also the size another handheld reports;
 * the point of writing it down is that a claim about handheld comfort has to be
 * measured against it rather than against a desktop monitor.
 */
export const HANDHELD_DISPLAY = { width: 1280, height: 800 } as const;

/**
 * Whether a window of this size fits inside a handheld's screen.
 *
 * This is what can be checked here, and it is deliberately not a claim about
 * comfort. The game's own floor is `MIN_WINDOW_WIDTH` × `MIN_WINDOW_HEIGHT`
 * (1024 × 700, in `rules.ts`), so the minimum the game will ever present is
 * *inside* the Deck's screen — which is a resolution fact and nothing more. Touch
 * targets, legibility at 7 inches, text entry, the on-screen keyboard, the
 * controller and whether the overlay draws are all unverified, and none of them
 * is implied by this return value. No `Steam Deck Verified` claim is made.
 */
export function windowFitsHandheld(width: number, height: number): boolean {
  return width <= HANDHELD_DISPLAY.width && height <= HANDHELD_DISPLAY.height;
}
