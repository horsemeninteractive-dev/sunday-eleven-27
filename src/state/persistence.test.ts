import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { generateDraft, startGameFromDraft } from '@/simulation/gameSetup';
import { addDays } from '@/simulation/calendar';
import { cupRoundMatchday, cupRoundOf } from '@/simulation/cup';
import {
  COUNTY_CUP_ID,
  COUNTY_CUP_NAME,
  LEAGUE_CUP_ID,
  LEAGUE_CUP_NAME,
  PLATE_ID,
  countyClubIds,
  countyIdOfPyramid,
  divisionOf,
  divisionsOf,
  leagueCompetitions,
  registerFixture,
} from '@/simulation/pyramid';
import { fieldClubs } from '@/simulation/seasonStructure';
import { processDay } from '@/simulation/day';
import { finishSeason, startNextSeason } from '@/simulation/season';
import { settleLeague } from '@/simulation/testSupport';
import { FOUNDING_PYRAMID_ID, cupFieldOf, storedCupField } from '@/domain/competition';
import {
  FOUNDING_COUNTY_ID,
  FOUNDING_COUNTY_NAME,
  FOUNDING_REGION_ID,
  NATION_NAME,
} from '@/domain/world';
import { ALDERFORDSHIRE_DISTRICTS } from '@/domain/districts';
import { GAME_STATE_VERSION, type GameState } from '@/domain/game';
import type { FaceChoices } from '@/domain/face';
import type { MatchId } from '@/domain/ids';
import { bootStore, flushAutosave, useGameStore } from './gameStore';
import * as idb from './indexedDb';
import {
  AUTOSAVE_SLOT,
  askToKeepStorage,
  autosave,
  deleteSave,
  deserialiseGame,
  listSaveSlots,
  loadGame,
  migrateLegacySaves,
  orderSaves,
  resetStoragePersistenceForTests,
  resumeCareer,
  resumeSlot,
  saveGame,
  serialiseGame,
  setResumeSlot,
  storageFailureReason,
  storagePersistenceNote,
  storagePersistenceStatus,
  type IndexedSaveRecord,
  type SaveSlotInfo,
} from './persistence';

/**
 * Persistence, against a real database.
 *
 * These tests run against `fake-indexeddb` rather than a hand-written map,
 * because the things that went wrong in this migration are all transaction
 * behaviour: a write finishing out of order, a migration half-applied, a record
 * that will not parse. A stub that returned success for everything would pass
 * while every one of those was broken. What is faked is the *storage engine*,
 * not the transaction semantics — requests, transactions, aborts and durability
 * are the real implementation.
 *
 * localStorage is stubbed for the same reason it used to be, and only because it
 * is not the thing under test any more: it is now the *old* location, and the
 * legacy tests need to write to it.
 */

function installLegacyStorage(): Map<string, string> {
  const map = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, String(value)),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  } as unknown as Storage;
  return map;
}

/** A fresh database for every test, so no test can see another's careers. */
function freshDatabase(): void {
  idb.resetForTests();
  globalThis.indexedDB = new IDBFactory();
}

function career(seed: string): GameState {
  const draft = generateDraft({ seed, startYear: 2026, pyramids: 2 });
  return startGameFromDraft(draft, {
    seed,
    startYear: 2026,
    clubId: draft.divisionClubIds[0]!,
    saveName: `Test — ${seed}`,
  });
}

/**
 * A career founded with the whole county: six districts, eighteen divisions.
 *
 * The world a career born today is handed, and so the one the migration has
 * nothing left to give.
 */
function countyCareer(seed: string): GameState {
  const draft = generateDraft({ seed, startYear: 2026 });
  return startGameFromDraft(draft, {
    seed,
    startYear: 2026,
    clubId: draft.divisionClubIds[0]!,
    saveName: `County — ${seed}`,
  });
}

/**
 * A career as a save written before the district next door existed holds it: one
 * ladder, one region, thirty-six clubs.
 *
 * Every fixture that is about *old* saves starts here, because that is what an
 * old save is. Stripping the pyramid model out of a two-ladder career would leave
 * a world no version of the game ever wrote — six divisions and no record of who
 * owns which three — and the migration would be being asked about a county that
 * never existed.
 */
function legacyCareer(seed: string): GameState {
  const draft = generateDraft({ seed, startYear: 2026, pyramids: 1 });
  return startGameFromDraft(draft, {
    seed,
    startYear: 2026,
    clubId: draft.divisionClubIds[0]!,
    saveName: `Legacy — ${seed}`,
  });
}

/** A career that has moved on a little, the way a played one would have. */
function playedOn(state: GameState, days: number): GameState {
  const moved = structuredClone(state);
  moved.date = addDays(state.date, days);
  return moved;
}

/**
 * Wait for something to become true.
 *
 * Writing a career means cloning a whole world into the database, which is not
 * instantaneous. A fixed sleep would either be too short on a slow machine or a
 * waste of time on a fast one, and either way it tests the speed of the host
 * rather than the behaviour of the code.
 */
async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

beforeEach(() => {
  freshDatabase();
  installLegacyStorage();
  // Deliberately *not* initialise(): that would run the localStorage migration
  // and set its completion flag, and the tests that are about that migration
  // need to be the ones deciding when it happens. The database opens lazily on
  // the first write or read, exactly as it does in the game.
});

afterEach(async () => {
  // A pending autosave would otherwise write into the next test's database.
  flushAutosave();
  idb.resetForTests();
});

describe('saving and loading a career', () => {
  it('saves, lists, and reads back the same career', async () => {
    const state = career('save-load');
    const saved = await saveGame(state, 'slot-1');

    expect(saved.error).toBeNull();
    expect(saved.info).not.toBeNull();
    expect(saved.info!.slot).toBe('slot-1');
    expect(saved.info!.clubName).toBe(state.clubs[state.userClubId]!.identity.name);
    expect(saved.info!.seed).toBe(state.seed);

    const slots = await listSaveSlots();
    expect(slots.map((entry) => entry.slot)).toEqual(['slot-1']);

    const loaded = await loadGame('slot-1');
    expect(loaded.error).toBeNull();
    expect(loaded.state?.date).toBe(state.date);
    expect(loaded.state?.seed).toBe(state.seed);
  });

  it('keeps a career whole, not a summary of one', async () => {
    // The whole point of moving off localStorage is that the world is stored
    // whole and durably. Every part of it must survive the round trip.
    const state = career('save-whole');
    await saveGame(state, 'slot-1');
    const loaded = (await loadGame('slot-1')).state!;

    expect(Object.keys(loaded.people)).toHaveLength(Object.keys(state.people).length);
    expect(Object.keys(loaded.clubs)).toHaveLength(Object.keys(state.clubs).length);
    expect(Object.keys(loaded.matches)).toHaveLength(Object.keys(state.matches).length);
    expect(loaded.relationships.byId).toBeDefined();
    expect(loaded.season.calendar).toHaveLength(state.season.calendar.length);
    expect(loaded.training).toBeDefined();
    // The world the simulation runs on, unchanged by being stored.
    expect(loaded.world.seed ?? loaded.seed).toBe(loaded.seed);
  });

  it('keeps the manager’s own slots exactly as he left them', async () => {
    const state = career('slots-independent');
    await saveGame(state, 'slot-1');
    const slotOneDate = (await loadGame('slot-1')).state!.date;

    await autosave(playedOn(state, 9));

    const slots = await listSaveSlots();
    expect(slots.map((entry) => entry.slot).sort()).toEqual([AUTOSAVE_SLOT, 'slot-1']);
    expect(slots.find((entry) => entry.slot === 'slot-1')!.auto).toBeUndefined();
    // The manager's save is untouched by a career that has moved on without it.
    expect((await loadGame('slot-1')).state!.date).toBe(slotOneDate);
    expect((await loadGame(AUTOSAVE_SLOT)).state!.date).toBe(addDays(state.date, 9));
  });

  it('says so, rather than throwing, when there is no save in the slot', async () => {
    const result = await loadGame('nothing-here');
    expect(result.state).toBeNull();
    expect(result.error).toBe('No save found in that slot.');
  });
});

describe('the autosave', () => {
  it('keeps a copy of the career that can be read back', async () => {
    const state = career('autosave-writes');
    const written = await autosave(state);
    expect(written.error).toBeNull();
    expect(written.info?.slot).toBe(AUTOSAVE_SLOT);
    expect(written.info?.auto).toBe(true);

    const slots = await listSaveSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0]!.slot).toBe(AUTOSAVE_SLOT);
    expect(slots[0]!.auto).toBe(true);
    expect(slots[0]!.clubName).toBe(state.clubs[state.userClubId]!.identity.name);
    expect((await loadGame(AUTOSAVE_SLOT)).state?.date).toBe(state.date);
  });

  it('comes back to the career the manager was playing', async () => {
    const state = playedOn(career('autosave-resume'), 11);
    await autosave(state);

    const resumed = await resumeCareer();
    expect(resumed.error).toBeNull();
    expect(resumed.slot).toBe(AUTOSAVE_SLOT);
    expect(resumed.state).not.toBeNull();
    expect(resumed.state!.date).toBe(state.date);
    expect(resumed.state!.userClubId).toBe(state.userClubId);
    expect(resumed.state!.seed).toBe(state.seed);
  });

  it('forgets where to resume on quit, without losing the save', async () => {
    await autosave(career('autosave-quit'));

    await useGameStore.getState().quitToMenu();

    expect(await resumeSlot()).toBeNull();
    expect((await resumeCareer()).state).toBeNull();
    expect((await listSaveSlots()).map((entry) => entry.slot)).toEqual([AUTOSAVE_SLOT]);
  });

  it('does not lock the game out when the mark points at a save that has gone', async () => {
    await setResumeSlot('slot-3');
    expect((await resumeCareer()).state).toBeNull();
    expect(await resumeSlot()).toBeNull();
  });

  it('forgets a mark pointing at a slot the manager deletes', async () => {
    await autosave(career('autosave-delete'));
    const removed = await deleteSave(AUTOSAVE_SLOT);
    expect(removed).toEqual({ ok: true, error: null });
    expect(await resumeSlot()).toBeNull();
    expect(await listSaveSlots()).toHaveLength(0);
  });

  it('does not block on the manager while a write is in flight', async () => {
    // An autosave is handed to the database and returns; it does not hold the
    // store up, so play continues while it is written.
    const state = career('autosave-not-blocking');
    const pending = autosave(state);
    expect(pending).toBeInstanceOf(Promise);
    const result = await pending;
    expect(result.error).toBeNull();
    expect(result.info?.slot).toBe(AUTOSAVE_SLOT);
    expect(result.info?.auto).toBe(true);
  });
});

