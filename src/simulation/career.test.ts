import { describe, expect, it } from 'vitest';
import type { ClubHistory } from '@/domain/club';
import { MANAGER_PERSON_ID } from '@/domain/communication';
import { isOfficial } from '@/domain/person';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { addDays } from './calendar';
import { continueTime } from './day';
import {
  applyForJob,
  careerStore,
  guaranteeVacancyFor,
  isEmployed,
  JOB_MARKET,
  managingClubId,
  runCareerDay,
  userManager,
  type CareerContext,
} from './career';
import { governanceStore } from './governance';
import { leagueClubIds } from './pyramid';
import { startNextSeason } from './season';
import { createTestGame, type TestGame } from './testSupport';

/**
 * The career loop is only real if it runs the whole way round: a committee that
 * parts ways with a manager must actually leave him without a club, the days
 * must pass with him out of work, a vacancy must be there to apply for, and a
 * yes must put him back in charge of a club he can actually pick a team for.
 * Anything less is a state the game cannot get out of.
 */

type State = TestGame['state'];

function userClub(state: State) {
  return state.clubs[state.userClubId]!;
}

function contextFor(state: State): CareerContext {
  return {
    seasonId: state.season.id,
    seasonLabel: state.season.label,
    seasonStart: state.season.startDate,
    previousSeasonId: state.season.id,
    previousSeasonLabel: state.season.label,
  };
}

/** A finished season on a club's record, however it actually went. */
function recordSeason(state: State, clubId: string, seasonId: string, seasonLabel: string, position: number): void {
  const record: ClubHistory['seasons'][number] = {
    seasonId,
    seasonLabel,
    competitionName: 'Stour Valley Sunday League Division One',
    tier: 1,
    played: 22,
    won: 2,
    drawn: 2,
    lost: 18,
    goalsFor: 14,
    goalsAgainst: 74,
    points: 8,
    finalPosition: position,
  };
  state.clubs[clubId]!.history.seasons.unshift(record);
}

function divisionOf(state: State, clubId: string) {
  return Object.values(state.competitions).find(
    (competition) => competition.kind === 'league' && competition.clubIds.includes(clubId),
  );
}

/**
 * Put the user's club in a place the committee cannot ignore, and give the rest
 * of the county a bad enough season that the managers' market empties a few
 * posts. A world where only one job comes free is a world with nothing to apply
 * for, which is not what this feature is about.
 */
function forceDismissal(game: TestGame): void {
  const state = game.state;
  const club = userClub(state);
  // Deep trouble, but a debt the club can still survive: this fixture is about
  // the committee parting ways with him, and a debt past
  // `CLUB_LIFECYCLE.terminalDebt` takes the decision out of the committee's hands
  // — the club folds and the spell ends `club-folded` instead. See
  // `clubLifecycle.test.ts`, which holds that end of it.
  club.finances.balance = -3000;
  club.finances.administrationSeasons = 3;

  // Everybody finishes bottom of their division: the user's club to the
  // committee's certain displeasure, and the rest so the carousel really turns.
  for (const clubId of leagueClubIds(state)) {
    if (clubId === state.userClubId) continue;
    const size = divisionOf(state, clubId)?.clubIds.length ?? 12;
    recordSeason(state, clubId, state.season.id, state.season.label, size);
  }
  recordSeason(state, state.userClubId, state.season.id, state.season.label, 12);
  recordSeason(state, state.userClubId, 'season_prev_2', '2024/25', 12);
  recordSeason(state, state.userClubId, 'season_prev_1', '2023/24', 12);
  governanceStore(state).standing = 'pressure';
}

/** Carry the dismissal through the season boundary and land between jobs. */
function dismissAtBoundary(game: TestGame): void {
  forceDismissal(game);
  startNextSeason(game.state);
  expect(isEmployed(game.state)).toBe(false);
}

