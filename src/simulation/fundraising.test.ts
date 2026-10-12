import { describe, expect, it } from 'vitest';
import { FUNDRAISERS, type FundraiserKind } from '@/domain/fundraising';
import { getRelationship, upsertRelationship } from './relationships';
import { ledgerBalances } from './finance';
import {
  fundraiserForecast,
  fundraisingAvailability,
  fundraisingRuns,
  fundraisingRunsThisSeason,
  organiseFundraiser,
  recentHomeCrowd,
  runFundraisingDay,
  scheduledFundraisers,
} from './fundraising';
import { clubChairman } from './governance';
import { userManager } from './career';
import { addDays } from './calendar';
import { scheduleStore } from './schedule';
import { createTestGame, type TestGame } from './testSupport';
import { deserialiseGame, serialiseGame } from '@/state/persistence';

/**
 * Fundraising is only a loop if the money is real and the size of it is read off
 * the club: a night must book exactly one ledger line, a well-backed club must
 * raise more than a forgotten one, and a small club's night must return less
 * than a big one's. Anything less is a button that prints money.
 */

type State = TestGame['state'];

function clubOf(game: TestGame) {
  return game.state.clubs[game.state.userClubId]!;
}

/** A date comfortably clear of any constraint the club already carries. */
function aFreeDate(state: State): string {
  return addDays(state.date, 30);
}

/** Fill in one played home league fixture with a given crowd, so the club has a gate. */
function recordHomeCrowd(game: TestGame, attendance: number): void {
  const state = game.state;
  const clubId = state.userClubId;
  const match = Object.values(state.matches).find(
    (candidate) =>
      candidate.homeClubId === clubId &&
      Boolean(state.competitions[candidate.competitionId]) &&
      !candidate.played,
  );
  if (!match) throw new Error('the test game has no unplayed home league fixture');
  match.played = true;
  match.status = 'finished';
  match.result = {
    homeGoals: 2,
    awayGoals: 1,
    homeShots: 10,
    awayShots: 8,
    homePossession: 52,
    awayPossession: 48,
    attendance,
  };
}

/**
 * Set how the chairman feels about the manager, whichever way round the model
 * stored the pair — relationships keep one record with a canonical order, so
 * `aToB` is not necessarily the chairman's own attitude.
 */
function setChairmanAttitude(
  relationship: ReturnType<typeof upsertRelationship>,
  chairmanId: string,
  attitude: { friendship: number; respect: number; trust: number; tension: number; loyalty: number },
): void {
  if (relationship.personAId === chairmanId) relationship.aToB = attitude;
  else relationship.bToA = attitude;
}