/**
 * Removing a saved career.
 *
 * The game could write a career out, read one back and move one in and out as a
 * file long before it could remove one, and the removal it now offers has to
 * survive the two things storage does on its own: writes queued behind each
 * other for one slot, and a slot that never held anything. What a delete does
 * *not* do is the third: a career is removed from one slot and from nowhere
 * else, because the manager's own snapshot and the autosave are two separate
 * copies of the same season and he asked about one of them.
 */
describe('deleting a saved career', () => {
  it('empties the slot and says it did', async () => {
    const state = career('delete-one');
    await saveGame(state, 'slot-1');
    await saveGame(state, 'slot-2');

    const removed = await deleteSave('slot-1');

    expect(removed).toEqual({ ok: true, error: null });
    expect((await listSaveSlots()).map((entry) => entry.slot)).toEqual(['slot-2']);
    expect((await loadGame('slot-1')).error).toBe('No save found in that slot.');
  });

  it('takes nothing else with it', async () => {
    const state = career('delete-independent');
    await saveGame(state, 'slot-1');
    await autosave(playedOn(state, 5));

    await deleteSave('slot-1');

    // The career being played is still where it was, and is still what the next
    // load opens: deleting a snapshot is not deleting the season.
    expect((await loadGame(AUTOSAVE_SLOT)).state!.date).toBe(addDays(state.date, 5));
    expect(await resumeSlot()).toBe(AUTOSAVE_SLOT);
  });

  it('lands after a save that was already on its way to the same slot', async () => {
    // A delete is not a special case in the queue: asked for while a write into
    // that slot is still in the air, it lands second, and the slot ends up empty
    // rather than being refilled by the write it was queued behind.
    const state = career('delete-behind-a-write');
    const write = saveGame(state, 'slot-1');
    const removed = deleteSave('slot-1');

    expect((await write).error).toBeNull();
    expect(await removed).toEqual({ ok: true, error: null });
    expect(await listSaveSlots()).toHaveLength(0);
  });

  it('is not an error when there was nothing in the slot', async () => {
    // A slot the game has never written to is the outcome the manager asked for,
    // not a failure to report. (It is also how the second half of a double press
    // lands, which must not raise an alert over a screen that is already up to
    // date.)
    expect(await deleteSave('slot-3')).toEqual({ ok: true, error: null });
  });
});

describe('rapid writes', () => {
  it('leaves the newest career in the slot, whatever order the writes finish in', async () => {
    // The bug this guards is the one asynchronous storage introduces: three
    // writes started in order but allowed to land in any order, so an older
    // career can end up written over a newer one. The dates make the order
    // unambiguous.
    const state = career('rapid-writes');
    await Promise.all([
      autosave(playedOn(state, 3)),
      autosave(playedOn(state, 9)),
      autosave(playedOn(state, 21)),
    ]);

    const stored = (await loadGame(AUTOSAVE_SLOT)).state!;
    expect(stored.date).toBe(addDays(state.date, 21));
  });

  it('keeps many writes arriving one after another in order', async () => {
    // Not just concurrent: a burst where each save starts after the last has
    // been asked for must still finish with the last one stored.
    const state = career('rapid-sequence');
    for (const days of [1, 2, 3, 4, 5, 6]) {
      await autosave(playedOn(state, days));
    }
    expect((await loadGame(AUTOSAVE_SLOT)).state!.date).toBe(addDays(state.date, 6));
  });

  it('does not let a failed write freeze the ones behind it', async () => {
    const state = career('rapid-after-failure');
    await autosave(playedOn(state, 1));

    // A save of something the database cannot hold is rejected; the next one
    // must still go through, or one bad career ends the autosave for good.
    const unholdable = { ...playedOn(state, 2), nonsense: () => 'not structured-cloneable' } as unknown as GameState;
    const rejected = await saveGame(unholdable, 'slot-bad');
    expect(rejected.info).toBeNull();
    expect(rejected.error).not.toBeNull();

    await autosave(playedOn(state, 3));
    expect((await loadGame(AUTOSAVE_SLOT)).state!.date).toBe(addDays(state.date, 3));
  });
});

describe('the store’s autosave', () => {
  // The generous timeouts here are the county's size, not slack: the debounce is
  // measured on the real clock, and the write behind it is a career with two
  // ladders in it now — the same assertions, on a state that takes longer to
  // serialise than it used to.
  it('writes once, a moment after the manager stops rather than on every change', { timeout: 30_000 }, async () => {
    const store = useGameStore.getState();
    await useGameStore.getState().quitToMenu();
    store.createDraft('autosave-timing');
    store.chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);

    // The write is on a timer, and the timer has not come round yet. Waiting
    // for the debounce is the point: the manager has not stopped.
    expect(await resumeSlot()).toBeNull();

    // The debounce is 800 ms; the write behind it is a whole career, and a
    // career is two ladders now. What is asserted is that the write lands rather
    // than that it lands inside any particular second.
    await waitFor(async () => (await resumeSlot()) === AUTOSAVE_SLOT, 'the debounced autosave to land', 20_000);

    expect((await listSaveSlots()).filter((entry) => entry.auto)).toHaveLength(1);
  });

  it('keeps up with the calendar, so a reload lands where the manager left off', { timeout: 30_000 }, async () => {
    const store = useGameStore.getState();
    await useGameStore.getState().quitToMenu();
    store.createDraft('autosave-calendar');
    store.chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const before = useGameStore.getState().game!;
    await store.advanceDays(3);
    // Waited for rather than assumed in: three days of a county with two ladders
    // in it is more football and a bigger book than the old one-deep save.
    await waitFor(
      async () => (await resumeCareer()).state?.date === useGameStore.getState().game!.date,
      'the autosave to catch up with the calendar',
      20_000,
    );

    const onDisk = (await resumeCareer()).state;
    expect(onDisk).not.toBeNull();
    expect(onDisk!.date).toBe(useGameStore.getState().game!.date);
    expect(onDisk!.date).toBe(addDays(before.date, 3));
  });

  it('does not write out a change that was only ever on screen', { timeout: 30_000 }, async () => {
    const store = useGameStore.getState();
    await useGameStore.getState().quitToMenu();
    store.createDraft('autosave-presentation');
    store.chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    useGameStore.getState().setNotice(null);
    useGameStore.getState().setView('squad');
    useGameStore.getState().selectPlayer(null);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // One autosave from choosing the club, and none from moving around the UI.
    expect((await listSaveSlots()).filter((entry) => entry.auto)).toHaveLength(1);
  });

  it('flushes a pending write when the page is going away', { timeout: 30_000 }, async () => {
    const store = useGameStore.getState();
    await useGameStore.getState().quitToMenu();
    store.createDraft('autosave-flush');
    store.chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);

    // Inside the debounce window, so the timer has not fired.
    expect(await resumeSlot()).toBeNull();

    // What pagehide does: hand the write over rather than trust the timer.
    flushAutosave();

    await waitFor(async () => (await resumeSlot()) === AUTOSAVE_SLOT, 'the flushed autosave to land');
    expect((await loadGame(AUTOSAVE_SLOT)).state).not.toBeNull();
  });
});

describe('starting the game', () => {
  it('opens the storage and only then decides which screen to show', async () => {
    await useGameStore.getState().quitToMenu();
    useGameStore.setState({ ready: false, game: null, view: 'start' });

    const boot = bootStore();
    // Before it resolves the store says so, rather than claiming there is no
    // career — which is the difference between "opening" and "nothing saved".
    expect(useGameStore.getState().ready).toBe(false);

    await boot;
    expect(useGameStore.getState().ready).toBe(true);
  });

  it('puts a manager back in the career he was playing', async () => {
    const state = playedOn(career('boot-resume'), 5);
    await autosave(state);

    useGameStore.setState({ ready: false, game: null, view: 'start' });
    await bootStore();

    expect(useGameStore.getState().view).toBe('dashboard');
    expect(useGameStore.getState().game?.date).toBe(state.date);
  });

  it('starts on the menu when there is no career, and says so when ready', async () => {
    await useGameStore.getState().quitToMenu();
    useGameStore.setState({ ready: false, game: null, view: 'start' });

    await bootStore();

    expect(useGameStore.getState().ready).toBe(true);
    expect(useGameStore.getState().game).toBeNull();
    expect(useGameStore.getState().view).toBe('start');
  });
});

describe('when the storage itself fails', () => {
  it('reports a broken database rather than throwing into the manager’s way', async () => {
    const state = career('storage-failure');
    // No database at all is the case a manager can actually hit: private
    // browsing, or storage the browser has switched off.
    globalThis.indexedDB = undefined as unknown as IDBFactory;
    idb.resetForTests();

    const refused = await saveGame(state, 'slot-1');
    expect(refused.info).toBeNull();
    expect(refused.error).toMatch(/database|storage/i);
    const notWritten = await autosave(state);
    expect(notWritten.info).toBeNull();
    expect(notWritten.error).not.toBeNull();
    expect(await listSaveSlots()).toEqual([]);
    expect(await resumeSlot()).toBeNull();
    // And a load says the storage failed rather than pretending the slot is
    // simply empty — those are different problems with different fixes.
    const result = await loadGame('slot-1');
    expect(result.state).toBeNull();
    expect(result.error).toMatch(/browser/i);
  });

  it('still opens the game when the database cannot be opened', async () => {
    globalThis.indexedDB = undefined as unknown as IDBFactory;
    idb.resetForTests();
    useGameStore.setState({ ready: false, game: null, view: 'start' });

    await bootStore();

    // The manager is not locked out of a game that cannot save yet: he is on
    // the menu, ready to start one, and only the saving is missing.
    expect(useGameStore.getState().ready).toBe(true);
    expect(useGameStore.getState().view).toBe('start');
  });

  it('leaves the career in memory intact when the write fails', async () => {
    const state = career('failure-keeps-career');
    await useGameStore.getState().quitToMenu();
    useGameStore.setState({ ready: true, game: state, view: 'dashboard' });

    globalThis.indexedDB = undefined as unknown as IDBFactory;
    idb.resetForTests();

    await saveGame(state, 'slot-1');

    // Nothing was stored, but the career he is playing is untouched.
    expect(useGameStore.getState().game?.date).toBe(state.date);
    expect(useGameStore.getState().view).toBe('dashboard');
  });
});

