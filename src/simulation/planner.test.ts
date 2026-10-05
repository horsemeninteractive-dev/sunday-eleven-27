import { describe, expect, it } from 'vitest';
import { addDays, dayOfWeek, daysBetween, preSeasonStart, toDate } from '@/simulation/calendar';
import { dayEvents, plannerDays, plannerMonth, weekEndOf, weekProgress, weekStartOf } from '@/simulation/planner';
import { matchdayDate, matchdaysPlayed, nextMatchday, seasonCalendarExhausted } from '@/simulation/timeline';
import { FRIENDLY_COMPETITION_ID } from '@/domain/competition';
import { eventsOn, nextFixtureFor, nextStop, recurringEvents, recursOn, scheduleEvent } from '@/simulation/schedule';
import { sessionDatesFor, sessionKeyFor } from '@/simulation/training/plan';
import { ensureClubTrained } from '@/simulation/training/session';
import { sessionRecordedFor } from '@/simulation/training/store';
import { createTestGame } from '@/simulation/testSupport';

/**
 * The calendar screen reads the schedule. What matters here is that the days
 * line up, that the manager's own day is marked, and that what is on a day is
 * what the simulation would actually do that day.
 */

const nextFixture = (state: ReturnType<typeof createTestGame>['state']) => {
  const matchday = nextMatchday(state);
  const match = Object.values(state.matches).find(
    (candidate) =>
      candidate.matchday === matchday &&
      (candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId),
  );
  if (!match) throw new Error('no fixture for the current matchday');
  return match;
};


describe('the game date', () => {
  it('starts a career in pre-season, not on the morning of the first game', () => {
    const { state } = createTestGame('calendar-start');
    const opener = matchdayDate(state, 1)!;
    expect(dayOfWeek(state.date)).toBe(1);
    expect(matchdaysPlayed(state)).toBe(0);
    expect(nextMatchday(state)).toBe(1);
    // A manager who lands on the first Sunday has no time to build anything.
    expect(state.season.startDate).toBe(state.date);
    expect(weekStartOf(preSeasonStart(opener))).toBe(state.date);
    expect(daysBetween(state.date, opener)).toBeGreaterThan(6 * 7);
  });

  it('counts matchdays from the calendar, never from a stored counter', () => {
    const { state } = createTestGame('calendar-derived');
    const firstSunday = matchdayDate(state, 1)!;
    expect(matchdaysPlayed(state, firstSunday)).toBe(0);
    expect(nextMatchday(state, firstSunday)).toBe(1);
    expect(matchdaysPlayed(state, addDays(firstSunday, 1))).toBe(1);
    expect(nextMatchday(state, addDays(firstSunday, 1))).toBe(2);
    // The following matchday is a fortnight away, not a week: the count comes
    // off the calendar rather than off any stored counter, so it follows the
    // league's actual rhythm.
    expect(matchdaysPlayed(state, addDays(firstSunday, 8))).toBe(1);
    expect(matchdaysPlayed(state, addDays(firstSunday, 15))).toBe(2);
    expect(nextMatchday(state, addDays(firstSunday, 15))).toBe(3);
  });

  it('knows when the season calendar has run out', () => {
    const { state } = createTestGame('calendar-exhausted');
    expect(seasonCalendarExhausted(state)).toBe(false);
    // The latest date, not the last entry: the cup rounds are numbered after the
    // league's matchdays but are played in the middle of them.
    const last = state.season.calendar.map((entry) => entry.date).sort().at(-1)!;
    expect(seasonCalendarExhausted(state, addDays(last, 1))).toBe(true);
  });

  it('places the manager in the first week of pre-season', () => {
    const { state } = createTestGame('calendar-progress');
    expect(weekProgress(state)).toEqual({ day: 1, total: 7 });
    expect(weekStartOf(state.date)).toBe(state.date);
    expect(weekEndOf(state.date)).toBe(preSeasonStart(matchdayDate(state, 1)!));
  });
});

