/**
 * Sorting a table by its columns.
 *
 * Every table in the game sorts the same way, so the rules live here rather
 * than in eleven views: the first tap on a heading sorts by that column, the
 * second turns it round, and the third puts the rows back the way the screen
 * wanted them — which matters, because some of these tables are only useful in
 * the order they arrive in (the league table, the ledger, the squad list).
 *
 * Ordering is done on values the screen already has, so a column reads the same
 * number it prints and nothing is re-derived to sort by.
 */

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string = string> {
  key: K | null;
  direction: SortDirection;
}

/**
 * No sort at all: the rows keep the order the screen worked out for them.
 * Keyed on `never` so one shared constant can start any table off, whatever
 * columns that table happens to have.
 */
export const UNSORTED: SortState<never> = { key: null, direction: 'asc' };

/** What a column hands the sorter for one row. Numbers sort as numbers. */
export type SortValue = number | string | null | undefined;

export type SortAccessors<T, K extends string> = Record<K, (row: T) => SortValue>;

/** Up, down, off: one tap on a heading. */
export function toggleSort<K extends string>(state: SortState<K>, key: K): SortState<K> {
  if (state.key !== key) return { key, direction: 'asc' };
  if (state.direction === 'asc') return { key, direction: 'desc' };
  return { key: null, direction: 'asc' };
}

function isBlank(value: SortValue): boolean {
  return value === null || value === undefined || value === '';
}

function compare(left: SortValue, right: SortValue): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right), 'en-GB', { numeric: true, sensitivity: 'base' });
}

/**
 * The rows, in the order the headings ask for.
 *
 * Empty values sink to the bottom whichever way the table is pointing: a
 * nowhere-row is not the best row just because the sort was reversed, and a
 * player with no goals should not outrank one with three.
 */
export function applySort<T, K extends string>(
  rows: readonly T[],
  state: SortState<K>,
  accessors: SortAccessors<T, K>,
): T[] {
  const read = state.key ? accessors[state.key] : undefined;
  if (!read) return [...rows];
  const flip = state.direction === 'asc' ? 1 : -1;
  return [...rows].sort((leftRow, rightRow) => {
    const left = read(leftRow);
    const right = read(rightRow);
    if (isBlank(left) || isBlank(right)) {
      if (isBlank(left) && isBlank(right)) return 0;
      return isBlank(left) ? 1 : -1;
    }
    return compare(left, right) * flip;
  });
}