describe('a fundraising night', () => {
  it('is priced on the club, and the forecast is what it banks', () => {
    const game = createTestGame('fundraising-price');
    const state = game.state;
    const date = aFreeDate(state);
    const forecast = fundraiserForecast(state, state.userClubId, 'quiz-night', date);

    expect(forecast.turnout).toBeGreaterThan(0);
    expect(forecast.take).toBeGreaterThan(0);

    const result = organiseFundraiser(state, state.userClubId, 'quiz-night', date);
    expect(result.ok).toBe(true);

    const before = clubOf(game).finances.ledger.length;
    runFundraisingDay(state, date);

    const ledger = clubOf(game).finances.ledger;
    expect(ledger.length).toBe(before + 1);
    const line = ledger[ledger.length - 1]!;
    expect(line.category).toBe('fundraising');
    expect(line.amount).toBe(forecast.net);
    expect(line.description).toContain(forecast.label);
    // One line, and the whole night: the books still add up.
    expect(ledgerBalances(clubOf(game).finances)).toBe(true);

    const runs = fundraisingRuns(state, state.userClubId);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.net).toBe(forecast.net);
    expect(runs[0]!.turnout).toBe(forecast.turnout);
  });

  it('raises more for a club with more standing, and for a bigger place', () => {
    const game = createTestGame('fundraising-standing');
    const state = game.state;
    const club = clubOf(game);
    const date = aFreeDate(state);
    const modest = fundraiserForecast(state, club.id, 'pub-event', date).net;

    // The same club, the same night, the same seed: only its standing moved.
    club.reputation = club.reputation + 40;
    const standing = fundraiserForecast(state, club.id, 'pub-event', date).net;
    expect(standing).toBeGreaterThan(modest);

    // And the same again for the place it plays in: the town is the other half of
    // how many people a night can reach, below the point where a club's
    // following is limited by the club rather than by the place.
    const town = state.world.towns[club.townId]!;
    const before = town.population;
    town.population = 900;
    const village = fundraiserForecast(state, club.id, 'pub-event', date).net;
    town.population = 6000;
    expect(fundraiserForecast(state, club.id, 'pub-event', date).net).toBeGreaterThan(village);

    // Past that point more people in the town do not mean more in the room: a
    // club this size can only draw so many, whatever is on the doorstep.
    town.population = 8000;
    const atTheCeiling = fundraiserForecast(state, club.id, 'pub-event', date).net;
    town.population = before;
    expect(fundraiserForecast(state, club.id, 'pub-event', date).net).toBe(atTheCeiling);
  });

  it('returns less for a club whose gates have fallen away', () => {
    const game = createTestGame('fundraising-gate');
    const state = game.state;
    const club = clubOf(game);
    const date = aFreeDate(state);

    recordHomeCrowd(game, 180);
    expect(recentHomeCrowd(state, club.id)).toBe(180);
    const good = fundraiserForecast(state, club.id, 'raffle', date).net;

    const match = Object.values(state.matches).find(
      (candidate) => candidate.homeClubId === club.id && candidate.played,
    )!;
    match.result!.attendance = 12;
    expect(recentHomeCrowd(state, club.id)).toBe(12);
    const poor = fundraiserForecast(state, club.id, 'raffle', date).net;

    expect(poor).toBeLessThan(good);
  });

  it('returns less when the night is badly organised', () => {
    const game = createTestGame('fundraising-organisation');
    const state = game.state;
    const club = clubOf(game);
    const manager = userManager(state)!;
    const date = aFreeDate(state);

    // A man who runs a club well, with a secretary and volunteers behind him...
    manager.attributes.organisation = 19;
    club.staff.volunteerIds = [club.chairmanId!, club.staff.coachIds[0] ?? club.chairmanId!];
    const organised = fundraiserForecast(state, club.id, 'quiz-night', date).net;

    // ...against the same club with nobody organising it at all.
    manager.attributes.organisation = 1;
    club.staff.secretaryId = null;
    club.staff.volunteerIds = [];
    expect(fundraiserForecast(state, club.id, 'quiz-night', date).net).toBeLessThan(organised);
  });

  it('returns more when the chairman is behind it, and less when he is not', () => {
    const game = createTestGame('fundraising-relationships');
    const state = game.state;
    const club = clubOf(game);
    const date = aFreeDate(state);
    const chairman = clubChairman(state, club.id)!;
    const managerId = club.managerId!;
    expect(chairman).toBeTruthy();

    const relationship = upsertRelationship(state, {
      aId: chairman.id,
      bId: managerId,
      origin: 'club-committee',
      context: 'Chairman and manager',
      date: state.date,
    });
    const neutral = fundraiserForecast(state, club.id, 'quiz-night', date).net;

    // The chairman's own attitude toward the manager: warm first.
    setChairmanAttitude(relationship, chairman.id, { friendship: 85, respect: 85, trust: 90, tension: 0, loyalty: 80 });
    const warm = fundraiserForecast(state, club.id, 'quiz-night', date).net;
    setChairmanAttitude(relationship, chairman.id, { friendship: 5, respect: 5, trust: 5, tension: 95, loyalty: 0 });
    const cold = fundraiserForecast(state, club.id, 'quiz-night', date).net;

    expect(warm).toBeGreaterThan(neutral);
    expect(cold).toBeLessThan(neutral);
    expect(getRelationship(state, chairman.id, managerId)).toBeTruthy();
  });

  it('books a loss as a loss rather than as a smaller profit', () => {
    // The smallest possible club, with nobody to organise it and a committee that
    // has no time for the man: the do at the pub does not cover its own costs.
    const game = createTestGame('fundraising-loss');
    const state = game.state;
    const club = clubOf(game);
    club.reputation = 1;
    club.staff.secretaryId = null;
    club.staff.volunteerIds = [];
    const town = state.world.towns[club.townId]!;
    town.businessIds = [];
    // ...in a hamlet, not the town this club happens to play in.
    town.population = 150;
    const chairman = clubChairman(state, club.id)!;
    const relationship = upsertRelationship(state, {
      aId: chairman.id,
      bId: club.managerId!,
      origin: 'club-committee',
      context: 'Chairman and manager',
      date: state.date,
    });
    setChairmanAttitude(relationship, chairman.id, { friendship: 0, respect: 0, trust: 0, tension: 100, loyalty: 0 });

    const date = aFreeDate(state);
    const forecast = fundraiserForecast(state, club.id, 'pub-event', date);
    expect(forecast.net).toBeLessThan(0);

    organiseFundraiser(state, club.id, 'pub-event', date);
    runFundraisingDay(state, date);

    const line = clubOf(game).finances.ledger.at(-1)!;
    expect(line.amount).toBeLessThan(0);
    expect(line.category).toBe('fundraising');
    expect(line.description).toContain('costs not covered');
    expect(ledgerBalances(clubOf(game).finances)).toBe(true);
  });
});

