import { fixtureIdsOnMatchday } from '@/simulation/pyramid';
import { describe, expect, it } from 'vitest';
import { addDays } from '@/simulation/calendar';
import { processDay, readyForToday } from '@/simulation/day';
import { ensureUserXi, prepareMatchday } from '@/simulation/matchday';
import { nextFixtureFor } from '@/simulation/schedule';
import { nextMatchday } from '@/simulation/timeline';
import { createTestGame } from '@/simulation/testSupport';

/**
 * Everything a match needs before anybody can kick off.
 *
 * The clock stops *on* the day a fixture is played rather than passing through
 * it, so these are the two functions that stand between the manager and a
 * Sunday morning with two empty teams on the pitch.
 */

type State = ReturnType<typeof createTestGame>['state'];

function userFixture(state: State) {
  const match = nextFixtureFor(state, state.userClubId, state.date);
  if (!match) throw new Error('no upcoming fixture');
  return match;
}

function userSide(state: State, match: ReturnType<typeof userFixture>) {
  return match.homeClubId === state.userClubId ? match.lineups.home : match.lineups.away;
}

/** Walk the clock the way the Continue button does: one day, stopping when the
 * manager has something to deal with. */
function advanceTo(state: State, days: number) {
  for (let i = 0; i < days; i += 1) processDay(state, state.date, { resolveUserMatch: false });
}

describe('a matchday is ready before the manager sees it', () => {
  it('has two teams and a referee when the clock stops on the day', () => {
    const { state } = createTestGame('matchday-readiness');
    const matchday = nextMatchday(state);
    const date = state.season.calendar.find((entry) => entry.matchday === matchday)!.date;
    advanceTo(state, Math.max(0, daysUntil(state.date, date)));

    // Standing on the day itself, before anything has been simulated.
    expect(state.date).toBe(date);
    readyForToday(state);
    const match = userFixture(state);
    expect(match.lineups.home.starting).toHaveLength(11);
    expect(match.lineups.away.starting).toHaveLength(11);
    expect(match.lineups.home.bench.length).toBeGreaterThan(0);
    expect(match.refereeId).not.toBeNull();
  });

  it('prepares every fixture on a matchday, not just the manager’s own', () => {
    const { state } = createTestGame('matchday-whole-division');
    const matchday = nextMatchday(state);
    const date = state.season.calendar.find((entry) => entry.matchday === matchday)!.date;
    advanceTo(state, Math.max(0, daysUntil(state.date, date)));
    readyForToday(state);

    const fixtures = fixtureIdsOnMatchday(state, matchday);
    expect(fixtures.length).toBeGreaterThan(1);
    for (const id of fixtures) {
      const match = state.matches[id]!;
      expect(match.lineups.home.starting).toHaveLength(11);
      expect(match.lineups.away.starting).toHaveLength(11);
    }
  });

  it('is idempotent — the side a manager picks is never overwritten', () => {
    const { state } = createTestGame('matchday-idempotent');
    const matchday = nextMatchday(state);
    const date = state.season.calendar.find((entry) => entry.matchday === matchday)!.date;
    advanceTo(state, Math.max(0, daysUntil(state.date, date)));
    readyForToday(state);

    const match = userFixture(state);
    const lineup = userSide(state, match);
    const keep = lineup.starting[0]!.playerId;
    const squad = state.clubs[state.userClubId]!.squadIds
      .map((id) => state.people[id]!)
      .filter((person) => person.kind === 'player' && person.id !== keep);
    // The manager drops his own man in and puts somebody else on the bench.
    lineup.starting[0] = { playerId: squad[0]!.id, position: lineup.starting[0]!.position, role: lineup.starting[0]!.role, outOfPosition: false };
    const picked = lineup.starting.map((slot) => slot.playerId).join();

    readyForToday(state);
    prepareMatchday(state, matchday);
    expect(userSide(state, match).starting.map((slot) => slot.playerId).join()).toBe(picked);
  });

  it('gives the manager an XI to edit for a fixture that is still weeks away', () => {
    const { state } = createTestGame('matchday-future-xi');
    // Matchdays are only prepared on the day, so this is the state a fixture a
    // fortnight out is really in when the manager opens team selection.
    const match = userFixture(state);
    const side = match.homeClubId === state.userClubId ? 'home' : 'away';
    match.lineups[side].starting = [];
    match.lineups[side].bench = [];

    ensureUserXi(state);

    const lineup = userSide(state, match);
    expect(lineup.starting).toHaveLength(11);
    expect(lineup.starting.some((slot) => slot.position === 'GK')).toBe(true);
  });

  it('leaves a manager’s own XI alone once he has one', () => {
    const { state } = createTestGame('matchday-keep-xi');
    const match = userFixture(state);
    // The first visit hands him a team; after that it is his and not the game's.
    ensureUserXi(state);
    const lineup = userSide(state, match);
    ensureUserXi(state);
    const picked = lineup.starting.map((slot) => slot.playerId).join();
    const [first, second] = lineup.starting;
    lineup.starting[0] = second!;
    lineup.starting[1] = first!;
    ensureUserXi(state);
    expect(userSide(state, match).starting.map((slot) => slot.playerId).join()).not.toBe(picked);
  });
});

function daysUntil(from: string, to: string): number {
  let cursor = from;
  let days = 0;
  while (cursor < to && days < 400) {
    cursor = addDays(cursor, 1);
    days += 1;
  }
  return days;
}
