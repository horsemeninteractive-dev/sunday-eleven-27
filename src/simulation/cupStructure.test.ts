import { describe, expect, it } from 'vitest';
import type { ClubId, CompetitionId } from '@/domain/ids';
import type { Match } from '@/domain/match';
import {
  mainCupPlan,
  platePlan,
  platePreliminaryLineup,
  matchesForRound,
  loserOf,
  winnerOf as winner,
  PRELIMINARY_SIZE,
  PLATE_PRELIMINARY_FROM_FIRST_ROUND,
} from './cup';
import { LEAGUE_CUP_ID, PLATE_ID } from './pyramid';
import { createTestGame } from './testSupport';
import { processDay } from './day';

/**
 * The shape of the season's cups.
 *
 * Two competitions share one set of losers. The main cup opens with a
 * preliminary for the bottom of the ladder, and its round of thirty-two and
 * preliminary together feed a Plate that runs the same way round again. These
 * are the arithmetic of that, plus one test that plays a real season's worth of
 * ties to prove the arithmetic reaches a final in both cups.
 */

const ids = (count: number): ClubId[] =>
  Array.from({ length: count }, (_, index) => `c${index}` as ClubId);

describe('the main cup plan', () => {
  it('opens a pyramid of 36 with a preliminary of eight and a round of thirty-two', () => {
    const plan = mainCupPlan(36);
    expect(plan.map((entry) => entry.entrants)).toEqual([8, 32, 16, 8, 4, 2]);
    // The preliminary is eight clubs drawn from a field of thirty-six: the other
    // twenty-eight are on a bye into the round of thirty-two.
    expect(plan[0]!.field).toBe(36);
    expect(plan[1]!.field).toBe(32);
  });

  it('plays 35 ties across the season, as the design says', () => {
    expect(mainCupPlan(36).reduce((total, entry) => total + entry.entrants / 2, 0)).toBe(35);
  });

  it('gives a club on a bye into round two its first tie in round two', () => {
    expect(mainCupPlan(36)[1]).toMatchObject({ field: 32, entrants: 32 });
  });

  it('runs a small field as a plain knockout with no preliminary', () => {
    expect(mainCupPlan(8).map((entry) => entry.entrants)).toEqual([8, 4, 2]);
    expect(mainCupPlan(4).map((entry) => entry.entrants)).toEqual([4, 2]);
  });

  it('declines to plan a competition that cannot field a tie', () => {
    expect(mainCupPlan(1)).toEqual([]);
    expect(mainCupPlan(0)).toEqual([]);
  });

  it('always finishes on a final of two', () => {
    for (const size of [4, 8, 12, 16, 20, 24, 32, 36, 48, 64]) {
      const plan = mainCupPlan(size);
      expect(plan[plan.length - 1]!.entrants).toBe(2);
    }
  });

  it('never has a round bigger than the one before it', () => {
    for (const size of [8, 12, 16, 20, 24, 32, 36, 48]) {
      const plan = mainCupPlan(size);
      for (let index = 1; index < plan.length; index += 1) {
        expect(plan[index]!.field).toBeLessThanOrEqual(plan[index - 1]!.field);
      }
    }
  });
});

describe('the Plate plan', () => {
  const main = mainCupPlan(36);

  it('runs a preliminary of eight into a round of sixteen, for 19 ties', () => {
    const plan = platePlan(main);
    expect(plan.map((entry) => entry.entrants)).toEqual([8, 16, 8, 4, 2]);
    expect(plan.reduce((total, entry) => total + entry.entrants / 2, 0)).toBe(19);
  });

  it('is fed by the main cup\'s preliminary losers and its round of thirty-two', () => {
    // Four who lost the preliminary plus sixteen who lost the round of
    // thirty-two is the twenty clubs the Plate is drawn from.
    const prelimLosers = main[0]!.entrants / 2;
    const firstRoundLosers = main[1]!.entrants / 2;
    expect(prelimLosers).toBe(4);
    expect(firstRoundLosers).toBe(16);
    expect(platePlan(main)[0]!.field).toBe(prelimLosers + firstRoundLosers);
  });

  it('gives a bye into the round of sixteen to the clubs it did not draw', () => {
    expect(platePlan(main)[0]!.field - platePlan(main)[0]!.entrants).toBe(12);
    // ... and those twelve byes plus the four winners make the sixteen.
    expect(platePlan(main)[1]!.field).toBe(16);
  });

  it('brings 54 ties in total across both competitions', () => {
    const ties = [...main, ...platePlan(main)].reduce((total, entry) => total + entry.entrants / 2, 0);
    expect(ties).toBe(54);
  });

  it('has nothing to plan when the main cup has not been planned', () => {
    expect(platePlan([])).toEqual([]);
  });

  it('takes four clubs from the main cup\'s round of thirty-two when there is no preliminary', () => {
    const plan = platePlan(mainCupPlan(8));
    expect(PLATE_PRELIMINARY_FROM_FIRST_ROUND).toBe(4);
    // No preliminary in the main cup, so the Plate is fed its opening round's
    // losers whole and needs no preliminary of its own.
    expect(plan[0]!.entrants).toBe(4);
    expect(plan[0]!.entrants).toBe(plan[0]!.field);
  });
});

