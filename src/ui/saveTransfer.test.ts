import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { GAME_STATE_VERSION, type GameState } from '@/domain/game';
import { generateDraft, startGameFromDraft } from '@/simulation/gameSetup';
import { careerFileName, exportCareer } from '@/state/careerFile';
import { AUTOSAVE_SLOT, autosave, loadGame, resumeSlot, saveGame } from '@/state/persistence';
import { flushAutosave, useGameStore } from '@/state/gameStore';
import * as idb from '@/state/indexedDb';
import {
  cancelImport,
  confirmImport,
  exportCurrentCareer,
  exportNotice,
  stageCareerFile,
  stagedCareer,
} from './saveTransfer';

/**
 * Getting a career out of the game and back in again.
 *
 * These run against a real database (`fake-indexeddb`) and the real store,
 * because the whole point of the flow is the order it does things in: a file is
 * read, nothing happens, and only a confirmed import writes anything. A test
 * that stubbed the store could pass while the game opened a career it had never
 * managed to store — which is the one outcome the flow exists to prevent.
 */

function career(seed: string): GameState {
  const draft = generateDraft({ seed, startYear: 2026 });
  return startGameFromDraft(draft, {
    seed,
    startYear: 2026,
    clubId: draft.divisionClubIds[0]!,
    saveName: `Test — ${seed}`,
  });
}

function freshDatabase(): void {
  idb.resetForTests();
  globalThis.indexedDB = new IDBFactory();
}

/** A host application that writes files, as a packaged build will provide. */
function installHost(
  outcome: boolean | { written: boolean; location?: string } | (() => Promise<boolean>) = true,
): { written: Array<{ name: string; text: string }> } {
  const written: Array<{ name: string; text: string }> = [];
  (globalThis as { se27Host?: unknown }).se27Host = {
    saveTextFile: async (name: string, text: string) => {
      written.push({ name, text });
      return typeof outcome === 'function' ? await outcome() : outcome;
    },
  };
  return { written };
}

beforeEach(() => {
  freshDatabase();
});

afterEach(() => {
  // The store's autosave is on a timer; clearing the career first means a
  // pending one writes nothing into the next test's database rather than a
  // career from a test that has finished.
  useGameStore.setState({ game: null, session: null, view: 'start' });
  flushAutosave();
  idb.resetForTests();
  delete (globalThis as { se27Host?: unknown }).se27Host;
});

describe('exporting a career', () => {
  it('writes one file, named for the club and the day, and says what it wrote', async () => {
    const state = career('export-named');
    useGameStore.setState({ game: state });
    const host = installHost();

    const result = await exportCurrentCareer();

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.fileName).toBe(careerFileName(state));
    expect(result.fileName).toMatch(/\.json$/);
    expect(host.written).toHaveLength(1);
    expect(host.written[0]!.name).toBe(result.fileName);

    // What was written is a career file this game can read: the envelope says
    // what it is, and the career inside it is the one on screen.
    const file = JSON.parse(host.written[0]!.text) as { format: string; version: number; state: GameState };
    expect(file.format).toBe('se27.career');
    expect(file.version).toBe(GAME_STATE_VERSION);
    expect(file.state.seed).toBe(state.seed);
    expect(file.state.date).toBe(state.date);
  });

  it('says where the file went when the host that wrote it can say', async () => {
    // The Android shell writes the career into the device's own Downloads
    // collection and says so. On a phone that place is the whole answer to "where
    // is my backup" — the file name alone leaves the manager hunting.
    useGameStore.setState({ game: career('export-location') });
    const host = installHost({ written: true, location: 'Downloads' });

    const result = await exportCurrentCareer();

    expect('error' in result).toBe(false);
    if ('error' in result) return;
    expect(result.location).toBe('Downloads');
    expect(host.written).toHaveLength(1);

    // And the sentence he reads names the place, exactly once.
    expect(exportNotice(result)).toBe(
      `Career written to ${result.fileName} in Downloads. Keep it somewhere you will find it again.`,
    );
  });

  it('keeps the sentence to the file name when the host does not know where', async () => {
    // A host that only answers yes or no has told the game where nothing is, and
    // an invented place is worse than none.
    useGameStore.setState({ game: career('export-no-location') });
    installHost(true);

    const result = await exportCurrentCareer();

    if ('error' in result) throw new Error('expected the export to succeed');
    expect(result.location).toBeUndefined();
    expect(exportNotice(result)).not.toMatch(/ in /);
    expect(exportNotice(result)).toContain(result.fileName);
  });

  it('says there is nothing to export rather than writing an empty file', async () => {
    useGameStore.setState({ game: null });
    const host = installHost();

    const result = await exportCurrentCareer();

    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toMatch(/no career open/i);
    expect(host.written).toHaveLength(0);
  });

  it('tells the manager when this browser has nowhere to put the file', async () => {
    // No host and no document: the situation a build with no host and no
    // download support would be in.
    useGameStore.setState({ game: career('export-nowhere') });

    const result = await exportCurrentCareer();

    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toMatch(/cannot write files/i);
    // And the career is exactly where it was: exporting is a copy, never a move.
    expect(useGameStore.getState().game).not.toBeNull();
  });

  /**
   * The defect that started all of this: the packaged build said a career had
   * been exported while nothing was written anywhere, because its WebView has no
   * download manager and the page had no way to tell. A host that refuses, with
   * no browser download behind it to fall back on, therefore has to come back as
   * a sentence — this is that case at the level the manager experiences it, and
   * the thing it pins is that no notice is published. On the save screen a
   * notice is the game telling him he has a copy.
   */
  it('never reports an export the host refused, in a build with no download behind it', async () => {
    useGameStore.setState({ game: career('export-refused'), notice: null, error: null });
    // A phone: the host is there and refused, and there is no document for the
    // browser's own download to be attempted with.
    installHost({ written: false });

    const result = await exportCurrentCareer();

    expect('error' in result).toBe(true);
    if (!('error' in result)) return;
    expect(result.error).toMatch(/nowhere to put the career/i);
    // Nothing is claimed, and the career is exactly where it was.
    expect(useGameStore.getState().notice).toBeNull();
    expect(useGameStore.getState().game).not.toBeNull();
  });
});

