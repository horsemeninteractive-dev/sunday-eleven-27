import { describe, expect, it } from 'vitest';
import type { Match } from '@/domain/match';
import {
  isActiveFixture,
  kickOffForReplay,
  postponeFixture,
  rearrangementsSoFar,
  rearrangementDeadlineFor,
  rescheduleDateFor,
} from './postponement';
import { addDays, canPlayOnWeekday, CUP_KICKOFF, formatKickOff, toDate } from './calendar';
import { rollMatchConditions } from './matchday';
import { Rng } from './rng';
import { createTestGame } from './testSupport';

/**
 * Calling fixtures off.
 *
 * A postponement is never a quiet edit to a date: the original keeps its place,
 * records why it did not happen, and a replacement is created for the rearranged
 * game. These pin the thing that makes that safe — a rearranged game is still a
 * game, and it has to be played *this season*. Without that, a bad winter can
 * bounce the same fixture forward for ever: the replacement rolls its own
 * conditions from its own id, so every rearrangement is a fresh chance of being
 * called off again, and a season that cannot close takes the next one with it.
 */

function firstActive(state: ReturnType<typeof createTestGame>['state']): Match {
  const match = Object.values(state.matches).find((candidate) => isActiveFixture(candidate));
  if (!match) throw new Error('no active fixture to postpone');
  return match;
}

describe('postponements', () => {
  it('never rearranges a game past the end of the season', () => {
    const { state } = createTestGame('postponement-deadline');
    const deadline = rearrangementDeadlineFor(state);
    const lastSunday = state.season.calendar[state.season.calendar.length - 1]!.date;
    const match = firstActive(state);

    // Inside the season there is room, and the slot is a real date after the game.
    const early = rescheduleDateFor(state, match, match.date);
    expect(early).not.toBeNull();
    expect(early! > match.date).toBe(true);
    expect(early! <= deadline).toBe(true);

    // On the last Sunday the league can still find a midweek slot...
    const beforeTheEnd = rescheduleDateFor(state, match, lastSunday);
    if (beforeTheEnd) expect(beforeTheEnd <= deadline).toBe(true);

    // ...but past the deadline there is no room, and asking repeatedly cannot
    // invent one. This is the whole safety property: the search is a function of
    // the date it is given, so a later date can never find an earlier slot.
    const afterDeadline = rescheduleDateFor(state, match, deadline);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const later = rescheduleDateFor(state, match, deadline + attempt);
      expect(later === null || later <= deadline).toBe(true);
    }
    // A date already past the deadline offers nothing at all.
    expect(afterDeadline).toBeNull();
  });

  it('abandons a fixture with a reason rather than rearranging it for ever', () => {
    const { state } = createTestGame('postponement-abandoned');
    const match = firstActive(state);
    const deadline = rearrangementDeadlineFor(state);

    // Stand on the last possible day and call the game off: there is nowhere to
    // put it, so it is abandoned on the record with the reason attached.
    const replacement = postponeFixture(state, match, deadline, 'Frozen pitch — test');

    expect(replacement).toBeNull();
    expect(match.status).toBe('abandoned');
    expect(match.postponementReason).toBe('Frozen pitch — test');
    expect(match.replacedByMatchId).toBeNull();
    // And nothing new was scheduled for it.
    expect(Object.values(state.matches).filter((other) => other.originalDate !== null)).toHaveLength(0);
  });

  it('chains a bad winter to a finite number of rearrangements', () => {
    const { state } = createTestGame('postponement-chain');
    const deadline = rearrangementDeadlineFor(state);

    // Keep calling it off, the way a wet winter does, and walk the chain until
    // the league gives up. Every step moves the game later, so this must end.
    let match = firstActive(state);
    let rearrangements = 0;
    for (; rearrangements < 100; rearrangements += 1) {
      const replacement = postponeFixture(state, match, match.date, 'Standing water — test');
      if (!replacement) break;
      match = replacement;
    }

    expect(rearrangements).toBeLessThan(100);
    expect(match.status).toBe('abandoned');
    // Nothing was ever arranged outside the season.
    for (const scheduled of Object.values(state.matches)) {
      expect(scheduled.date <= deadline).toBe(true);
    }
  });
});

