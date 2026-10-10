import { describe, expect, it } from 'vitest';
import type { ISODate } from '@/domain/ids';
import { plannerDays, type PlannerDay, type PlannerEvent } from '@/simulation/planner';
import { createTestGame } from '@/simulation/testSupport';
import { minutesOf, toneOf, weekLabel, weekStripView } from './weekStrip';

/**
 * The week bar's decisions, checked without a browser.
 *
 * The bar is the one screen element that is read before anything else, so what
 * is asserted here is what a manager would notice if it were wrong: that a match
 * leads its day, that a cleared event stops shouting, that the week's own name
 * survives a month boundary, and that a Sunday is not called the same thing as
 * a Monday.
 */

function event(overrides: Partial<PlannerEvent> = {}): PlannerEvent {
  return {
    kind: 'training',
    time: '19:00',
    label: 'Training',
    detail: '',
    priority: 'informational',
    resolved: false,
    ...overrides,
  };
}

function day(date: ISODate, events: PlannerEvent[] = []): PlannerDay {
  const parsed = new Date(`${date}T00:00:00Z`);
  const weekday = parsed.getUTCDay();
  return {
    date,
    weekday,
    weekdayLabel: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(weekday + 6) % 7]!,
    dayLabel: String(parsed.getUTCDate()),
    monthLabel: parsed.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }),
    isToday: false,
    isPast: false,
    isMatchday: events.some((candidate) => candidate.kind === 'league-match' || candidate.kind === 'cup-match'),
    isTrainingDay: events.some((candidate) => candidate.kind === 'training'),
    events,
  };
}

describe('the weight a day carries', () => {
  it('gives a match the match, whatever else is on the day', () => {
    // A match is a match even though it is rated critical: the day the week is
    // arranged around is not allowed to read as an alarm.
    expect(toneOf(event({ kind: 'league-match', priority: 'critical' }))).toBe('match');
    expect(toneOf(event({ kind: 'cup-match', priority: 'critical' }))).toBe('match');
    expect(toneOf(event({ kind: 'friendly', priority: 'important' }))).toBe('match');
  });

  it('reads a session and a called-off session differently', () => {
    expect(toneOf(event({ kind: 'training', priority: 'background' }))).toBe('training');
    expect(toneOf(event({ kind: 'training-cancelled', priority: 'informational' }))).toBe('attention');
  });

  it('keeps one day a week flagged for a match that was not played', () => {
    expect(toneOf(event({ kind: 'postponed', priority: 'critical' }))).toBe('attention');
  });

  it('stops shouting once the manager has dealt with it', () => {
    // The same injury, before and after: an unresolved critical event wants him,
    // a resolved one is history and belongs in the muted ink.
    const injury = event({ kind: 'injury', priority: 'critical' });
    expect(toneOf(injury)).toBe('attention');
    expect(toneOf({ ...injury, resolved: true })).toBe('club');
  });

  it('separates club business from the things that simply happen', () => {
    expect(toneOf(event({ kind: 'committee', priority: 'important' }))).toBe('attention');
    expect(toneOf(event({ kind: 'sponsor', priority: 'informational' }))).toBe('club');
    expect(toneOf(event({ kind: 'social', priority: 'background' }))).toBe('club');
    expect(toneOf(event({ kind: 'finance', priority: 'informational' }))).toBe('quiet');
    expect(toneOf(event({ kind: 'world-news', priority: 'background' }))).toBe('quiet');
  });
});

describe('reading an hour', () => {
  it('takes both clocks the world writes in', () => {
    expect(minutesOf('19:00')).toBe(19 * 60);
    expect(minutesOf('10:15am')).toBe(10 * 60 + 15);
    expect(minutesOf('2:00pm')).toBe(14 * 60);
  });

  it('sorts the morning before the afternoon rather than the string before the string', () => {
    // '9:00am' is later in the alphabet than '10:00am' and earlier in the day,
    // which is the whole reason the bar sorts on minutes.
    expect(minutesOf('9:00am')!).toBeLessThan(minutesOf('10:00am')!);
    expect(minutesOf('9:00pm')!).toBeGreaterThan(minutesOf('10:00am')!);
  });

  it('says nothing about a time it cannot read', () => {
    expect(minutesOf('')).toBeNull();
    expect(minutesOf('afternoon')).toBeNull();
    expect(minutesOf('25:00')).toBeNull();
  });
});

describe('the week has seven days whatever the calendar month does', () => {
  it('names a week inside one month', () => {
    expect(weekLabel([day('2026-08-03'), day('2026-08-09')])).toBe('3–9 August 2026');
  });

  it('names both months when the week straddles one', () => {
    expect(weekLabel([day('2026-08-31'), day('2026-09-06')])).toBe('31 August – 6 September 2026');
  });

  it('writes the year out at both ends exactly when the week straddles that', () => {
    // Once a season, and a week that did not say which December it meant would
    // read as a typo.
    expect(weekLabel([day('2026-12-28'), day('2027-01-03')])).toBe('28 December 2026 – 3 January 2027');
  });
});

describe('the bar itself', () => {
  const today = '2026-08-05' as ISODate;

  it('marks the day being stood on, and the days already behind it', () => {
    const view = weekStripView(plannerDays(buildState(), 0, 7, today), today);
    expect(view.days).toHaveLength(7);
    expect(view.days.map((entry) => entry.weekdayLabel)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(view.days.filter((entry) => entry.isToday)).toHaveLength(1);
    expect(view.days.filter((entry) => entry.isPast).map((entry) => entry.date)).toEqual([
      '2026-08-03',
      '2026-08-04',
    ]);
    // Today counts as one left, so a Sunday says "Last day" rather than "0 days
    // left" — the manager is still standing in it.
    expect(view.remaining).toBe(5);
  });

  it('leads the day with its match, and counts what a column could not hold', () => {
    const saturday = day('2026-08-08', [
      event({ kind: 'finance', time: '09:00', label: 'Subs go out', priority: 'informational' }),
      event({ kind: 'league-match', time: '14:00', label: 'vs Galway', priority: 'critical' }),
      event({ kind: 'training', time: '19:00', label: 'Light session', priority: 'informational' }),
      event({ kind: 'social', time: '', label: 'Quiz night', priority: 'background' }),
    ]);
    const view = weekStripView([saturday], today, { limit: 2 });
    expect(view.days[0]!.entries.map((entry) => entry.label)).toEqual(['vs Galway', 'Subs go out']);
    expect(view.days[0]!.hidden).toBe(2);
    expect(view.days[0]!.isMatchday).toBe(true);
  });

  it('counts the days with a game on them, which is why the week is arranged at all', () => {
    const week = [
      day('2026-08-03'),
      day('2026-08-04', [event({ kind: 'league-match', priority: 'critical' })]),
      day('2026-08-05'),
      day('2026-08-06'),
      day('2026-08-07'),
      day('2026-08-08', [event({ kind: 'cup-match', priority: 'critical' })]),
      day('2026-08-09'),
    ];
    const view = weekStripView(week, today);
    expect(view.matchdays).toBe(2);
  });

  it('shows every entry of a quiet week rather than an empty one', () => {
    const training = day('2026-08-06', [event({ kind: 'training', label: 'Tactical training' })]);
    const view = weekStripView([training], today);
    expect(view.days[0]!.entries).toHaveLength(1);
    expect(view.days[0]!.hidden).toBe(0);
  });

  it('has nothing to say about a week with no days in it', () => {
    expect(weekStripView([], today).label).toBe('');
  });
});

/** A real game, so the bar is read off the world it is drawn from. */
function buildState() {
  return createTestGame('week-strip', 0, 2026).state;
}
