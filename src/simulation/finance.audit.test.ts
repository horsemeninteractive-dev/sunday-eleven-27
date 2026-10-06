import { describe, expect, it } from 'vitest';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { addDays, dayOfWeek } from './calendar';
import { processDay } from './day';
import { isCompetitiveMatch } from '@/domain/match';
import { addLedgerEntry, applyMatchdayFinances, financeSummary, ledgerBalances, matchdayCosts, reconcileBalance } from './finance';
import { activeDealForClub } from './sponsorship';
import { sessionDatesFor } from './training/plan';
import { sessionsFor } from './training/store';
import { createTestGame } from './testSupport';

/* ------------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------------ */

type State = ReturnType<typeof createTestGame>['state'];

function runDays(state: State, days: number): void {
  for (let i = 0; i < days; i += 1) processDay(state, state.date, { resolveUserMatch: true });
}

function userClub(state: State) {
  return state.clubs[state.userClubId]!;
}

function linesFor(state: State, description: string) {
  return userClub(state).finances.ledger.filter((line) => line.description === description);
}

/* ------------------------------------------------------------------------ *
 * Game start
 * ------------------------------------------------------------------------ */

describe('a career begins with no artificial settlement', () => {
  it('creates a career on the Monday it starts, with no money moved', () => {
    const { state } = createTestGame('finance-create');
    const club = userClub(state);

    // A generated club starts the world in the black with a clean book. The
    // old weekly seed fired sponsorship and a week of standing costs on the day
    // the manager was created; nothing like that happens now.
    expect(club.finances.ledger).toHaveLength(0);
    expect(club.finances.balance).toBe(club.finances.openingBalance);
    const firstDay = club.finances.ledger.filter((line) => line.date === state.date);
    expect(firstDay).toHaveLength(0);
  });

  it('does not book a week of costs before the first Wednesday has happened', () => {
    const { state } = createTestGame('finance-create-costs');
    // Walk to the day before the first Wednesday of the career.
    let date = state.date;
    while (dayOfWeek(addDays(date, 1)) !== 3) date = addDays(date, 1);
    processDay(state, date);
    expect(linesFor(state, 'Insurance (weekly)')).toHaveLength(0);
    // The ground is not a weekly bill at all, on any day.
    expect(userClub(state).finances.ledger.some((line) => line.category === 'pitch-hire')).toBe(false);
  });
});

/* ------------------------------------------------------------------------ *
 * Recurring costs
 * ------------------------------------------------------------------------ */

