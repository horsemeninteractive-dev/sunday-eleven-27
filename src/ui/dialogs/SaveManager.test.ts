import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isReadingSaves } from './SaveManager';

/**
 * What the save screen says while it reads the career.
 *
 * One line, and it has to stop when the read stops. A rejected `listSaves` used
 * to leave the list null for the life of the dialog, so "Reading saved careers…"
 * sat above an alert saying they could not be read at all — two answers to one
 * question, on the screen where the manager is deciding whether his career is
 * safe. The menu's own list of saves already settles it the same way.
 */
describe('the save screen while it is reading the saves', () => {
  it('says so only until the read is over, whether it worked or not', () => {
    expect(isReadingSaves(null, null)).toBe(true);
    // A read that failed is over as well: the alert is the answer now.
    expect(isReadingSaves(null, 'The saved careers could not be listed.')).toBe(false);
    // An empty list is a list.
    expect(isReadingSaves([], null)).toBe(false);
    // And a save that failed leaves the list on the screen where it was.
    expect(isReadingSaves([], 'The browser could not save this career.')).toBe(false);
  });

  it('is asked by the screen rather than restated in it', () => {
    const source = readFileSync('src/ui/dialogs/SaveManager.tsx', 'utf8');
    expect(source).toContain('isReadingSaves(saves, failure)');
    expect(source).toContain('{reading &&');
  });
});
