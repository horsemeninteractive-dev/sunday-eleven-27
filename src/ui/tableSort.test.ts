import { describe, expect, it } from 'vitest';
import { applySort, toggleSort, UNSORTED, type SortAccessors, type SortState } from './tableSort';

interface Row {
  name: string;
  goals: number;
  note?: string;
}

const ROWS: Row[] = [
  { name: 'Ward', goals: 3, note: 'in form' },
  { name: 'Ashton', goals: 12 },
  { name: 'Mbeki', goals: 0, note: 'injured' },
];

const ACCESSORS: SortAccessors<Row, 'name' | 'goals' | 'note'> = {
  name: (row) => row.name,
  goals: (row) => row.goals,
  note: (row) => row.note,
};

const names = (rows: Row[]) => rows.map((row) => row.name);

describe('sorting a table', () => {
  it('sorts up, then down, then hands the rows back', () => {
    const up = toggleSort(UNSORTED, 'goals');
    expect(up).toEqual({ key: 'goals', direction: 'asc' });
    const down = toggleSort(up, 'goals');
    expect(down).toEqual({ key: 'goals', direction: 'desc' });
    expect(toggleSort(down, 'goals')).toEqual({ key: null, direction: 'asc' });
  });

  it('starts a fresh column at the top rather than continuing the last one', () => {
    const state: SortState<'goals' | 'name'> = { key: 'goals', direction: 'desc' };
    expect(toggleSort(state, 'name')).toEqual({ key: 'name', direction: 'asc' });
  });

  it('leaves the rows alone until a column is asked for', () => {
    const sorted = applySort(ROWS, UNSORTED, ACCESSORS);
    expect(names(sorted)).toEqual(['Ward', 'Ashton', 'Mbeki']);
    // A copy, so the screen's own array is never reordered underneath it.
    expect(sorted).not.toBe(ROWS);
  });

  it('sorts numbers as numbers and words as words', () => {
    expect(names(applySort(ROWS, { key: 'goals', direction: 'asc' }, ACCESSORS))).toEqual(['Mbeki', 'Ward', 'Ashton']);
    expect(names(applySort(ROWS, { key: 'goals', direction: 'desc' }, ACCESSORS))).toEqual(['Ashton', 'Ward', 'Mbeki']);
    expect(names(applySort(ROWS, { key: 'name', direction: 'asc' }, ACCESSORS))).toEqual(['Ashton', 'Mbeki', 'Ward']);
  });

  it('sinks empty values whichever way the column is pointing', () => {
    // Ashton has no note at all: a blank is not "lowest", it is unknown.
    expect(names(applySort(ROWS, { key: 'note', direction: 'asc' }, ACCESSORS))).toEqual(['Ward', 'Mbeki', 'Ashton']);
    expect(names(applySort(ROWS, { key: 'note', direction: 'desc' }, ACCESSORS))).toEqual(['Mbeki', 'Ward', 'Ashton']);
  });

  it('reads numbers written inside words in order', () => {
    const seasons = [{ label: '2026/27' }, { label: '2025/26' }, { label: '2026/10' }];
    const sorted = applySort(seasons, { key: 'label', direction: 'asc' }, {
      label: (row: { label: string }) => row.label,
    });
    expect(sorted.map((season) => season.label)).toEqual(['2025/26', '2026/10', '2026/27']);
  });

  it('ignores a column it has no accessor for', () => {
    const sorted = applySort(ROWS, { key: 'unknown' as 'goals', direction: 'asc' }, ACCESSORS);
    expect(sorted).toEqual(ROWS);
  });
});