describe('saves that are wrong', () => {
  it('rejects a save from a newer version of the game', async () => {
    // Writing it directly into the store rather than through `saveGame`, which
    // would never produce one.
    const state = career('newer-version');
    await idb.put(idb.SAVES, {
      slot: 'slot-1',
      file: { version: GAME_STATE_VERSION + 1, savedAt: new Date().toISOString(), state },
      info: {
        slot: 'slot-1',
        saveName: state.saveName,
        clubName: 'Future FC',
        date: state.date,
        seasonLabel: state.season.label,
        savedAt: new Date().toISOString(),
        seed: state.seed,
      },
    });

    const result = await loadGame('slot-1');
    expect(result.state).toBeNull();
    expect(result.error).toMatch(/newer version/i);
  });

  it('reports a corrupt save rather than crashing', async () => {
    // Every kind of wrong this can be, each of which used to reach JSON.parse.
    const broken: unknown[] = [
      { slot: 'no-file', info: {} },
      { slot: 'no-state', file: { version: GAME_STATE_VERSION } },
      { slot: 'null-state', file: { version: GAME_STATE_VERSION, state: null } },
      { slot: 'bad-version', file: { version: 'nine', state: {} } },
      { slot: 'no-clubs', file: { version: GAME_STATE_VERSION, state: { userClubId: 'club_x' } } },
    ];
    for (const record of broken) {
      await idb.put(idb.SAVES, record);
    }

    for (const record of broken) {
      const result = await loadGame((record as { slot: string }).slot);
      expect(result.state, `slot ${(record as { slot: string }).slot} should not load`).toBeNull();
      expect(result.error).toBeTruthy();
    }
  });

  it('still round-trips a career through the export functions', async () => {
    // serialiseGame/deserialiseGame are the compatibility boundary, and they do
    // not go near the database at all.
    const state = playedOn(career('export-round-trip'), 4);
    const raw = serialiseGame(state);

    const parsed = deserialiseGame(raw);
    expect(parsed.error).toBeNull();
    expect(parsed.state?.date).toBe(state.date);
    expect(parsed.state?.seed).toBe(state.seed);
    expect(Object.keys(parsed.state!.people)).toHaveLength(Object.keys(state.people).length);

    expect(deserialiseGame('not json').state).toBeNull();
    expect(deserialiseGame('{}').state).toBeNull();
  });

  it('keeps the face a manager chose, because it belongs to the career', async () => {
    // The customiser writes the face into the career rather than into the browser
    // that happened to pick it, so it has to come back out of a save intact —
    // including through the export path, which is the compatibility boundary a
    // manager's backup file travels.
    const face: FaceChoices = {
      shape: 'square',
      skin: 'olive',
      hair: 'ginger',
      hairStyle: 'bald',
      beard: 'beard',
      glasses: true,
      eyeColour: 'green',
      eyeShape: 'narrow',
      browWeight: 'heavy',
      browLift: 'low',
      nose: 'broad',
      mouth: 'thin',
    };
    const draft = generateDraft({ seed: 'face-in-the-save', startYear: 2026, pyramids: 2 });
    const state = startGameFromDraft(draft, {
      seed: 'face-in-the-save',
      startYear: 2026,
      clubId: draft.divisionClubIds[0]!,
      saveName: 'Face',
      manager: { firstName: 'Dave', surname: 'Fletcher', nickname: '', birthday: '1978-03-02', occupation: '', hometown: '', face },
    });
    const parsed = deserialiseGame(serialiseGame(playedOn(state, 3)));
    expect(parsed.state?.people['user_manager']?.face).toEqual(face);
    expect(parsed.state?.managerProfile.face).toEqual(face);

    // And a career whose manager chose nothing reads back with no face at all, so
    // an old save's manager is not handed a pair of glasses on the way through.
    const plain = deserialiseGame(serialiseGame(career('no-face-in-the-save')));
    expect(plain.state?.people['user_manager']?.face).toBeUndefined();
    expect('face' in plain.state!.managerProfile).toBe(false);
  });
});