/**
 * A pitch that can never be played, and a fixture that is called off for ever.
 *
 * Both were found in a real career: a fixture whose home ground had the worst
 * drainage in the county was postponed five times in a row — September to
 * November — because the pitch computed as waterlogged even in clear weather, so
 * there was never a date on which it could be played.
 */
describe('a bad ground is bad, not unplayable', () => {
  /** Roll the pitch for a ground of a given drainage, on a dry day. */
  function pitchInDryWeather(drainage: number, quality: number, surface: 'grass' | '3G' = 'grass') {
    const ground = {
      id: 'g' as Match['groundId'],
      name: 'Test Ground',
      surface,
      quality,
      drainage,
      hasFloodlights: false,
      capacity: 1000,
    };
    // A fixed seed and a fixed date: the only variable under test is the ground.
    const conditions = rollMatchConditions(new Rng('dry'), ground as never, '2026-09-09' as never);
    return conditions;
  }

  it('does not call the worst ground waterlogged when no rain has fallen', () => {
    // The bug: drainage 3 and quality 5 produced a flood risk of 1.875 in clear
    // weather, above the 1.6 threshold, so the pitch was permanently waterlogged.
    const conditions = pitchInDryWeather(3, 5);
    expect(conditions.pitch).not.toBe('waterlogged');
  });

  it('plays the worst ground in the county in dry weather', () => {
    expect(pitchInDryWeather(2, 2).pitch).not.toBe('waterlogged');
  });

  it('still waterlogs the worst ground in heavy rain', () => {
    // The fix must not have simply removed the effect of a bad pitch.
    const heavy = new Rng('heavy');
    // Force heavy rain by rolling against the same stream the function uses.
    let conditions = rollMatchConditions(heavy, { id: 'g', name: 'G', surface: 'grass', quality: 2, drainage: 2, hasFloodlights: false, capacity: 1 } as never, '2026-11-14' as never);
    if (conditions.weather !== 'heavy-rain') {
      // November can roll other weather; search seeds for a heavy-rain day.
      for (let seed = 0; seed < 400 && conditions.weather !== 'heavy-rain'; seed += 1) {
        conditions = rollMatchConditions(new Rng(`heavy-${seed}`), { id: 'g', name: 'G', surface: 'grass', quality: 2, drainage: 2, hasFloodlights: false, capacity: 1 } as never, '2026-11-14' as never);
      }
    }
    expect(conditions.weather).toBe('heavy-rain');
    expect(conditions.pitch).toBe('waterlogged');
  });

  it('sheds rain on a good ground where a bad one floods', () => {
    const poor = { id: 'g', name: 'G', surface: 'grass', quality: 3, drainage: 3, hasFloodlights: false, capacity: 1 } as never;
    const good = { id: 'g', name: 'G', surface: 'grass', quality: 17, drainage: 17, hasFloodlights: false, capacity: 1 } as never;
    let poorPitch = 'worn';
    let goodPitch = 'worn';
    for (let seed = 0; seed < 60 && !(poorPitch === 'waterlogged' && goodPitch !== 'waterlogged'); seed += 1) {
      poorPitch = rollMatchConditions(new Rng(`p${seed}`), poor, '2026-11-14' as never).pitch;
      goodPitch = rollMatchConditions(new Rng(`p${seed}`), good, '2026-11-14' as never).pitch;
    }
    expect(poorPitch).toBe('waterlogged');
    expect(goodPitch).not.toBe('waterlogged');
  });

  it('leaves a 3G pitch alone whatever the weather', () => {
    expect(pitchInDryWeather(2, 2, '3G').pitch).toBe('excellent');
  });
});

