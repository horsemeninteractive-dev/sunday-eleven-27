import { describe, expect, it } from 'vitest';
import { SELECTION_SORT_KEYS } from './selectionSort';

/**
 * The headings over the list a side is picked from.
 *
 * Which of them is in use is remembered by `ui/rememberedSort.ts`, along with
 * every other table in the game, and that is tested there. What is left here is
 * the list itself: seven headings, seven keys, one word each — and
 * `teamSelection.test.ts` holds those keys against the accessors that actually
 * sort the rows, which is the other half of the promise that a heading can be
 * pressed and can be remembered.
 */

describe('the headings over the selection list', () => {
  it('gives every heading a key of its own and a word to press', () => {
    const keys = SELECTION_SORT_KEYS.map((heading) => heading.key);
    expect(new Set(keys).size).toBe(SELECTION_SORT_KEYS.length);
    for (const heading of SELECTION_SORT_KEYS) expect(heading.label.trim()).not.toBe('');
    expect(SELECTION_SORT_KEYS).toHaveLength(7);
  });

  it('offers them in the order a manager reads a squad', () => {
    expect(SELECTION_SORT_KEYS.map((heading) => heading.label)).toEqual([
      'Player',
      'Pos',
      'Fitness',
      'Form',
      'Morale',
      'Availability',
      'Fit',
    ]);
  });
});
