import { describe, expect, it } from 'vitest';
import { addDays, dayOfWeek, formatShortDate } from '@/simulation/calendar';
import {
  blockingEventsOn,
  eventsOn,
  flaggedEventsOn,
  markNotifiedThrough,
  nextFixtureFor,
  nextStop,
  recurringEvents,
  recursOn,
  scheduleEvent,
  scheduleTrial,
} from '@/simulation/schedule';
import { decidePostponement, isActiveFixture, postponeFixture } from '@/simulation/postponement';
import { everyFixtureSettled } from '@/simulation/season';
import { sessionDatesFor } from '@/simulation/training/plan';
import { nextMatchday } from '@/simulation/timeline';
import { createTestGame } from '@/simulation/testSupport';

/**
 * The calendar is the clock. These tests are about the clock's own rules:
 * when something fires, how loudly, and what a postponement actually does to
 * the season.
 */

type State = ReturnType<typeof createTestGame>['state'];

/** The manager's next game — not necessarily this matchday: a division with an
 * odd number of clubs leaves somebody idle every week. */
function userFixture(state: State) {
  const match = nextFixtureFor(state, state.userClubId, state.date);
  if (!match) throw new Error('no upcoming fixture');
  return match;
}

describe('what is on and when', () => {
  it('fires an event on its own date and not before', () => {
    const { state } = createTestGame('schedule-firing');
    const date = addDays(state.date, 6);
    scheduleEvent(state, {
      date,
      kind: 'fundraising',
      priority: 'important',
      source: 'club',
      title: 'Race night',
      detail: 'In the clubhouse, first race at eight.',
      clubIds: [state.userClubId],
    });

    expect(eventsOn(state, addDays(date, -1)).some((item) => item.title === 'Race night')).toBe(false);
    expect(eventsOn(state, date).some((item) => item.title === 'Race night')).toBe(true);
    expect(eventsOn(state, addDays(date, 1)).some((item) => item.title === 'Race night')).toBe(false);
  });

  it('reads priority off the event, not off a stored flag', () => {
    const { state } = createTestGame('schedule-priority');
    // The Sunday: a fixture in the calendar, and nothing else of mine on it.
    const date = addDays(state.date, 6);
    const make = (priority: 'critical' | 'important' | 'informational' | 'background', title: string) =>
      scheduleEvent(state, {
        date,
        kind: 'social',
        priority,
        source: 'social',
        title,
        detail: 'Something on.',
      });
    make('critical', 'Must deal with');
    make('important', 'Worth looking at');
    make('informational', 'Just so you know');
    make('background', 'Simulated quietly');

    expect(blockingEventsOn(state, date).map((item) => item.title)).toContain('Must deal with');
    // Flagged means exactly the important ones — not the critical, not the rest.
    expect(flaggedEventsOn(state, date).map((item) => item.title)).toEqual(['Worth looking at']);
    expect(flaggedEventsOn(state, date).map((item) => item.title)).not.toContain('Just so you know');
    expect(eventsOn(state, date).map((item) => item.title)).toContain('Simulated quietly');
  });

  it('moves the whole season calendar, not a counter, to decide the matchday', () => {
    const { state } = createTestGame('schedule-matchday');
    const firstSunday = state.season.calendar[0]!.date;
    expect(nextMatchday(state, firstSunday)).toBe(1);
    expect(nextMatchday(state, addDays(firstSunday, 1))).toBe(2);
    expect(eventsOn(state, firstSunday).some((item) => item.kind === 'league-match')).toBe(true);
  });

  it('books a trial on the training night it belongs to', () => {
    const { state } = createTestGame('schedule-trial');
    const personId = Object.keys(state.people)[0]!;
    const event = scheduleTrial(state, personId, 'Coming down for a look.');
    expect(event.kind).toBe('trial');
    expect(event.date).toBe(sessionDatesFor(state)[0]);
    expect(dayOfWeek(event.date)).toBe(4);
    expect(eventsOn(state, event.date).some((item) => item.kind === 'trial')).toBe(true);
  });
});

