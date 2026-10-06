import { describe, expect, it } from 'vitest';
import { isPlayer } from '@/domain/person';
import { createTestGame } from './testSupport';
import { leagueCompetitions, tierOf } from './pyramid';
import { startNextSeason } from './season';
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
    divisions: leagueCompetitions(state).map((competition) => competition.clubIds),
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

  /**
   * The club that forms in a folded club's place has to be in the ladder from
   * the moment it exists. It used to be pushed into last season's competition
   * record, which the new season was not built from — so it arrived in no
   * division at all, with no fixtures and no season record to archive.
   */
  it('puts a replacement club straight into the division its predecessor left', () => {
    const { state } = createTestGame('club-reform-division');
    const clubId = firstNonUserClub(state);
    const club = state.clubs[clubId]!;
    const tier = tierOf(state, clubId);
    const sizesBefore = leagueCompetitions(state).map((competition) => competition.clubIds.length);
    const knownBefore = new Set(leagueCompetitions(state).flatMap((competition) => [...competition.clubIds]));
    club.finances.balance = CLUB_LIFECYCLE.terminalDebt - 500;

    startNextSeason(state);

    // The old club is off the ladder entirely, not merely inactive on it.
    expect(state.clubs[clubId]!.active).toBe(false);
    expect(leagueCompetitions(state).some((competition) => competition.clubIds.includes(clubId))).toBe(false);

    // The new club exists, is in exactly one division, and sits in the tier the
    // club it replaced played in.
    const replacement = Object.values(state.clubs).find(
      (candidate) => candidate.active && !knownBefore.has(candidate.id),
    );
    expect(replacement).toBeTruthy();
    const memberships = leagueCompetitions(state).filter((competition) =>
      competition.clubIds.includes(replacement!.id),
    );
    expect(memberships).toHaveLength(1);
    expect(tierOf(state, replacement!.id)).toBe(tier);

    // And it has this season's record already opened, so the season is archived.
    expect(replacement!.history.seasons.some((record) => record.seasonId === state.season.id)).toBe(true);

    // The ladder holds its size, which is the whole point of the cycle.
    expect(leagueCompetitions(state).map((competition) => competition.clubIds.length)).toEqual(sizesBefore);

    // Every active club is in exactly one division, both halves of the swap
    // having gone through the same ladder the season was actually built from.
    for (const candidate of Object.values(state.clubs)) {
      if (!candidate.active) continue;
      const count = leagueCompetitions(state).filter((competition) => competition.clubIds.includes(candidate.id)).length;
      expect(count).toBe(1);
    }
  });

  it('forms a distinct replacement for each club that folds, even in one town', () => {
    const { state } = createTestGame('club-reform-collision');
    // A town can hold more than one club and both can go under in one summer.
    // The replacement stream and id used to be keyed on the town, so the second
    // fold minted the same club again: one id in the division twice and two
    // fixtures on one afternoon.
    const byTown = new Map<string, string[]>();
    for (const club of Object.values(state.clubs)) {
      if (!club.active || club.id === state.userClubId) continue;
      byTown.set(club.townId, [...(byTown.get(club.townId) ?? []), club.id]);
    }
    const pair = [...byTown.values()].find((ids) => ids.length >= 2);
    expect(pair).toBeTruthy();
    const sizesBefore = leagueCompetitions(state).map((competition) => competition.clubIds.length);
    const knownBefore = new Set(leagueCompetitions(state).flatMap((competition) => [...competition.clubIds]));
    for (const clubId of pair!.slice(0, 2)) {
      state.clubs[clubId]!.finances.balance = CLUB_LIFECYCLE.terminalDebt - 500;
    }

    startNextSeason(state);

    const formed = Object.values(state.clubs).filter((club) => club.active && !knownBefore.has(club.id));
    expect(formed).toHaveLength(2);
    for (const replacement of formed) {
      const memberships = leagueCompetitions(state).filter((competition) =>
        competition.clubIds.includes(replacement.id),
      );
      expect(memberships).toHaveLength(1);
    }
    // No club id is listed twice in any division, and the ladder holds its size.
    for (const competition of leagueCompetitions(state)) {
      expect(new Set(competition.clubIds).size).toBe(competition.clubIds.length);
    }
    expect(leagueCompetitions(state).map((competition) => competition.clubIds.length)).toEqual(sizesBefore);
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
