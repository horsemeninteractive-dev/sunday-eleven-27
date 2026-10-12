import { describe, expect, it } from 'vitest';
import { isOfficial, type Official } from '@/domain/person';
import { createTestGame } from './testSupport';
import { generateManager } from './generation/worldGenerator';
import { appointStaff, rolesAtClub } from './staff';
import { Rng } from './rng';
import { fillVacantPost, MANAGER_MARKET, runManagerMarket, type ManagerMarketContext } from './managers';

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

  /**
   * A man promoted from the committee gives up the post he was holding.
   *
   * The best-placed man inside a club is normally the assistant, so this is the
   * ordinary route into a manager's job and not an edge case — but the committee's
   * roster went on naming him as the assistant in the post he had just left.
   * Nothing noticed until his age caught up with him: the market retires a manager
   * at 68 and deletes him from the world, and the club was then left pointing at a
   * man who no longer existed. The fifteen-season soak found it (`club-staff-exists`
   * four seasons after a re-formed club was minted: the replacement's assistant had
   * been promoted, and his assistant post outlived him).
   */
  it('vacates the post a promoted assistant was holding, and outlives his own retirement', () => {
    const { state } = createTestGame('managers-promote');
    const competition = Object.values(state.competitions)[0]!;
    const clubId = competition.clubIds.find((id) => id !== state.userClubId)!;
    const club = state.clubs[clubId]!;
    // Nobody in the county is between jobs, and the club has no manager, so the
    // only man the post can go to is the one already in the building.
    club.managerId = null;
    for (const person of Object.values(state.people)) {
      if (isOfficial(person) && person.clubId === null && person.role === 'manager') delete state.people[person.id];
    }
    const assistant = generateManager(new Rng('managers-promote-assistant'), club.townId, club.reputation, 1);
    // The generated id is `mgr_1` whatever is asked for, and the world already
    // has one of those: a fixture that overwrote him would be testing its own
    // collision rather than the promotion.
    assistant.id = 'staff_test_promoted_assistant';
    assistant.role = 'assistant';
    state.people[assistant.id] = assistant;
    appointStaff(state, club.id, assistant.id, 'assistant', state.date);
    expect(club.staff!.assistantId).toBe(assistant.id);

    const change = fillVacantPost(state, club, contextFor(state, 0));

    expect(change?.personId).toBe(assistant.id);
    expect(club.managerId).toBe(assistant.id);
    // The post he held is empty rather than still naming him, and his own record
    // no longer says he is the assistant.
    expect(club.staff!.assistantId).toBeNull();
    expect(rolesAtClub(assistant, club.id)).toEqual([]);

    // Which is what makes his own retirement survivable: at 68 the market takes
    // him out of the world, and no club is left pointing at him.
    assistant.age = MANAGER_MARKET.retirementAge;
    runManagerMarket(state, contextFor(state, 1));

    expect(state.people[assistant.id]).toBeUndefined();
    everyClubIsStaffed(state);
    for (const candidate of Object.values(state.clubs)) {
      const named = [
        candidate.staff?.assistantId,
        candidate.staff?.physioId,
        candidate.staff?.secretaryId,
        candidate.staff?.treasurerId,
        ...(candidate.staff?.coachIds ?? []),
        ...(candidate.staff?.scoutIds ?? []),
        ...(candidate.staff?.volunteerIds ?? []),
      ].filter((id): id is string => Boolean(id));
      for (const id of named) expect(state.people[id], `${candidate.id} names ${id}`).toBeDefined();
    }
  });
});
