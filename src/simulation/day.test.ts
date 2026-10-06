import { describe, expect, it } from 'vitest';
import { addDays, dayOfWeek } from '@/simulation/calendar';
import { processDay } from '@/simulation/day';
import { continueTime, currentAttention } from '@/simulation/day';
import { sessionDatesFor } from '@/simulation/training/plan';

/** The next Thursday the club trains — pre-season counts. */
const nextTraining = (state: ReturnType<typeof createTestGame>['state']) =>
  sessionDatesFor(state).find((date) => date >= state.date)!;
import { sessionsFor } from '@/simulation/training/store';
import { matchdaysPlayed } from '@/simulation/timeline';
import { ledgerOf, squadOf } from '@/simulation/queries';
import { eventsOn, nextFixtureFor } from '@/simulation/schedule';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { createTestGame } from '@/simulation/testSupport';
import type { Player } from '@/domain/person';
import { isPlayer } from '@/domain/person';

/**
 * A day at a time.
 *
 * These tests are about the clock's behaviour rather than about football: that
 * one day of simulation moves the world exactly one day, that a day never
 * happens twice, that recovery counts down in days, and that a save resumes
 * from the afternoon it was made.
 */

type State = ReturnType<typeof createTestGame>['state'];

function squad(state: State): Player[] {
  return squadOf(state, state.userClubId);
}

describe('advancing the clock', () => {
  it('moves exactly one day, and simulates the day it left', () => {
    const { state } = createTestGame('day-advance');
    const start = state.date;
    const outcome = processDay(state);
    expect(outcome.date).toBe(start);
    expect(outcome.nextDate).toBe(addDays(start, 1));
    expect(state.date).toBe(addDays(start, 1));
  });

  it('crosses a month boundary without losing a day', () => {
    const { state } = createTestGame('day-month');
    state.date = '2026-09-30';
    processDay(state);
    expect(state.date).toBe('2026-10-01');
    processDay(state);
    expect(state.date).toBe('2026-10-02');
  });

  it('crosses the end of the year', () => {
    const { state } = createTestGame('day-year');
    state.date = '2026-12-31';
    processDay(state);
    expect(state.date).toBe('2027-01-01');
    expect(state.season.id).toBe('season_2026_27');
  });

  it('runs the quiet days and says what happened on them', () => {
    const { state } = createTestGame('day-continue');
    const outcome = continueTime(state, { maxDays: 2 });
    expect(outcome.days).toEqual([addDays(state.date, -2), addDays(state.date, -1)]);
  });

  it('stops before a day worth stopping on, rather than after', () => {
    const { state } = createTestGame('day-stop-training');
    // The first appointment of the season is the Thursday of the manager's own
    // first week, pre-season or not.
    const training = addDays(state.date, 3);
    expect(sessionDatesFor(state)[0]).toBe(training);
    const outcome = continueTime(state);
    expect(outcome.stop).not.toBeNull();
    expect(outcome.stop!.date).toBe(training);
    expect(outcome.stop!.headline).toBe('Training tonight');
    // The clock is standing on it: the session has not been run for him.
    expect(state.date).toBe(training);
    expect(sessionsFor(state, state.userClubId)).toHaveLength(0);
  });

  it('refuses to pass an unplayed match', () => {
    const { state } = createTestGame('day-stop-match');
    const date = userFixture(state).date;
    state.date = date;
    const attention = currentAttention(state);
    expect(attention?.kind).toBe('blocking');

    const outcome = continueTime(state, { maxDays: 3 });
    expect(outcome.days).toHaveLength(0);
    expect(state.date).toBe(date);
  });

  it('moves the clock when pressed again, rather than repeating itself', () => {
    const { state } = createTestGame('day-stop-twice');
    const training = addDays(state.date, 3);

    // The first press runs the quiet days and stops on the notice.
    const first = continueTime(state);
    expect(first.stop?.kind).toBe('flagged');
    expect(first.stop?.date).toBe(training);
    expect(state.date).toBe(training);

    // He has now been shown it, so the second press must move the clock. This
    // used to stop on the very same day for ever: the only thing that marks a
    // day as told is simulating it, and a day worth stopping on is precisely
    // the one that is not simulated. A career could not be moved past its own
    // pre-season at all.
    const second = continueTime(state);
    expect(second.stop?.date).not.toBe(training);
    expect(state.date > training).toBe(true);
  });

  it('still leaves the thing it stopped for waiting to be done', () => {
    const { state } = createTestGame('day-stop-still-waits');
    continueTime(state);
    const training = addDays(state.date, 3);
    expect(currentAttention(state)?.date).not.toBe(training);
    // Being told about Thursday is not the same as having trained.
    expect(sessionsFor(state, state.userClubId)).toHaveLength(0);
  });
});