describe('importing a career file', () => {
  it('reads a career the game exported, and opens it only once it is stored', async () => {
    const state = career('import-round-trip');
    const host = installHost();
    useGameStore.setState({ game: state });

    // Exported the way the game exports it, so the file under test is the real
    // thing rather than a fixture written by hand in the test.
    const exported = await exportCurrentCareer();
    expect('error' in exported).toBe(false);
    const file = host.written[0]!;
    expect(file.name).toBe(careerFileName(state));

    // A fresh session: nothing open, nothing stored.
    useGameStore.setState({ game: null, view: 'start' });
    const staged = stageCareerFile(file.name, file.text);

    expect(staged).toEqual({ ok: true, error: null });
    expect(stagedCareer()?.career.clubName).toBe(state.clubs[state.userClubId]!.identity.name);
    // Staged is not opened: nothing has been written and the game is still on
    // the menu.
    expect(useGameStore.getState().game).toBeNull();
    expect((await loadGame(AUTOSAVE_SLOT)).state).toBeNull();
    expect(await resumeSlot()).toBeNull();

    expect(await confirmImport()).toBe(true);

    expect(stagedCareer()).toBeNull();
    expect(useGameStore.getState().game?.seed).toBe(state.seed);
    expect(useGameStore.getState().view).toBe('dashboard');
    // And it is on disk: the reload after this lands in the imported career.
    expect(await resumeSlot()).toBe(AUTOSAVE_SLOT);
    expect((await loadGame(AUTOSAVE_SLOT)).state?.date).toBe(state.date);
  });

  it('replaces the autosave and leaves the manager’s own slots exactly as they were', async () => {
    const mine = career('import-keeps-mine');
    await saveGame(mine, 'slot-1');
    useGameStore.setState({ game: mine });

    const incoming = career('import-incoming');
    stageCareerFile('incoming.json', exportCareer(incoming));
    expect(await confirmImport()).toBe(true);

    expect((await loadGame(AUTOSAVE_SLOT)).state?.seed).toBe(incoming.seed);
    expect((await loadGame('slot-1')).state?.seed).toBe(mine.seed);
  });

  it('refuses a file that is not a career file without touching the career being played', async () => {
    const mine = career('import-refuses');
    await autosave(mine);
    useGameStore.setState({ game: mine, view: 'dashboard' });

    const staged = stageCareerFile('holiday-photos.json', 'this is not JSON at all');

    expect(staged.ok).toBe(false);
    expect(staged.error).toMatch(/could not be read/i);
    expect(stagedCareer()).toBeNull();
    expect(useGameStore.getState().error).toBe(staged.error);
    expect(useGameStore.getState().game?.seed).toBe(mine.seed);
    expect((await loadGame(AUTOSAVE_SLOT)).state?.seed).toBe(mine.seed);
  });

  it('turns down a file from a newer build rather than half-reading it', async () => {
    const state = career('import-newer');
    const file = JSON.parse(exportCareer(state)) as { version: number };
    file.version = GAME_STATE_VERSION + 1;

    const staged = stageCareerFile('from-the-future.json', JSON.stringify(file));

    expect(staged.ok).toBe(false);
    expect(staged.error).toMatch(/newer version of the game/i);
    expect(stagedCareer()).toBeNull();
    expect(useGameStore.getState().game).toBeNull();
  });

  it('drops a file that was staged before a bad one, so only the last choice stands', async () => {
    const state = career('import-last-choice');
    expect(stageCareerFile('good.json', exportCareer(state)).ok).toBe(true);
    expect(stagedCareer()).not.toBeNull();

    expect(stageCareerFile('bad.json', '{}').ok).toBe(false);
    expect(stagedCareer()).toBeNull();
  });

  it('changes nothing at all when the manager cancels', async () => {
    const mine = career('import-cancelled');
    await autosave(mine);
    useGameStore.setState({ game: mine, view: 'dashboard' });
    const before = (await loadGame(AUTOSAVE_SLOT)).state!.date;

    const incoming = career('import-cancelled-other');
    stageCareerFile('other.json', exportCareer(incoming));
    cancelImport();

    expect(stagedCareer()).toBeNull();
    expect(useGameStore.getState().game?.seed).toBe(mine.seed);
    // The career that was protected is byte-for-byte the one that was there.
    expect((await loadGame(AUTOSAVE_SLOT)).state?.seed).toBe(mine.seed);
    expect((await loadGame(AUTOSAVE_SLOT)).state?.date).toBe(before);
  });

  it('will not open an imported career it could not store, and says so', async () => {
    const mine = career('import-unstorable');
    useGameStore.setState({ game: mine, view: 'dashboard' });
    const incoming = career('import-unstorable-other');
    stageCareerFile('other.json', exportCareer(incoming));

    // The browser's storage goes away between choosing the file and opening it.
    idb.resetForTests();
    globalThis.indexedDB = undefined as unknown as IDBFactory;

    expect(await confirmImport()).toBe(false);

    expect(useGameStore.getState().game?.seed).toBe(mine.seed);
    expect(useGameStore.getState().saveFailure).toMatch(/no database available|storage/i);
    expect(useGameStore.getState().error).toMatch(/has not been opened/i);
    // Still staged, so the manager can try again once there is room.
    expect(stagedCareer()).not.toBeNull();
  });
});
