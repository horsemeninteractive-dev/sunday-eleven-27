import { useCallback, useState } from 'react';
import { UNSORTED, type SortAccessors, type SortDirection, type SortState } from './tableSort';

/**
 * Which heading every table in the game was left on.
 *
 * Every table here sorts by its columns, and until now every one of them forgot
 * the moment the manager walked to another screen: he decides he reads his squad
 * by age, taps Age, goes to look at the league table, comes back, and the names
 * are in the order the screen chose again. That is the sort of small tax that
 * makes a feature not worth having, and it is the same tax on nine screens.
 *
 * So the remembering is done once, here, and every screen asks for it. The keys a
 * choice may name are the keys of the screen's own accessor map — the same map
 * `applySort` is handed — so a screen cannot remember a column it does not draw
 * or draw a column it cannot remember: there is one list, and it is the one that
 * sorts the rows.
 *
 * Where the choice is kept is the interesting decision, and it is the same one
 * `ui/selectionSort.ts` made for the list a side is picked from: in browser
 * storage under `se27.ui.sort.<screen>.<career>`, the namespace the panel layout
 * already uses, rather than in the career's own file. A sort is a reading of a
 * table rather than a fact about the world, so a save handed to somebody else
 * should not arrive carrying the last manager's view of it; nothing that is only
 * about how a screen looks is worth a save-format version; and it is asked for
 * per career all the same, because two saves hold two different squads, tables
 * and ledgers, and a manager reading one of them by age is not necessarily
 * reading the other that way.
 *
 * None of it is allowed to fail loudly. A career that is not open, a browser with
 * no storage at all, storage that throws, a value from a version that has since
 * renamed or dropped a column — all of them open the table in the order the
 * screen chose, which is what the table is for. A note about browser storage over
 * a league table would cost more room than the sort does.
 */

/**
 * The screens that remember which heading they were left on.
 *
 * A register rather than a free string, for two reasons: two screens cannot
 * accidentally share a key, and a screen that sorts a table and does not appear
 * in this list is a test failure rather than a table that quietly never
 * remembers anything. `ClubSelectView` is deliberately absent — it sorts clubs
 * while a manager is choosing one, which is before a career exists to keep the
 * choice under.
 */
export const SORT_SCREENS = [
  'squad',
  'league',
  'world',
  'recruitment',
  'training',
  'finances',
  'history',
  'selection',
  'profile-career',
  'profile-squad',
] as const;

export type SortScreen = (typeof SORT_SCREENS)[number];

export const SORT_KEY_PREFIX = 'se27.ui.sort.';

export function sortChoiceKey(screen: SortScreen, saveId: string): string {
  return `${SORT_KEY_PREFIX}${screen}.${saveId}`;
}

/**
 * Read a remembered choice, and never fail because of one.
 *
 * Anything unreadable, or naming a column this screen does not have, becomes the
 * order the screen chose for the rows. A remembered column from a version that
 * has since lost or renamed it must not leave the table with no heading pressed
 * and no order either.
 */
export function readSortChoice<K extends string>(value: string | null, keys: readonly K[]): SortState<K> {
  try {
    const parsed: unknown = value ? JSON.parse(value) : null;
    if (!parsed || typeof parsed !== 'object') return { ...UNSORTED };
    const candidate = parsed as { key?: unknown; direction?: unknown };
    if (typeof candidate.key !== 'string' || !(keys as readonly string[]).includes(candidate.key)) {
      return { ...UNSORTED };
    }
    const direction: SortDirection = candidate.direction === 'desc' ? 'desc' : 'asc';
    return { key: candidate.key as K, direction };
  } catch {
    return { ...UNSORTED };
  }
}

function store(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** What this screen was last sorted by in this career, or its own order. */
export function loadSortChoice<K extends string>(
  screen: SortScreen,
  saveId: string | null,
  keys: readonly K[],
): SortState<K> {
  if (!saveId) return { ...UNSORTED };
  const backing = store();
  if (!backing) return { ...UNSORTED };
  try {
    return readSortChoice(backing.getItem(sortChoiceKey(screen, saveId)), keys);
  } catch {
    return { ...UNSORTED };
  }
}

/** Remember it, and say whether the browser took it. */
export function rememberSortChoice<K extends string>(
  screen: SortScreen,
  saveId: string | null,
  state: SortState<K>,
): boolean {
  if (!saveId) return false;
  const backing = store();
  if (!backing) return false;
  try {
    backing.setItem(sortChoiceKey(screen, saveId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/**
 * The sort state of a table, which is the one it was left on.
 *
 * A screen says what it is and which career it is in, hands over the accessor map
 * it already sorts with, and gets back the same `[sort, setSort]` pair it would
 * have got from `useState` — with the difference that the first value is read
 * before the first paint and every value written is written down. Handing it the
 * accessors rather than a list of column names is what makes the columns a screen
 * can sort by and the columns it can remember the same list.
 */
export function useRememberedSort<T, K extends string>(
  screen: SortScreen,
  saveId: string | null,
  accessors: SortAccessors<T, K>,
): [SortState<K>, (next: SortState<K>) => void] {
  const [sort, setSort] = useState<SortState<K>>(() => loadSortChoice(screen, saveId, Object.keys(accessors) as K[]));
  const remember = useCallback(
    (next: SortState<K>) => {
      setSort(next);
      rememberSortChoice(screen, saveId, next);
    },
    [screen, saveId],
  );
  return [sort, remember];
}
