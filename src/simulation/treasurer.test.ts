import { describe, expect, it } from 'vitest';
import type { Match, PlayerPerformance } from '@/domain/match';
import { isPlayer, type Player } from '@/domain/person';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { addDays } from './calendar';
import { processDay } from './day';
import { ledgerBalances, recordMatchdaySubs } from './finance';
import { matchEnvironment, prepareMatchday } from './matchday';
import { simulateMatchHeadless } from './match/matchEngine';
import { weeklySponsorshipIncome } from './sponsorship';
import { leagueMatchdayCount, matchdaysPlayed, nextMatchday, seasonEndDate, weeksRemaining } from './timeline';
import { createTestGame, type TestGame } from './testSupport';
import {
  collectSubs,
  financialConcerns,
  financialResponsibility,
  outstandingSubs,
  outstandingSubsTotal,
  seasonOutlook,
  treasurerSummary,
} from './treasurer';

/* ------------------------------------------------------------------------ *\
 * Helpers
 * ------------------------------------------------------------------------ */

type State = TestGame['state'];

function userClub(state: State) {
  return state.clubs[state.userClubId]!;
}

function squadOf(game: TestGame): Player[] {
  return userClub(game.state).squadIds.map((id) => game.state.people[id]).filter(isPlayer);
}

/** A player with a real debt, as one or more matches would have left him. */
function withDebt(player: Player, amounts: Array<{ amount: number; date: string; matchId: string }>): void {
  player.subs = {
    owed: amounts.reduce((sum, entry) => sum + entry.amount, 0),
    missedWeeks: amounts.length,
    lastPaidOn: null,
    liabilities: amounts.map((entry) => ({
      id: `${entry.matchId}:${player.id}`,
      matchId: entry.matchId,
      date: entry.date,
      category: 'starter',
      amount: entry.amount,
      paid: 0,
      paidOn: null,
    })),
    payments: [],
  };
}

function subsLines(state: State) {
  return userClub(state).finances.ledger.filter((line) => line.category === 'subs');
}

/**
 * Put the book in known hands.
 *
 * The world only gives a club a treasurer about two times in three, so tests
 * that need one appoint the chairman explicitly rather than leaning on a roll.
 */
function appointChairmanAsTreasurer(game: TestGame): string {
  const club = userClub(game.state);
  expect(club.chairmanId).toBeTruthy();
  club.staff.treasurerId = club.chairmanId;
  return club.chairmanId!;
}

/** A prepared, completed fixture with an authored participation record. */
function preparedFixture(game: TestGame, matchday = nextMatchday(game.state)): Match {
  prepareMatchday(game.state, matchday);
  return Object.values(game.state.matches).find((candidate) => candidate.matchday === matchday)!;
}

function performance(playerId: string, clubId: string, started: boolean, cameOnMinute: number | null): PlayerPerformance {
  return {
    playerId,
    clubId,
    started,
    minutesPlayed: started ? 90 : cameOnMinute !== null ? 30 : 0,
    positionPlayed: 'CM',
    goals: 0,
    assists: 0,
    shots: 0,
    shotsOnTarget: 0,
    passes: 0,
    passesCompleted: 0,
    tackles: 0,
    interceptions: 0,
    saves: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    rating: 6,
    cameOnMinute,
    wentOffMinute: null,
    energy: 100,
    injuryDetail: null,
    sentOff: false,
  };
}

/* ------------------------------------------------------------------------ *\
 * Owed is not income
 * ------------------------------------------------------------------------ */