describe('recurring costs occur on their own dates', () => {
  it('pays the standing costs only on a Wednesday', () => {
    const { state } = createTestGame('finance-cost-dates');
    runDays(state, 24);

    const insurance = linesFor(state, 'Insurance (weekly)');
    expect(insurance.length).toBeGreaterThan(0);
    for (const line of insurance) {
      expect(dayOfWeek(line.date)).toBe(3);
    }
    // A pitch is never billed on a Wednesday: it belongs to the fixture.
    expect(linesFor(state, 'Weekly pitch hire')).toHaveLength(0);
  });

  it('takes the sponsorship only on an agreement payday, once each', () => {
    const { state } = createTestGame('finance-sponsor-dates');
    runDays(state, 35);

    // The agreement, not a calendar rule, says when an instalment is due. The
    // seeded deals pay weekly on a Friday, so every sponsorship line is one.
    const sponsored = Object.values(state.clubs).filter((club) => activeDealForClub(state, club.id));
    expect(sponsored.length).toBeGreaterThan(0);
    let total = 0;
    for (const club of sponsored) {
      const lines = club.finances.ledger.filter((line) => line.category === 'sponsorship');
      const dates = lines.map((line) => line.date);
      total += lines.length;
      for (const date of dates) expect(dayOfWeek(date)).toBe(5);
      // Exactly one payment per due date.
      expect(new Set(dates).size).toBe(dates.length);
    }
    expect(total).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------------ *
 * Training cost
 * ------------------------------------------------------------------------ */

describe('training cost is a real transaction on the session date', () => {
  it('charges the training pitch when a session is actually held', () => {
    const { state } = createTestGame('finance-training-cost');
    const club = userClub(state);
    club.finances.trainingCostPerWeek = 20;
    const sessionDate = sessionDatesFor(state).find((date) => date >= state.date)!;

    processDay(state, sessionDate);

    const session = sessionsFor(state, state.userClubId).find((entry) => entry.date === sessionDate)!;
    expect(session).toBeDefined();
    const hall = userClub(state).finances.ledger.filter(
      (line) => line.date === sessionDate && /Sports hall hire/.test(line.description),
    );
    const charge = linesFor(state, 'Training pitch and floodlights');
    // The standing rate is paid when the session is actually held at the club's
    // own pitch. A cancelled session — or one moved into a hired hall, which is
    // its own cost — does not also pay it.
    const expected = !session.cancelled && hall.length === 0 ? 1 : 0;
    expect(charge).toHaveLength(expected);
    if (expected === 1) {
      expect(charge[0]!.amount).toBe(-20);
      expect(charge[0]!.date).toBe(sessionDate);
    }
  });

  it('charges nothing when the club trains for free', () => {
    const { state } = createTestGame('finance-training-free');
    userClub(state).finances.trainingCostPerWeek = 0;
    const sessionDate = sessionDatesFor(state).find((date) => date >= state.date)!;
    processDay(state, sessionDate);
    expect(linesFor(state, 'Training pitch and floodlights')).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------ *
 * Player subs stay matchday-only
 * ------------------------------------------------------------------------ */

describe('the calendar cannot generate squad-wide sub income', () => {
  it('books no weekly subs line on any day', () => {
    const { state } = createTestGame('finance-no-weekly-subs');
    runDays(state, 20);
    const weeklySubs = userClub(state).finances.ledger.filter((line) => /^Player subs \(/.test(line.description));
    expect(weeklySubs).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------ *
 * The books add up
 * ------------------------------------------------------------------------ */

describe('the balance is the ledger and nothing else', () => {
  it('keeps every club balanced after a month of trading', () => {
    const { state } = createTestGame('finance-reconcile');
    runDays(state, 30);
    for (const club of Object.values(state.clubs)) {
      expect(ledgerBalances(club.finances)).toBe(true);
      expect(club.finances.balance).toBe(reconcileBalance(club.finances));
    }
  });

  it('still adds up after the ledger is trimmed', () => {
    const { state } = createTestGame('finance-trim');
    const club = userClub(state);
    runDays(state, 12);
    const openingBefore = club.finances.openingBalance;
    // Force the cap: 600 synthetic credits, so the oldest lines must be folded
    // into the opening balance rather than silently dropped.
    for (let i = 0; i < 600; i += 1) {
      addLedgerEntry(state, state.userClubId, {
        date: state.date,
        description: `Test line ${i}`,
        category: 'other',
        amount: 1,
      });
    }
    expect(club.finances.ledger.length).toBeLessThanOrEqual(400);
    expect(club.finances.openingBalance).toBeGreaterThan(openingBefore);
    expect(club.finances.balance).toBe(reconcileBalance(club.finances));
    expect(ledgerBalances(club.finances)).toBe(true);
  });

  it('reports UI totals straight from the ledger', () => {
    const { state } = createTestGame('finance-ui');
    runDays(state, 20);
    const club = userClub(state);
    const summary = financeSummary(club);
    const recent = club.finances.ledger.slice(-40);
    const income = Math.round(recent.filter((line) => line.amount > 0).reduce((sum, line) => sum + line.amount, 0));
    const expenditure = Math.round(
      Math.abs(recent.filter((line) => line.amount < 0).reduce((sum, line) => sum + line.amount, 0)),
    );
    expect(summary.income).toBe(income);
    expect(summary.expenditure).toBe(expenditure);
    expect(summary.net).toBe(income - expenditure);
  });
});

/* ------------------------------------------------------------------------ *
 * Save/load
 * ------------------------------------------------------------------------ */

describe('financial state survives a save', () => {
  it('keeps the balance, opening balance and book across a reload', () => {
    const { state } = createTestGame('finance-save');
    runDays(state, 25);
    const club = userClub(state);

    const loaded = deserialiseGame(serialiseGame(state));
    expect(loaded.error).toBeNull();
    const reloaded = loaded.state!.clubs[state.userClubId]!;

    expect(reloaded.finances.balance).toBe(club.finances.balance);
    expect(reloaded.finances.openingBalance).toBe(club.finances.openingBalance);
    expect(reloaded.finances.ledger).toEqual(club.finances.ledger);
    expect(ledgerBalances(reloaded.finances)).toBe(true);
  });

  it('gives an old save an opening balance that makes its books add up', () => {
    const { state } = createTestGame('finance-migrate-opening');
    const club = userClub(state);
    runDays(state, 10);
    const stateClone = structuredClone(state) as unknown as Record<string, unknown>;
    const clubs = stateClone.clubs as Record<string, { finances: Record<string, unknown> }>;
    for (const entry of Object.values(clubs)) delete entry.finances.openingBalance;

    const loaded = deserialiseGame(JSON.stringify({ version: 10, savedAt: new Date().toISOString(), state: stateClone }));
    expect(loaded.error).toBeNull();
    const migrated = loaded.state!.clubs[state.userClubId]!;
    expect(typeof migrated.finances.openingBalance).toBe('number');
    expect(migrated.finances.balance).toBe(club.finances.balance);
    expect(ledgerBalances(migrated.finances)).toBe(true);
  });
});

/* ------------------------------------------------------------------------ *\
 * The ground is billed with the fixture that used it
 * ------------------------------------------------------------------------ */

describe('the ground is a fixture cost, not a weekly one', () => {
  it('charges the home club its own pitch, on the day it plays at home', () => {
    const { state } = createTestGame('finance-ground-home');
    const homeId = state.userClubId;
    const match = Object.values(state.matches).find(
      (candidate) => candidate.homeClubId === homeId && !candidate.played && isCompetitiveMatch(state, candidate),
    )!;
    expect(match).toBeTruthy();
    match.result = {
      homeGoals: 1,
      awayGoals: 0,
      homeShots: 4,
      awayShots: 2,
      homePossession: 55,
      awayPossession: 45,
      attendance: 30,
    };

    const club = state.clubs[homeId]!;
    const before = club.finances.ledger.length;
    applyMatchdayFinances(state, match);
    const pitch = club.finances.ledger.slice(before).find((line) => line.category === 'pitch-hire')!;

    expect(pitch).toBeTruthy();
    expect(pitch.amount).toBe(-club.finances.weeklyGroundCost);
    // Dated the day the ground was actually used.
    expect(pitch.date).toBe(match.date);
  });

  it('charges a club nothing for a ground it is only visiting', () => {
    const { state } = createTestGame('finance-ground-away');
    const awayId = state.userClubId;
    const match = Object.values(state.matches).find(
      (candidate) => candidate.awayClubId === awayId && !candidate.played && isCompetitiveMatch(state, candidate),
    )!;
    expect(match).toBeTruthy();

    expect(matchdayCosts(state, match, awayId).groundHire).toBe(0);
  });

  it('bills a pitch only on a day the club actually played at home', () => {
    const { state } = createTestGame('finance-ground-count');
    const clubId = state.userClubId;
    runDays(state, 120);

    const club = state.clubs[clubId]!;
    const homeDates = new Set(
      Object.values(state.matches)
        .filter((m) => m.homeClubId === clubId && m.played)
        .map((m) => m.date),
    );
    // The match-ground line specifically: the `pitch-hire` category also holds
    // the weekly training pitch, which is a different, genuinely weekly cost.
    const pitchLines = club.finances.ledger.filter((line) => line.description.startsWith('Ground hire —'));
    expect(pitchLines.length).toBeGreaterThan(0);
    expect(pitchLines.length).toBeLessThanOrEqual(homeDates.size);
    for (const line of pitchLines) expect(homeDates.has(line.date)).toBe(true);
  });
});