describe('the season announces itself when it opens', () => {
  it('says pre-season begins on the Monday the club\u2019s year starts', () => {
    const { state } = createTestGame('preseason-opens');
    // The announcement used to be dated to the Monday of the week the first
    // fixture falls in, which is the *last* Monday of pre-season — so the game
    // announced that pre-season had begun on the day it finished.
    const opening = eventsOn(state, state.season.startDate).find((event) => event.title === 'Pre-season begins');
    expect(opening).toBeDefined();
    expect(opening!.date).toBe(state.season.startDate);

    // And nothing announces it on the last Monday of pre-season any more.
    const lastMonday = eventsOn(state, addDays(state.season.endDate, -1));
    expect(lastMonday.some((event) => event.title === 'Pre-season begins')).toBe(false);
  });
});

describe('days are simulated once', () => {
  it('runs Thursday once, however many times the day is asked for', () => {
    const { state } = createTestGame('day-once-training');
    const training = nextTraining(state);
    state.date = training;
    processDay(state);
    const after = sessionsFor(state, state.userClubId).length;
    expect(after).toBe(1);

    // Asking for the same day again must not run a second session: the store is
    // keyed on the matchday and the day has already happened.
    state.date = training;
    processDay(state);
    expect(sessionsFor(state, state.userClubId)).toHaveLength(1);
  });

  it('plays a Sunday once', () => {
    const { state } = createTestGame('day-once-match');
    const fixture = userFixture(state);
    const date = fixture.date;
    state.date = date;
    processDay(state, date, { resolveUserMatch: true });
    expect(fixture.played).toBe(true);
    const appearances = squad(state).reduce((sum, player) => sum + player.record.appearances, 0);

    processDay(state, date, { resolveUserMatch: true });
    const after = squad(state).reduce((sum, player) => sum + player.record.appearances, 0);
    expect(after).toBe(appearances);
  });
});

describe('training in the week', () => {
  it('happens on its own date, and only once', () => {
    const { state } = createTestGame('day-training-date');
    const training = nextTraining(state);
    const outcome = processDay(state, training);
    const session = sessionsFor(state, state.userClubId)[0];
    expect(session).toBeDefined();
    expect(session!.date).toBe(training);
    expect(dayOfWeek(session!.date)).toBe(4);
    expect(outcome.notes.some((line) => line.startsWith('Training'))).toBe(true);
  });

  it('leaves out a player who is not available that day', () => {
    const { state } = createTestGame('day-training-availability');
    const training = nextTraining(state);
    const player = squad(state)[0]!;
    player.availability = {
      status: 'unavailable',
      reason: 'work',
      note: 'On shift',
      until: null,
      discoveredLate: false,
    };
    processDay(state, training);
    const session = sessionsFor(state, state.userClubId)[0]!;
    const entry = session.attendance.find((item) => item.personId === player.id);
    expect(entry?.status).toBe('absent');
  });
});

describe('bodies over time', () => {
  it('counts an injury down in days, and he is back on the day it reaches zero', () => {
    const { state } = createTestGame('day-recovery');
    const player = squad(state)[0]!;
    const start = state.date;
    player.injury = { description: 'a pulled hamstring', severity: 'minor', daysOut: 3, occurredOn: start };
    player.availability = {
      status: 'unavailable',
      reason: 'injury',
      note: 'Out with a pulled hamstring',
      until: null,
      discoveredLate: false,
    };

    processDay(state, start);
    expect(player.injury?.daysOut).toBe(2);
    processDay(state, addDays(start, 1));
    expect(player.injury?.daysOut).toBe(1);
    processDay(state, addDays(start, 2));
    expect(player.injury).toBeNull();
    expect(player.availability.status).toBe('available');
  });

  it('brings tired legs back up over the days between games', () => {
    const { state } = createTestGame('day-fitness');
    const player = squad(state)[0]!;
    const start = state.date;
    player.fitness = 40;
    processDay(state, start);
    expect(player.fitness).toBeGreaterThan(40);
    processDay(state, addDays(start, 1));
    expect(player.fitness).toBeGreaterThan(43);
  });
});

