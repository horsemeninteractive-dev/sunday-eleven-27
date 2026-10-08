/**
 * The headings over the list a side is picked from.
 *
 * The list opens in the side's own order, and these seven are how a manager reads
 * it another way: by name, by position, by who is fittest or in the best form.
 * The keys and the words on the headings are declared together so a heading that
 * could be remembered and not drawn — or drawn and not remembered — is not
 * something this file can express, and `teamSelection.test.ts` holds the list
 * against the accessors that actually sort the rows, which is the other half of
 * the same promise.
 *
 * Which of them is in use is not here: that is `ui/rememberedSort.ts`, which is
 * also what every other table in the game uses to be left where it was.
 */

export type SelectionSortKey = 'player' | 'pos' | 'condition' | 'form' | 'morale' | 'availability' | 'fit';

/** The headings over the list, in the order they are offered. */
export const SELECTION_SORT_KEYS: Array<{ key: SelectionSortKey; label: string }> = [
  { key: 'player', label: 'Player' },
  { key: 'pos', label: 'Pos' },
  { key: 'condition', label: 'Fitness' },
  { key: 'form', label: 'Form' },
  { key: 'morale', label: 'Morale' },
  { key: 'availability', label: 'Availability' },
  { key: 'fit', label: 'Fit' },
];
