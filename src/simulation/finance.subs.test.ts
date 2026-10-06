import { describe, expect, it } from 'vitest';
import type { Match, PlayerPerformance } from '@/domain/match';
import { isPlayer, type Player } from '@/domain/person';
import { deserialiseGame } from '@/state/persistence';
import { addDays } from './calendar';
import { processDay } from './day';
import {
  DEFAULT_STARTER_SUB,
  DEFAULT_SUBSTITUTE_SUB,
  collectPlayerSubs,
  participationCategory,
  recordMatchdaySubs,
  settleMatchdaySubs,
  subAmountFor,
} from './finance';
import { matchEnvironment, prepareMatchday } from './matchday';
import { simulateMatchHeadless } from './match/matchEngine';
import { recurringEvents } from './schedule';
import { nextMatchday } from './timeline';
import { createTestGame, type TestGame } from './testSupport';

/* ------------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------------ */

function squadOf(game: TestGame): Player[] {
  return game.state.clubs[game.clubId]!.squadIds.map((id) => game.state.people[id]).filter(isPlayer);
}

/** Every player in the world, for "nothing moved" assertions. */
function everyone(state: ReturnType<typeof createTestGame>['state']): Player[] {
  return Object.values(state.people).filter(isPlayer);
}

/** A prepared fixture with two real lineups. */
function preparedFixture(game: TestGame, matchday = nextMatchday(game.state)): Match {
  prepareMatchday(game.state, matchday);
  const match = Object.values(game.state.matches).find((candidate) => candidate.matchday === matchday)!;
  return match;
}

/**
 * The engine's own participation record, authored by hand.
 *
 * Exactly the fields Finance reads: a starter, a substitute who came on, and a
 * named substitute who never did. Everything else is noise the finance layer
 * must not need.
 */
function performance(
  playerId: string,
  clubId: string,
  started: boolean,
  cameOnMinute: number | null,
): PlayerPerformance {
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

/** Find the next date falling on the given weekday. */
function nextWeekday(from: string, weekday: number): string {
  let date = from;
  for (let i = 0; i < 14; i += 1) {
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === weekday) return date;
    date = addDays(date, 1);
  }
  return date;
}

/** Put a known pair of liabilities on a player, as two matches would have. */
function twoLiabilities(player: Player): void {
  player.subs = {
    owed: 8,
    missedWeeks: 2,
    lastPaidOn: null,
    liabilities: [
      { id: 'matchA:p', matchId: 'matchA', date: '2026-09-06', category: 'starter', amount: 5, paid: 0, paidOn: null },
      { id: 'matchB:p', matchId: 'matchB', date: '2026-09-13', category: 'substitute', amount: 3, paid: 0, paidOn: null },
    ],
    payments: [],
  };
}

/* ------------------------------------------------------------------------ *
 * The category the engine's record maps to
 * ------------------------------------------------------------------------ */

describe('participation comes from the engine, not the squad list', () => {
  it('reads a starter, a substitute who came on, and an unused substitute apart', () => {
    expect(participationCategory(performance('p', 'c', true, null))).toBe('starter');
    expect(participationCategory(performance('p', 'c', false, 62))).toBe('substitute');
    expect(participationCategory(performance('p', 'c', false, null))).toBeNull();
  });

  it('prices the categories from the club’s own settings', () => {
    const finances = { starterSubAmount: 7, substituteSubAmount: 4 } as Parameters<typeof subAmountFor>[0];
    expect(subAmountFor(finances, 'starter')).toBe(7);
    expect(subAmountFor(finances, 'substitute')).toBe(4);
  });

  it('falls back to the realistic defaults when a club has no setting', () => {
    const finances = {} as Parameters<typeof subAmountFor>[0];
    expect(subAmountFor(finances, 'starter')).toBe(DEFAULT_STARTER_SUB);
    expect(subAmountFor(finances, 'substitute')).toBe(DEFAULT_SUBSTITUTE_SUB);
    expect(DEFAULT_STARTER_SUB).toBe(5);
    expect(DEFAULT_SUBSTITUTE_SUB).toBe(3);
  });
});

/* ------------------------------------------------------------------------ *
 * Liabilities from a completed match
 * ------------------------------------------------------------------------ */

