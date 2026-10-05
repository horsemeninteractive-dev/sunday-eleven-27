import { describe, expect, it } from 'vitest';
import { useGameStore } from '@/state/gameStore';
import { gameActions } from './hooks';
import { createTestGame } from '@/simulation/testSupport';
import { continueTimeSteps, processDay, processDaySteps, type DayStep } from '@/simulation/day';
import { addDays } from '@/simulation/calendar';

/**
 * Running a matchday through the engine is seconds of real work, so the tests
 * that do it are given room rather than the five-second default.
 */
const MATCHDAY_TIMEOUT_MS = 120_000;

/**
 * The rest of the league is played out by the same engine the manager watches,
 * one club at a time, and each of those takes long enough to look like a freeze.
 * The stepping loop exists so the store can put a progress bar up and say which
 * match is being worked out. These tests are about that loop, and about the
 * promise that draining it is exactly the synchronous day it replaced.
 */

/**
 * Put the clock on a league matchday the manager has nothing to play on.
 *
 * In a one-division league every matchday carries his own fixture too, and that
 * fixture correctly stops the clock before the day is simulated — which is
 * exactly why, in the game, he plays his match first and presses Continue after.
 * This reproduces that: the opener, with his own game moved to the following
 * Sunday so it is waiting there rather than in front of him.
 */
function parkUserFixture(state: ReturnType<typeof createTestGame>['state']): string {
  const opener = state.season.calendar[0]!.date;
  for (const match of Object.values(state.matches)) {
    if (match.homeClubId !== state.userClubId && match.awayClubId !== state.userClubId) continue;
    if (match.date === opener) match.date = addDays(opener, 7);
  }
  state.date = opener;
  return opener;
}

/** The first date with more than one other club's fixture on it. */
function matchdayOf(state: ReturnType<typeof createTestGame>['state']): string {
  const counts = new Map<string, number>();
  for (const match of Object.values(state.matches)) {
    if (match.homeClubId === state.userClubId || match.awayClubId === state.userClubId) continue;
    counts.set(match.date, (counts.get(match.date) ?? 0) + 1);
  }
  const found = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).find(([, count]) => count > 1);
  return found?.[0] ?? state.date;
}

describe('playing out the rest of the league', () => {
  it('stands between fixtures, counting the day off and naming each one', () => {
    // One matchday, simulated once: every assertion below is a reading of the
    // same walk through the loop, rather than five matchdays' worth of engine.
    const game = createTestGame('processing-steps');
    const date = matchdayOf(game.state);
    const mine = game.state.clubs[game.state.userClubId]!.identity.shortName;

    const steps: DayStep[] = [];
    const iterator = processDaySteps(game.state, date);
    let next = iterator.next();
    while (!next.done) {
      steps.push(next.value);
      next = iterator.next();
    }

    // Every fixture is announced before it is played. The one thing that can
    // answer without an announcement is a forfeit, which is decided before a
    // ball is kicked, so the pairing is checked in that direction only.
    expect(steps[0]!.kind).toBe('fixture');
    expect(steps.filter((step) => step.kind === 'fixture').length).toBeGreaterThan(1);
    // The day's own total, which is what the bar is drawn against. It is not
    // the number of fixtures dated today: one postponed before kick-off is not
    // football the manager is waiting on, and the bar must not stall on it.
    const total = steps[0]!.total;
    expect(total).toBeGreaterThan(1);
    expect(steps.every((step) => step.total === total)).toBe(true);
    // The count only goes up, and never past the day.
    const dones = steps.map((step) => step.done);
    expect(dones).toEqual([...dones].sort((a, b) => a - b));
    expect(dones[dones.length - 1]).toBe(total);

    // The manager's own game is never in this count: he plays that one himself.
    for (const step of steps) {
      if (step.kind !== 'fixture') continue;
      expect(`${step.home} v ${step.away}`).toMatch(/ v /);
      expect(step.home).not.toBe(mine);
      expect(step.away).not.toBe(mine);
    }
    // And what it says when the whistle goes is a scoreline, not a status.
    for (const step of steps) {
      if (step.kind === 'result') expect(step.line).toMatch(/\d+–\d+/);
    }
  });

  it('plays out exactly the day it replaced', () => {
    // Draining the stepping loop has to be the synchronous day, or the modal
    // would be showing the manager a different league from the one he gets.
    const stepped = createTestGame('processing-parity');
    const drained = createTestGame('processing-parity');
    const date = matchdayOf(stepped.state);

    const iterator = processDaySteps(stepped.state, date);
    let next = iterator.next();
    while (!next.done) next = iterator.next();
    const outcome = next.value;

    const plain = processDay(drained.state, date);
    expect(outcome.results).toEqual(plain.results);
    expect(JSON.stringify(stepped.state)).toEqual(JSON.stringify(drained.state));
  });
});

