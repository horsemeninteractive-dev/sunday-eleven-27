import { GAME_STATE_VERSION, type GameState } from '@/domain/game';
import { birthdayForAge, type ManagerProfile } from '@/domain/manager';
import { emptyRecruitmentStore } from '@/domain/recruitment';
import {
  generateInitialRelationships,
  linkUnattachedPlayersInto,
} from '@/simulation/generation/relationshipGenerator';
import { generateUnattachedPlayers } from '@/simulation/generation/unattachedPlayers';
import { rebuildRelationshipIndex, relationshipStore } from '@/simulation/relationships';
import { pruneCandidates } from '@/simulation/recruitment/store';
import { ensureTrainingState, pruneTrainingHistory } from '@/simulation/training/store';
import { emptyScheduleState } from '@/domain/events';

/**
 * Local save slots.
 *
 * The whole simulation state is plain JSON, so saving is a stringify and
 * loading is a parse plus a version check. Presentation state is deliberately
 * never saved: on load the UI is rebuilt from the simulation.
 */

// The storage keys keep their original prefix. They are invisible to the
// manager, and renaming them would orphan every career already in the browser.
const KEY_PREFIX = 'slfm26.save.';
const INDEX_KEY = 'slfm26.saves';
/**
 * The slot the game keeps up to date by itself. It is a slot like any other —
 * the manager can load it, and it is listed alongside his own — but nothing
 * writes to it except the autosave.
 */
export const AUTOSAVE_SLOT = 'autosave';
/** Whether the next page load should open the career rather than the menu. */
const RESUME_KEY = 'slfm26.resume';

export interface SaveSlotInfo {
  slot: string;
  saveName: string;
  clubName: string;
  date: string;
  seasonLabel: string;
  savedAt: string;
  seed: string;
  /** True for the career the game writes as it is played, not one the manager made. */
  auto?: boolean;
}