describe('a completed match creates liabilities from actual participation', () => {
  it('charges starters full and substitutes who came on the reduced amount', () => {
    const game = createTestGame('subs-categories');
    const match = preparedFixture(game);
    match.result = { homeGoals: 1, awayGoals: 0, homeShots: 5, awayShots: 3, homePossession: 55, awayPossession: 45, attendance: 40 };

    const home = match.homeClubId;
    const players = game.state.clubs[home]!.squadIds;
    const starter = players[0]!;
    const subOn = players[1]!;
    const unused = players[2]!;
    const unselected = players[3]!;

    match.performances = {
      [starter]: performance(starter, home, true, null),
      [subOn]: performance(subOn, home, false, 65),
      [unused]: performance(unused, home, false, null),
    };

    const created = recordMatchdaySubs(game.state, match);

    const liabilities = (game.state.people[starter] as Player).subs.liabilities!;
    expect(liabilities).toHaveLength(1);
    expect(liabilities[0]).toMatchObject({ category: 'starter', amount: 5, paid: 0, matchId: match.id });

    const subLiabilities = (game.state.people[subOn] as Player).subs.liabilities!;
    expect(subLiabilities[0]).toMatchObject({ category: 'substitute', amount: 3 });

    // The named substitute who never came on owes nothing, and the man who was
    // not in the squad at all owes nothing. Squad membership is not a debt.
    expect((game.state.people[unused] as Player).subs.liabilities).toHaveLength(0);
    expect((game.state.people[unselected] as Player).subs.liabilities).toHaveLength(0);
    expect((game.state.people[unselected] as Player).subs.owed).toBe(0);
    expect(created).toHaveLength(2);
  });

  it('never invents a liability for a man who was merely on the squad list', () => {
    const game = createTestGame('subs-squad-only');
    const match = preparedFixture(game);
    match.result = { homeGoals: 0, awayGoals: 0, homeShots: 1, awayShots: 1, homePossession: 50, awayPossession: 50, attendance: 20 };
    // Nobody recorded as playing, though the club has a full squad.
    match.performances = {};

    recordMatchdaySubs(game.state, match);

    for (const player of squadOf(game)) {
      expect(player.subs.owed).toBe(0);
      expect(player.subs.liabilities ?? []).toHaveLength(0);
    }
  });

  it('charges nothing to a man who was unavailable', () => {
    const game = createTestGame('subs-unavailable');
    const match = preparedFixture(game);
    match.result = { homeGoals: 0, awayGoals: 1, homeShots: 2, awayShots: 4, homePossession: 45, awayPossession: 55, attendance: 15 };
    const home = match.homeClubId;
    const out = game.state.people[game.state.clubs[home]!.squadIds[0]!] as Player;
    out.availability = { status: 'unavailable', reason: 'work', note: 'shift', until: null, discoveredLate: false };
    // He was not in the record, so the engine never saw him play.
    match.performances = {};

    recordMatchdaySubs(game.state, match);

    expect(out.subs.owed).toBe(0);
    expect(out.subs.liabilities ?? []).toHaveLength(0);
  });

  it('does not double-charge when the same completed match is settled twice', () => {
    const game = createTestGame('subs-idempotent');
    const match = preparedFixture(game);
    match.result = { homeGoals: 2, awayGoals: 1, homeShots: 6, awayShots: 4, homePossession: 52, awayPossession: 48, attendance: 33 };
    const home = match.homeClubId;
    const starter = game.state.clubs[home]!.squadIds[0]!;
    match.performances = { [starter]: performance(starter, home, true, null) };

    recordMatchdaySubs(game.state, match);
    recordMatchdaySubs(game.state, match);

    expect((game.state.people[starter] as Player).subs.liabilities).toHaveLength(1);
    expect((game.state.people[starter] as Player).subs.owed).toBe(5);
  });

  it('keeps a debt from more than one match, so the reason for it survives', () => {
    const game = createTestGame('subs-multiple');
    const match = preparedFixture(game);
    const home = match.homeClubId;
    const player = game.state.clubs[home]!.squadIds[0]!;

    match.result = { homeGoals: 1, awayGoals: 1, homeShots: 3, awayShots: 3, homePossession: 50, awayPossession: 50, attendance: 25 };
    match.performances = { [player]: performance(player, home, true, null) };
    recordMatchdaySubs(game.state, match);

    // A second match, the cup tie a week later: he came on this time.
    const second: Match = { ...match, id: `${match.id}-cup`, date: addDays(match.date, 7) };
    second.performances = { [player]: performance(player, home, false, 70) };
    recordMatchdaySubs(game.state, second);

    const subs = (game.state.people[player] as Player).subs;
    expect(subs.liabilities).toHaveLength(2);
    expect(subs.liabilities!.map((liability) => liability.matchId)).toEqual([match.id, second.id]);
    expect(subs.owed).toBe(8);
    expect(subs.missedWeeks).toBe(2);
  });

  it('keeps a carried balance when a new match liability is added', () => {
    const game = createTestGame('subs-carried');
    const match = preparedFixture(game);
    const home = match.homeClubId;
    const player = game.state.people[game.state.clubs[home]!.squadIds[0]!] as Player;
    player.subs = {
      owed: 10,
      missedWeeks: 1,
      lastPaidOn: null,
      liabilities: [
        { id: `carried:${player.id}`, matchId: 'carried', date: game.state.date, category: 'carried', amount: 10, paid: 0, paidOn: null },
      ],
      payments: [],
    };
    match.result = { homeGoals: 1, awayGoals: 0, homeShots: 4, awayShots: 2, homePossession: 55, awayPossession: 45, attendance: 18 };
    match.performances = { [player.id]: performance(player.id, home, true, null) };

    recordMatchdaySubs(game.state, match);

    expect(player.subs.owed).toBe(15);
    expect(player.subs.liabilities).toHaveLength(2);

    // Paying £10 settles the carried balance first and leaves the match £5.
    collectPlayerSubs(game.state, home, player.id, game.state.date, 10);
    expect(player.subs.owed).toBe(5);
    expect(player.subs.liabilities![0]!.paidOn).toBe(game.state.date);
  });
});