describe('old save versions', () => {
  it('migrates a version 7 save — one league, no cups — into the pyramid', async () => {
    // The migration chain is the game's own and must keep running unchanged by
    // where the save is kept. This is the version the pyramid work wrote.
    const state = legacyCareer('migration-v7');
    const legacy = stripToVersion7(state);

    const result = await readMigrated(legacy);
    expect(result.version).toBe(GAME_STATE_VERSION);
    expect(result.state.pyramids[FOUNDING_PYRAMID_ID]?.config.tiers).toBe(3);
    expect(result.state.pyramids[FOUNDING_PYRAMID_ID]?.config.clubsPerTier).toBe(12);
    // 36 clubs, in three divisions of twelve.
    const leagueClubs = new Set(
      Object.values(result.state.competitions)
        .filter((competition) => competition.kind === 'league')
        .flatMap((competition) => competition.clubIds),
    );
    expect(leagueClubs.size).toBe(36);
    // The manager's club has not moved division under him.
    expect(result.state.clubs[result.state.userClubId]!.active).toBe(true);
  });

  it('gives an old save the development curves it predates', async () => {
    const state = legacyCareer('migration-curves');
    const legacy = stripToVersion8(state);
    for (const person of Object.values(legacy.state.people)) {
      if ((person as { kind?: string }).kind === 'player') {
        delete (person as { development?: unknown }).development;
      }
    }

    const result = await readMigrated(legacy);
    const players = Object.values(result.state.people).filter(
      (person) => (person as { kind?: string }).kind === 'player',
    ) as Array<{ development?: { potential: number; peakAge: number } }>;
    expect(players.length).toBeGreaterThan(0);
    for (const player of players) {
      expect(player.development).toBeDefined();
      expect(Number.isFinite(player.development!.potential)).toBe(true);
      expect(Number.isFinite(player.development!.peakAge)).toBe(true);
    }
  });

  it('gives an old save a manager profile and a training history it predates', async () => {
    const state = legacyCareer('migration-profile');
    const legacy = stripToVersion8(state);
    delete (legacy.state as { managerProfile?: unknown }).managerProfile;

    const result = await readMigrated(legacy);
    expect(result.state.managerProfile?.surname).toBeTruthy();
    expect(result.state.training).toBeDefined();
    expect(Array.isArray(result.state.training!.history)).toBe(true);
  });

  it('gives a save made before round identity the round each cup tie was drawn for', async () => {
    const state = legacyCareer('migration-cup-rounds');
    const legacy = stripToVersion21(state);

    // The Plate as it stands once the main cup has fed it: a drawn opening round
    // of its own, which is the second competition the migration has to place.
    const plate = Object.values(legacy.state.competitions).find(
      (competition) => competition.id === PLATE_ID,
    )!;
    const plateTieId = 'tie_plate_drawn' as MatchId;
    const source = Object.values(legacy.state.matches).find(
      (match) => Boolean(legacy.state.competitions[match.competitionId]?.cup),
    )!;
    const plateTie = {
      ...source,
      id: plateTieId,
      competitionId: PLATE_ID,
      competitionName: plate.name,
      matchday: cupRoundMatchday(legacy.state, plate, 2),
    };
    legacy.state.matches[plateTieId] = plateTie;
    registerFixture(legacy.state, PLATE_ID, plateTieId, plateTie.matchday);

    // What each tie was being read as before the field existed: the arithmetic,
    // which is the fallback `cupRoundOf` still uses for a tie without one.
    const before = new Map<string, number>();
    for (const match of Object.values(legacy.state.matches)) {
      const competition = legacy.state.competitions[match.competitionId];
      if (!competition?.cup) continue;
      expect(match.cupRound).toBeUndefined();
      before.set(match.id, cupRoundOf(legacy.state, competition, match));
    }
    expect(before.size).toBeGreaterThan(1);
    expect([...before.values()].every((round) => round > 0)).toBe(true);
    expect(before.get(plateTieId)).toBe(2);

    const result = await readMigrated(legacy);
    expect(result.error).toBeNull();
    expect(result.version).toBe(GAME_STATE_VERSION);

    // Every cup tie comes back with the round it already had, and nothing else
    // about it has moved: same date, same competition, same result.
    for (const [id, round] of before) {
      const after = result.state.matches[id]!;
      const original = legacy.state.matches[id]!;
      expect(after.cupRound).toBe(round);
      expect(after.competitionId).toBe(original.competitionId);
      expect(after.date).toBe(original.date);
      expect(after.matchday).toBe(original.matchday);
      expect(after.played).toBe(original.played);
      expect(after.result).toEqual(original.result);
      expect(after.status).toBe(original.status);
    }
    // Both cups are covered, each from its own arithmetic.
    const cupTieCompetitions = new Set([...before.keys()].map((id) => result.state.matches[id]!.competitionId));
    expect(cupTieCompetitions.size).toBe(2);

    // And nothing that is not a cup tie is given a round.
    for (const match of Object.values(result.state.matches)) {
      if (result.state.competitions[match.competitionId]?.cup) continue;
      expect(match.cupRound).toBeUndefined();
    }

    // Loading the same save again is the same answer, not a second back-fill on
    // top of the first: the round a tie already has is left exactly where it is.
    const again = await readMigrated(legacy);
    expect(again.version).toBe(GAME_STATE_VERSION);
    for (const [id, round] of before) expect(again.state.matches[id]!.cupRound).toBe(round);
  });

  it('gives a save made before pyramids one region for its towns and one pyramid that owns its ladder', async () => {
    const legacy = stripToVersion22(legacyCareer('migration-pyramids'));
    const before = {
      divisionIds: leagueCompetitions(legacy.state).map((competition) => competition.id),
      userDivisionId: divisionOf(legacy.state, legacy.state.userClubId)?.id ?? null,
      config: { ...legacyConfig(legacy.state) },
      matches: Object.values(legacy.state.matches).map((match) => ({
        id: match.id,
        competitionId: match.competitionId,
        date: match.date,
        matchday: match.matchday,
        played: match.played,
        status: match.status,
        homeClubId: match.homeClubId,
        awayClubId: match.awayClubId,
        cupRound: match.cupRound,
      })),
      townIds: Object.keys(legacy.state.world.towns).sort(),
    };
    expect(before.divisionIds.length).toBe(3);
    expect(before.userDivisionId).not.toBeNull();

    const result = await readMigrated(legacy);
    expect(result.error).toBeNull();
    expect(result.version).toBe(GAME_STATE_VERSION);

    // One region, drawn around the towns the county already has, and every town
    // of the county is in it.
    const regions = Object.values(result.state.world.regions);
    expect(regions).toHaveLength(1);
    expect(result.state.world.regionIds).toEqual([regions[0]!.id]);
    expect(regions[0]!.name).toBe(result.state.world.regionName);
    // Its centre is the middle of those towns, not an invented point.
    const towns = Object.values(result.state.world.towns);
    const meanX = towns.reduce((sum, town) => sum + town.x, 0) / towns.length;
    const meanY = towns.reduce((sum, town) => sum + town.y, 0) / towns.length;
    expect(regions[0]!.centre.x).toBeCloseTo(meanX);
    expect(regions[0]!.centre.y).toBeCloseTo(meanY);
    expect(Object.keys(result.state.world.towns).sort()).toEqual(before.townIds);
    for (const town of towns) expect(town.regionId).toBe(regions[0]!.id);

    // One pyramid, whose id is the prefix every competition in the save already
    // carries, holding the shape the career was generated with.
    expect(result.state.pyramidIds).toEqual([FOUNDING_PYRAMID_ID]);
    const pyramid = result.state.pyramids[FOUNDING_PYRAMID_ID]!;
    expect(pyramid.id).toBe(FOUNDING_PYRAMID_ID);
    expect(pyramid.name).toBe(`${result.state.world.regionName} Sunday League`);
    expect(pyramid.regionId).toBe(regions[0]!.id);
    expect(pyramid.level).toBe(1);
    expect(pyramid.config).toEqual(before.config);
    // It owns the divisions the save had, in the order it had them, and its cups.
    expect(pyramid.competitionIds).toEqual(before.divisionIds);
    expect(pyramid.cupIds).toEqual([LEAGUE_CUP_ID, PLATE_ID]);
    expect(divisionsOf(result.state).map((competition) => competition.id)).toEqual(before.divisionIds);
    // The old singular shape is gone rather than left beside the pyramid that
    // now carries it.
    expect('pyramid' in result.state).toBe(false);

    // Nothing about the football moved: same competitions, same matches, same
    // division for the manager's club.
    expect(leagueCompetitions(result.state).map((competition) => competition.id)).toEqual(before.divisionIds);
    for (const id of before.divisionIds) {
      expect(result.state.competitions[id]!.clubIds).toEqual(legacy.state.competitions[id]!.clubIds);
      expect(result.state.competitions[id]!.name).toBe(legacy.state.competitions[id]!.name);
    }
    expect(divisionOf(result.state, result.state.userClubId)?.id).toBe(before.userDivisionId);
    const after = new Map(
      Object.values(result.state.matches).map((match) => [
        match.id,
        {
          id: match.id,
          competitionId: match.competitionId,
          date: match.date,
          matchday: match.matchday,
          played: match.played,
          status: match.status,
          homeClubId: match.homeClubId,
          awayClubId: match.awayClubId,
          cupRound: match.cupRound,
        },
      ]),
    );
    expect(after.size).toBe(before.matches.length);
    for (const match of before.matches) expect(after.get(match.id)).toEqual(match);

    // Every club that is playing is in exactly one division, and those divisions
    // are the ones the pyramid says it owns.
    const owned = new Set(pyramid.competitionIds);
    for (const club of Object.values(result.state.clubs)) {
      if (!club.active) continue;
      const memberships = leagueCompetitions(result.state).filter((competition) =>
        competition.clubIds.includes(club.id),
      );
      expect(memberships).toHaveLength(1);
      expect(owned.has(memberships[0]!.id)).toBe(true);
    }

    // And loading the same career again is the same answer, not a second helping
    // of regions and pyramids on top of the first.
    const again = await readMigrated(legacy);
    expect(again.version).toBe(GAME_STATE_VERSION);
    expect(Object.keys(again.state.world.regions)).toHaveLength(1);
    expect(again.state.world.regionIds).toEqual([regions[0]!.id]);
    expect(again.state.pyramidIds).toEqual([FOUNDING_PYRAMID_ID]);
    expect(Object.keys(again.state.pyramids)).toHaveLength(1);
    for (const town of Object.values(again.state.world.towns)) {
      expect(town.regionId).toBe(regions[0]!.id);
    }
  });

  it('plays a migrated career through a season rollover, into the county the map has', async () => {
    const legacy = stripToVersion22(legacyCareer('migration-rollover'));
    const result = await readMigrated(legacy);
    const before = divisionsOf(result.state).map((competition) => competition.id);
    // A one-ladder career migrating in is one the county's five districts belong
    // to, and it waits for the boundary like any other.
    expect(result.state.worldExpansion).toEqual({ pending: true });
    expect(result.state.pyramidIds).toEqual([FOUNDING_PYRAMID_ID]);

    const countyTowns = Object.values(result.state.world.towns).map((town) => ({ id: town.id, regionId: town.regionId }));
    settleLeague(result.state);
    finishSeason(result.state);
    startNextSeason(result.state);

    // The new season was built through the pyramids' own records: the ladder the
    // career already had, rebuilt exactly as it was, and every district the map
    // draws founded alongside it.
    expect(result.state.phase).toBe('season');
    expect(result.state.pyramidIds).toHaveLength(ALDERFORDSHIRE_DISTRICTS.length);
    const districts = result.state.pyramidIds.slice(1);
    expect(districts).toHaveLength(ALDERFORDSHIRE_DISTRICTS.length - 1);
    expect(divisionsOf(result.state).map((competition) => competition.id)).toEqual(before);
    expect(result.state.pyramids[FOUNDING_PYRAMID_ID]!.competitionIds).toEqual(before);
    for (const district of districts) expect(divisionsOf(result.state, district)).toHaveLength(3);
    expect(result.state.worldExpansion).toEqual({
      pending: false,
      expandedInSeasonId: result.state.season.id,
    });
    for (const competition of leagueCompetitions(result.state)) {
      expect(competition.clubIds, competition.id).toHaveLength(12);
    }
    // Eighteen divisions of twelve, and no club in more than one of them.
    expect(leagueCompetitions(result.state)).toHaveLength(
      ALDERFORDSHIRE_DISTRICTS.length * 3,
    );
    for (const club of Object.values(result.state.clubs)) {
      if (!club.active) continue;
      const memberships = leagueCompetitions(result.state).filter((competition) =>
        competition.clubIds.includes(club.id),
      );
      expect(memberships).toHaveLength(1);
    }

    // Six regions, and the county's own towns have not moved into any of them.
    expect(result.state.world.regionIds).toEqual(
      ALDERFORDSHIRE_DISTRICTS.map((district) => district.regionId),
    );
    for (const town of countyTowns) {
      expect(result.state.world.towns[town.id]!.regionId).toBe(town.regionId);
    }

    // Every ladder's cup is drawn for the new season, and the county cup exists
    // now that there is a county to have one.
    expect(Object.keys(result.state.fixtures[LEAGUE_CUP_ID]?.matchdayOf ?? {}).length).toBeGreaterThan(0);
    expect(result.state.competitions[PLATE_ID]).toBeDefined();
    expect(result.state.competitions[COUNTY_CUP_ID]).toBeDefined();
  });

  it('rejects a save from a newer game before any migration is attempted', async () => {
    const legacy = stripToVersion7(legacyCareer('migration-too-new'));
    legacy.version = GAME_STATE_VERSION + 1;
    expect((await readMigrated(legacy)).error).toMatch(/newer version/i);
  });
});

/**
 * The county's second district, for a career that predates it.
 *
 * The migration and the roll-over are deliberately two different moments.
 * Opening an old save answers the question — the marker — and the next season
 * boundary is what acts on it, because a ladder cannot be spliced into a season
 * whose fixtures are half played without inventing results. Everything here is
 * about that gap: what the save is while it waits, and what it is after.
 */