describe('owed money is a player debt, never club income', () => {
  it('does not move the balance and books no income while a sub is unpaid', () => {
    const game = createTestGame('treasurer-unpaid');
    const player = squadOf(game)[0]!;
    withDebt(player, [{ amount: 5, date: game.state.date, matchId: 'matchA' }]);
    const before = userClub(game.state).finances.balance;

    // Reading the position changes nothing.
    const outstanding = outstandingSubs(game.state);
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]).toMatchObject({ personId: player.id, owed: 5, matches: 1 });
    expect(outstandingSubsTotal(game.state)).toBe(5);

    expect(userClub(game.state).finances.balance).toBe(before);
    expect(subsLines(game.state)).toHaveLength(0);
  });

  it('counts the money as income only once it has actually been handed over', () => {
    const game = createTestGame('treasurer-paid');
    const player = squadOf(game)[0]!;
    withDebt(player, [{ amount: 5, date: game.state.date, matchId: 'matchA' }]);
    const before = userClub(game.state).finances.balance;

    const result = collectSubs(game.state, game.state.userClubId, player.id, game.state.date);

    expect(result).toEqual({ collected: 5, owedAfter: 0 });
    expect(userClub(game.state).finances.balance).toBe(before + 5);
    expect(subsLines(game.state)).toHaveLength(1);
    expect(subsLines(game.state)[0]!.amount).toBe(5);
    expect(player.subs.owed).toBe(0);
    expect(outstandingSubs(game.state)).toHaveLength(0);
  });

  it('handles a part payment, leaving the rest outstanding', () => {
    const game = createTestGame('treasurer-partial');
    const player = squadOf(game)[0]!;
    withDebt(player, [
      { amount: 5, date: '2026-09-06', matchId: 'matchA' },
      { amount: 3, date: '2026-09-13', matchId: 'matchB' },
    ]);
    const before = userClub(game.state).finances.balance;

    const result = collectSubs(game.state, game.state.userClubId, player.id, game.state.date, 5);

    expect(result).toEqual({ collected: 5, owedAfter: 3 });
    expect(userClub(game.state).finances.balance).toBe(before + 5);
    // The oldest liability is paid; the newer one is untouched.
    expect(player.subs.liabilities![0]).toMatchObject({ paid: 5, paidOn: game.state.date });
    expect(player.subs.liabilities![1]).toMatchObject({ paid: 0, paidOn: null });
    expect(outstandingSubs(game.state)[0]!.owed).toBe(3);
  });
});

/* ------------------------------------------------------------------------ *\
 * Money moving in, exactly once
 * ------------------------------------------------------------------------ */

describe('a payment moves the club balance exactly once', () => {
  it('books one ledger line per real payment', () => {
    const game = createTestGame('treasurer-once');
    const player = squadOf(game)[0]!;
    withDebt(player, [{ amount: 5, date: game.state.date, matchId: 'matchA' }]);
    const before = userClub(game.state).finances.balance;

    collectSubs(game.state, game.state.userClubId, player.id, game.state.date, 2);
    collectSubs(game.state, game.state.userClubId, player.id, game.state.date, 3);

    expect(userClub(game.state).finances.balance).toBe(before + 5);
    expect(subsLines(game.state)).toHaveLength(2);
    expect(subsLines(game.state).reduce((sum, line) => sum + line.amount, 0)).toBe(5);
    expect(player.subs.owed).toBe(0);
  });

  it('cannot book a duplicate payment for a debt that is already settled', () => {
    const game = createTestGame('treasurer-duplicate');
    const player = squadOf(game)[0]!;
    withDebt(player, [{ amount: 5, date: game.state.date, matchId: 'matchA' }]);
    const before = userClub(game.state).finances.balance;

    collectSubs(game.state, game.state.userClubId, player.id, game.state.date);
    const second = collectSubs(game.state, game.state.userClubId, player.id, game.state.date);

    expect(second.collected).toBe(0);
    expect(second.owedAfter).toBe(0);
    expect(userClub(game.state).finances.balance).toBe(before + 5);
    expect(subsLines(game.state)).toHaveLength(1);
  });

  it('never takes more than the man actually owes', () => {
    const game = createTestGame('treasurer-clamp');
    const player = squadOf(game)[0]!;
    withDebt(player, [{ amount: 5, date: game.state.date, matchId: 'matchA' }]);

    const result = collectSubs(game.state, game.state.userClubId, player.id, game.state.date, 100);

    expect(result.collected).toBe(5);
    expect(player.subs.owed).toBe(0);
  });
});

/* ------------------------------------------------------------------------ *\
 * The role
 * ------------------------------------------------------------------------ */