/* ------------------------------------------------------------------------ *
 * Payment model
 * ------------------------------------------------------------------------ */

describe('payment preserves history and settles the right liabilities', () => {
  it('a part payment settles the oldest liability and leaves the rest outstanding', () => {
    const game = createTestGame('subs-partial');
    const player = squadOf(game)[0]!;
    twoLiabilities(player);

    const taken = collectPlayerSubs(game.state, game.clubId, player.id, game.state.date, 5);

    expect(taken).toBe(5);
    expect(player.subs.liabilities![0]).toMatchObject({ paid: 5, paidOn: game.state.date });
    expect(player.subs.liabilities![1]).toMatchObject({ paid: 0, paidOn: null });
    expect(player.subs.owed).toBe(3);
    expect(player.subs.lastPaidOn).toBe(game.state.date);
    expect(player.subs.payments).toHaveLength(1);
  });

  it('collecting everything clears the whole book but keeps the history', () => {
    const game = createTestGame('subs-full');
    const player = squadOf(game)[0]!;
    twoLiabilities(player);

    collectPlayerSubs(game.state, game.clubId, player.id, game.state.date);

    expect(player.subs.owed).toBe(0);
    expect(player.subs.missedWeeks).toBe(0);
    expect(player.subs.liabilities).toHaveLength(2);
    expect(player.subs.liabilities!.every((liability) => liability.paidOn === game.state.date)).toBe(true);
  });

  it('books the money that arrived and nothing else', () => {
    const game = createTestGame('subs-ledger');
    const player = squadOf(game)[0]!;
    twoLiabilities(player);
    const before = game.state.clubs[game.clubId]!.finances.balance;

    collectPlayerSubs(game.state, game.clubId, player.id, game.state.date, 5);

    expect(game.state.clubs[game.clubId]!.finances.balance).toBe(before + 5);
    expect(
      game.state.clubs[game.clubId]!.finances.ledger.some((line) => line.category === 'subs' && line.amount === 5),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------------ *
 * The real engine, headless
 * ------------------------------------------------------------------------ */

describe('headless matches produce participation-based liabilities', () => {
  it('matches every liability to an engine participation record', () => {
    const game = createTestGame('subs-engine');
    const matchday = nextMatchday(game.state);
    const match = preparedFixture(game, matchday);
    simulateMatchHeadless(match, matchEnvironment(game.state, match, { autoManageAllBenches: true }));
    expect(match.result).not.toBeNull();

    const created = recordMatchdaySubs(game.state, match);

    // Every liability corresponds to a player the engine recorded as playing…
    const participants = Object.values(match.performances).filter((entry) => participationCategory(entry) !== null);
    expect(created.map((liability) => liability.id).sort()).toEqual(
      participants.map((entry) => `${match.id}:${entry.playerId}`).sort(),
    );
    // …and no unused substitute or non-participant was charged.
    for (const entry of Object.values(match.performances)) {
      if (participationCategory(entry) === null) {
        const subs = (game.state.people[entry.playerId] as Player | undefined)?.subs;
        expect(subs?.liabilities ?? []).toHaveLength(0);
      }
    }
    // The club only ever charges its own configured rate.
    for (const liability of created) {
      const expected = liability.category === 'starter' ? DEFAULT_STARTER_SUB : DEFAULT_SUBSTITUTE_SUB;
      expect(liability.amount).toBe(expected);
    }
  });
});

describe('settling a matchday moves the book only by what a man played', () => {
  it('raises the right liabilities and only books money that arrived', () => {
    const game = createTestGame('subs-settle');
    const match = preparedFixture(game);
    match.result = { homeGoals: 3, awayGoals: 2, homeShots: 8, awayShots: 6, homePossession: 54, awayPossession: 46, attendance: 41 };
    const home = match.homeClubId;
    const club = game.state.clubs[home]!;
    club.finances.balance = 500;
    const starter = game.state.people[club.squadIds[0]!] as Player;
    starter.attributes.behavioural.reliability = 20;
    match.performances = { [starter.id]: performance(starter.id, home, true, null) };

    const result = settleMatchdaySubs(game.state, match);

    expect(result.liabilities).toHaveLength(1);
    expect(result.income).toBeGreaterThanOrEqual(0);
    expect(result.income).toBeLessThanOrEqual(5);
    // Whatever came in, the man's debt is consistent with it.
    expect(starter.subs.owed).toBe(result.income > 0 ? 0 : 5);
  });
});

/* ------------------------------------------------------------------------ *
 * Timing: no squad-wide weekly tax
 * ------------------------------------------------------------------------ */

describe('there is no weekly squad-wide settlement', () => {
  it('has no Friday subs rule in the club calendar', () => {
    const { state } = createTestGame('subs-no-rule');
    expect(recurringEvents(state).some((rule) => rule.id === 'rec_subs')).toBe(false);
  });

  it('does not move anybody’s book on a Friday with no football', () => {
    const game = createTestGame('subs-no-friday');
    const all = everyone(game.state);
    const before = new Map(all.map((player) => [player.id, player.subs.owed]));
    const friday = nextWeekday(game.state.date, 5);

    processDay(game.state, friday);

    for (const player of all) {
      expect(player.subs.owed).toBe(before.get(player.id));
      expect(player.subs.liabilities ?? []).toHaveLength(0);
    }
    expect(
      game.state.clubs[game.state.userClubId]!.finances.ledger.some((line) => /^Player subs \(/.test(line.description)),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------------ *
 * Migration
 * ------------------------------------------------------------------------ */

describe('an old save migrates without inventing debt', () => {
  it('adds matchday rates and empty liability arrays, keeping any existing balance', () => {
    const game = createTestGame('subs-migration');
    const state = structuredClone(game.state) as unknown as Record<string, unknown>;
    // Present it as a version 10 save: no matchday rates, an old per-player
    // subs record with a balance and a missed-week count, and no liabilities.
    const clubs = state.clubs as Record<string, { finances: Record<string, unknown> }>;
    for (const club of Object.values(clubs)) {
      delete club.finances.starterSubAmount;
      delete club.finances.substituteSubAmount;
    }
    const people = state.people as Record<string, { kind: string; subs?: Record<string, unknown> }>;
    const marked: string[] = [];
    for (const [id, person] of Object.entries(people)) {
      if (person.kind !== 'player') continue;
      person.subs = { owed: 10, missedWeeks: 2, lastPaidOn: null };
      marked.push(id);
    }

    const loaded = deserialiseGame(
      JSON.stringify({ version: 10, savedAt: new Date().toISOString(), state }),
    );
    expect(loaded.error).toBeNull();
    const migrated = loaded.state!;

    // Defaults, and no fabricated liabilities for matches it never recorded.
    for (const club of Object.values(migrated.clubs)) {
      expect(club.finances.starterSubAmount).toBe(DEFAULT_STARTER_SUB);
      expect(club.finances.substituteSubAmount).toBe(DEFAULT_SUBSTITUTE_SUB);
    }
    const player = migrated.people[marked[0]!];
    expect(player.kind).toBe('player');
    if (player.kind === 'player') {
      // The old balance is kept as one carried liability, not multiplied into a
      // pile of fabricated matches, and no match is invented to explain it.
      expect(player.subs.liabilities).toHaveLength(1);
      expect(player.subs.liabilities![0]).toMatchObject({ category: 'carried', amount: 10, paid: 0 });
      expect(player.subs.owed).toBe(10);
    }
  });
});