describe('money on its own dates', () => {
  it('does not collect squad-wide subs on a Friday any more', () => {
    const { state } = createTestGame('day-money');
    // Walk to the first Friday in the season. There is no match, so nobody can
    // be charged: subs are a matchday liability now.
    let date = state.date;
    while (dayOfWeek(date) !== 5) date = addDays(date, 1);
    processDay(state, date);

    const subs = ledgerOf(state, state.userClubId).filter(
      (entry) => entry.category === 'subs' && entry.date === date,
    );
    expect(subs).toHaveLength(0);
  });

  it('pays the standing costs on the Wednesday, dated that day', () => {
    const { state } = createTestGame('day-costs');
    let date = state.date;
    while (dayOfWeek(date) !== 3) date = addDays(date, 1);
    processDay(state, date);
    const costs = ledgerOf(state, state.userClubId).filter(
      (entry) => entry.category === 'pitch-hire' && entry.date === date,
    );
    expect(costs.length).toBeGreaterThan(0);
  });
});

describe('news comes from what happened', () => {
  it('reports the match on the day it was played', () => {
    const { state } = createTestGame('day-news');
    const date = userFixture(state).date;
    const outcome = processDay(state, date, { resolveUserMatch: true });
    expect(outcome.news.length).toBeGreaterThan(0);
    expect(state.news.some((item) => item.date === date && item.category === 'Match')).toBe(true);
  });
});

describe('saving and loading time', () => {
  it('resumes from the exact day, with the future still scheduled', () => {
    const { state } = createTestGame('day-save');
    processDay(state);
    processDay(state);
    const midweek = state.date;
    expect(dayOfWeek(midweek)).not.toBe(0);

    const raw = serialiseGame(state);
    const loaded = deserialiseGame(raw);
    expect(loaded.error).toBeNull();
    const restored = loaded.state!;
    expect(restored.date).toBe(midweek);
    expect(matchdaysPlayed(restored)).toBe(matchdaysPlayed(state));

    // The loaded career carries on identically: the same day produces the same
    // result from the same saved state.
    const a = processDay(state, state.date);
    const b = processDay(restored, restored.date);
    expect(b.news.length).toBe(a.news.length);
    expect(restored.date).toBe(state.date);
    expect(b.notes).toEqual(a.notes);
  });

  it('does not duplicate a scheduled event when a save is loaded', () => {
    const { state } = createTestGame('day-save-events');
    const restored = deserialiseGame(serialiseGame(state)).state!;
    expect(restored.schedule.events.length).toBe(state.schedule.events.length);
    expect(restored.schedule.notifiedThrough).toBe(state.schedule.notifiedThrough);
  });

  it('is reproducible: the same seed produces the same month', () => {
    const a = createTestGame('day-determinism');
    const b = createTestGame('day-determinism');
    for (let i = 0; i < 28; i += 1) {
      processDay(a.state);
      processDay(b.state);
    }
    expect(b.state.date).toBe(a.state.date);
    expect(b.state.news.length).toBe(a.state.news.length);
    expect(ledgerOf(b.state, b.state.userClubId).length).toBe(ledgerOf(a.state, a.state.userClubId).length);

    const statuses = (state: State) =>
      Object.values(state.people)
        .filter(isPlayer)
        .map((player) => `${player.id}:${player.availability.status}`)
        .sort();
    expect(statuses(b.state)).toEqual(statuses(a.state));
  });
});

/** The manager's next game. A club can be idle on a matchday, so never assume one. */
function userFixture(state: State) {
  const match = nextFixtureFor(state, state.userClubId, state.date);
  if (!match) throw new Error('no upcoming fixture for the user club');
  return match;
}

