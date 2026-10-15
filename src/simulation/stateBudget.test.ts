import { describe, expect, it } from 'vitest';
import { ALDERFORDSHIRE_DISTRICTS } from '@/domain/districts';
import type { GameState } from '@/domain/game';
import { checkCalendarIntegrity, checkStateBudget, seasonSnapshot, SOAK_BANDS, stateSizeBytes, type SoakSnapshot } from './soak';
import { createTestGame, playSeason } from './testSupport';

/**
 * The state-size guard, in miniature.
 *
 * `state-bounded` is the one invariant a soak holds that no other invariant
 * covers: news has a cap, the standings history has a cap, the season archive
 * has a cap, a squad has a cap — and the state as a whole had none, so the way a
 * career outgrows its device is a season that keeps one record per fixture, or a
 * retention mistake that holds two seasons of matches at once, and both of those
 * leave a world every other check is perfectly happy with.
 *
 * The baseline is the verified six-district county, so the reading that matters
 * is taken on a full county — and the comparison itself is exercised on
 * measurements supplied by the test, because generating 216 clubs and playing
 * them a season to ask "is 300,000 KB more than 250,000 KB" is a minute of
 * football for a question about two numbers.
 *
 * The budget is held against the county's *career*, not only against its first
 * season, because the reading is not flat: a career's state grows as its people
 * store settles and its subs book is folded (about 3,600 KB a season on average), and
 * `npm run soak` plays ten of them. A budget written for season one alone would
 * fail the tool's own default run, which is the one thing a threshold must never
 * do.
 */

/** The six-district county's first season, as the benchmark recorded it. */
const VERIFIED_SIX_DISTRICT_BASELINE_BYTES = 204_904_153;

/** A snapshot of a world, with the measurement replaced by the one under test. */
function measured(state: GameState, size: number): SoakSnapshot {
  return { ...seasonSnapshot(state), stateBytes: size };
}

/** The reading in the report's own units, so a failure can be read at a glance. */
function kb(size: number): string {
  return Math.round(size / 1024).toLocaleString('en-US');
}

