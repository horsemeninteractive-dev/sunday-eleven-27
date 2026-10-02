import { describe, expect, it } from 'vitest';
import { isOfficial, type Official } from '@/domain/person';
import { createTestGame } from './testSupport';
import { MANAGER_MARKET, runManagerMarket, type ManagerMarketContext } from './managers';

/**
 * The managers' market is only meaningful if it both moves and bounds the men in
 * it: a post that falls vacant must be filled, a career that ends must not leave
 * the club pointing at a ghost, and the pool of men between jobs must not grow
 * without limit — those are the properties a long career depends on.
 */

function contextFor(state: ReturnType<typeof createTestGame>['state'], index: number): ManagerMarketContext {
  return {
    seasonId: `season_test_next_${index}`,
    seasonLabel: `next ${index}`,
    seasonStart: state.season.startDate,
    previousSeasonId: `season_test_prev_${index}`,
    previousSeasonLabel: `prev ${index}`,
  };
}

/** Every club's manager, if it has one, must still exist. */
function everyClubIsStaffed(state: ReturnType<typeof createTestGame>['state']): void {
  for (const club of Object.values(state.clubs)) {
    expect(club.managerId).toBeTruthy();
    expect(state.people[club.managerId!]).toBeDefined();
  }
}

function managersBetweenJobs(state: ReturnType<typeof createTestGame>['state']): Official[] {
  return Object.values(state.people).filter(
    (person): person is Official => isOfficial(person) && person.clubId === null && person.role === 'manager',
  );
}

/**
 * Give a club the worst possible season on the record, without replaying one:
 * the market judges the archive, so writing the archive is enough.
 */
function recordDisaster(
  state: ReturnType<typeof createTestGame>['state'],
  seasonId: string,
  clubId: string,
  positions: number,
): void {
  const club = state.clubs[clubId]!;
  club.history.seasons.unshift({
    seasonId,
    seasonLabel: seasonId,
    competitionName: 'Test League',
    tier: 1,
    played: 22,
    won: 1,
    drawn: 1,
    lost: 20,
    goalsFor: 10,
    goalsAgainst: 70,
    points: 4,
    finalPosition: positions,
  });
}

describe('the managers’ market', () => {
  it('retires a manager who has had enough, and fills the post with somebody who exists', () => {
    const { state } = createTestGame('managers-retire');
    const competition = Object.values(state.competitions)[0]!;
    const clubId = competition.clubIds.find((id) => isOfficial(state.people[state.clubs[id]!.managerId!]))!;
    const club = state.clubs[clubId]!;
    const manager = state.people[club.managerId!] as Official;
    manager.age = MANAGER_MARKET.retirementAge;

    const outcome = runManagerMarket(state, contextFor(state, 0));

    expect(state.people[manager.id]).toBeUndefined();
    expect(outcome.changes.some((change) => change.clubId === clubId && change.reason === 'retired')).toBe(true);
    expect(club.managerId).toBeTruthy();
    expect(state.people[club.managerId!]).toBeDefined();
    expect(isOfficial(state.people[club.managerId!]) || club.managerId !== manager.id).toBe(true);
  });

  it('costs a manager his job when a season falls far below what the club expects', () => {
    const { state } = createTestGame('managers-sack');
    const competition = Object.values(state.competitions)[0]!;
    // A club with an official in the dugout: a player-manager is left alone by
    // the market, so sacking one would not be testing anything.
    const clubId = competition.clubIds.find(
      (id) => id !== state.userClubId && isOfficial(state.people[state.clubs[id]!.managerId!]),
    )!;
    const positions = competition.clubIds.length;

    let sacks = 0;
    for (let index = 0; index < 12; index++) {
      const previousSeasonId = `season_test_prev_${index}`;
      recordDisaster(state, previousSeasonId, clubId, positions);
      const outcome = runManagerMarket(state, {
        ...contextFor(state, index),
        previousSeasonId,
      });
      if (outcome.changes.some((change) => change.clubId === clubId && change.reason === 'sacked')) sacks += 1;
      everyClubIsStaffed(state);
    }

    expect(sacks).toBeGreaterThan(0);
  });

  it('never leaves a club managerless and keeps the pool of men between jobs bounded', () => {
    const { state } = createTestGame('managers-bounds');
    const competition = Object.values(state.competitions)[0]!;
    const positions = competition.clubIds.length;

    for (let index = 0; index < 10; index++) {
      // Everybody finishes bottom-ish, so the wheel really turns.
      for (const clubId of competition.clubIds) recordDisaster(state, `season_test_prev_${index}`, clubId, positions);
      runManagerMarket(state, contextFor(state, index));

      everyClubIsStaffed(state);
      expect(managersBetweenJobs(state).length).toBeLessThanOrEqual(MANAGER_MARKET.maxPool);
    }
  });
});
