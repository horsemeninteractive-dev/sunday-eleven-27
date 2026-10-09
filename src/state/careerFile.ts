import { GAME_STATE_VERSION, type GameState } from '@/domain/game';
import { VERSION } from '@/version';
import { readSaveFile, type SaveFile } from './persistence';

/**
 * The career file: one career, in a file the manager keeps.
 *
 * What is stored inside a career is `SaveFile` — the same `{ version, savedAt,
 * state }` the database holds — so an exported career is not a second dialect
 * of the game's own save. It is the game's own save, with three fields added
 * that say what it is and who wrote it:
 *
 *     { format: 'se27.career', formatVersion: 1, app: '0.10.1',
 *       version: 16, savedAt: '…', state: { … } }
 *
 * Everything is additive, and that is the point. A file with no marker at all is
 * still a save file — the reader below accepts one, which is what makes a career
 * exported by a build from before this file existed still importable, and what
 * means a career exported today could be dropped into the old localStorage slot
 * format without ceremony. Nothing here changes the game state, its schema or
 * `GAME_STATE_VERSION`: the migrations are the ones the database already runs,
 * through the same reader, so an imported career comes up exactly as a loaded
 * one does.
 *
 * The envelope version is separate from the save version on purpose. One moves
 * when the *file* around a career changes; the other moves when the career's
 * contents do. A build that could read v1 files may well be a build five
 * simulation versions later.
 */

/** The marker that says a file is one of ours. Not the same thing as a save version. */
export const CAREER_FILE_FORMAT = 'se27.career';

/**
 * The version of the file around the career.
 *
 * 1 — a save file, plus `format`, `formatVersion` and `app`.
 *
 * A reader refuses a file whose `formatVersion` it is older than, because a
 * newer writer may have added something the reader would silently ignore and
 * the manager would then be playing a career that is missing part of itself.
 */
export const CAREER_FILE_VERSION = 1;

/** A career on disk, as this game writes it. */
export interface CareerFile extends SaveFile {
  format: typeof CAREER_FILE_FORMAT;
  formatVersion: number;
  /** The build that wrote it. Read by a person, not by code. */
  app: string;
}

/** A career read back from a file, described the way the manager will recognise it. */
export interface ImportedCareer {
  state: GameState;
  clubName: string;
  seasonLabel: string;
  date: string;
  saveName: string;
  seed: string;
  /** The build the file says wrote it, or 'an unknown build'. */
  writtenBy: string;
  /** When the file was written. */
  savedAt: string;
  /** The save version the file carried, before the migrations brought it up. */
  fromVersion: number;
}

/** The longest club name that will be allowed into a file name. */
const NAME_LIMIT = 48;

/**
 * A career as the text of a file.
 *
 * The state is serialised once, here, and the string handed back is what the
 * manager's copy *is*: the caller writes it out (see `saveTransfer`) and does
 * not touch it again.
 */
export function exportCareer(state: GameState, now: Date = new Date()): string {
  const file: CareerFile = {
    format: CAREER_FILE_FORMAT,
    formatVersion: CAREER_FILE_VERSION,
    app: VERSION,
    version: GAME_STATE_VERSION,
    savedAt: now.toISOString(),
    state,
  };
  return JSON.stringify(file);
}

/**
 * What to call the file.
 *
 * A download folder is where a career goes to be unrecognisable: three files
 * called `save.json` from three different games, and the one that matters is
 * the one opened last. So the name carries everything needed to tell this
 * file from its neighbours without opening it — the game, the club and the
 * in-game date the career had reached — and the club name is reduced to
 * something every filesystem will accept.
 */
export function careerFileName(state: GameState): string {
  return `sunday-eleven-27-career-${clubSlug(state)}-${state.date}.json`;
}

/**
 * A club name squeezed into a file name.
 *
 * Lower case, alphanumerics only, runs of everything else made one dash. Not
 * reversible and not meant to be: it exists to be read by a person scanning a
 * download folder, and the club's real name is inside the file, spelled exactly
 * as the game spells it.
 */
export function clubSlug(state: GameState): string {
  const name = state.clubs[state.userClubId]?.identity.name ?? '';
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, NAME_LIMIT)
    .replace(/-+$/g, '');
  return slug || 'career';
}

/**
 * Read a career out of a file the manager chose.
 *
 * Every way this can fail is a different sentence, because the manager has to
 * decide what to do about it: a file that is not one of ours is a wrong file
 * chosen, a file from a newer build is an update owed, and a file that is
 * genuinely corrupt is a backup to look for. Only the last of those is bad news.
 *
 * It never writes, never migrates anything on disk and never touches the career
 * already loaded: it reads text and answers. What happens to the career already
 * on screen is the caller's decision, made after the manager has been told.
 */
export function parseCareerFile(raw: string): { career: ImportedCareer | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      career: null,
      error: 'That file could not be read. A career file from this game is JSON, and this one is not.',
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { career: null, error: 'That file is not a career file from this game.' };
  }

  const file = parsed as Partial<CareerFile> & { format?: unknown };

  // A file that names a format we do not know is refused by name, rather than
  // being reported as corrupt: "this is somebody else's file" and "this file is
  // damaged" call for different things from the manager.
  if (file.format !== undefined && file.format !== CAREER_FILE_FORMAT) {
    return {
      career: null,
      error: `That file was written by another application (its format is “${String(file.format)}”), so it is not a career.`,
    };
  }

  if (file.format === CAREER_FILE_FORMAT && typeof file.formatVersion === 'number' && file.formatVersion > CAREER_FILE_VERSION) {
    return {
      career: null,
      error: `That career file was written by a newer version of the game (file v${file.formatVersion}, this build reads v${CAREER_FILE_VERSION}). Update the game and try again.`,
    };
  }

  if (typeof file.version !== 'number' || !file.state || typeof file.state !== 'object') {
    return {
      career: null,
      error: 'That file has no career in it. It may be a career file that was cut short while it was being written.',
    };
  }

  // From here the file is handed to the one reader the database uses, so an
  // imported career gets exactly the version check and the same migrations a
  // stored one gets — and the two can never drift apart.
  const read = readSaveFile({ version: file.version, savedAt: file.savedAt ?? '', state: file.state as GameState });
  if (!read.state) return { career: null, error: read.error };

  const state = read.state;
  return {
    career: {
      state,
      clubName: state.clubs[state.userClubId]?.identity.name ?? 'Unknown club',
      seasonLabel: state.season?.label ?? '',
      date: state.date,
      saveName: state.saveName,
      seed: state.seed,
      writtenBy: typeof file.app === 'string' && file.app ? file.app : 'an unknown build',
      savedAt: typeof file.savedAt === 'string' ? file.savedAt : '',
      fromVersion: file.version,
    },
    error: null,
  };
}
