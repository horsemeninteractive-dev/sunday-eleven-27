import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { GameState } from '@/domain/game';
import { generateDraft, startGameFromDraft } from '@/simulation/gameSetup';
import { AUTOSAVE_SLOT, listSaveSlots, resumeSlot } from '@/state/persistence';
import { flushAutosave, scheduleAutosave, useGameStore } from '@/state/gameStore';
import * as idb from '@/state/indexedDb';

/**
 * Deleting a saved career, from the game's side rather than the database's.
 *
 * The menu and the save screen both go through the store's own action, and the
 * store is where the one thing the database cannot know about lives: the
 * autosave is written by a debounced timer, and a timer that has not come round
 * yet is holding a whole career on its way into the slot the manager is
 * clearing. That a debounced write does land when it is left alone is covered in
 * `state/persistence.test.ts`; the question here is only what happens to it when
 * the manager asks for the career to be gone.
 */

function career(seed: string): GameState {
  const draft = generateDraft({ seed, startYear: 2026, pyramids: 2 });
  return startGameFromDraft(draft, {
    seed,
    startYear: 2026,
    clubId: draft.divisionClubIds[0]!,
    saveName: `Test — ${seed}`,
  });
}

beforeEach(() => {
  idb.resetForTests();
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  // The career first, then the timer: a write handed over here would otherwise
  // land in the next test's database instead of this one's.
  useGameStore.setState({ game: null, session: null, view: 'start', error: null, notice: null });
  flushAutosave();
  idb.resetForTests();
});

describe('removing a saved career from the game', () => {
  it('empties the slot and leaves the career on screen where it is', async () => {
    const state = career('store-delete-a-slot');
    useGameStore.setState({ game: state, view: 'dashboard', error: null, notice: null });
    expect(await useGameStore.getState().saveGame('slot-1')).toBe(true);

    expect(await useGameStore.getState().deleteSave('slot-1')).toBe(true);

    expect((await listSaveSlots()).map((entry) => entry.slot)).not.toContain('slot-1');
    // The season in front of the manager is untouched: a deletion is about what
    // is on this browser's disk, not about the career he is playing.
    expect(useGameStore.getState().game).toBe(state);
    expect(useGameStore.getState().error).toBeNull();
  });

  it('takes the debounced autosave off the clock, so the career does not come back', async () => {
    const state = career('store-delete-the-autosave');
    // Handing the store a career is what a career being played looks like from
    // here, and it is also what puts an autosave on the clock.
    useGameStore.setState({ game: state, view: 'dashboard' });
    scheduleAutosave(state);

    expect(await useGameStore.getState().deleteSave(AUTOSAVE_SLOT)).toBe(true);

    // Longer than the debounce, so a timer left running would have fired by now
    // and put the career back.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(await listSaveSlots()).toHaveLength(0);
    expect(await resumeSlot()).toBeNull();
  });

  it('holds the manager to the truth when the browser will not remove it', async () => {
    useGameStore.setState({ game: career('store-delete-refused'), view: 'dashboard' });
    expect(await useGameStore.getState().saveGame('slot-1')).toBe(true);

    // The browser's storage goes away underneath the game, which is the failure
    // this whole module keeps its composure about: the answer is no, and the
    // manager is told why rather than being shown an empty slot.
    idb.resetForTests();
    globalThis.indexedDB = undefined as unknown as IDBFactory;

    expect(await useGameStore.getState().deleteSave('slot-1')).toBe(false);
    expect(useGameStore.getState().error).toContain('would not remove');
  });
});