describe('organising a night', () => {
  it('puts it on the calendar, and will not book a second over the top of it', () => {
    const game = createTestGame('fundraising-organise');
    const state = game.state;
    const result = organiseFundraiser(state, state.userClubId, 'quiz-night');
    expect(result.ok).toBe(true);
    expect(result.event).toBeTruthy();

    const pending = scheduledFundraisers(state, state.userClubId);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.kind).toBe('fundraising');
    expect(pending[0]!.data.fundraiser).toBe('quiz-night');

    const again = organiseFundraiser(state, state.userClubId, 'raffle');
    expect(again.ok).toBe(false);
    expect(scheduledFundraisers(state, state.userClubId)).toHaveLength(1);
  });

  it('gives a night notice, and holds a few weeks clear of the last one', () => {
    const game = createTestGame('fundraising-window');
    const state = game.state;

    const first = organiseFundraiser(state, state.userClubId, 'raffle');
    expect(first.event!.date >= addDays(state.date, 1)).toBe(true);
    runFundraisingDay(state, first.event!.date);

    const availability = fundraisingAvailability(state, state.userClubId);
    expect(availability.canOrganise).toBe(true);
    expect(availability.nextDate > first.event!.date).toBe(true);
  });

  it('will not ask the club’s people more than a few times a season', () => {
    const game = createTestGame('fundraising-season-cap');
    const state = game.state;
    const kinds: FundraiserKind[] = ['raffle', 'quiz-night', 'pub-event', 'raffle'];

    let date = state.date;
    for (const kind of kinds) {
      const result = organiseFundraiser(state, state.userClubId, kind, addDays(date, 30));
      expect(result.ok).toBe(true);
      date = result.event!.date;
      runFundraisingDay(state, date);
    }
    expect(fundraisingRunsThisSeason(state, state.userClubId)).toHaveLength(4);

    const refused = organiseFundraiser(state, state.userClubId, 'raffle', addDays(date, 30));
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/enough/i);
  });

  it('places the night on the earliest date it is allowed, not today', () => {
    const game = createTestGame('fundraising-lead');
    const state = game.state;
    const result = organiseFundraiser(state, state.userClubId, 'pub-event');
    expect(result.event!.date).not.toBe(state.date);
    expect(result.event!.date >= addDays(state.date, 1)).toBe(true);
  });
});