export interface SaveFile {
  version: number;
  savedAt: string;
  state: GameState;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * The careers to list, most recently saved first.
 *
 * The order is the manager's own history rather than a ranking of the saves:
 * the one he was playing five minutes ago is the one he wants, and the career
 * the game writes as it is played is simply the most recent of them, not a
 * special case wedged above the others. Slots that were never stamped with a
 * time sort last rather than jumping the queue.
 */
export function orderSaves(saves: readonly SaveSlotInfo[]): SaveSlotInfo[] {
  return [...saves].sort((a, b) => {
    const left = a.savedAt ?? '';
    const right = b.savedAt ?? '';
    if (left === right) return 0;
    return left > right ? -1 : 1;
  });
}

/**
 * Write, or say that it did not happen.
 *
 * A full browser quota throws, and a career being autosaved in the background
 * must never throw into whatever the manager was actually doing.
 */
function write(store: Storage, key: string, value: string): boolean {
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Bring an older save up to date.
 *
 * Each step regenerates deterministically from the world seed, so an old career
 * wakes up with the same social fabric and the same local faces it would have
 * had if it had been started today:
 *
 *  - version 1 predates the social layer, so the relationship network is built;
 *  - version 2 predates recruitment, so the unattached pool arrives with it;
 *  - version 3 predates training, so every player is given a plausible starting
 *    knowledge of his club's system and the Thursday routine begins;
 *  - version 4 predates the day-by-day calendar, so the manager is put at the
 *    start of the week he is in;
 *  - version 5 predates continuous time: its `date` was the coming Sunday and
 *    its cursor was the day the manager actually stood on. The cursor becomes
 *    the date, the matchday counter goes (it is derived from the calendar now),
 *    and every fixture is given the calendar fields postponements need.
 */
function migrateSave(file: SaveFile): SaveFile {
  const state = file.state as GameState & {
    relationships?: GameState['relationships'];
    recruitment?: GameState['recruitment'];
  };
  const from = typeof file.version === 'number' ? file.version : 1;

  if (from < 3 && !Object.keys(state.people).some((id) => id.startsWith('free_migrated_'))) {
    const arrivals = generateUnattachedPlayers({
      seed: state.seed,
      towns: Object.values(state.world.towns),
      date: state.date,
      idPrefix: 'migrated',
    });
    for (const player of arrivals) state.people[player.id] = player;
    if (state.relationships?.byId) {
      // The save already has a social fabric, so the new faces need threading
      // into it rather than replacing it.
      linkUnattachedPlayersInto(relationshipStore(state), state.seed, state.people, state.clubs, state.date);
    }
  }

  if (!state.relationships || !state.relationships.byId) {
    state.relationships = generateInitialRelationships({
      seed: state.seed,
      people: state.people,
      clubs: state.clubs,
      date: state.date,
    });
  }

  if (!state.recruitment || !state.recruitment.candidates) {
    state.recruitment = emptyRecruitmentStore();
  }

  // A career that predates training has no session history, no plans and no
  // per-player familiarity: all three are rebuilt from the world itself, so the
  // save wakes up with the squad it would have had if training had always been
  // in the build.
  ensureTrainingState(state);
  pruneTrainingHistory(state);

  // A career from before the manager introduced himself derives his profile
  // from the manager official the world already generated, so nothing is lost
  // and the identity stays stable.
  if (!state.managerProfile) {
    const manager = state.people['user_manager'];
    state.managerProfile = {
      firstName: manager?.firstName ?? 'The',
      surname: manager?.surname ?? 'Manager',
      nickname: manager?.nickname ?? '',
      birthday: birthdayForAge(manager?.age ?? 40, state.date),
      occupation: manager?.occupation ?? 'Volunteer',
      hometown: '',
    } satisfies ManagerProfile;
  }

  // Continuous time: the day the manager was standing on becomes the date, and
  // the two pieces of state that duplicated it go.
  const legacy = state as GameState & { calendarCursor?: string };
  if (legacy.calendarCursor) state.date = legacy.calendarCursor;
  delete legacy.calendarCursor;
  delete (state.season as { currentMatchday?: number }).currentMatchday;
  if (!state.schedule) state.schedule = emptyScheduleState();

  // Fixtures from before the calendar existed need the fields postponement and
  // the late calls rely on. Nothing about the games themselves changes.
  for (const match of Object.values(state.matches)) {
    if (match.status === undefined) match.status = match.played ? 'finished' : 'scheduled';
    if (match.postponementReason === undefined) match.postponementReason = null;
    if (match.postponedOn === undefined) match.postponedOn = null;
    if (match.originalDate === undefined) match.originalDate = null;
    if (match.replacedByMatchId === undefined) match.replacedByMatchId = null;
    if (match.lateCallMade === undefined) match.lateCallMade = false;
  }

  rebuildRelationshipIndex(state);
  pruneCandidates(state);
  file.version = GAME_STATE_VERSION;
  state.version = GAME_STATE_VERSION;
  return file;
}

/** Write a career to a slot. Returns null if the browser would not store it. */
export function saveGame(
  state: GameState,
  slot: string,
  options: { auto?: boolean } = {},
): SaveSlotInfo | null {
  const file: SaveFile = { version: GAME_STATE_VERSION, savedAt: new Date().toISOString(), state };
  const info: SaveSlotInfo = {
    slot,
    saveName: state.saveName,
    clubName: state.clubs[state.userClubId]?.identity.name ?? 'Unknown club',
    date: state.date,
    seasonLabel: state.season.label,
    savedAt: file.savedAt,
    seed: state.seed,
    ...(options.auto ? { auto: true } : {}),
  };

  const store = storage();
  if (!store) return null;
  if (!write(store, KEY_PREFIX + slot, JSON.stringify(file))) return null;
  const index = listSaveSlots().filter((entry) => entry.slot !== slot);
  index.push(info);
  write(store, INDEX_KEY, JSON.stringify(index));
  return info;
}

/**
 * The career the manager is playing, written as he plays it.
 *
 * A Sunday league season is played in ten-minute bursts between everything
 * else, so needing to remember to save is a way to lose a month. This keeps a
 * copy of the live career and marks it as the one to reopen, while leaving the
 * manager's own slots exactly as he left them.
 */
export function autosave(state: GameState): boolean {
  if (!saveGame(state, AUTOSAVE_SLOT, { auto: true })) return false;
  setResumeSlot(AUTOSAVE_SLOT);
  return true;
}

/** The slot the next page load should open, if any. */
export function resumeSlot(): string | null {
  const store = storage();
  if (!store) return null;
  try {
    return store.getItem(RESUME_KEY);
  } catch {
    return null;
  }
}

/**
 * Point the next load at a slot, or forget it.
 *
 * Quitting to the menu forgets it — the menu has to stay reachable — but the
 * autosave itself is left alone, so quitting never costs the manager a career.
 */
export function setResumeSlot(slot: string | null): void {
  const store = storage();
  if (!store) return;
  if (slot) write(store, RESUME_KEY, slot);
  else {
    try {
      store.removeItem(RESUME_KEY);
    } catch {
      // Nothing was marked, or the browser refuses to touch it: either way
      // there is nothing left to do.
    }
  }
}

/**
 * The career to open as the game starts.
 *
 * A reload lands the manager back on his own dashboard rather than on the menu.
 * A mark pointing at a save that has gone or will not parse is cleared, so a
 * stale mark cannot lock the game out of its own front door.
 */
export function resumeCareer(): GameState | null {
  const slot = resumeSlot();
  if (!slot) return null;
  const result = loadGame(slot);
  if (!result.state) {
    setResumeSlot(null);
    return null;
  }
  return result.state;
}

export function loadGame(slot: string): { state: GameState | null; error: string | null } {
  const store = storage();
  if (!store) return { state: null, error: 'Local storage is unavailable in this browser.' };
  const raw = store.getItem(KEY_PREFIX + slot);
  if (!raw) return { state: null, error: 'No save found in that slot.' };

  try {
    const file = JSON.parse(raw) as SaveFile;
    if (!file || typeof file !== 'object' || !file.state) {
      return { state: null, error: 'That save file is unreadable.' };
    }
    if (typeof file.version !== 'number' || file.version > GAME_STATE_VERSION) {
      return {
        state: null,
        error: `That save was made with a newer version of the game (save v${file.version}, game v${GAME_STATE_VERSION}).`,
      };
    }
    const migrated = migrateSave(file);
    const state = migrated.state;
    if (!state.clubs || !state.userClubId || !state.clubs[state.userClubId]) {
      return { state: null, error: 'That save is missing the club it belongs to.' };
    }
    return { state, error: null };
  } catch {
    return { state: null, error: 'That save file is corrupted.' };
  }
}

export function listSaveSlots(): SaveSlotInfo[] {
  const store = storage();
  if (!store) return [];
  const raw = store.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SaveSlotInfo[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function deleteSave(slot: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEY_PREFIX + slot);
  } catch {
    // Nothing stored under that slot to begin with.
  }
  write(store, INDEX_KEY, JSON.stringify(listSaveSlots().filter((entry) => entry.slot !== slot)));
  if (resumeSlot() === slot) setResumeSlot(null);
}

/** Used by tests and by "export save" style features. */
export function serialiseGame(state: GameState): string {
  return JSON.stringify({ version: GAME_STATE_VERSION, savedAt: new Date().toISOString(), state } satisfies SaveFile);
}

export function deserialiseGame(raw: string): { state: GameState | null; error: string | null } {
  try {
    const file = JSON.parse(raw) as SaveFile;
    if (typeof file.version !== 'number' || file.version > GAME_STATE_VERSION) {
      return { state: null, error: 'Version mismatch.' };
    }
    return { state: migrateSave(file).state, error: null };
  } catch {
    return { state: null, error: 'Unreadable save data.' };
  }
}