describe('the district next door', () => {
  it('marks a one-ladder save as waiting for it, without touching the world', async () => {
    const before = legacyCareer('migration-district');
    const legacy = stripToVersion23(before);

    const result = await readMigrated(legacy);
    expect(result.error).toBeNull();
    expect(result.version).toBe(GAME_STATE_VERSION);

    // The question is asked and answered: this career is owed a district, and
    // will be given one at its next season boundary.
    expect(result.state.worldExpansion).toEqual({ pending: true });
    // And nothing else about the world has moved. One ladder, one region, the
    // towns, clubs, competitions, fixtures and calendar the save was written
    // with — the season in flight is the season the manager left behind.
    expect(result.state.pyramidIds).toEqual([FOUNDING_PYRAMID_ID]);
    expect(result.state.world.regionIds).toEqual([FOUNDING_REGION_ID]);
    expect(Object.keys(result.state.world.regions)).toHaveLength(1);
    expect(Object.keys(result.state.clubs)).toHaveLength(Object.keys(before.clubs).length);
    expect(Object.keys(result.state.world.towns)).toHaveLength(Object.keys(before.world.towns).length);
    expect(result.state.season.calendar).toEqual(before.season.calendar);
    for (const competition of Object.values(before.competitions)) {
      expect(result.state.competitions[competition.id], competition.id).toEqual(competition);
    }
    for (const [matchId, match] of Object.entries(before.matches)) {
      expect(result.state.matches[matchId], matchId).toEqual(match);
    }

    // Loading the same save twice is the same answer twice, not a second
    // district waiting behind the first.
    const again = await readMigrated(legacy);
    expect(again.state.worldExpansion).toEqual({ pending: true });
    expect(again.state.pyramidIds).toEqual([FOUNDING_PYRAMID_ID]);
    expect(Object.keys(again.state.clubs)).toHaveLength(Object.keys(before.clubs).length);
  });

  it('answers the question for a career that already has the whole county', async () => {
    const whole = stripToVersion23(countyCareer('migration-district-six'));

    const result = await readMigrated(whole);

    // A career founded with every district cannot be expanded a second time: the
    // migration records that it was asked, and that nothing was owed.
    expect(result.state.worldExpansion).toEqual({ pending: false });
    expect(result.state.pyramidIds).toHaveLength(ALDERFORDSHIRE_DISTRICTS.length);
    expect(Object.keys(result.state.world.regions)).toHaveLength(ALDERFORDSHIRE_DISTRICTS.length);
  });

  it('owes a two-ladder career the four districts the map has added since', async () => {
    // Every save the game wrote between the district next door and the whole
    // county: two ladders, and four districts it has never had.
    const two = stripToVersion23(career('migration-district-two'));

    const result = await readMigrated(two);

    expect(result.state.worldExpansion).toEqual({ pending: true });
    expect(result.state.pyramidIds).toHaveLength(2);
    expect(Object.keys(result.state.world.regions)).toHaveLength(2);
    // And nothing was founded on opening it: the districts arrive at the season
    // boundary, not in the middle of a season already being played.
    expect(Object.keys(result.state.clubs)).toHaveLength(72);
  });

  it('keeps a career waiting for its district across a save and a reload', async () => {
    const legacy = stripToVersion23(legacyCareer('migration-district-saved'));
    const migrated = (await readMigrated(legacy)).state;
    const clubs = Object.keys(migrated.clubs).length;

    // Saved before the boundary: the marker is part of the career rather than of
    // the session that opened it, and reading the career back does not found a
    // district in the middle of the season.
    const saved = await saveGame(migrated, 'slot-pending');
    expect(saved.error).toBeNull();
    const reloaded = (await loadGame('slot-pending')).state!;
    expect(reloaded.worldExpansion).toEqual({ pending: true });
    expect(reloaded.pyramidIds).toEqual([FOUNDING_PYRAMID_ID]);
    expect(Object.keys(reloaded.world.regions)).toHaveLength(1);
    expect(Object.keys(reloaded.clubs)).toHaveLength(clubs);
  });

  it('gives a marked career its districts at the boundary, once, and keeps them', async () => {
    const legacy = stripToVersion23(legacyCareer('migration-district-rollover'));
    const migrated = (await readMigrated(legacy)).state;
    const countyClubs = Object.keys(migrated.clubs).sort();

    settleLeague(migrated);
    finishSeason(migrated);
    startNextSeason(migrated);

    const districts = migrated.pyramidIds.slice(1);
    const expandedIn = migrated.season.id;
    expect(migrated.pyramidIds).toHaveLength(ALDERFORDSHIRE_DISTRICTS.length);
    expect(districts).toHaveLength(ALDERFORDSHIRE_DISTRICTS.length - 1);
    expect(migrated.worldExpansion).toEqual({ pending: false, expandedInSeasonId: expandedIn });
    for (const clubId of countyClubs) expect(migrated.clubs[clubId]).toBeDefined();

    // The world it has just been given is a world the game *plays*: the autumn
    // runs through the real day loop — lineups picked, fixtures resolved, rounds
    // drawn as their afternoon arrives — until the county cup's opening round has
    // been played out, which is the first afternoon the two ladders meet.
    const countyCupOpening = Object.values(migrated.matches)
      .filter((match) => match.competitionId === COUNTY_CUP_ID)
      .map((match) => match.date)
      .sort()[0]!;
    let days = 0;
    while (migrated.date <= countyCupOpening && days < 200) {
      processDay(migrated, migrated.date, { resolveUserMatch: true });
      days += 1;
    }
    expect(days).toBeLessThan(200);
    const playedIn = (pyramidId: string) =>
      Object.values(migrated.matches).some(
        (match) => match.played && match.competitionId.startsWith(`comp_${pyramidId}_`),
      );
    expect(playedIn(FOUNDING_PYRAMID_ID)).toBe(true);
    for (const district of districts) expect(playedIn(district), district).toBe(true);
    expect(migrated.competitions[COUNTY_CUP_ID]!.cup!.round).toBeGreaterThan(1);
    expect(migrated.phase).toBe('season');
    // Nobody was asked to play twice on one afternoon, in either ladder or in the
    // cup that spans them.
    const onADate = new Map<string, string[]>();
    for (const match of Object.values(migrated.matches)) {
      if (!match.played) continue;
      onADate.set(match.date, [...(onADate.get(match.date) ?? []), match.homeClubId, match.awayClubId]);
    }
    for (const [date, clubsOnIt] of onADate) {
      expect(new Set(clubsOnIt).size, date).toBe(clubsOnIt.length);
    }

    // After the boundary, saved and reloaded: the expanded world is the world the
    // save holds, and the marker is spent rather than waiting to be spent again.
    await saveGame(migrated, 'slot-expanded');
    const reloaded = (await loadGame('slot-expanded')).state!;
    expect(reloaded.pyramidIds).toEqual([FOUNDING_PYRAMID_ID, ...districts]);
    expect(reloaded.worldExpansion).toEqual({ pending: false, expandedInSeasonId: expandedIn });
    expect(Object.keys(reloaded.world.regions)).toHaveLength(ALDERFORDSHIRE_DISTRICTS.length);
    for (const clubId of countyClubs) expect(reloaded.clubs[clubId]).toBeDefined();

    // And the boundary after that finds nothing to found: the same six ladders,
    // the same map, the same five districts.
    const towns = Object.keys(reloaded.world.towns).length;
    const clubs = Object.keys(reloaded.clubs).length;
    settleLeague(reloaded);
    finishSeason(reloaded);
    startNextSeason(reloaded);
    expect(reloaded.pyramidIds).toEqual([FOUNDING_PYRAMID_ID, ...districts]);
    expect(Object.keys(reloaded.world.regions)).toHaveLength(ALDERFORDSHIRE_DISTRICTS.length);
    expect(Object.keys(reloaded.world.towns)).toHaveLength(towns);
    expect(Object.keys(reloaded.clubs)).toHaveLength(clubs);
    expect(reloaded.worldExpansion).toEqual({ pending: false, expandedInSeasonId: expandedIn });
    // Half a season of football through the real day loop, over a county of six
    // ladders and two boundaries' worth of saves, is most of what this test costs:
    // it is given a timeout of its own rather than the default, and a generous one
    // because the world it plays in is three times the world this test was
    // written in.
  }, 300_000);
});