describe('choosing who plays the Plate preliminary', () => {
  const available = ids(20);
  const prelimLosers = available.slice(0, 4);

  it('puts every preliminary loser in the tie', () => {
    const { playIn } = platePreliminaryLineup(available, prelimLosers, 8);
    for (const clubId of prelimLosers) expect(playIn).toContain(clubId);
  });

  it('draws eight and gives the other twelve a bye', () => {
    const { playIn, byes } = platePreliminaryLineup(available, prelimLosers, 8);
    expect(playIn).toHaveLength(8);
    expect(byes).toHaveLength(12);
  });

  it('splits the field without losing or duplicating a club', () => {
    const { playIn, byes } = platePreliminaryLineup(available, prelimLosers, 8);
    const union = [...playIn, ...byes];
    expect(union).toHaveLength(20);
    expect(new Set(union).size).toBe(20);
  });

  it('never draws a club that is not in the field', () => {
    const { playIn, byes } = platePreliminaryLineup(available, prelimLosers, 8);
    for (const clubId of [...playIn, ...byes]) expect(available).toContain(clubId);
  });

  it('copes with fewer clubs than there are places', () => {
    const { playIn, byes } = platePreliminaryLineup(ids(5), ids(2), 8);
    expect(playIn).toHaveLength(5);
    expect(byes).toHaveLength(0);
  });

  it('copes with a required club that is not in the field', () => {
    const { playIn } = platePreliminaryLineup(ids(4), ['nope' as ClubId], 8);
    expect(playIn).toHaveLength(4);
  });
});

/**
 * Play a season's cup ties without simulating a single one of them.
 *
 * The match engine costs about 1.2 seconds a game, so a season of real ties —
 * fifty-four of them, before the league's several hundred — cannot be played
 * inside a test. What this file is about is the *bracket*: who is in each round,
 * who is knocked out and who is handed a bye, and whether the two competitions
 * feed each other correctly. None of that depends on the football inside the tie,
 * only on the fact that a tie ends with a winner.
 *
 * So each tie is settled by hand — a scoreline written straight onto the match —
 * and the day loop is stepped only across days that have no fixtures on them, on
 * which it settles the cups and draws the next round without reaching the engine.
 */
function settleTiesOn(state: ReturnType<typeof createTestGame>['state'], date: string): void {
  for (const match of Object.values(state.matches)) {
    if (match.date !== date || match.played || match.status !== 'scheduled') continue;
    match.played = true;
    match.status = 'finished';
    const homeGoals = match.homeClubId.length % 3;
    const awayGoals = match.awayClubId.length % 2;
    match.result = {
      homeGoals,
      awayGoals,
      homeShots: 7,
      awayShots: 5,
      homePossession: 51,
      awayPossession: 49,
      attendance: 200,
    } as Match['result'];
    // A knockout tie is level at ninety minutes, so it is decided on penalties.
    if (match.knockout && homeGoals === awayGoals && match.result) {
      match.result.penalties = { home: 4, away: 3 };
      match.shootoutWinnerId = match.homeClubId;
    }
  }
}

/**
 * Run the season's cups to a conclusion.
 *
 * Steps one day at a time, settling whatever is due and letting the day loop
 * advance the rounds. Returns nothing: the caller interrogates the world.
 */