describe('recurring commitments', () => {
  it('expresses the club routine as rules with dates', () => {
    const { state } = createTestGame('schedule-recurring');
    const rules = recurringEvents(state);
    const training = rules.find((rule) => rule.id === 'rec_training')!;
    expect(training.frequency).toBe('weekly');
    expect(training.weekday).toBe(4);
    expect(training.title).toBe('Training');

    // Player subs are a matchday liability now, and sponsorship is owned by the
    // club's own agreements: neither has a calendar rule any more.
    expect(rules.some((rule) => rule.id === 'rec_subs')).toBe(false);
    expect(rules.some((rule) => rule.id === 'rec_sponsor')).toBe(false);

    const costs = rules.find((rule) => rule.id === 'rec_costs')!;
    const wednesday = addDays(state.date, ((3 - dayOfWeek(state.date)) + 7) % 7);
    expect(recursOn(costs, wednesday)).toBe(true);
    expect(recursOn(costs, addDays(wednesday, 3))).toBe(false);
  });

  it('leaves sponsorship to the club’s agreements, not to the calendar', () => {
    const { state } = createTestGame('schedule-sponsor');
    // There is no weekly or monthly sponsorship rule any more. The agreement is
    // the single authority for when an instalment is due, so the calendar has
    // nothing to say about it and nothing to disagree with.
    expect(recurringEvents(state).some((rule) => rule.id === 'rec_sponsor')).toBe(false);
    expect(recurringEvents(state).some((rule) => rule.kind === 'sponsor')).toBe(false);
    expect(recurringEvents(state).some((rule) => rule.frequency === 'monthly')).toBe(false);
  });

  it('does not stop the clock twice for the same day', () => {
    const { state } = createTestGame('schedule-notified');
    // The first appointment of the season: the manager's own first Thursday.
    const training = sessionDatesFor(state)[0]!;
    const first = nextStop(state, state.date);
    expect(first.date).toBe(training);

    markNotifiedThrough(state, training);
    const second = nextStop(state, state.date);
    expect(second.date).not.toBe(training);
  });
});

describe('postponements', () => {
  it('leaves a perfect Sunday alone', () => {
    const { state } = createTestGame('postpone-fine');
    const match = userFixture(state);
    match.conditions = { weather: 'clear', pitch: 'excellent', pitchQuality: 18, temperatureC: 16 };
    expect(decidePostponement(state, match, match.date).postpone).toBe(false);
  });

  it('calls a game off, keeps the record and arranges the replay', () => {
    const { state } = createTestGame('postpone-fixture');
    const match = userFixture(state);
    const originalDate = match.date;
    const replacement = postponeFixture(state, match, match.date, 'Standing water in the goalmouth');

    expect(match.status).toBe('postponed');
    expect(match.postponedOn).toBe(originalDate);
    expect(match.postponementReason).toBe('Standing water in the goalmouth');
    expect(match.replacedByMatchId).toBe(replacement?.id ?? null);
    expect(replacement).not.toBeNull();
    // The replay is a genuine fixture, on a later date, on the same matchday.
    expect(replacement!.date > originalDate).toBe(true);
    expect(replacement!.matchday).toBe(match.matchday);
    expect(replacement!.originalDate).toBe(originalDate);
    expect(replacement!.status).toBe('scheduled');
    expect(state.matches[replacement!.id]).toBeDefined();
    // The pair are distinguishable, and the original never becomes active again.
    expect(isActiveFixture(match)).toBe(false);
    expect(isActiveFixture(replacement!)).toBe(true);
    // Nothing is settled until the replay has been played.
    expect(everyFixtureSettled(state)).toBe(false);
    replacement!.played = true;
    replacement!.status = 'finished';
    for (const other of Object.values(state.matches)) {
      if (other.status === 'scheduled') {
        other.played = true;
        other.status = 'finished';
      }
    }
    expect(everyFixtureSettled(state)).toBe(true);
  });

  it('keeps the original on its date, so the record shows what happened', () => {
    const { state } = createTestGame('postpone-record');
    const match = userFixture(state);
    const date = match.date;
    postponeFixture(state, match, date, 'Frozen pitch');
    const onTheDay = eventsOn(state, date).filter((item) => item.kind === 'postponed');
    expect(onTheDay).toHaveLength(1);
    expect(onTheDay[0]!.detail).toContain('Frozen pitch');
    // A called-off game must never stop the clock.
    expect(blockingEventsOn(state, date)).toHaveLength(0);
    expect(formatShortDate(date).length).toBeGreaterThan(0);
  });
});