describe('bringing localStorage careers across', () => {
  /** Write a career the way the old build did: a JSON string under its key. */
  function writeLegacy(state: GameState, slot: string, auto = false): SaveSlotInfo {
    const savedAt = new Date().toISOString();
    localStorage.setItem(
      `slfm26.save.${slot}`,
      JSON.stringify({ version: GAME_STATE_VERSION, savedAt, state }),
    );
    const info: SaveSlotInfo = {
      slot,
      saveName: state.saveName,
      clubName: state.clubs[state.userClubId]?.identity.name ?? 'Unknown club',
      date: state.date,
      seasonLabel: state.season.label,
      savedAt,
      seed: state.seed,
      ...(auto ? { auto: true } : {}),
    };
    return info;
  }

  function legacyIndex(entries: SaveSlotInfo[]): void {
    localStorage.setItem('slfm26.saves', JSON.stringify(entries));
  }

  it('imports a career and its resume mark', async () => {
    const state = playedOn(career('legacy-single'), 6);
    legacyIndex([writeLegacy(state, 'slot-1')]);
    localStorage.setItem('slfm26.resume', 'slot-1');

    const report = await migrateLegacySaves();

    expect(report.imported).toEqual(['slot-1']);
    expect(report.complete).toBe(true);
    const loaded = await loadGame('slot-1');
    expect(loaded.state?.date).toBe(state.date);
    expect(await resumeSlot()).toBe('slot-1');
  });

  it('imports several careers and the autosave, keeping them independent', async () => {
    const state = career('legacy-many');
    legacyIndex([
      writeLegacy(state, 'slot-1'),
      writeLegacy(state, 'slot-2'),
      writeLegacy(playedOn(state, 4), AUTOSAVE_SLOT, true),
    ]);

    const report = await migrateLegacySaves();
    expect(report.imported.sort()).toEqual([AUTOSAVE_SLOT, 'slot-1', 'slot-2']);
    expect(report.complete).toBe(true);

    const slots = await listSaveSlots();
    expect(slots).toHaveLength(3);
    expect(slots.find((entry) => entry.slot === AUTOSAVE_SLOT)!.auto).toBe(true);
    expect(slots.find((entry) => entry.slot === 'slot-1')!.auto).toBeUndefined();
    expect((await loadGame(AUTOSAVE_SLOT)).state!.date).toBe(addDays(state.date, 4));
    expect((await loadGame('slot-1')).state!.date).toBe(state.date);
  });

  it('brings across a career the old index had lost track of', async () => {
    // The index could be stale or half-written; a career the manager can see
    // must not be the one thing left behind.
    const state = career('legacy-orphan');
    writeLegacy(state, 'slot-orphan');
    legacyIndex([]);

    const report = await migrateLegacySaves();
    expect(report.imported).toEqual(['slot-orphan']);
    expect((await loadGame('slot-orphan')).state?.seed).toBe(state.seed);
  });

  it('carries a corrupt career across the rest without losing it', async () => {
    const state = career('legacy-corrupt');
    legacyIndex([writeLegacy(state, 'slot-good')]);
    localStorage.setItem('slfm26.save.slot-bad', '{ this is not a save');
    localStorage.setItem('slfm26.save.slot-broken', JSON.stringify({ version: GAME_STATE_VERSION }));
    // A save that parses, claims a version, and is shaped wrongly enough that
    // describing it for the slot list would throw. It used to be able to take
    // the whole migration — and every other manager's career — down with it.
    localStorage.setItem(
      'slfm26.save.slot-shapeless',
      JSON.stringify({ version: GAME_STATE_VERSION, savedAt: new Date().toISOString(), state: { seed: 'x' } }),
    );

    const report = await migrateLegacySaves();

    expect(report.imported).toEqual(['slot-good']);
    expect(report.failed.sort()).toEqual(['slot-bad', 'slot-broken', 'slot-shapeless']);
    // Not complete, so a later run looks again — and still imports nothing new.
    expect(report.complete).toBe(false);
    // The good career came across.
    expect((await loadGame('slot-good')).state).not.toBeNull();
    // And the bad ones are exactly where they were, untouched.
    expect(localStorage.getItem('slfm26.save.slot-bad')).toBe('{ this is not a save');
    expect(localStorage.getItem('slfm26.save.slot-broken')).not.toBeNull();
  });

  it('never deletes the old careers', async () => {
    const state = career('legacy-kept');
    legacyIndex([writeLegacy(state, 'slot-1')]);
    localStorage.setItem('slfm26.resume', 'slot-1');

    await migrateLegacySaves();

    // The fallback the manager would use if the database is refused later.
    expect(localStorage.getItem('slfm26.save.slot-1')).not.toBeNull();
    expect(localStorage.getItem('slfm26.saves')).not.toBeNull();
    expect(localStorage.getItem('slfm26.resume')).toBe('slot-1');
  });

  it('does not run twice, and does not duplicate on a second run', async () => {
    const state = career('legacy-idempotent');
    legacyIndex([writeLegacy(state, 'slot-1'), writeLegacy(state, 'slot-2')]);

    const first = await migrateLegacySaves();
    expect(first.skipped).toBe(false);
    expect(first.imported).toHaveLength(2);

    const second = await migrateLegacySaves();
    expect(second.skipped).toBe(true);
    expect(second.imported).toHaveLength(0);

    expect(await listSaveSlots()).toHaveLength(2);
  });

  it('does not overwrite a career the manager has played on since', async () => {
    // Interrupting the migration leaves no completion flag, so it runs again —
    // and must not undo the newer career now sitting in that slot.
    const old = career('legacy-overwrite');
    const older = playedOn(old, 1);
    const newer = playedOn(old, 40);
    legacyIndex([writeLegacy(older, 'slot-1')]);

    // The import runs, then the manager plays and saves the same slot.
    await migrateLegacySaves();
    await idb.put(idb.METADATA, { key: 'migration.localStorage.v1', value: 'complete' });
    await idb.deleteKey(idb.METADATA, 'migration.localStorage.v1');
    await saveGame(newer, 'slot-1');

    const rerun = await migrateLegacySaves();
    expect(rerun.imported).toEqual([]);
    expect((await loadGame('slot-1')).state!.date).toBe(addDays(old.date, 40));
  });

  it('brings careers across automatically at startup', async () => {
    const state = playedOn(career('legacy-startup'), 9);
    legacyIndex([writeLegacy(state, 'slot-1')]);
    localStorage.setItem('slfm26.resume', 'slot-1');

    useGameStore.setState({ ready: false, game: null, view: 'start' });
    await bootStore();

    // The migration has already run by the time the store is ready, so the
    // manager is put straight back into the career he left.
    expect(useGameStore.getState().ready).toBe(true);
    expect(useGameStore.getState().view).toBe('dashboard');
    expect(useGameStore.getState().game?.date).toBe(state.date);
  });

  it('does nothing when there is nothing in localStorage to bring across', async () => {
    const report = await migrateLegacySaves();
    expect(report.imported).toEqual([]);
    expect(report.complete).toBe(true);
    expect(await listSaveSlots()).toEqual([]);
  });
});

describe('the order careers are listed in', () => {
  const slot = (name: string, savedAt: string, auto = false): SaveSlotInfo => ({
    slot: name,
    saveName: name,
    clubName: `${name} FC`,
    date: '2026-09-01',
    seasonLabel: '2026/27',
    savedAt,
    seed: name,
    ...(auto ? { auto: true } : {}),
  });

  it('puts the most recently saved career at the top', () => {
    const ordered = orderSaves([
      slot('slot-1', '2026-09-01T10:00:00.000Z'),
      slot('slot-2', '2026-09-03T10:00:00.000Z'),
      slot('autosave', '2026-09-02T10:00:00.000Z', true),
    ]);
    expect(ordered.map((entry) => entry.slot)).toEqual(['slot-2', 'autosave', 'slot-1']);
  });

  it('does not give the autosave a place of its own', () => {
    // The career played five minutes ago is the one wanted, whichever slot it is in.
    const ordered = orderSaves([
      slot('autosave', '2026-09-01T10:00:00.000Z', true),
      slot('slot-1', '2026-09-04T10:00:00.000Z'),
    ]);
    expect(ordered[0]!.slot).toBe('slot-1');
  });

  it('leaves the list it was given alone', () => {
    const given = [slot('slot-1', '2026-09-01T10:00:00.000Z'), slot('slot-2', '2026-09-03T10:00:00.000Z')];
    orderSaves(given);
    expect(given.map((entry) => entry.slot)).toEqual(['slot-1', 'slot-2']);
    expect(orderSaves([])).toEqual([]);
  });
});

describe('writes that overlap', () => {
  it('stores the newest career when a burst of snapshots arrives, and writes fewer times than it was asked to', async () => {
    const state = career('coalesced-burst');
    // A watched match, a day advancing, a team sheet being dragged: six
    // snapshots of one career, every one of them asked for in the same turn.
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map((days) => autosave(playedOn(state, days))));

    expect(results.every((result) => result.error === null)).toBe(true);
    expect((await loadGame(AUTOSAVE_SLOT)).state!.date).toBe(addDays(state.date, 6));

    // A superseded snapshot settles with the answer of the write that replaced
    // it — the same record object — so fewer distinct answers than questions is
    // the evidence that they were dropped rather than each written out.
    const answers = new Set(results.map((result) => result.info));
    expect(answers.size).toBeGreaterThanOrEqual(1);
    expect(answers.size).toBeLessThan(results.length);
  });

  it('never drops a manual save: an instruction is carried out, not coalesced away', async () => {
    const state = career('coalesced-manual');
    const [manual] = await Promise.all([
      saveGame(playedOn(state, 1), 'slot-1'),
      autosave(playedOn(state, 2)),
      autosave(playedOn(state, 3)),
    ]);

    expect(manual.info?.slot).toBe('slot-1');
    expect((await loadGame('slot-1')).state!.date).toBe(addDays(state.date, 1));
    expect((await loadGame(AUTOSAVE_SLOT)).state!.date).toBe(addDays(state.date, 3));
  });
});

describe('a browser that will not store', () => {
  it('reports the failure rather than a save that did not happen', async () => {
    const state = career('no-storage');
    idb.resetForTests();
    globalThis.indexedDB = undefined as unknown as IDBFactory;

    const result = await saveGame(state, 'slot-1');

    expect(result.info).toBeNull();
    expect(result.error).toMatch(/database|storage|blocked/i);
  });

  it('names each kind of storage trouble for what it is', async () => {
    const held = await storageFailureReason(
      new idb.StorageUnavailableError('Another tab is holding this game’s storage open.'),
    );
    expect(held).toMatch(/another tab/i);

    const full = await storageFailureReason(new DOMException('no room', 'QuotaExceededError'));
    expect(full).toMatch(/no room left/i);

    // A value the browser refuses to clone is this game's fault and is named as
    // such: dressed up as a storage problem, it would send whoever has to fix it
    // looking at the manager's disk.
    const uncloneable = await storageFailureReason(new DOMException('no', 'DataCloneError'));
    expect(uncloneable).toMatch(/fault in this game/i);

    const other = await storageFailureReason(new Error('who knows'));
    expect(other).toMatch(/would not store that save/i);
  });

  it('leaves the failed value reported as a failure, not as a silently skipped write', async () => {
    const state = career('unholdable');
    const unholdable = { ...state, nonsense: () => 'not structured-cloneable' } as unknown as GameState;

    const result = await saveGame(unholdable, 'slot-bad');

    expect(result.info).toBeNull();
    expect(result.error).not.toBeNull();
  });
});

describe('asking the browser to keep the careers', () => {
  function installStorageManager(answer: boolean): { persist: ReturnType<typeof vi.fn> } {
    const manager = { persisted: vi.fn(async () => false), persist: vi.fn(async () => answer) };
    vi.stubGlobal('navigator', { storage: manager });
    return manager;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    resetStoragePersistenceForTests();
  });

  it('asks when a career first lands, and not before it', async () => {
    const manager = installStorageManager(true);
    resetStoragePersistenceForTests();
    expect(manager.persist).not.toHaveBeenCalled();

    await saveGame(career('ask-after-write'), 'slot-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(manager.persist).toHaveBeenCalledTimes(1);
    expect(storagePersistenceStatus()).toEqual({ asked: true, status: 'granted' });
  });

  // Two whole careers are built and written here, and a career is two ladders
  // now: under the slow suite's own load this is seconds of work, not slack — so
  // the case is given the budget the work needs rather than the default fifth of
  // it. The assertions are unchanged.
  it('asks once however many careers are written, and a refusal is not a failure', { timeout: 30_000 }, async () => {
    const manager = installStorageManager(false);
    resetStoragePersistenceForTests();

    expect(await askToKeepStorage()).toEqual({ asked: true, status: 'denied' });
    await saveGame(career('ask-once'), 'slot-1');
    await saveGame(career('ask-once-too'), 'slot-2');
    await askToKeepStorage();

    // A question repeated on every write is noise, and noise gets refused.
    expect(manager.persist).toHaveBeenCalledTimes(1);
  });

  it('does not ask a browser that has no storage manager at all', async () => {
    vi.stubGlobal('navigator', {});
    resetStoragePersistenceForTests();

    expect(await askToKeepStorage()).toEqual({ asked: true, status: 'unsupported' });
  });

  it('says plainly that a browser keeping the storage is still not a promise', () => {
    const granted = storagePersistenceNote('granted');
    expect(granted).toMatch(/export/i);
    expect(granted).not.toMatch(/never be lost|permanent(ly)? safe/i);
    expect(storagePersistenceNote('denied')).toMatch(/best-effort/i);
    expect(storagePersistenceNote('unsupported')).toMatch(/export/i);
  });
});

