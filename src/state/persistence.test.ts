import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { generateDraft, startGameFromDraft } from '@/simulation/gameSetup';
import { addDays } from '@/simulation/calendar';
import { GAME_STATE_VERSION, type GameState } from '@/domain/game';
import type { FaceChoices } from '@/domain/face';
import { bootStore, flushAutosave, useGameStore } from './gameStore';
import * as idb from './indexedDb';
import {
  AUTOSAVE_SLOT,
  autosave,
  deleteSave,
  deserialiseGame,
  listSaveSlots,
  loadGame,
  migrateLegacySaves,
  orderSaves,
  resumeCareer,
  resumeSlot,
  saveGame,
  serialiseGame,
  setResumeSlot,
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
  const draft = generateDraft({ seed, startYear: 2026 });
  return startGameFromDraft(draft, {
    seed,
    startYear: 2026,
    clubId: draft.divisionClubIds[0]!,
    saveName: `Test — ${seed}`,
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
    const info = await saveGame(state, 'slot-1');

    expect(info).not.toBeNull();
    expect(info!.slot).toBe('slot-1');
    expect(info!.clubName).toBe(state.clubs[state.userClubId]!.identity.name);
    expect(info!.seed).toBe(state.seed);

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
    expect(await autosave(state)).toBe(true);

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
    expect(resumed).not.toBeNull();
    expect(resumed!.date).toBe(state.date);
    expect(resumed!.userClubId).toBe(state.userClubId);
    expect(resumed!.seed).toBe(state.seed);
  });

  it('forgets where to resume on quit, without losing the save', async () => {
    await autosave(career('autosave-quit'));

    await useGameStore.getState().quitToMenu();

    expect(await resumeSlot()).toBeNull();
    expect(await resumeCareer()).toBeNull();
    expect((await listSaveSlots()).map((entry) => entry.slot)).toEqual([AUTOSAVE_SLOT]);
  });

  it('does not lock the game out when the mark points at a save that has gone', async () => {
    await setResumeSlot('slot-3');
    expect(await resumeCareer()).toBeNull();
    expect(await resumeSlot()).toBeNull();
  });

  it('forgets a mark pointing at a slot the manager deletes', async () => {
    await autosave(career('autosave-delete'));
    await deleteSave(AUTOSAVE_SLOT);
    expect(await resumeSlot()).toBeNull();
    expect(await listSaveSlots()).toHaveLength(0);
  });

  it('does not block on the manager while a write is in flight', async () => {
    // An autosave is handed to the database and returns; it does not hold the
    // store up, so play continues while it is written.
    const state = career('autosave-not-blocking');
    const pending = autosave(state);
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).resolves.toBe(true);
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
    await expect(saveGame(unholdable, 'slot-bad')).resolves.toBeNull();

    await autosave(playedOn(state, 3));
    expect((await loadGame(AUTOSAVE_SLOT)).state!.date).toBe(addDays(state.date, 3));
  });
});

describe('the store’s autosave', () => {
  it('writes once, a moment after the manager stops rather than on every change', async () => {
    const store = useGameStore.getState();
    await useGameStore.getState().quitToMenu();
    store.createDraft('autosave-timing');
    store.chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);

    // The write is on a timer, and the timer has not come round yet. Waiting
    // for the debounce is the point: the manager has not stopped.
    expect(await resumeSlot()).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(await resumeSlot()).toBe(AUTOSAVE_SLOT);
    expect((await listSaveSlots()).filter((entry) => entry.auto)).toHaveLength(1);
  });

  it('keeps up with the calendar, so a reload lands where the manager left off', async () => {
    const store = useGameStore.getState();
    await useGameStore.getState().quitToMenu();
    store.createDraft('autosave-calendar');
    store.chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const before = useGameStore.getState().game!;
    await store.advanceDays(3);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const onDisk = await resumeCareer();
    expect(onDisk).not.toBeNull();
    expect(onDisk!.date).toBe(useGameStore.getState().game!.date);
    expect(onDisk!.date).toBe(addDays(before.date, 3));
  });

  it('does not write out a change that was only ever on screen', async () => {
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

  it('flushes a pending write when the page is going away', async () => {
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

    expect(await saveGame(state, 'slot-1')).toBeNull();
    expect(await autosave(state)).toBe(false);
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
    const draft = generateDraft({ seed: 'face-in-the-save', startYear: 2026 });
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
    const state = career('migration-v7');
    const legacy = stripToVersion7(state);

    const result = await readMigrated(legacy);
    expect(result.version).toBe(GAME_STATE_VERSION);
    expect(result.state.pyramid?.tiers).toBe(3);
    expect(result.state.pyramid?.clubsPerTier).toBe(12);
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
    const state = career('migration-curves');
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
    const state = career('migration-profile');
    const legacy = stripToVersion8(state);
    delete (legacy.state as { managerProfile?: unknown }).managerProfile;

    const result = await readMigrated(legacy);
    expect(result.state.managerProfile?.surname).toBeTruthy();
    expect(result.state.training).toBeDefined();
    expect(Array.isArray(result.state.training!.history)).toBe(true);
  });

  it('rejects a save from a newer game before any migration is attempted', async () => {
    const legacy = stripToVersion7(career('migration-too-new'));
    legacy.version = GAME_STATE_VERSION + 1;
    expect((await readMigrated(legacy)).error).toMatch(/newer version/i);
  });
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
  return { version: 7, savedAt: new Date().toISOString(), state: legacy };
}

/** A career as a version 8 save left it: a pyramid, but no development curves. */
function stripToVersion8(state: GameState): { version: number; savedAt: string; state: GameState } {
  const legacy = structuredClone(state);
  delete (legacy as { promotionHistory?: unknown }).promotionHistory;
  return { version: 8, savedAt: new Date().toISOString(), state: legacy };
}