describe('the night itself', () => {
  it('settles once, on its own date, and never twice', () => {
    const game = createTestGame('fundraising-settle');
    const state = game.state;
    const booked = organiseFundraiser(state, state.userClubId, 'quiz-night');
    const date = booked.event!.date;

    expect(scheduleStore(state).events.filter((event) => event.resolvedOn === null && event.kind === 'fundraising')).toHaveLength(1);

    runFundraisingDay(state, date);
    const after = clubOf(game).finances.ledger.length;
    expect(fundraisingRuns(state, state.userClubId)).toHaveLength(1);

    // Running the day again must not book a second night.
    runFundraisingDay(state, date);
    expect(clubOf(game).finances.ledger.length).toBe(after);
    expect(fundraisingRuns(state, state.userClubId)).toHaveLength(1);
  });

  it('lands on the committee, one way or the other', () => {
    const game = createTestGame('fundraising-committee');
    const state = game.state;
    const chairman = clubChairman(state, state.userClubId)!;
    const managerId = state.clubs[state.userClubId]!.managerId!;
    const before = getRelationship(state, chairman.id, managerId)?.history.length ?? 0;

    const booked = organiseFundraiser(state, state.userClubId, 'pub-event', addDays(state.date, 30));
    runFundraisingDay(state, booked.event!.date);

    // Either a good night the chairman notices, or a bad one he does: what must
    // not happen is a night that leaves no mark at all on a relationship.
    const relationship = getRelationship(state, chairman.id, managerId);
    const run = fundraisingRuns(state, state.userClubId)[0]!;
    const good = run.net >= Math.max(60, FUNDRAISERS['pub-event'].cost * 2);
    const bad = run.net < 0;
    if (good || bad) {
      expect(relationship).toBeTruthy();
      expect(relationship!.history.length).toBeGreaterThan(before);
      expect(relationship!.history.map((entry) => entry.description).join(' ')).toContain(
        good ? 'behind him' : 'concerns',
      );
    } else {
      // A night that merely broke even is not a matter for the committee, and
      // nothing is written about it.
      expect(relationship?.history.length ?? 0).toBe(before);
    }
  });

  it('books exactly one ledger line for the whole night, whatever it took', () => {
    const game = createTestGame('fundraising-one-line');
    const state = game.state;
    const booked = organiseFundraiser(state, state.userClubId, 'raffle', addDays(state.date, 30));
    const before = clubOf(game).finances.ledger.length;
    const balance = clubOf(game).finances.balance;

    runFundraisingDay(state, booked.event!.date);

    const added = clubOf(game).finances.ledger.slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.category).toBe('fundraising');
    expect(clubOf(game).finances.balance).toBeCloseTo(balance + added[0]!.amount, 2);
  });
});

describe('the record survives a save', () => {
  it('carries the nights through serialisation, and gives an old save an empty record', () => {
    const game = createTestGame('fundraising-save');
    const state = game.state;
    const booked = organiseFundraiser(state, state.userClubId, 'quiz-night', addDays(state.date, 30));
    runFundraisingDay(state, booked.event!.date);
    expect(fundraisingRuns(state, state.userClubId)).toHaveLength(1);

    const restored = deserialiseGame(serialiseGame(state)).state!;
    expect(restored.fundraising.runs).toHaveLength(1);
    expect(restored.fundraising.runs[0]!.kind).toBe('quiz-night');
    expect(ledgerBalances(restored.clubs[restored.userClubId]!.finances)).toBe(true);

    // A save written before any of this existed wakes up with an empty record,
    // not invented nights.
    const legacy = JSON.parse(serialiseGame(state)) as { version: number; state: Record<string, unknown> };
    legacy.version = 17;
    delete legacy.state.fundraising;
    const migrated = deserialiseGame(JSON.stringify(legacy)).state!;
    expect(migrated.fundraising.runs).toEqual([]);
    expect(migrated.version).toBeGreaterThan(17);
    expect(ledgerBalances(migrated.clubs[migrated.userClubId]!.finances)).toBe(true);
  });
});