describe('what is on each day', () => {
  it('marks Thursday as training and Sunday as the match', () => {
    const { state } = createTestGame('planner-days');
    const match = nextFixture(state);
    const matchEvents = dayEvents(state, match.date);
    expect(matchEvents.some((event) => event.kind === 'league-match')).toBe(true);

    const trainingDate = addDays(match.date, -3);
    const training = dayEvents(state, trainingDate);
    expect(training[0]?.kind).toBe('training');
    expect(training[0]?.label).toBe('Training tonight');

    // No football on the days in between — only the club's bookkeeping.
    const tuesday = dayEvents(state, addDays(match.date, -5));
    expect(tuesday.filter((event) => event.kind === 'league-match' || event.kind === 'training')).toHaveLength(0);
  });

  it('lays out a month as whole weeks', () => {
    const { state } = createTestGame('planner-month');
    const cells = plannerMonth(state, 2026, 8);
    expect(cells.length % 7).toBe(0);
    expect(cells.filter(Boolean)).toHaveLength(30);
    expect(cells.filter((cell) => cell && cell.isMatchday).length).toBeGreaterThan(0);
  });

  it('gives seven days from Monday, with today marked', () => {
    const { state } = createTestGame('planner-grid');
    const days = plannerDays(state);
    expect(days).toHaveLength(7);
    expect(days[0]!.weekdayLabel).toBe('Mon');
    expect(days[6]!.weekdayLabel).toBe('Sun');
    expect(days.filter((day) => day.isToday)).toHaveLength(1);
    expect(days[0]!.isToday).toBe(true);
  });

  it('puts a recurring commitment on the date the rule says', () => {
    const { state } = createTestGame('planner-recurring');
    const subs = recurringEvents(state).find((rule) => rule.id === 'rec_subs')!;
    expect(subs.weekday).toBe(5);
    const friday = addDays(state.date, (5 - 1 + 7) % 7);
    expect(toDate(friday).getUTCDay()).toBe(5);
    expect(recursOn(subs, friday)).toBe(true);
    expect(recursOn(subs, addDays(friday, 1))).toBe(false);
  });

  it('shows something the manager scheduled himself', () => {
    const { state } = createTestGame('planner-stored');
    const date = addDays(state.date, 2);
    scheduleEvent(state, {
      date,
      time: '19:30',
      kind: 'committee',
      priority: 'important',
      source: 'club',
      title: 'Committee meeting',
      detail: 'The clubhouse, seven thirty.',
      clubIds: [state.userClubId],
    });
    expect(dayEvents(state, date).some((event) => event.label === 'Committee meeting')).toBe(true);
  });
});

describe('stopping points', () => {
  it('stops at training first, then the match, then nothing', () => {
    const { state } = createTestGame('planner-stops');
    const match = nextFixture(state);
    // Training runs from the day the manager takes charge, so the first session
    // is the Thursday of his own first week.
    const training = sessionDatesFor(state)[0]!;
    expect(training).toBe(addDays(state.date, 3));

    const first = nextStop(state, state.date);
    expect(first.kind).toBe('flagged');
    expect(first.date).toBe(training);
    expect(first.headline).toBe('Training tonight');

    ensureClubTrained(state, state.userClubId, sessionKeyFor(state, training));
    expect(sessionRecordedFor(state, state.userClubId, sessionKeyFor(state, training))).toBe(true);
    // Already trained: Thursday is no longer worth stopping on.
    const afterTraining = eventsOn(state, training).filter((item) => item.priority === 'important');
    expect(afterTraining).toHaveLength(0);

    // The next week has the same shape: another Thursday, then the summer's
    // first game — the friendly, long before the league fixture above.
    const nextWeek = nextStop(state, addDays(training, 1));
    expect(nextWeek.kind).toBe('flagged');
    expect(nextWeek.date).toBe(sessionDatesFor(state)[1]);
    const friendly = nextFixtureFor(state, state.userClubId, state.date)!;
    expect(friendly.competitionId).toBe(FRIENDLY_COMPETITION_ID);
    expect(daysBetween(friendly.date, match.date)).toBeGreaterThan(0);
  });
});
