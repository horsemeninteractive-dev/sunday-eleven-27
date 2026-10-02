import { describe, expect, it } from 'vitest';
import { isPlayer } from '@/domain/person';
import { createTestGame } from './testSupport';
import { CLUB_LIFECYCLE, reviewClubFinances, type ClubLifecycleContext } from './clubLifecycle';

/**
 * The point of the cycle is that a club can die and the league survives it: a
 * club that cannot pay its way folds, and a new club takes its place in the same
 * town so the division never shrinks. These tests hold both halves.
 */

function contextFor(state: ReturnType<typeof createTestGame>['state'], index = 0): ClubLifecycleContext {
  return {
    seasonId: `season_lifecycle_${index}`,
    seasonLabel: `lifecycle ${index}`,
    seasonStart: state.season.startDate,
  };
}

function firstNonUserClub(state: ReturnType<typeof createTestGame>['state']): string {
  const competition = Object.values(state.competitions)[0]!;
  return competition.clubIds.find((id) => id !== state.userClubId)!;
}

describe('club folding and reform', () => {
  it('folds a club in terminal debt and forms a new one in its place', () => {
    const { state } = createTestGame('club-folds');
    const competition = Object.values(state.competitions)[0]!;
    const clubId = firstNonUserClub(state);
    const club = state.clubs[clubId]!;
    const size = competition.clubIds.length;
    const squadIds = [...club.squadIds];
    const townId = club.townId;
    club.finances.balance = CLUB_LIFECYCLE.terminalDebt - 500;

    const outcome = reviewClubFinances(state, contextFor(state));

    expect(outcome.folded.some((fold) => fold.clubId === clubId)).toBe(true);
    expect(state.clubs[clubId]!.active).toBe(false);
    expect(competition.clubIds).not.toContain(clubId);

    // Its people are gone from the world.
    for (const id of squadIds) expect(state.people[id]).toBeUndefined();

    // A new club formed in the same town, and the division kept its size.
    expect(competition.clubIds.length).toBe(size);
    const formed = outcome.formed[0]!;
    const replacement = state.clubs[formed.clubId]!;
    expect(replacement.active).toBe(true);
    expect(replacement.townId).toBe(townId);
    expect(replacement.squadIds.length).toBeGreaterThanOrEqual(11);
    expect(replacement.squadIds.filter((id) => isPlayer(state.people[id])).length).toBeGreaterThanOrEqual(11);
    expect(competition.clubIds).toContain(formed.clubId);
    expect(outcome.events.length).toBeGreaterThan(0);
  });

  it('gives a club in the red a few seasons to recover, and resets when it does', () => {
    const { state } = createTestGame('club-recovers');
    const clubId = firstNonUserClub(state);
    const club = state.clubs[clubId]!;

    club.finances.balance = -300;
    const first = reviewClubFinances(state, contextFor(state, 0));
    expect(first.folded.some((fold) => fold.clubId === clubId)).toBe(false);
    expect(club.finances.administrationSeasons).toBe(1);
    expect(club.active).toBe(true);

    club.finances.balance = 400; // a good season, a sponsor back
    reviewClubFinances(state, contextFor(state, 1));
    expect(club.finances.administrationSeasons).toBe(0);

    club.finances.balance = -150;
    const third = reviewClubFinances(state, contextFor(state, 2));
    expect(third.folded.some((fold) => fold.clubId === clubId)).toBe(false);
    expect(club.finances.administrationSeasons).toBe(1);
  });

  it('folds a club that cannot get out of the red after the grace period', () => {
    const { state } = createTestGame('club-grace');
    const competition = Object.values(state.competitions)[0]!;
    const clubId = firstNonUserClub(state);
    const club = state.clubs[clubId]!;
    const size = competition.clubIds.length;
    club.finances.balance = -200;

    reviewClubFinances(state, contextFor(state, 0));
    reviewClubFinances(state, contextFor(state, 1));
    const third = reviewClubFinances(state, {
      ...contextFor(state, 2),
      seasonId: 'season_lifecycle_2b',
    });

    expect(third.folded.some((fold) => fold.clubId === clubId)).toBe(true);
    expect(club.active).toBe(false);
    expect(competition.clubIds.length).toBe(size);
  });

  it('holds the player’s own club out of the cycle', () => {
    const { state } = createTestGame('club-protected');
    const userClub = state.clubs[state.userClubId]!;
    userClub.finances.balance = -100000;

    for (let index = 0; index < 5; index++) {
      reviewClubFinances(state, { ...contextFor(state, index), protectedClubIds: [state.userClubId] });
    }

    expect(userClub.active).toBe(true);
    expect(userClub.finances.administrationSeasons).toBe(0);
  });
});
