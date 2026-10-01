import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDraft, startGameFromDraft } from '@/simulation/gameSetup';
import { addDays } from '@/simulation/calendar';
import type { GameState } from '@/domain/game';
import { useGameStore } from './gameStore';
import {
  AUTOSAVE_SLOT,
  autosave,
  deleteSave,
  listSaveSlots,
  loadGame,
  orderSaves,
  resumeCareer,
  resumeSlot,
  saveGame,
  setResumeSlot,
  type SaveSlotInfo,
} from './persistence';

/**
 * Autosave.
 *
 * Sunday league is played in ten-minute bursts between other things, so the
 * manager should never have to remember to save and a closed tab should never
 * cost him a season — while the slots he makes himself have to keep behaving
 * exactly as they did. These are the rules that has to obey.
 */

/**
 * vitest runs in node, where there is no browser storage to write to. The stub
 * is a real map rather than a spy, so the save and load paths are exercised
 * rather than stubbed out.
 */
function installStorage(options: { failAbove?: number } = {}): void {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (options.failAbove !== undefined && String(value).length > options.failAbove) {
        throw new Error('QuotaExceededError');
      }
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  });
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

beforeEach(() => {
  installStorage();
  useGameStore.getState().quitToMenu();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the autosave', () => {
  it('keeps a copy of the career that can be read back', () => {
    const state = career('autosave-writes');
    expect(autosave(state)).toBe(true);

    const slots = listSaveSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0]!.slot).toBe(AUTOSAVE_SLOT);
    expect(slots[0]!.auto).toBe(true);
    expect(slots[0]!.clubName).toBe(state.clubs[state.userClubId]!.identity.name);
    expect(loadGame(AUTOSAVE_SLOT).state?.date).toBe(state.date);
  });

  it('comes back to the career the manager was playing', () => {
    const state = playedOn(career('autosave-resume'), 11);
    autosave(state);

    const resumed = resumeCareer();
    expect(resumed).not.toBeNull();
    expect(resumed!.date).toBe(state.date);
    expect(resumed!.userClubId).toBe(state.userClubId);
    expect(resumed!.seed).toBe(state.seed);
  });

  it('leaves the manager’s own slots exactly as he left them', () => {
    const state = career('autosave-slots');
    expect(saveGame(state, 'slot-1')).not.toBeNull();
    const clubSlotDate = loadGame('slot-1').state!.date;

    autosave(playedOn(state, 9));

    const slots = listSaveSlots();
    expect(slots.map((entry) => entry.slot).sort()).toEqual([AUTOSAVE_SLOT, 'slot-1']);
    expect(slots.find((entry) => entry.slot === 'slot-1')!.auto).toBeUndefined();
    // The manager's save is untouched by a career that has moved on without it.
    expect(loadGame('slot-1').state!.date).toBe(clubSlotDate);
    expect(loadGame(AUTOSAVE_SLOT).state!.date).toBe(addDays(state.date, 9));
  });

  it('forgets where to resume on quit, without losing the save', () => {
    autosave(career('autosave-quit'));

    useGameStore.getState().quitToMenu();

    expect(resumeSlot()).toBeNull();
    expect(resumeCareer()).toBeNull();
    expect(listSaveSlots().map((entry) => entry.slot)).toEqual([AUTOSAVE_SLOT]);
  });

  it('does not lock the game out when the mark points at a save that has gone', () => {
    setResumeSlot('slot-3');
    expect(resumeCareer()).toBeNull();
    expect(resumeSlot()).toBeNull();
  });

  it('forgets a mark pointing at a slot the manager deletes', () => {
    autosave(career('autosave-delete'));
    deleteSave(AUTOSAVE_SLOT);
    expect(resumeSlot()).toBeNull();
    expect(listSaveSlots()).toHaveLength(0);
  });

  it('reports a full browser rather than throwing into the manager’s way', () => {
    const state = career('autosave-full');
    installStorage({ failAbove: 16 });

    expect(saveGame(state, 'slot-1')).toBeNull();
    expect(autosave(state)).toBe(false);
    expect(listSaveSlots()).toHaveLength(0);
    // Nothing was written, so there is nothing to come back to.
    expect(resumeSlot()).toBeNull();
  });
});

describe('the store’s autosave', () => {
  it('writes once, a moment after the manager stops rather than on every change', () => {
    vi.useFakeTimers();
    const store = useGameStore.getState();
    store.createDraft('autosave-timing');
    store.chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);

    // A career has begun, but the write waits for the manager to settle.
    expect(resumeSlot()).toBeNull();
    vi.advanceTimersByTime(700);
    expect(resumeSlot()).toBeNull();

    vi.advanceTimersByTime(200);
    expect(resumeSlot()).toBe(AUTOSAVE_SLOT);
    expect(listSaveSlots().filter((entry) => entry.auto)).toHaveLength(1);
  });

  it('keeps up with the calendar, so a reload lands where the manager left off', () => {
    vi.useFakeTimers();
    const store = useGameStore.getState();
    store.createDraft('autosave-calendar');
    store.chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);
    vi.advanceTimersByTime(1000);

    const before = useGameStore.getState().game!;
    store.advanceDays(3);
    vi.advanceTimersByTime(1000);

    const onDisk = resumeCareer();
    expect(onDisk).not.toBeNull();
    expect(onDisk!.date).toBe(useGameStore.getState().game!.date);
    expect(onDisk!.date).toBe(addDays(before.date, 3));
  });

  it('does not write out a change that was only ever on screen', () => {
    vi.useFakeTimers();
    const store = useGameStore.getState();
    store.createDraft('autosave-presentation');
    store.chooseClub(useGameStore.getState().draft!.divisionClubIds[0]!);
    vi.advanceTimersByTime(1000);

    useGameStore.getState().setNotice(null);
    useGameStore.getState().setView('squad');
    useGameStore.getState().selectPlayer(null);
    vi.advanceTimersByTime(1000);

    // One autosave from choosing the club, and none from moving around the UI.
    expect(listSaveSlots().filter((entry) => entry.auto)).toHaveLength(1);
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
