import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  SORT_SCREENS,
  SORT_KEY_PREFIX,
  loadSortChoice,
  readSortChoice,
  rememberSortChoice,
  sortChoiceKey,
  useRememberedSort,
  type SortScreen,
} from './rememberedSort';
import { UNSORTED, applySort, type SortAccessors } from './tableSort';

/**
 * Every table in the game being left where it was.
 *
 * The promise a manager is given is a small one — that a table he has already
 * arranged looks the way he left it — and it is only kept if three things hold:
 * that the choice comes back as it went in, that it belongs to the screen and
 * the career it was made in, and that a browser which has lost it, or which
 * refuses to answer at all, opens the table in the order the screen chose. The
 * last of those is also the first: a column renamed since the choice was made is
 * a column this screen does not have.
 */

const KEYS = ['player', 'age'] as const;

function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, String(value)),
    removeItem: (key: string) => map.delete(key),
  });
  return map;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the column a table was left sorted by', () => {
  it('opens in the order the screen chose when nothing has been chosen', () => {
    for (const nothing of [null, '', 'not json at all', '{}', '[]', '7']) {
      expect(readSortChoice(nothing, KEYS)).toEqual(UNSORTED);
    }
  });

  it('gives back the column it was given, both ways round', () => {
    expect(readSortChoice(JSON.stringify({ key: 'age', direction: 'desc' }), KEYS)).toEqual({ key: 'age', direction: 'desc' });
    expect(readSortChoice(JSON.stringify({ key: 'player', direction: 'asc' }), KEYS)).toEqual({ key: 'player', direction: 'asc' });
    for (const key of KEYS) {
      expect(readSortChoice(JSON.stringify({ key, direction: 'asc' }), KEYS)).toEqual({ key, direction: 'asc' });
    }
  });

  it('sorts by a column it has when the rest of the record is nonsense', () => {
    // A hand-edited direction is a direction, and there are only two of them: the
    // column is worth keeping even when the rest of the value is not.
    expect(readSortChoice(JSON.stringify({ key: 'age', direction: 'sideways' }), KEYS)).toEqual({ key: 'age', direction: 'asc' });
    expect(readSortChoice(JSON.stringify({ key: 'age', direction: null }), KEYS)).toEqual({ key: 'age', direction: 'asc' });
  });

  it('refuses a column this screen does not have', () => {
    // A column renamed or dropped since the choice was made must not leave the
    // table claiming to be sorted by something that is not in it.
    expect(readSortChoice(JSON.stringify({ key: 'goals', direction: 'asc' }), KEYS)).toEqual(UNSORTED);
    expect(readSortChoice(JSON.stringify({ key: 12, direction: 'asc' }), KEYS)).toEqual(UNSORTED);
  });

  it('remembers the choice under the screen and the career it was made in', () => {
    const written = installStorage();
    expect(rememberSortChoice('squad', 'career-a', { key: 'age', direction: 'desc' })).toBe(true);
    expect(loadSortChoice('squad', 'career-a', KEYS)).toEqual({ key: 'age', direction: 'desc' });
    // Another screen is another table, and another career is another squad.
    expect(loadSortChoice('league', 'career-a', KEYS)).toEqual(UNSORTED);
    expect(loadSortChoice('squad', 'career-b', KEYS)).toEqual(UNSORTED);
    rememberSortChoice('squad', 'career-b', { key: 'player', direction: 'asc' });
    rememberSortChoice('league', 'career-a', { key: 'age', direction: 'asc' });
    expect(loadSortChoice('squad', 'career-a', KEYS)).toEqual({ key: 'age', direction: 'desc' });
    expect(loadSortChoice('squad', 'career-b', KEYS)).toEqual({ key: 'player', direction: 'asc' });
    // Named after the screen and the career, in the browser-local namespace.
    expect(sortChoiceKey('squad', 'career-a')).toBe(`${SORT_KEY_PREFIX}squad.career-a`);
    expect([...written.keys()].sort()).toEqual(
      [
        sortChoiceKey('league', 'career-a'),
        sortChoiceKey('squad', 'career-a'),
        sortChoiceKey('squad', 'career-b'),
      ].sort(),
    );
  });

  it("remembers that the screen's own order was chosen too", () => {
    installStorage();
    rememberSortChoice('squad', 'career-a', { key: 'age', direction: 'asc' });
    rememberSortChoice('squad', 'career-a', { key: null, direction: 'asc' });
    // The third tap means something — the order the screen chose for its rows is
    // an answer, not the absence of one — so it is remembered like the rest.
    expect(loadSortChoice('squad', 'career-a', KEYS)).toEqual(UNSORTED);
  });

  it('remembers nothing for a career that is not open', () => {
    const written = installStorage();
    expect(loadSortChoice('squad', null, KEYS)).toEqual(UNSORTED);
    expect(rememberSortChoice('squad', null, { key: 'age', direction: 'asc' })).toBe(false);
    expect([...written.keys()]).toEqual([]);
  });

  it('opens in the order the screen chose when the browser cannot remember anything', () => {
    // No storage at all, as in a browser with it switched off.
    vi.stubGlobal('localStorage', undefined);
    expect(loadSortChoice('squad', 'career-a', KEYS)).toEqual(UNSORTED);
    expect(rememberSortChoice('squad', 'career-a', { key: 'age', direction: 'asc' })).toBe(false);

    // And storage that is there but refuses: a table is not worth a warning.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage is not available');
      },
      setItem: () => {
        throw new Error('storage is not available');
      },
    });
    expect(loadSortChoice('squad', 'career-a', KEYS)).toEqual(UNSORTED);
    expect(rememberSortChoice('squad', 'career-a', { key: 'age', direction: 'asc' })).toBe(false);
  });
});