describe('the treasurer holds the book without becoming a second finance system', () => {
  it('identifies the appointed treasurer and reads his competence', () => {
    const game = createTestGame('treasurer-identity');
    const treasurerId = appointChairmanAsTreasurer(game);

    const responsibility = financialResponsibility(game.state);
    expect(responsibility.role).toBe('treasurer');
    expect(responsibility.personId).toBe(treasurerId);
    expect(responsibility.name).toBeTruthy();
    expect(responsibility.competence).toBeGreaterThan(0);
    expect(responsibility.managerToo).toBe(false);
  });

  it('operates the club’s finance responsibilities: outstanding view, concerns and collection', () => {
    const game = createTestGame('treasurer-operates');
    appointChairmanAsTreasurer(game);
    const player = squadOf(game)[0]!;
    withDebt(player, [{ amount: 5, date: game.state.date, matchId: 'matchA' }]);

    const summary = treasurerSummary(game.state);
    expect(summary.responsibility.role).toBe('treasurer');
    expect(summary.outstandingTotal).toBe(5);
    expect(summary.concerns.some((concern) => concern.kind === 'arrears')).toBe(true);

    // The treasurer takes the money through the one door that moves the book.
    collectSubs(game.state, game.state.userClubId, player.id, game.state.date);
    expect(treasurerSummary(game.state).outstandingTotal).toBe(0);
  });

  it('works when the manager is also the treasurer', () => {
    const game = createTestGame('treasurer-manager-too');
    const club = userClub(game.state);
    // The small club where the same man does both jobs.
    club.staff.treasurerId = club.managerId;

    const responsibility = financialResponsibility(game.state);
    expect(responsibility.role).toBe('treasurer');
    expect(responsibility.personId).toBe(club.managerId);
    expect(responsibility.managerToo).toBe(true);
    // The manager is a real official, so the money sense is still readable.
    expect(responsibility.competence).toBeGreaterThan(0);

    const player = squadOf(game)[0]!;
    withDebt(player, [{ amount: 5, date: game.state.date, matchId: 'matchA' }]);
    const before = userClub(game.state).finances.balance;
    collectSubs(game.state, game.state.userClubId, player.id, game.state.date);
    expect(userClub(game.state).finances.balance).toBe(before + 5);
  });

  it('does not break Finance when there is no treasurer at all', () => {
    const game = createTestGame('treasurer-none');
    const club = userClub(game.state);
    club.staff.treasurerId = null;

    // Responsibility falls to the manager, and the book still works.
    const responsibility = financialResponsibility(game.state);
    expect(responsibility.role).toBe('manager');
    expect(responsibility.managerToo).toBe(true);

    const player = squadOf(game)[0]!;
    withDebt(player, [{ amount: 4, date: game.state.date, matchId: 'matchA' }]);
    const before = club.finances.balance;
    expect(collectSubs(game.state, game.state.userClubId, player.id, game.state.date).collected).toBe(4);
    expect(club.finances.balance).toBe(before + 4);
    expect(ledgerBalances(club.finances)).toBe(true);
  });

  it('does not invent a money worry when the manager keeps the book himself', () => {
    const game = createTestGame('treasurer-fallback-concern');
    userClub(game.state).staff.treasurerId = null;
    const concerns = financialConcerns(game.state);
    // The manager is not an absent role: his keeping the book is normal, not a gap.
    expect(concerns.some((concern) => concern.kind === 'no-treasurer')).toBe(false);
  });
});

/* ------------------------------------------------------------------------ *\
 * Expenses stay where they were
 * ------------------------------------------------------------------------ */

describe('the treasurer operates existing costs, never a copy of them', () => {
  it('leaves the club’s bills to Finance and books none of its own', () => {
    const game = createTestGame('treasurer-expenses');
    const club = userClub(game.state);

    for (let i = 0; i < 12; i += 1) processDay(game.state, game.state.date);

    // The standing costs are still applied by the finance service on its own dates.
    const ground = club.finances.ledger.filter((line) => line.description === 'Weekly pitch hire');
    expect(ground.length).toBeGreaterThan(0);
    expect(club.finances.ledger.some((line) => line.description === 'Insurance (weekly)')).toBe(true);

    const ledgerLength = club.finances.ledger.length;
    const balance = club.finances.balance;
    // Reading the treasurer's position must not fabricate a single transaction.
    treasurerSummary(game.state);
    outstandingSubs(game.state);
    financialConcerns(game.state);
    expect(club.finances.ledger).toHaveLength(ledgerLength);
    expect(club.finances.balance).toBe(balance);
    expect(ledgerBalances(club.finances)).toBe(true);
  });
});

/* ------------------------------------------------------------------------ *\
 * Liabilities from the engine, and their durability
 * ------------------------------------------------------------------------ */

