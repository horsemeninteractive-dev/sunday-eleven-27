import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A saved career can be removed, from the screens that list it.
 *
 * Saving and loading were the only two things the game could do to a save, so a
 * career a manager had finished with sat in its slot forever and the only way to
 * be rid of it was to clear the browser's storage, which takes every other
 * career with it. Two screens list saved careers — the save screen inside a
 * career and the menu's Continue list — and both now offer to remove one, which
 * is a thing that would regress in silence if it were dropped from either.
 *
 * The control itself is pinned here rather than the two screens' markup: one
 * destructive act, asked about in one place and in one set of words, so the two
 * lists cannot drift into asking different questions about the same thing.
 */

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('deleting a saved career', () => {
  it('is offered wherever a saved career is listed', () => {
    for (const file of ['src/ui/dialogs/SaveManager.tsx', 'src/ui/views/StartView.tsx']) {
      expect(source(file), `${file} lists saved careers without offering to remove one`).toContain(
        'DeleteSaveButton',
      );
    }
  });

  it('asks first, and points at the copy that survives it', () => {
    const control = source('src/ui/components/DeleteSave.tsx');
    expect(control).toContain('kind="confirm"');
    // The deletion goes through the store, which is the thing that knows about
    // the autosave's timer, and the answer is what the screen acts on.
    expect(control).toContain('deleteSave(slot)');
    expect(control).toContain('export');
  });

  it('is offered on the menu for the autosave, and not from inside the career writing it', () => {
    // The autosave is the career being played, kept level with itself by a
    // debounced write. Removing it from inside the game is a deletion the
    // manager's next change would undo, so the control belongs on the menu,
    // where nothing is writing it — and the row here says so.
    const manager = source('src/ui/dialogs/SaveManager.tsx');
    const autosaveRow = manager.split('\n').find((line) => line.includes('Autosave ·')) ?? '';
    expect(autosaveRow).not.toContain('DeleteSaveButton');
    expect(manager).toContain('remove it from the main menu');
    // The menu's list gives it to every row it draws, the autosave included.
    const menu = source('src/ui/views/StartView.tsx');
    const list = menu.slice(menu.indexOf('saves.map((save)'));
    expect(list).toContain('slot={save.slot}');
    expect(list).toContain('DeleteSaveButton');
  });
});
