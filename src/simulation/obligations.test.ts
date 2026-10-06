import { describe, expect, it } from 'vitest';
import { isCompetitiveMatch } from '@/domain/match';
import { addDays, daysBetween } from './calendar';
import { applyMatchdayFinances, applyStandingCosts } from './finance';
import { obligationsTotal, upcomingObligations } from './obligations';
import { recurringEvents, recursOn } from './schedule';
import { createTestGame } from './testSupport';

/**
 * What the club is told it will owe has to be what it is actually billed.
 *
 * A projection that quietly disagrees with the ledger is worse than no
 * projection: it is a treasurer telling the manager a number the bank does not
 * recognise. So these tests do not just check that the arithmetic is plausible —
 * they run the very day that charges the money and compare the ledger against
 * the projection.
 */

function leagueFixtureFor(state: ReturnType<typeof createTestGame>['state'], clubId: string) {
  return Object.values(state.matches).find(
    (match) =>
      !match.played &&
      (match.homeClubId === clubId || match.awayClubId === clubId) &&
      isCompetitiveMatch(state, match),
  );
}

describe('the club’s known obligations', () => {
  it('lists only money out, in date order, inside the horizon it was asked for', () => {
    const { state } = createTestGame('obligations-shape');
    const clubId = state.userClubId;
    const rows = upcomingObligations(state, clubId, { weeks: 6, limit: 50 });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.amount).toBeLessThan(0);
      expect(daysBetween(state.date, row.date)).toBeGreaterThanOrEqual(0);
      expect(daysBetween(row.date, addDays(state.date, 42))).toBeGreaterThanOrEqual(0);
    }
    const dates = rows.map((row) => row.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('reads the standing costs off the calendar’s own rule, and they match the bill', () => {
    const { state } = createTestGame('obligations-standing');
    const clubId = state.userClubId;
    const club = state.clubs[clubId]!;
    const rule = recurringEvents(state).find((entry) => entry.id === 'rec_costs')!;
    // The projection is a look at a payday the schedule already knows about.
    const next = addDays(state.date, (rule.weekday! - new Date(`${state.date}T00:00:00Z`).getUTCDay() + 7) % 7 || 7);
    expect(recursOn(rule, next)).toBe(true);

    const rows = upcomingObligations(state, clubId, { weeks: 3, limit: 50 });
    const standing = rows.filter((row) => row.label === 'Standing costs');
    expect(standing.length).toBeGreaterThan(0);
    // The weekly standing bill is the insurance: the pitch is billed with the
    // home fixture that used it, and appears as a fixture obligation instead.
    expect(standing[0]!.amount).toBe(-club.finances.insurancePerWeek);

    // Now actually run that payday and check the ledger says the same thing.
    const date = standing[0]!.date;
    const before = club.finances.ledger.length;
    applyStandingCosts(state, clubId, date);
    const written = club.finances.ledger.slice(before);
    const insurance = written.find((line) => line.category === 'insurance')!;
    expect(insurance.amount).toBe(-club.finances.insurancePerWeek);
    expect(insurance.amount).toBe(standing[0]!.amount);
    // Nothing for a pitch is charged on a Wednesday any more.
    expect(written.find((line) => line.category === 'pitch-hire')).toBeUndefined();
  });

  it('prices a fixture the way that fixture is actually charged', () => {
    const { state } = createTestGame('obligations-fixture');
    const clubId = state.userClubId;
    const match = leagueFixtureFor(state, clubId)!;
    expect(match).toBeTruthy();

    const projected = upcomingObligations(state, clubId, { weeks: 40, limit: 100 }).find(
      (row) => row.id === `match:${match.id}`,
    )!;
    expect(projected).toBeTruthy();

    // Play it, then compare the ledger with what was projected.
    match.result = { homeGoals: 1, awayGoals: 0, homeShots: 4, awayShots: 2, homePossession: 55, awayPossession: 45, attendance: 30 };
    const club = state.clubs[clubId]!;
    const before = club.finances.ledger.filter((line) => line.date === match.date).length;
    applyMatchdayFinances(state, match);
    const today = club.finances.ledger.filter((line) => line.date === match.date).slice(before);
    const out = today.filter((line) => line.amount < 0).reduce((sum, line) => sum + line.amount, 0);

    // The projection is the club's own outgoing side of that fixture, to the penny.
    expect(out).toBe(projected.amount);
  });

  it('says nothing about money the club does not owe', () => {
    const { state } = createTestGame('obligations-none');
    const clubId = state.userClubId;
    const club = state.clubs[clubId]!;
    club.finances.weeklyGroundCost = 0;
    club.finances.insurancePerWeek = 0;
    club.finances.trainingCostPerWeek = 0;
    for (const match of Object.values(state.matches)) {
      if (match.homeClubId === clubId || match.awayClubId === clubId) match.played = true;
    }
    expect(upcomingObligations(state, clubId, { weeks: 6, limit: 50 })).toEqual([]);
    expect(obligationsTotal([])).toBe(0);
  });

  it('totals what is listed, and honours the limit it was given', () => {
    const { state } = createTestGame('obligations-limit');
    const all = upcomingObligations(state, state.userClubId, { weeks: 8, limit: 100 });
    const few = upcomingObligations(state, state.userClubId, { weeks: 8, limit: 3 });
    expect(few.length).toBeLessThanOrEqual(3);
    expect(obligationsTotal(few)).toBe(Math.round(few.reduce((sum, row) => sum + row.amount, 0) * 100) / 100);
    if (all.length <= 3) expect(obligationsTotal(few)).toBe(obligationsTotal(all));
  });
});