describe('the processing modal', () => {
  /** Every state the dialog was ever in, in order. */
  function watch(): { seen: Array<{ current: string | null; done: number; total: number }>; stop: () => void } {
    const seen: Array<{ current: string | null; done: number; total: number }> = [];
    const stop = useGameStore.subscribe((state) => {
      if (state.processing) seen.push({ ...state.processing });
    });
    return { seen, stop };
  }

  it('never appears when the days it moves have no other club’s football', async () => {
    // The bug this pins down: the dialog was decided by whether a fixture existed
    // *somewhere ahead*, so a quiet Tuesday in a league season produced a
    // progress bar for work nobody was waiting on.
    const game = createTestGame('processing-quiet');
    useGameStore.setState({ game: game.state, notice: null, error: null, processing: null, advancing: false });
    const { seen, stop } = watch();

    await gameActions().continueGame();

    stop();
    expect(seen).toEqual([]);
    // The clock still moved — a day with nothing on it is quick, not skipped.
    expect(useGameStore.getState().advancing).toBe(false);
    expect(useGameStore.getState().processing).toBeNull();
    expect(useGameStore.getState().game!.date > game.state.date).toBe(true);
  });

  it('comes up on a matchday, names the match and counts it off', async () => {
    const game = createTestGame('processing-live');
    // Start the clock on a day that actually has other clubs' football on it: in
    // a one-division league every matchday carries the manager's own game too,
    // and that stops the clock before the day is simulated.
    parkUserFixture(game.state);
    useGameStore.setState({ game: game.state, notice: null, error: null, processing: null, advancing: false });

    // Subscribe rather than poll. The modal is a store subscriber and the store
    // is synchronous: a `current` match is on screen while the engine blocks, so
    // no timer is ever scheduled in the middle of it.
    const { seen, stop } = watch();
    await gameActions().continueGame();
    stop();

    expect(seen.length).toBeGreaterThan(1);
    // It names a match while it works, rather than only counting to nothing.
    expect(seen.some((entry) => entry.current !== null && / v /.test(entry.current))).toBe(true);
    // A known total, and a count that only goes up: the bar is not guessing.
    expect(seen.every((entry) => entry.total > 0)).toBe(true);
    // The count only goes up *within* one matchday. A single continue can cross
    // two of them now the league plays fortnightly — a Sunday of cup ties and the
    // league Sunday after it — so the run restarts at zero when the next one
    // begins, and the bar is reset rather than carried over.
    //
    // Reading the whole sequence as one ascending run was only ever true because
    // a continue used to stop at the first matchday it met.
    const runs: Array<{ done: number[]; total: number }> = [{ done: [], total: 0 }];
    seen.forEach((entry, index) => {
      const previous = index > 0 ? seen[index - 1]!.done : -1;
      // A fall means a new matchday has begun and the bar has been reset to
      // zero, so each run is counted against the total of its own matchday.
      if (entry.done < previous) runs.push({ done: [], total: 0 });
      const run = runs[runs.length - 1]!;
      run.done.push(entry.done);
      run.total = entry.total;
    });
    for (const run of runs) {
      expect(run.done).toEqual([...run.done].sort((a, b) => a - b));
      // Every run finishes against its own total: the bar is not guessing and
      // does not stop short of the football it promised.
      expect(Math.max(...run.done)).toBe(run.total);
    }
    expect(runs.length).toBeGreaterThanOrEqual(1);
    // And it closes itself when the football is done.
    expect(useGameStore.getState().processing).toBeNull();
    expect(useGameStore.getState().advancing).toBe(false);
  }, MATCHDAY_TIMEOUT_MS);

  it('is up before the first match of the day is simulated', async () => {
    const game = createTestGame('processing-early');
    parkUserFixture(game.state);
    useGameStore.setState({ game: game.state, notice: null, error: null, processing: null, advancing: false });

    const { seen, stop } = watch();
    await gameActions().continueGame();
    stop();

    // The first thing the dialog ever says is a fixture, and it says one before
    // there is any result: the bar is drawn before the engine is run, not after.
    expect(seen[0]!.current).toMatch(/ v /);
    expect(seen[0]!.done).toBe(0);
  }, MATCHDAY_TIMEOUT_MS);

  it('cannot be started twice while the clock is moving', async () => {
    const game = createTestGame('processing-twice');
    useGameStore.setState({ game: game.state, notice: null, error: null, processing: null, advancing: false });

    // Two presses with no await between them: the second must find the clock
    // already moving, because on a quiet day there is no dialog to show it.
    const first = gameActions().continueGame();
    const second = gameActions().continueGame();
    await Promise.all([first, second]);
    expect(useGameStore.getState().advancing).toBe(false);
    expect(useGameStore.getState().processing).toBeNull();
  });

  it('moves the calendar under the same dialog', async () => {
    const game = createTestGame('processing-planner');
    parkUserFixture(game.state);
    useGameStore.setState({ game: game.state, notice: null, error: null, processing: null, advancing: false });

    const { seen, stop } = watch();
    await gameActions().jumpToDate(addDays(game.state.date, 1));
    stop();

    // Advancing days by hand crosses the same football, so it is explained too.
    expect(seen.length).toBeGreaterThan(0);
    expect(useGameStore.getState().processing).toBeNull();
  }, MATCHDAY_TIMEOUT_MS);

  it('leaves the stepping loop available to the whole week', () => {
    // The week shortcut uses the same day loop, so it must still produce one
    // outcome and no exception when drained.
    const game = createTestGame('processing-week');
    const iterator = continueTimeSteps(game.state, { maxDays: 2 });
    const steps: DayStep[] = [];
    let next = iterator.next();
    while (!next.done) {
      steps.push(next.value);
      next = iterator.next();
    }
    expect(next.value.days.length).toBeGreaterThan(0);
    expect(steps.every((step) => step.total > 0)).toBe(true);
  });
});