function playTheCups(state: ReturnType<typeof createTestGame>['state']): void {
  const cupIds: CompetitionId[] = [LEAGUE_CUP_ID, PLATE_ID];
  const cupsDecided = () => cupIds.every((id) => state.competitions[id]?.cup?.complete);

  for (let day = 0; day < 400 && !cupsDecided(); day += 1) {
    const today = state.date;
    // Settle the day's ties directly rather than through the match engine.
    settleTiesOn(state, today);
    const before = state.date;
    processDay(state, today);
    // A day that will not pass is a day the manager cannot get past: that is
    // exactly the failure this test exists to catch, so it is reported rather
    // than looped over.
    if (state.date === before) break;
  }
}

describe('a season of cups actually played', () => {
  const { state } = createTestGame('cup-season');
  playTheCups(state);

  const main = state.competitions[LEAGUE_CUP_ID]!;
  const plate = state.competitions[PLATE_ID]!;

  it('draws the preliminary from eight clubs, not thirty-six', () => {
    expect(main.cup?.plan?.[0]?.entrants).toBe(PRELIMINARY_SIZE);

    const firstRound = matchesForRound(state, main, 1);
    expect(firstRound).toHaveLength(PRELIMINARY_SIZE / 2);
    const drawn = firstRound.flatMap((tie) => [tie.homeClubId, tie.awayClubId]);
    expect(new Set(drawn).size).toBe(PRELIMINARY_SIZE);
    expect(firstRound.every((tie) => tie.played)).toBe(true);
  });

  it('puts twenty-eight clubs on a bye into the round of thirty-two', () => {
    const secondRound = matchesForRound(state, main, 2);
    expect(secondRound).toHaveLength(16);
    // Four prelim winners plus twenty-four byes make the thirty-two.
    const prelimWinners = matchesForRound(state, main, 1).map((tie) => winner(tie));
    const secondRoundClubs = new Set(secondRound.flatMap((tie) => [tie.homeClubId, tie.awayClubId]));
    for (const clubId of prelimWinners) expect(secondRoundClubs.has(clubId)).toBe(true);
  });

  it('reaches a final in both cups', () => {
    expect(main.cup?.complete).toBe(true);
    expect(main.cup?.winnerClubId).toBeTruthy();
    expect(plate.cup?.complete).toBe(true);
    expect(plate.cup?.winnerClubId).toBeTruthy();
  });

  it('plays 35 ties in the main cup and 19 in the Plate', () => {
    const tiesIn = (id: typeof LEAGUE_CUP_ID) =>
      Object.values(state.matches).filter((match) => match.competitionId === id && match.played).length;
    expect(tiesIn(LEAGUE_CUP_ID)).toBe(35);
    expect(tiesIn(PLATE_ID)).toBe(19);
  });

  it('feeds the Plate only from clubs the main cup eliminated', () => {
    const mainLosers = new Set<ClubId>();
    for (const round of [1, 2]) {
      for (const tie of matchesForRound(state, main, round)) mainLosers.add(loserOf(tie));
    }
    // A club can only reach the Plate by losing in the main cup, so no club can
    // be handed a second run at a trophy it has already been knocked out of.
    const plateEntrants = new Set<ClubId>();
    for (let round = 1; round <= (plate.cup?.plan?.length ?? 0); round += 1) {
      for (const tie of matchesForRound(state, plate, round)) {
        plateEntrants.add(tie.homeClubId);
        plateEntrants.add(tie.awayClubId);
      }
    }
    expect(plateEntrants.size).toBeGreaterThan(0);
    for (const clubId of plateEntrants) expect(mainLosers.has(clubId)).toBe(true);
  });

  it('crowns two different winners, since the Plate is a separate trophy', () => {
    expect(main.cup?.winnerClubId).not.toBe(plate.cup?.winnerClubId);
  });

  it('never puts a club in two ties on the same day', () => {
    const byDate = new Map<string, Set<ClubId>>();
    for (const match of Object.values(state.matches)) {
      if (!match.played) continue;
      const clubs = byDate.get(match.date) ?? new Set<ClubId>();
      expect(clubs.has(match.homeClubId)).toBe(false);
      expect(clubs.has(match.awayClubId)).toBe(false);
      clubs.add(match.homeClubId);
      clubs.add(match.awayClubId);
      byDate.set(match.date, clubs);
    }
  });
});