describe('a career that will not open', () => {
  it('is reported rather than quietly dropped back to the menu', async () => {
    const state = career('corrupt-resume');
    await autosave(state);

    // Damage the stored record the way a half-written one would be. The career
    // stays in the database: what is being tested is what the game says about
    // it, not whether it is thrown away — nothing here deletes anything.
    const record = await idb.get<IndexedSaveRecord>(idb.SAVES, AUTOSAVE_SLOT);
    await idb.put(idb.SAVES, {
      ...record!,
      file: { ...record!.file, state: { ...record!.file.state, people: null } },
    });

    const resumed = await resumeCareer();

    expect(resumed.state).toBeNull();
    expect(resumed.slot).toBe(AUTOSAVE_SLOT);
    expect(resumed.error).toMatch(/could not be reopened/i);
    // Still there, still listed, and the mark is cleared so the menu is reachable.
    expect((await listSaveSlots()).map((entry) => entry.slot)).toEqual([AUTOSAVE_SLOT]);
    expect(await resumeSlot()).toBeNull();
  });
});

describe('the store reporting a stalled autosave', () => {
  it(
    'tells the manager when the career stops reaching storage, and stops saying so when it can be written again',
    { timeout: 30_000 },
    async () => {
    const store = useGameStore.getState();
    await store.quitToMenu();
    store.createDraft('autosave-lost-storage');
    store.chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);
    await waitFor(async () => (await resumeSlot()) === AUTOSAVE_SLOT, 'the first autosave to land');

    // The browser's storage goes away mid-session.
    idb.resetForTests();
    globalThis.indexedDB = undefined as unknown as IDBFactory;
    useGameStore.setState({ game: playedOn(useGameStore.getState().game!, 1) });

    await waitFor(async () => useGameStore.getState().saveFailure !== null, 'the failure to be reported');
    expect(useGameStore.getState().saveFailure).toMatch(/database|storage/i);
    expect(useGameStore.getState().error).not.toBeNull();

    // Storage comes back: the next write lands and the worry is dropped.
    freshDatabase();
    useGameStore.setState({ game: playedOn(useGameStore.getState().game!, 1) });

    await waitFor(async () => useGameStore.getState().saveFailure === null, 'the failure to be cleared');
  });
});

/* ------------------------------------------------------------------------ *
 * Helpers for building old saves
 * ------------------------------------------------------------------------ */

/** Push a current career back to an older save version, for the migrations. */
async function readMigrated(
  legacy: { version: number; savedAt: string; state: GameState },
): Promise<{ version: number; state: GameState; error: string | null }> {
  // Written to the database as it would have been stored, and read back through
  // the normal path, so this exercises the real pipeline rather than reaching
  // into the migration directly.
  await idb.put(idb.SAVES, {
    slot: 'legacy',
    file: { version: legacy.version, savedAt: legacy.savedAt, state: legacy.state },
    info: {
      slot: 'legacy',
      saveName: legacy.state.saveName,
      clubName: 'Legacy',
      date: legacy.state.date,
      seasonLabel: legacy.state.season.label,
      savedAt: legacy.savedAt,
      seed: legacy.state.seed,
    },
  });
  const result = await loadGame('legacy');
  // The version that matters is the one the career now carries, not the one the
  // stored record still names: loading migrates in memory and, as it always has,
  // does not write the migrated career back over the original.
  return { version: result.state?.version ?? legacy.version, state: result.state!, error: result.error };
}

/** A career as a version 7 save left it: one league, no cups, no pyramid. */
/**
 * Take the pyramid model back out of a career, the way a save written before it
 * would have been stored: no pyramid records, no pyramid list, no regions, and
 * no region on any town. What is left is a world described only by the ladder it
 * is playing — which is exactly what a pre-change save holds.
 */
describe('a county of its own', () => {
  /** A career as version 26 left it: a named county, and no county record. */
  function legacyCounties(state: GameState): { version: number; savedAt: string; state: GameState } {
    const legacy = structuredClone(state);
    delete (legacy.world as { counties?: unknown }).counties;
    delete (legacy.world as { countyIds?: unknown }).countyIds;
    for (const region of Object.values(legacy.world.regions)) delete (region as { countyId?: unknown }).countyId;
    for (const town of Object.values(legacy.world.towns)) delete (town as { countyId?: unknown }).countyId;
    return { version: 26, savedAt: new Date().toISOString(), state: legacy };
  }

  it('gives a save written before counties one, holding every region, town and ladder it has', async () => {
    const legacy = legacyCounties(career('migration-county'));
    const before = {
      regionIds: [...legacy.state.world.regionIds],
      townIds: Object.keys(legacy.state.world.towns).sort(),
      pyramidIds: [...legacy.state.pyramidIds],
      divisionIds: leagueCompetitions(legacy.state).map((competition) => competition.id),
      cupIds: Object.values(legacy.state.competitions)
        .filter((competition) => competition.kind === 'cup')
        .map((competition) => competition.id)
        .sort(),
      honours: Object.values(legacy.state.clubs).flatMap((club) => club.history.honours),
    };

    const result = await readMigrated(legacy);
    expect(result.error).toBeNull();
    expect(result.version).toBe(GAME_STATE_VERSION);

    // One county, named what the save already called itself, holding the regions
    // the world was drawn from.
    expect(result.state.world.countyIds).toEqual([FOUNDING_COUNTY_ID]);
    const county = result.state.world.counties[FOUNDING_COUNTY_ID]!;
    expect(county.id).toBe(FOUNDING_COUNTY_ID);
    expect(county.name).toBe(FOUNDING_COUNTY_NAME);
    // The county's name and the name the career reads for itself are one fact,
    // written in both places from the one word the save carried.
    expect(county.name).toBe(result.state.world.countyName);
    expect(county.regionIds).toEqual(before.regionIds);
    for (const region of Object.values(result.state.world.regions)) {
      expect(region.countyId).toBe(FOUNDING_COUNTY_ID);
    }
    for (const town of Object.values(result.state.world.towns)) expect(town.countyId).toBe(FOUNDING_COUNTY_ID);

    // A ladder is in the county because the region it draws from is, and nothing
    // the career already held has moved: the same towns, the same competitions,
    // the same honours.
    expect(result.state.pyramidIds).toEqual(before.pyramidIds);
    for (const pyramidId of result.state.pyramidIds) {
      expect(countyIdOfPyramid(result.state, pyramidId)).toBe(FOUNDING_COUNTY_ID);
    }
    expect(Object.keys(result.state.world.towns).sort()).toEqual(before.townIds);
    expect(leagueCompetitions(result.state).map((competition) => competition.id)).toEqual(before.divisionIds);
    expect(
      Object.values(result.state.competitions)
        .filter((competition) => competition.kind === 'cup')
        .map((competition) => competition.id)
        .sort(),
    ).toEqual(before.cupIds);
    expect(Object.values(result.state.clubs).flatMap((club) => club.history.honours)).toEqual(before.honours);
  });

  it('does not grow a second county when it is applied twice', async () => {
    const legacy = legacyCounties(career('county-twice'));
    const once = await readMigrated(legacy);
    const twice = await readMigrated({ ...legacy, version: 26, state: structuredClone(once.state) });

    expect(twice.state.world.countyIds).toEqual([FOUNDING_COUNTY_ID]);
    expect(Object.keys(twice.state.world.counties)).toEqual([FOUNDING_COUNTY_ID]);
    expect(twice.state.world.counties[FOUNDING_COUNTY_ID]!.regionIds).toEqual(
      once.state.world.counties[FOUNDING_COUNTY_ID]!.regionIds,
    );
    for (const town of Object.values(twice.state.world.towns)) expect(town.countyId).toBe(FOUNDING_COUNTY_ID);
  });

  it('keeps the entrant set of a cup that says nothing about which county it is', async () => {
    // A county cup written before counties had ids names no county, and a cup
    // that names no county is the career's own — the founding county, which is
    // where every club of a one-county career is — rather than a licence to enter
    // every county a later world might hold.
    const state = career('county-legacy-field');
    const cup = state.competitions[COUNTY_CUP_ID]!;
    expect(cupFieldOf(cup.cup)).toEqual({ kind: 'county' });
    expect(storedCupField({ kind: 'county', countyId: FOUNDING_COUNTY_ID })).toEqual({ kind: 'county' });
    expect(storedCupField({ kind: 'county', countyId: 'county_2' })).toEqual({ kind: 'county', countyId: 'county_2' });

    const inTheCup = new Set(fieldClubs(state, cupFieldOf(cup.cup)));
    expect(inTheCup).toEqual(new Set(countyClubIds(state)));
    expect(new Set(fieldClubs(state, { kind: 'county' }))).toEqual(inTheCup);
    // Every active club in the career, and both ladders of it.
    expect(inTheCup.size).toBe(Object.values(state.clubs).filter((club) => club.active).length);
    expect(inTheCup.size).toBe(72);

    const reloaded = (await readMigrated({ version: 27, savedAt: new Date().toISOString(), state: structuredClone(state) })).state;
    expect(new Set(fieldClubs(reloaded, cupFieldOf(reloaded.competitions[COUNTY_CUP_ID]!.cup)))).toEqual(inTheCup);
  });

  it('keeps its county across a save and a reload', async () => {
    const state = career('county-round-trip');
    await saveGame(state, 'slot-1');
    const loaded = (await loadGame('slot-1')).state!;

    expect(loaded.world.countyIds).toEqual(state.world.countyIds);
    expect(loaded.world.counties[FOUNDING_COUNTY_ID]).toEqual(state.world.counties[FOUNDING_COUNTY_ID]);
    for (const town of Object.values(loaded.world.towns)) expect(town.countyId).toBe(FOUNDING_COUNTY_ID);
    expect(
      Object.values(loaded.world.regions).map((region) => region.countyId),
    ).toEqual(Object.values(state.world.regions).map((region) => region.countyId));
  });
});