describe('the state-size budget', () => {
  it('is set above the verified baseline and above the county\u2019s own growth', () => {
    // The number the band's own comment is written around: `npm run benchmark
    // --districts=6` on seed `bench`, at the close of season one, as recorded in
    // `reports/benchmark-se27-phase3.json` — 216 clubs, 2,407 fixtures, 2,917
    // played. A budget below the world the game builds today would fail on a
    // checkout with nothing wrong with it.
    expect(SOAK_BANDS.stateBudgetBytes).toBeGreaterThan(VERIFIED_SIX_DISTRICT_BASELINE_BYTES);

    // And above the growth, because a career is not one season: seed `soak`
    // measured 203,456 KB at its first close, 224,044 KB at its second, 239,797 KB
    // at its third ... and 333,330 KB at its tenth, which is the run the tool makes
    // by default. The budget has to clear that whole path, not just its first step.
    expect(SOAK_BANDS.stateBudgetBytes).toBeGreaterThan(333_330 * 1024);

    // Twice the county's first season, and never so far above it that a doubling
    // of a season's retained football would slip through at every season.
    const ratio = SOAK_BANDS.stateBudgetBytes / VERIFIED_SIX_DISTRICT_BASELINE_BYTES;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2.5);
  });

  it('is one definition of the size, shared with the benchmark', () => {
    const { state } = createTestGame('budget-reading', 0, 2026, 2);
    // The measurement is `JSON.stringify(state).length` — the reading the world
    // audit takes and the reason its numbers are comparable with the soak's. A
    // second definition of "the size of the game" that disagreed with this one
    // would show up here rather than in a report somebody has to re-read.
    expect(stateSizeBytes(state)).toBe(JSON.stringify(state).length);
    // And a snapshot carries that same reading, so the guard is holding the
    // season to the measurement and not to a differently-taken number.
    expect(seasonSnapshot(state).stateBytes).toBe(stateSizeBytes(state));
  });

  it('passes the whole county as it is generated', () => {
    const { state } = createTestGame('budget-county', 0, 2026, ALDERFORDSHIRE_DISTRICTS.length);
    expect(checkStateBudget(state, seasonSnapshot(state))).toEqual([]);
    // The fresh county is a tenth of the budget: the other nine tenths are the
    // season's retained football, which is what the guard is really about.
    expect(stateSizeBytes(state)).toBeLessThan(SOAK_BANDS.stateBudgetBytes / 4);
  });

  it('fails a state over the budget, naming the measurement, the limit and the world', () => {
    const { state } = createTestGame('budget-over', 0, 2026, 2);
    const over = SOAK_BANDS.stateBudgetBytes + 1;
    const found = checkStateBudget(state, measured(state, over));

    expect(found).toHaveLength(1);
    expect(found[0]!.severity).toBe('fail');
    expect(found[0]!.invariant).toBe('state-bounded');
    // What it measured, and what it was allowed: in the report's units and in
    // bytes, so the two can be compared without arithmetic in the reader's head.
    expect(found[0]!.detail).toContain(`${kb(SOAK_BANDS.stateBudgetBytes)} KB budget`);
    expect(found[0]!.detail).toContain(`${kb(over)} KB (${over.toLocaleString('en-US')} bytes)`);
    // A difference too small to be a kilobyte is still a difference, and is said
    // in bytes rather than rounded away to nothing.
    expect(found[0]!.detail).toContain('1 byte past');
    // A difference worth reading in KB is read in KB.
    const wellOver = measured(state, SOAK_BANDS.stateBudgetBytes + 50 * 1024);
    expect(checkStateBudget(state, wellOver)[0]!.detail).toContain('50 KB past');
    // And the failure says what the budget is set for, because the answer to "is
    // this the world's own growth or something new?" is the whole question.
    expect(checkStateBudget(state, wellOver)[0]!.detail).toContain('3,600 KB a season on average');
    expect(checkStateBudget(state, wellOver)[0]!.detail).toContain('ten-season run');
    // The world it was measured on, and where in the state the size is.
    expect(found[0]!.detail).toContain('2 districts, 72 clubs');
    expect(found[0]!.detail).toContain("match records are");
    // And what to change when the growth is wanted, rather than a number.
    expect(found[0]!.detail).toContain('SOAK_BANDS.stateBudgetBytes');
  });

  it('holds a state exactly at the budget, and fails the byte after it', () => {
    const { state } = createTestGame('budget-boundary', 0, 2026, 2);
    // The budget is a ceiling, so it is inclusive: at it is inside the band, one
    // byte over is not.
    expect(checkStateBudget(state, measured(state, SOAK_BANDS.stateBudgetBytes))).toEqual([]);
    expect(checkStateBudget(state, measured(state, SOAK_BANDS.stateBudgetBytes - 1))).toEqual([]);
    expect(checkStateBudget(state, measured(state, SOAK_BANDS.stateBudgetBytes + 1))).toHaveLength(1);
  });

  it('is read at the close of a season, where the state is at its largest', () => {
    // A hand-played season: no engine, but the same day loop and the same season
    // boundary the real one runs, so this is the same checkpoint from the same
    // code. One district, because the checkpoint is what is under test here and
    // the full county's twenty-minute season is a different test's business.
    const { state } = createTestGame('budget-checkpoint', 0, 2026, 1);
    const fresh = stateSizeBytes(state);
    playSeason(state);
    const atSeasonEnd = stateSizeBytes(state);
    expect(atSeasonEnd).toBeGreaterThan(fresh);

    const snapshot = seasonSnapshot(state);
    // The snapshot carries the season's own reading, not the one the career
    // opened with.
    expect(snapshot.stateBytes).toBe(atSeasonEnd);
    // And the guard is asking about that reading: it holds at the season end, and
    // fails one byte below it — so a career that had only ever been measured in
    // August would not pass this.
    expect(checkStateBudget(state, snapshot, atSeasonEnd)).toEqual([]);
    expect(checkStateBudget(state, snapshot, atSeasonEnd - 1)).toHaveLength(1);
    const heldToTheFreshSize = checkStateBudget(state, snapshot, fresh);
    expect(heldToTheFreshSize).toHaveLength(1);
    // The failure names the world it measured, in words that read at every size.
    expect(heldToTheFreshSize[0]!.detail).toContain('1 district, 36 clubs');
  });

  it('reports independently of the other invariants', () => {
    // A world mid-season: its cups have been drawn and cannot be won yet, which
    // is the calendar's own business. The budget has nothing to say about that
    // world, and says nothing about it — and a state over budget is reported
    // whether or not the calendar is clean, because neither check swallows the
    // other.
    const { state } = createTestGame('budget-independent', 0, 2026, 2);
    const snapshot = seasonSnapshot(state);

    const calendar = checkCalendarIntegrity(state, snapshot);
    expect(calendar.length).toBeGreaterThan(0);
    expect(checkStateBudget(state, snapshot)).toEqual([]);

    const over = measured(state, SOAK_BANDS.stateBudgetBytes + 1);
    expect(checkStateBudget(state, over).map((item) => item.invariant)).toEqual(['state-bounded']);
    expect(checkCalendarIntegrity(state, over)).toEqual(calendar);
  });

  it('reads the state without changing it', () => {
    const { state } = createTestGame('budget-pure', 0, 2026, 2);
    const before = JSON.stringify(state);
    const snapshot = seasonSnapshot(state);

    stateSizeBytes(state);
    checkStateBudget(state, snapshot);
    checkStateBudget(state, { ...snapshot, stateBytes: SOAK_BANDS.stateBudgetBytes + 1 });
    checkStateBudget(state, snapshot, 1);

    // Not one byte of the game moved: the guard measures and reports, and a
    // failure is a failure to write down rather than a state anything mutated.
    expect(JSON.stringify(state)).toBe(before);
  });
});