describe('a fixture cannot be called off for ever', () => {
  it('abandons a fixture that has been rearranged the maximum number of times', () => {
    const { state } = createTestGame('postponement-cap');
    let match = firstActive(state);
    let rearrangements = 0;

    // Keep calling it off until the rule gives up.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const replacement = postponeFixture(state, match, match.date, 'Standing water');
      if (!replacement) break;
      rearrangements += 1;
      match = replacement;
    }

    // The bug: this never terminated, and the fixture rolled from September to
    // November with the round unable to complete.
    expect(rearrangements).toBeGreaterThan(0);
    expect(rearrangements).toBeLessThanOrEqual(3);
    expect(match.status).toBe('abandoned');
    expect(rearrangementsSoFar(state, match)).toBeLessThanOrEqual(3);
  });

  it('counts a fixture that was already bouncing before the rule existed', () => {
    const { state } = createTestGame('postponement-existing-chain');
    const first = firstActive(state);
    let current = postponeFixture(state, first, first.date, 'Frozen');
    for (let i = 0; i < 2 && current; i += 1) {
      current = postponeFixture(state, current, current.date, 'Frozen');
    }
    expect(current).not.toBeNull();
    // The counter walks the chain out of the world rather than trusting a field.
    expect(rearrangementsSoFar(state, current!)).toBe(3);
  });

  it('stops counting at a fixture that has not been rearranged at all', () => {
    const { state } = createTestGame('postponement-none');
    expect(rearrangementsSoFar(state, firstActive(state))).toBe(0);
  });
});

describe('kick-off times read the same wherever they are shown', () => {
  it('rewrites a 24-hour time into the house style', () => {
    expect(formatKickOff('19:45')).toBe('7:45pm');
    expect(formatKickOff('18:45')).toBe('6:45pm');
    expect(formatKickOff('14:00')).toBe('2:00pm');
    // Midnight and noon are the two that a naive hour % 12 gets wrong.
    expect(formatKickOff('00:00')).toBe('12:00am');
    expect(formatKickOff('12:00')).toBe('12:00pm');
    expect(formatKickOff('09:30')).toBe('9:30am');
  });

  it('leaves a time that is already written the right way alone', () => {
    expect(formatKickOff('10:30am')).toBe('10:30am');
    expect(formatKickOff('7:45pm')).toBe('7:45pm');
    // A kick-off with no particular hour has nothing to convert.
    expect(formatKickOff('tbc')).toBe('tbc');
    expect(formatKickOff('')).toBe('');
  });

  it('gives a cup tie and its replay the same spelling as a league game', () => {
    expect(CUP_KICKOFF).toBe(formatKickOff(CUP_KICKOFF));
    // A midweek replay is an evening game; a Sunday keeps the morning kick-off.
    expect(kickOffForReplay('2026-09-16', CUP_KICKOFF)).toBe('6:45pm');
    expect(kickOffForReplay('2026-09-20', '10:30am')).toBe('10:30am');
    // There is no Saturday case any more: nothing in this league is played on a
    // Saturday, so a rearranged game can never be given a Saturday kick-off.
    expect(kickOffForReplay('2026-09-19', CUP_KICKOFF)).toBe(CUP_KICKOFF);
  });
});

describe('a game is never played on a Thursday or a Saturday', () => {
  it('will not move a fixture to either, however hard it looks', () => {
    const { state } = createTestGame('postponement-banned-days');
    const match = firstActive(state);
    // Walk every date a rearrangement could reach inside its search window.
    const weekdays = new Set<number>();
    for (let day = 0; day < 60; day += 1) {
      const from = addDays(state.date, day);
      const slot = rescheduleDateFor(state, match, from);
      if (slot) weekdays.add(toDate(slot).getUTCDay());
    }
    // Only Sundays, in fact: with a free Sunday in most weeks the midweek
    // fallback is never reached. A Wednesday is permitted — it is the last
    // resort — but a Thursday and a Saturday are not permitted at all, so the
    // only thing to assert is that they never appear.
    expect(weekdays.size).toBeGreaterThan(0);
    expect(weekdays.has(4)).toBe(false);
    expect(weekdays.has(6)).toBe(false);
    for (const weekday of weekdays) {
      expect(canPlayOnWeekday(weekday)).toBe(true);
    }
  });
});