describe('the player-manager career loop', () => {
  it('begins in work, in charge of the club chosen', () => {
    const game = createTestGame('career-start');
    expect(isEmployed(game.state)).toBe(true);
    expect(managingClubId(game.state)).toBe(game.clubId);
    const spell = careerStore(game.state).spells.at(-1)!;
    expect(spell.clubId).toBe(game.clubId);
    expect(spell.to).toBeNull();
  });

  it('ends the tenure at the season boundary, and leaves him between jobs', () => {
    const game = createTestGame('career-dismiss');
    const state = game.state;
    const oldClubId = state.userClubId;
    const oldClub = userClub(state);

    forceDismissal(game);
    // Before the boundary he is still in work: only the season turning can take
    // the job away.
    expect(isEmployed(state)).toBe(true);
    expect(managingClubId(state)).toBe(oldClubId);

    startNextSeason(state);

    expect(isEmployed(state)).toBe(false);
    expect(careerStore(state).status).toBe('unemployed');
    expect(careerStore(state).clubId).toBeNull();
    expect(careerStore(state).lastClubId).toBe(oldClubId);
    expect(managingClubId(state)).toBeNull();

    // The club's own history is where the tenure ends, and the post is emptied.
    expect(oldClub.managerId).not.toBe(MANAGER_PERSON_ID);
    const tenure = oldClub.history.managers.find((entry) => entry.personId === MANAGER_PERSON_ID);
    expect(tenure).toBeDefined();
    expect(tenure!.to).not.toBeNull();

    // The spell is closed with the reason, and the manager is still in the world
    // — he is the player, and the point of all this.
    const spell = careerStore(state).spells.at(-1)!;
    expect(spell.clubId).toBe(oldClubId);
    expect(spell.to).not.toBeNull();
    expect(spell.ending).toBe('dismissed');
    expect(userManager(state)).not.toBeNull();
    expect(userManager(state)!.clubId).toBeNull();
  });

  it('leaves every club either staffed or advertising, never simply abandoned', () => {
    const game = createTestGame('career-staffed');
    dismissAtBoundary(game);
    const state = game.state;

    const openings = new Set(careerStore(state).openings.map((opening) => opening.clubId));
    for (const clubId of leagueClubIds(state)) {
      const club = state.clubs[clubId]!;
      const staffed = Boolean(club.managerId) && Boolean(state.people[club.managerId!]);
      expect(staffed || openings.has(clubId)).toBe(true);
    }
  });

  it('holds a handful of posts open, and fills them when the window closes', () => {
    const game = createTestGame('career-market');
    const state = game.state;
    dismissAtBoundary(game);

    const openings = careerStore(state).openings;
    expect(openings.length).toBeGreaterThan(0);
    expect(openings.length).toBeLessThanOrEqual(JOB_MARKET.hold);
    // Never the club he has just left: a committee does not re-hire the man it
    // has dismissed the same afternoon.
    expect(openings.some((opening) => opening.clubId === careerStore(state).lastClubId)).toBe(false);

    const first = openings[0]!;
    // Each is genuinely vacant, and open for exactly the window.
    for (const opening of openings) {
      expect(state.clubs[opening.clubId]!.managerId).toBeFalsy();
      expect(addDays(opening.postedOn, JOB_MARKET.windowDays)).toBe(opening.closesOn);
    }

    // The day after the window shuts, the club stops waiting and appoints.
    runCareerDay(state, addDays(first.closesOn, 1));
    expect(state.clubs[first.clubId]!.managerId).toBeTruthy();
    expect(careerStore(state).openings.some((opening) => opening.clubId === first.clubId)).toBe(false);
  });

  it('appoints him into a vacant post, and he is back in charge of a real club', () => {
    const game = createTestGame('career-appointed');
    const state = game.state;
    dismissAtBoundary(game);

    // A man good enough for the posts he is offered: his standing is set to the
    // clubs' own, so the appointment is decided on his coaching and not on a
    // gamble against the field. The roll is deterministic from the seed, so this
    // either lands on a given seed or does not — it never flickers between runs.
    const manager = userManager(state)!;
    manager.reputation = Math.max(...careerStore(state).openings.map((opening) => state.clubs[opening.clubId]!.reputation));

    let accepted = false;
    for (const opening of [...careerStore(state).openings]) {
      const result = applyForJob(state, opening.clubId, contextFor(state));
      if (result.accepted) {
        accepted = true;
        break;
      }
    }
    expect(accepted).toBe(true);

    expect(isEmployed(state)).toBe(true);
    expect(careerStore(state).status).toBe('employed');
    expect(managingClubId(state)).toBe(state.userClubId);
    expect(state.clubs[state.userClubId]!.managerId).toBe(MANAGER_PERSON_ID);
    expect(careerStore(state).openings).toEqual([]);
    expect(careerStore(state).spells.at(-1)!.to).toBeNull();

    // The club is his: a squad to pick from, a £book and a tactics sheet.
    const hisClub = state.clubs[state.userClubId]!;
    expect(hisClub.squadIds.length).toBeGreaterThan(0);
    expect(hisClub.tactics.formation).toBe('4-4-2');
    const tenure = hisClub.history.managers.find((entry) => entry.personId === MANAGER_PERSON_ID);
    expect(tenure!.to).toBeNull();
  });

  it('closes a post for good when it turns him down', () => {
    const game = createTestGame('career-refused');
    const state = game.state;
    dismissAtBoundary(game);

    // Reach far above his level: a club far better than the man asking will say
    // no, and once it has, the same man does not ask again.
    const manager = userManager(state)!;
    const opening = careerStore(state).openings[0]!;
    manager.reputation = -999;

    const first = applyForJob(state, opening.clubId, contextFor(state));
    expect(first.ok).toBe(true);
    expect(first.accepted).toBe(false);
    expect(careerStore(state).openings.some((entry) => entry.clubId === opening.clubId)).toBe(false);

    const second = applyForJob(state, opening.clubId, contextFor(state));
    expect(second.ok).toBe(false);
  });

  it('always leaves him something to apply for, even when nobody else was hiring', () => {
    const game = createTestGame('career-guarantee');
    const state = game.state;
    forceDismissal(game);
    // Nobody in the county is within his reach, so the summer's own vacancies are
    // all held nothing: the board would be empty, and the career would wait a
    // year for the next chance. It must not: a way back that exists only when
    // somebody else happens to move is not a way back.
    userManager(state)!.reputation = -999;

    startNextSeason(state);

    expect(isEmployed(state)).toBe(false);
    const openings = careerStore(state).openings;
    expect(openings.length).toBeGreaterThan(0);
    for (const opening of openings) {
      // Each is a real post: a club with nobody in charge, which is not the club
      // he has just left — no committee re-advertises to the man it sacked.
      expect(state.clubs[opening.clubId]!.managerId).toBeFalsy();
      expect(opening.clubId).not.toBe(careerStore(state).lastClubId);
    }
    // And the man who was moved aside is in the world, between jobs like him.
    const moved = Object.values(state.people).filter(
      (person) => isOfficial(person) && person.clubId === null && person.role === 'manager',
    );
    expect(moved.length).toBeGreaterThan(1);
  });

  it('names the club nearest to his standing, and never the one he has left', () => {
    const game = createTestGame('career-guarantee-choice');
    const state = game.state;
    dismissAtBoundary(game);
    const manager = userManager(state)!;
    manager.reputation = 30;
    const choose = guaranteeVacancyFor(state)!;
    const clubs = Object.values(state.clubs).filter((club) => Boolean(club.managerId));

    const chosen = choose(clubs)!;
    const distances = clubs.map((club) => Math.abs(club.reputation - manager.reputation));
    expect(Math.abs(chosen.reputation - manager.reputation)).toBe(Math.min(...distances));
    // The club he has just left is not a candidate, however near it is.
    expect(choose([state.clubs[state.userClubId]!])).toBeNull();
    // And while he is in work, there is no such callback at all.
    expect(guaranteeVacancyFor(createTestGame('career-guarantee-employed').state)).toBeNull();
  });

  it('is never appointed by the AI market on its own, however long he waits', () => {
    const game = createTestGame('career-never-hired-by-ai');
    const state = game.state;
    dismissAtBoundary(game);

    // Burn the whole window without applying: the posts fill with somebody else,
    // and the player is still out of work.
    for (let day = 0; day <= JOB_MARKET.windowDays + 5; day++) {
      runCareerDay(state, addDays(state.date, day));
    }

    expect(isEmployed(state)).toBe(false);
    expect(managingClubId(state)).toBeNull();
    expect(state.clubs[state.userClubId]!.managerId).not.toBe(MANAGER_PERSON_ID);
    expect(careerStore(state).openings).toEqual([]);
  });

  it('plays the days out with him out of work: no fixture, no stoppage, no bench', () => {
    const game = createTestGame('career-days');
    const state = game.state;
    dismissAtBoundary(game);

    // The days still move — there is nothing to stop for — and the career tick
    // does not invent a match for a man with no club.
    const start = state.date;
    runCareerDay(state, start);
    expect(state.date).toBe(start);
    expect(userManager(state)!.clubId).toBeNull();
  });

  it('stops the club\'s own correspondence, while the world carries on without him', () => {
    const game = createTestGame('career-silence');
    const state = game.state;
    dismissAtBoundary(game);

    const mailed = (game: State) =>
      Object.values(game.communication.conversations).reduce(
        (sum, conversation) => sum + conversation.messages.length,
        0,
      );

    const before = mailed(state);
    const start = state.date;
    // A month of the career running with him out of work. The league plays its
    // football and the days move, but the treasurer, the secretary and the
    // committee are writing to the man in the job, and there is not one.
    continueTime(state, { maxDays: 28 });
    expect(mailed(state)).toBe(before);
    expect(state.date).not.toBe(start);
    expect(isEmployed(state)).toBe(false);
  });

  it('carries the career through a save, and gives an old save a career in work', () => {
    const game = createTestGame('career-save');
    const state = game.state;
    const spells = careerStore(state).spells.length;

    const parsed = deserialiseGame(serialiseGame(state));
    expect(parsed.error).toBeNull();
    expect(parsed.state!.career.status).toBe('employed');
    expect(parsed.state!.career.clubId).toBe(parsed.state!.userClubId);
    expect(parsed.state!.career.spells).toHaveLength(spells);

    // A save written before the manager had a career is given an employed one at
    // the club it was already managing — nobody wakes up out of work.
    const legacy = JSON.parse(serialiseGame(state)) as { version: number; state: Record<string, unknown> };
    legacy.version = 16;
    delete legacy.state.career;
    const migrated = deserialiseGame(JSON.stringify(legacy)).state!;
    expect(migrated.career.status).toBe('employed');
    expect(migrated.career.clubId).toBe(migrated.userClubId);
    expect(migrated.version).toBeGreaterThan(16);
    expect(isOfficial(migrated.people[MANAGER_PERSON_ID])).toBe(true);
  });
});