describe('a county with a name', () => {
  /** The district next door's name in a save: what no rename may touch. */
  function districtRegion(state: GameState): string {
    return Object.values(state.world.regions)[1]?.name ?? state.world.regionName;
  }

  /**
   * A career as version 25 left it: a county named by its seed, and a cup called
   * flatly 'County Cup'.
   *
   * Both words are put back by hand rather than by stripping a field, because
   * that is what the old save actually holds — it was not written without a
   * county name, it was written with a different one — and three clubs keep an
   * honour each: in the county's old words, in the founding ladder's old words
   * (its cups were named after no district then), and in a district's own name,
   * which no rename reaches. The season archive is given a county cup too: it
   * holds a copy of the name, and a copy is a name to bring forward.
   */
  function legacyNaming(state: GameState): { version: number; savedAt: string; state: GameState } {
    const legacy = structuredClone(state);
    legacy.world.countyName = 'Marsworthshire';
    delete (legacy.world as { nationName?: string }).nationName;
    legacy.competitions[COUNTY_CUP_ID]!.name = 'County Cup';
    const clubs = Object.values(legacy.clubs);
    clubs[0]!.history.honours = ['2019/20 County Cup winners'];
    clubs[1]!.history.honours = [`2019/20 ${LEAGUE_CUP_NAME} winners`];
    clubs[2]!.history.honours = [`2019/20 ${districtRegion(state)} ${LEAGUE_CUP_NAME} winners`];
    legacy.seasonHistory = [
      {
        seasonId: 'season_2019_20',
        seasonLabel: '2019/20',
        leagues: [],
        cups: [
          {
            competitionId: COUNTY_CUP_ID,
            name: 'County Cup',
            clubIds: [],
            rounds: [],
            winnerClubId: null,
            runnerUpClubId: null,
          },
        ],
      },
    ];
    return { version: 25, savedAt: new Date().toISOString(), state: legacy };
  }

  it('names the county, the cup that is its own, and the honours won in it', async () => {
    const state = career('naming-v25');
    const region = state.world.regionName;
    const clubNames = Object.values(state.clubs).map((club) => club.identity.name).sort();
    const result = await readMigrated(legacyNaming(state));

    expect(result.error).toBeNull();
    expect(result.state.world.countyName).toBe(FOUNDING_COUNTY_NAME);
    expect(result.state.world.nationName).toBe(NATION_NAME);
    expect(result.state.competitions[COUNTY_CUP_ID]!.name).toBe(COUNTY_CUP_NAME);
    expect(result.state.seasonHistory!.at(-1)!.cups[0]!.name).toBe(COUNTY_CUP_NAME);

    // The founding ladder's cups are named after its district now, so the honours
    // won in them are brought forward with them — in the save's own words, which
    // for a career this old is the valley it has always played in.
    expect(result.state.competitions[LEAGUE_CUP_ID]!.name).toBe(`${region} ${LEAGUE_CUP_NAME}`);

    const honours = Object.values(result.state.clubs).flatMap((club) => club.history.honours);
    expect(honours).toContain(`2019/20 ${COUNTY_CUP_NAME} winners`);
    expect(honours).not.toContain('2019/20 County Cup winners');
    expect(honours).toContain(`2019/20 ${region} ${LEAGUE_CUP_NAME} winners`);
    expect(honours).not.toContain(`2019/20 ${LEAGUE_CUP_NAME} winners`);
    // A district's cup honour is in words no rename reaches: it was already named
    // after its own region, and it is left exactly as it was.
    expect(honours).toContain(`2019/20 ${districtRegion(state)} ${LEAGUE_CUP_NAME} winners`);

    // And the county's *places* are exactly where they were: the name is a name,
    // not a reason to lay the world out again.
    expect(Object.values(result.state.clubs).map((club) => club.identity.name).sort()).toEqual(clubNames);
    expect(Object.values(result.state.world.towns).map((town) => town.name).sort()).toEqual(
      Object.values(state.world.towns).map((town) => town.name).sort(),
    );
    expect(Object.keys(result.state.matches).length).toBe(Object.keys(state.matches).length);
    expect(Object.values(result.state.world.regions).map((region) => region.name)).toEqual(
      Object.values(state.world.regions).map((region) => region.name),
    );
  });

  it('reads the same again however many times it is loaded', async () => {
    // The new name ends in the old one, so a second pass over a renamed honour
    // is the one thing this migration could get wrong twice.
    const legacy = legacyNaming(career('naming-twice'));
    const once = await readMigrated(legacy);
    const twice = await readMigrated({ ...legacy, version: 25, state: structuredClone(once.state) });
    const honours = Object.values(twice.state.clubs).flatMap((club) => club.history.honours);
    expect(honours).toContain(`2019/20 ${COUNTY_CUP_NAME} winners`);
    expect(honours.filter((honour) => honour.includes(COUNTY_CUP_NAME)).length).toBe(1);
    expect(twice.state.world.countyName).toBe(FOUNDING_COUNTY_NAME);
  });

  it('leaves a career that already knows what county it is in alone', async () => {
    const legacy = legacyNaming(career('naming-current'));
    // The same career, saved by a build that already names the county: nothing in
    // it is old, so nothing in it is rewritten. The migration is a step for saves
    // written before the name existed, and this one was not.
    const result = await readMigrated({
      version: GAME_STATE_VERSION,
      savedAt: new Date().toISOString(),
      state: structuredClone(legacy.state),
    });
    expect(result.error).toBeNull();
    expect(result.state.world.countyName).toBe('Marsworthshire');
    expect(result.state.competitions[COUNTY_CUP_ID]!.name).toBe('County Cup');
  });
});

function stripPyramidModel(state: GameState): void {
  delete (state as { pyramids?: unknown }).pyramids;
  delete (state as { pyramidIds?: unknown }).pyramidIds;
  delete (state.world as { regions?: unknown }).regions;
  delete (state.world as { regionIds?: unknown }).regionIds;
  // A save this old predates counties as well: no county records, no county the
  // world reads first, and no county on any town. The migrations that give it one
  // are the ones being asked about.
  delete (state.world as { counties?: unknown }).counties;
  delete (state.world as { countyIds?: unknown }).countyIds;
  for (const town of Object.values(state.world.towns)) {
    delete (town as { regionId?: unknown }).regionId;
    delete (town as { countyId?: unknown }).countyId;
  }
}

function stripToVersion7(state: GameState): { version: number; savedAt: string; state: GameState } {
  const legacy = structuredClone(state);
  const division = Object.values(legacy.competitions).find((competition) => competition.kind === 'league');
  if (!division) throw new Error('expected a division to reduce to one league');

  // Only the division the manager's club is in survives, under its old id.
  const keeper = division;
  legacy.competitions = { comp_league_1: { ...keeper, id: 'comp_league_1', tier: 1, promotionPlaces: undefined, relegationPlaces: undefined } };
  legacy.fixtures = { comp_league_1: legacy.fixtures[keeper.id] ?? { competitionId: 'comp_league_1', byMatchday: {}, matchdayOf: {} } };
  for (const match of Object.values(legacy.matches)) {
    match.competitionId = 'comp_league_1';
  }
  delete (legacy as { pyramid?: unknown }).pyramid;
  delete (legacy as { promotionHistory?: unknown }).promotionHistory;
  stripPyramidModel(legacy);
  return { version: 7, savedAt: new Date().toISOString(), state: legacy };
}

/**
 * A save from just before the county's second district: the world as the last
 * version of the game wrote it, one ladder and no marker either way.
 *
 * There is nothing to strip but the answer itself: a version 23 save has regions
 * and pyramids, and whether it is owed a district is the question the migration
 * asks — it is not a field the save carries.
 */
function stripToVersion23(state: GameState): { version: number; savedAt: string; state: GameState } {
  const legacy = structuredClone(state);
  delete (legacy as { worldExpansion?: unknown }).worldExpansion;
  return { version: 23, savedAt: new Date().toISOString(), state: legacy };
}

/**
 * A save from just before regions and pyramids: the same world, with its ladder
 * back as one loose configuration and no geography above the towns.
 */
function stripToVersion22(state: GameState): { version: number; savedAt: string; state: GameState } {
  const legacy = structuredClone(state);
  (legacy as GameState & { pyramid?: LegacyPyramidConfig }).pyramid = {
    ...legacy.pyramids[FOUNDING_PYRAMID_ID]!.config,
  };
  stripPyramidModel(legacy);
  return { version: 22, savedAt: new Date().toISOString(), state: legacy };
}

/** The shape the ladder had as a single loose configuration. */
type LegacyPyramidConfig = GameState['pyramids'][string]['config'];

/** The old singular configuration, read off a save written before pyramids. */
function legacyConfig(state: GameState): LegacyPyramidConfig {
  const config = (state as GameState & { pyramid?: LegacyPyramidConfig }).pyramid;
  if (!config) throw new Error('expected a legacy ladder configuration');
  return config;
}

/** A career as a version 8 save left it: a pyramid, but no development curves. */
function stripToVersion8(state: GameState): { version: number; savedAt: string; state: GameState } {
  const legacy = structuredClone(state);
  delete (legacy as { promotionHistory?: unknown }).promotionHistory;
  return { version: 8, savedAt: new Date().toISOString(), state: legacy };
}

/**
 * A save from just before round identity: the same world, with the round left
 * out of every cup tie and the version number to match.
 */
function stripToVersion21(state: GameState): { version: number; savedAt: string; state: GameState } {
  const legacy = structuredClone(state);
  for (const match of Object.values(legacy.matches)) delete (match as { cupRound?: number }).cupRound;
  return { version: 21, savedAt: new Date().toISOString(), state: legacy };
}