describe('matchday participation is what creates a player’s debt', () => {
  it('charges exactly the men the engine recorded as playing', () => {
    const game = createTestGame('treasurer-participation');
    const match = preparedFixture(game);
    match.result = { homeGoals: 1, awayGoals: 0, homeShots: 5, awayShots: 3, homePossession: 55, awayPossession: 45, attendance: 40 };
    const home = match.homeClubId;
    const players = game.state.clubs[home]!.squadIds;
    const starter = players[0]!;
    const subOn = players[1]!;
    const unused = players[2]!;
    match.performances = {
      [starter]: performance(starter, home, true, null),
      [subOn]: performance(subOn, home, false, 62),
      [unused]: performance(unused, home, false, null),
    };

    recordMatchdaySubs(game.state, match);

    const outstanding = outstandingSubs(game.state, home);
    expect(outstanding.map((row) => row.personId).sort()).toEqual([starter, subOn].sort());
    expect((game.state.people[starter] as Player).subs.owed).toBe(5);
    expect((game.state.people[subOn] as Player).subs.owed).toBe(3);
    expect((game.state.people[unused] as Player).subs.owed).toBe(0);
  });

  it('uses the real engine through a headless match', () => {
    const game = createTestGame('treasurer-headless');
    const match = preparedFixture(game);
    simulateMatchHeadless(match, matchEnvironment(game.state, match, { autoManageAllBenches: true }));
    recordMatchdaySubs(game.state, match);

    const participants = Object.values(match.performances).filter((entry) => entry.started || entry.cameOnMinute !== null);
    expect(outstandingSubs(game.state, match.homeClubId).length + outstandingSubs(game.state, match.awayClubId).length).toBe(
      participants.length,
    );
  });

  it('keeps outstanding balances across a save and reload', () => {
    const game = createTestGame('treasurer-save');
    const player = squadOf(game)[0]!;
    withDebt(player, [
      { amount: 5, date: '2026-09-06', matchId: 'matchA' },
      { amount: 3, date: '2026-09-13', matchId: 'matchB' },
    ]);

    const loaded = deserialiseGame(serialiseGame(game.state));
    expect(loaded.error).toBeNull();
    const reloaded = loaded.state!;

    const outstanding = outstandingSubs(reloaded, reloaded.userClubId);
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]).toMatchObject({ personId: player.id, owed: 8, matches: 2 });

    // And the collection still works after the reload.
    const before = reloaded.clubs[reloaded.userClubId]!.finances.balance;
    const result = collectSubs(reloaded, reloaded.userClubId, player.id, reloaded.date, 5);
    expect(result).toEqual({ collected: 5, owedAfter: 3 });
    expect(reloaded.clubs[reloaded.userClubId]!.finances.balance).toBe(before + 5);
  });
});

/* ------------------------------------------------------------------------ *\
 * Where the book is heading
 * ------------------------------------------------------------------------ */

/**
 * The season outlook is the one week's money carried forward to the end of the
 * season. It is a run rate rather than a promise, so what matters is that it
 * uses the same week as the tiles, the same weeks as the header, and nothing
 * that is not already banked.
 */
describe('where the book is heading', () => {
  it('carries the recurring week over the weeks the season has left', () => {
    const game = createTestGame('outlook-week');
    const outlook = seasonOutlook(game.state);
    const club = userClub(game.state);
    const weeklyOut =
      club.finances.weeklyGroundCost + club.finances.insurancePerWeek + club.finances.trainingCostPerWeek;

    expect(outlook.weeklyNet).toBeCloseTo(weeklySponsorshipIncome(game.state, game.clubId) - weeklyOut, 2);
    expect(outlook.weeksLeft).toBe(weeksRemaining(game.state));
    expect(outlook.projected).toBeCloseTo(club.finances.balance + outlook.weeklyNet * outlook.weeksLeft, 2);
  });

  it('budgets in calendar weeks rather than matchdays', () => {
    const game = createTestGame('outlook-weeks');
    const outlook = seasonOutlook(game.state);
    const matchdaysLeft = leagueMatchdayCount(game.state) - matchdaysPlayed(game.state);

    // The season outlasts the fixture list, so a budget built on Sundays comes
    // up short — which is the whole reason the outlook counts weeks.
    expect(outlook.weeksLeft).toBeGreaterThan(matchdaysLeft);
    expect(outlook.seasonEnd).toBe(seasonEndDate(game.state));
  });

  it('leaves nothing to project once the season has run out', () => {
    const game = createTestGame('outlook-over');
    game.state.date = addDays(seasonEndDate(game.state)!, 1);

    const outlook = seasonOutlook(game.state);
    expect(outlook.weeksLeft).toBe(0);
    expect(outlook.projected).toBe(userClub(game.state).finances.balance);
  });

  it('reads a club that is not there as no money at all', () => {
    const game = createTestGame('outlook-missing');
    expect(seasonOutlook(game.state, 'club_nobody')).toMatchObject({ weeklyNet: 0, projected: 0 });
  });
});
