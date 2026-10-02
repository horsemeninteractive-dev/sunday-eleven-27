import { describe, expect, it } from 'vitest';
import type { Match } from '@/domain/match';
import { isActiveFixture, postponeFixture, rearrangementDeadlineFor, rescheduleDateFor } from './postponement';
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