/** A table of two men, and the map that sorts it — the shape every screen has. */
type Row = { name: string; age: number };
const ROWS: Row[] = [
  { name: 'Ward', age: 31 },
  { name: 'Ashton', age: 24 },
];
const ACCESSORS: SortAccessors<Row, 'player' | 'age'> = {
  player: (row) => row.name,
  age: (row) => row.age,
};

/**
 * What a screen draws: which heading is pressed, and the rows under it. It draws
 * text rather than markup so the drawing can be compared as a sentence.
 */
function Table({ screen, saveId }: { screen: SortScreen; saveId: string | null }): string {
  const [sort] = useRememberedSort(screen, saveId, ACCESSORS);
  const rows = applySort(ROWS, sort, ACCESSORS);
  return `${sort.key ?? 'none'} ${sort.direction} ${rows.map((row) => row.name).join(' ')}`;
}

const drawn = (screen: SortScreen, saveId: string | null) =>
  renderToStaticMarkup(createElement(Table, { screen, saveId }));

describe('a screen that remembers its sort', () => {
  it('opens on the heading it was left on, before it is painted', () => {
    installStorage();
    // Nothing remembered: the rows are in the order the screen worked out.
    expect(drawn('squad', 'career-a')).toBe('none asc Ward Ashton');
    // Sorted by age, a second ago: that is what the table draws, on its first
    // paint, with no effect and no flash of the wrong order.
    rememberSortChoice('squad', 'career-a', { key: 'age', direction: 'asc' });
    expect(drawn('squad', 'career-a')).toBe('age asc Ashton Ward');
    rememberSortChoice('squad', 'career-a', { key: 'age', direction: 'desc' });
    expect(drawn('squad', 'career-a')).toBe('age desc Ward Ashton');
    // The third tap: the screen's own order came back, and is remembered.
    rememberSortChoice('squad', 'career-a', { key: null, direction: 'asc' });
    expect(drawn('squad', 'career-a')).toBe('none asc Ward Ashton');
  });

  it('opens on what this screen and this career were left on, and nobody else', () => {
    installStorage();
    rememberSortChoice('squad', 'career-a', { key: 'age', direction: 'asc' });
    expect(drawn('squad', 'career-a')).toBe('age asc Ashton Ward');
    expect(drawn('squad', 'career-b')).toBe('none asc Ward Ashton');
    expect(drawn('league', 'career-a')).toBe('none asc Ward Ashton');
    expect(drawn('squad', null)).toBe('none asc Ward Ashton');
  });

  it('opens in the screen order when the remembered column is not one of its own', () => {
    // A column from a version that had one, or from a screen whose columns have
    // changed since: the table still draws, in the order the screen chose.
    installStorage();
    rememberSortChoice('squad', 'career-a', { key: 'goals' as 'age', direction: 'asc' });
    expect(drawn('squad', 'career-a')).toBe('none asc Ward Ashton');
  });
});

/**
 * The register of screens, and the screens that use it.
 *
 * The list of screens in the module exists so that a screen which sorts a table
 * and forgets to remember it is a failure rather than a table that quietly
 * forgets, and so that two screens cannot end up sharing one key. Read off the
 * sources, because what is being checked is that every screen was changed.
 */
function uiSources(folder: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) found.push(...uiSources(path));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) found.push(path);
  }
  return found;
}

describe('every table in the game', () => {
  it('is in the register, and remembers its sort', () => {
    const users = new Map<string, string>();
    const direct: string[] = [];
    for (const file of uiSources('src/ui')) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/useRememberedSort\('([a-z-]+)'/g)) users.set(match[1]!, file);
      // The remembering module holds the one sort state that is not a screen's.
      if (file === 'src/ui/rememberedSort.ts') continue;
      // A sort state held in the screen itself is a sort state nobody remembers.
      if (text.includes('useState<SortState<')) direct.push(file);
    }
    expect([...users.keys()].sort()).toEqual([...SORT_SCREENS].sort());
    // The club-choice screen sorts clubs while a manager is choosing one, which
    // is before there is a career to keep the choice under. It is the one table
    // here with nothing to remember itself by.
    expect(direct.sort()).toEqual(['src/ui/views/ClubSelectView.tsx']);
  });
});
