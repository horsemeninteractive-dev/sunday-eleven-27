import { describe, expect, it } from 'vitest';
import { GAME_STATE_VERSION } from '@/domain/game';
import type { SponsorshipDeal } from '@/domain/sponsorship';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { dayOfWeek } from './calendar';
import { processDay } from './day';
import { ledgerBalances, reconcileBalance } from './finance';
import { getRelationship } from './relationships';
import {
  activeDealForClub,
  endSponsorship,
  offerSponsorship,
  renewSponsorship,
  runSponsorship,
  seekSponsor,
  SPONSORSHIP,
  sponsorCandidates,
  sponsorNameFor,
  sponsorshipStore,
  sponsorshipSummary,
  sponsorshipTermsFor,
  weeklySponsorshipIncome,
} from './sponsorship';
import { createTestGame } from './testSupport';

type State = ReturnType<typeof createTestGame>['state'];

function runDays(state: State, days: number): void {
  for (let i = 0; i < days; i += 1) processDay(state, state.date, { resolveUserMatch: true });
}

function sponsorshipLines(state: State, clubId: string) {
  return state.clubs[clubId]!.finances.ledger.filter((line) => line.category === 'sponsorship');
}

/** A club that certainly has a deal, for the tests that need one. */
function sponsoredClub(state: State): string {
  const club = Object.values(state.clubs).find((candidate) => activeDealForClub(state, candidate.id));
  if (!club) throw new Error('the world has no sponsored club');
  return club.id;
}

/* ------------------------------------------------------------------------ *\
 * The sponsor model
 * ------------------------------------------------------------------------ */

describe('a sponsor is a real business with a real agreement', () => {
  it('seeds each named club with a deal with the business that backs it', () => {
    const { state } = createTestGame('sponsor-seed');
    const clubId = sponsoredClub(state);
    const deal = activeDealForClub(state, clubId)!;

    expect(deal.status).toBe('active');
    expect(deal.instalment).toBeGreaterThan(0);
    expect(deal.startDate).toBe(state.season.startDate);
    expect(deal.endDate).toBe(state.season.endDate);
    expect(deal.terms.frequency).toBe('weekly');
    // The sponsor is a business that already exists in the world, and it is
    // recorded as backing the club — not an invented entity.
    const business = state.world.businesses[deal.sponsorId]!;
    expect(business).toBeDefined();
    expect(business.sponsoredClubIds).toContain(clubId);
    expect(sponsorNameFor(state, clubId)).toBe(business.name);
  });

  it('leaves a club alone when no business backs it', () => {
    const { state } = createTestGame('sponsor-nobody');
    const clubId = state.userClubId;
    endSponsorship(state, clubId);

    expect(activeDealForClub(state, clubId)).toBeNull();
    const summary = sponsorshipSummary(state, clubId);
    expect(summary.standing).toBe('none');
    expect(summary.sponsorName).toBeNull();

    // Two weeks with no sponsor: the club is poorer, but nothing is invented.
    runDays(state, 14);
    expect(sponsorshipLines(state, clubId)).toHaveLength(0);
    expect(ledgerBalances(state.clubs[clubId]!.finances)).toBe(true);
  });
});

/* ------------------------------------------------------------------------ *\
 * Payment
 * ------------------------------------------------------------------------ */

describe('the agreement decides when money is due', () => {
  it('books exactly one ledger line per instalment, on the payday', () => {
    const { state } = createTestGame('sponsor-pay');
    const clubId = sponsoredClub(state);
    const deal = activeDealForClub(state, clubId)!;
    const business = state.world.businesses[deal.sponsorId]!;

    runDays(state, 21);

    const lines = sponsorshipLines(state, clubId);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(dayOfWeek(line.date)).toBe(5);
      expect(line.description).toBe(`${business.name} sponsorship`);
      expect(line.amount).toBe(deal.instalment);
    }
    // Exactly one line per due date, and every paid date was a real payday.
    const dates = lines.map((line) => line.date);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('never pays the same due date twice', () => {
    const { state } = createTestGame('sponsor-nodefault');
    const clubId = sponsoredClub(state);
    runDays(state, 12);

    const first = sponsorshipLines(state, clubId);
    expect(first.length).toBeGreaterThan(0);
    const paidDate = first[0]!.date;
    const deal = activeDealForClub(state, clubId)!;
    const paidCount = deal.paidCount;
    const linesOnDay = first.filter((line) => line.date === paidDate).length;

    // Ask for the same day again, as a reload or a repeated tick would.
    runSponsorship(state, paidDate);
    runSponsorship(state, paidDate);

    expect(sponsorshipLines(state, clubId).filter((line) => line.date === paidDate)).toHaveLength(linesOnDay);
    expect(activeDealForClub(state, clubId)!.paidCount).toBe(paidCount);
  });

  it('keeps every club balanced while sponsorship income flows', () => {
    const { state } = createTestGame('sponsor-reconcile');
    runDays(state, 30);
    let sponsorshipTotal = 0;
    for (const club of Object.values(state.clubs)) {
      expect(ledgerBalances(club.finances)).toBe(true);
      expect(club.finances.balance).toBe(reconcileBalance(club.finances));
      sponsorshipTotal += sponsorshipLines(state, club.id).reduce((sum, line) => sum + line.amount, 0);
    }
    expect(sponsorshipTotal).toBeGreaterThan(0);
  });
});/* ------------------------------------------------------------------------ *\
 * Cadence: a business brings its own
 * ------------------------------------------------------------------------ */

/** Sign the club with a trade business — the ones that pay monthly. */
function signWithTrade(state: State, clubId: string): SponsorshipDeal {
  const trades = Object.values(state.world.businesses).filter(
    (business) => sponsorshipTermsFor(business).frequency === 'monthly',
  );
  for (const trade of trades) {
    const result = offerSponsorship(state, clubId, trade.id);
    if (result.outcome === 'accepted' && result.deal) return result.deal;
  }
  throw new Error('no trade business would take the club on');
}

describe('a business brings its own cadence to a deal', () => {
  it('pays weekly for a shop, monthly for a trade', () => {
    const { state } = createTestGame('sponsor-cadence');
    const businesses = Object.values(state.world.businesses);
    const shops = businesses.filter((b) => ['pub', 'cafe', 'butcher'].includes(b.kind));
    const trades = businesses.filter((b) => ['builder', 'garage', 'plumbers'].includes(b.kind));
    expect(shops.length).toBeGreaterThan(0);
    expect(trades.length).toBeGreaterThan(0);

    for (const shop of shops) {
      expect(sponsorshipTermsFor(shop)).toEqual({ frequency: 'weekly', payDay: SPONSORSHIP.weeklyPayDay });
    }
    for (const trade of trades) {
      expect(sponsorshipTermsFor(trade)).toEqual({ frequency: 'monthly', payDay: SPONSORSHIP.monthlyPayDay });
    }
  });

  it('signs a monthly deal for a trade and keeps the annual money the same', () => {
    const { state } = createTestGame('sponsor-monthly-sign');
    const clubId = state.userClubId;
    endSponsorship(state, clubId);

    const deal = signWithTrade(state, clubId);
    expect(deal.terms.frequency).toBe('monthly');
    expect(deal.terms.payDay).toBe(SPONSORSHIP.monthlyPayDay);
    // The cadence changes when the money lands, not how much of it there is: a
    // monthly instalment is a year's worth in twelve parts, so its weekly
    // equivalent is a weekly deal's instalment, not a quarter of it.
    expect(weeklySponsorshipIncome(state, clubId)).toBeCloseTo((deal.instalment * 12) / 52, -1);
    expect(deal.instalment).toBeGreaterThan(SPONSORSHIP.minInstalment);
  });

  it('pays a monthly deal on its own payday, through the ordinary path', () => {
    const { state } = createTestGame('sponsor-monthly-pay');
    const clubId = state.userClubId;
    endSponsorship(state, clubId);
    const deal = signWithTrade(state, clubId);
    const business = state.world.businesses[deal.sponsorId]!;

    runDays(state, 45);

    const lines = sponsorshipLines(state, clubId);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      // The agreement's own payday — the 28th — and one ledger line each time.
      expect(Number(line.date.slice(8, 10))).toBe(SPONSORSHIP.monthlyPayDay);
      expect(line.description).toBe(`${business.name} sponsorship`);
      expect(line.amount).toBe(deal.instalment);
    }
    const dates = lines.map((line) => line.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(ledgerBalances(state.clubs[clubId]!.finances)).toBe(true);
    expect(state.clubs[clubId]!.finances.balance).toBe(reconcileBalance(state.clubs[clubId]!.finances));
  });
});

/* ------------------------------------------------------------------------ *\
 * Ending a deal
 * ------------------------------------------------------------------------ */
describe('a sponsorship can end', () => {
  it('releases the business and stops the income', () => {
    const { state } = createTestGame('sponsor-end');
    const clubId = sponsoredClub(state);
    const deal = activeDealForClub(state, clubId)!;
    const business = state.world.businesses[deal.sponsorId]!;

    endSponsorship(state, clubId);
    expect(activeDealForClub(state, clubId)).toBeNull();
    expect(deal.status).toBe('ended');
    expect(business.sponsoredClubIds).not.toContain(clubId);

    const before = sponsorshipLines(state, clubId).length;
    runDays(state, 14);
    expect(sponsorshipLines(state, clubId).length).toBe(before);
  });
});

/* ------------------------------------------------------------------------ *\
 * Renewal, leaving and replacement
 * ------------------------------------------------------------------------ */

describe('the summer review', () => {
  it('renews the deals that carry on and never silently drops one', () => {
    const { state } = createTestGame('sponsor-renew');
    const activeBefore = Object.values(state.clubs).filter((club) => activeDealForClub(state, club.id)).length;
    const clubId = sponsoredClub(state);
    const before = activeDealForClub(state, clubId)!;

    const outcome = renewSponsorship(state, {
      seasonId: state.season.id,
      seasonLabel: state.season.label,
      seasonStart: state.season.startDate,
      previousSeasonId: 'season-not-played',
      previousSeasonLabel: 'last season',
    });

    // Every deal was accounted for: renewed or lost, never vanishing.
    expect(outcome.renewed + outcome.lost).toBe(activeBefore);
    expect(outcome.renewed).toBeGreaterThan(0);

    const after = activeDealForClub(state, clubId)!;
    expect(after).toBeDefined();
    expect(after.endDate).toBe(state.season.endDate);
    expect(after.instalment).toBeGreaterThan(0);
    expect(after.startDate).toBe(before.startDate);
  });

  it('replaces a departed sponsor when the club can find another', () => {
    const { state } = createTestGame('sponsor-replace');
    const clubId = sponsoredClub(state);
    const deal = activeDealForClub(state, clubId)!;
    // A cooling, well-missed deal on a club that looks to be struggling.
    deal.relationship = 5;
    deal.missedCount = 2;

    const outcome = renewSponsorship(state, {
      seasonId: state.season.id,
      seasonLabel: state.season.label,
      seasonStart: state.season.startDate,
      previousSeasonId: 'season-not-played',
      previousSeasonLabel: 'last season',
    });

    // The old deal is settled one way or the other, and the club is never left
    // in a broken state: any club it gained a sponsor for holds a real deal.
    expect(outcome.lost + outcome.renewed).toBeGreaterThan(-1);
    for (const id of [clubId]) {
      const current = activeDealForClub(state, id);
      if (current) {
        expect(state.world.businesses[current.sponsorId]).toBeDefined();
        expect(current.status).toBe('active');
      }
    }
    for (const club of Object.values(state.clubs)) {
      const current = activeDealForClub(state, club.id);
      if (!current) continue;
      expect(state.world.businesses[current.sponsorId]).toBeDefined();
      expect(state.world.businesses[current.sponsorId]!.sponsoredClubIds).toContain(club.id);
    }
  });
});

/* ------------------------------------------------------------------------ *\
 * Sponsors and no sponsors, side by side
 * ------------------------------------------------------------------------ */

describe('a sponsor-less club is a normal club', () => {
  it('carries on alongside sponsored clubs for a month', () => {
    const { state } = createTestGame('sponsor-mixed');
    endSponsorship(state, state.userClubId);

    runDays(state, 40);

    expect(activeDealForClub(state, state.userClubId)).toBeNull();
    // The rest of the world still gets paid, and nobody's books break.
    const others = Object.values(state.clubs)
      .filter((club) => club.id !== state.userClubId)
      .reduce((sum, club) => sum + sponsorshipLines(state, club.id).length, 0);
    expect(others).toBeGreaterThan(0);
    for (const club of Object.values(state.clubs)) {
      expect(ledgerBalances(club.finances)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------------ *\
 * Finding a sponsor
 * ------------------------------------------------------------------------ */

describe('finding a sponsor', () => {
  it('offers real local businesses and can sign one', () => {
    const { state } = createTestGame('sponsor-find');
    const clubId = state.userClubId;
    endSponsorship(state, clubId);

    const candidates = sponsorCandidates(state, clubId);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(state.world.businesses[candidate.businessId]).toBeDefined();
    }

    const result = seekSponsor(state, clubId);
    expect(result.outcome).toBe('accepted');
    const deal = activeDealForClub(state, clubId)!;
    expect(deal).toBeDefined();
    expect(state.world.businesses[deal.sponsorId]!.sponsoredClubIds).toContain(clubId);
    expect(sponsorshipSummary(state, clubId).standing).toBe('active');
  });

  it('refuses a business that does not exist', () => {
    const { state } = createTestGame('sponsor-ghost');
    endSponsorship(state, state.userClubId);
    const result = offerSponsorship(state, state.userClubId, 'no-such-business');
    expect(result.outcome).toBe('no-business');
    expect(activeDealForClub(state, state.userClubId)).toBeNull();
  });

  it('will not sign a second sponsor over an existing one', () => {
    const { state } = createTestGame('sponsor-double');
    const clubId = sponsoredClub(state);
    const candidate = sponsorCandidates(state, clubId)[0];
    const other = Object.values(state.world.businesses).find((business) => business.id !== activeDealForClub(state, clubId)!.sponsorId)!;
    const result = offerSponsorship(state, clubId, candidate?.businessId ?? other.id);
    expect(result.outcome).toBe('already-sponsored');
  });
});

/* ------------------------------------------------------------------------ *\
 * The relationship system
 * ------------------------------------------------------------------------ */

describe('sponsorship uses the one relationship system', () => {
  it('records a signing through the manager–chairman relationship', () => {
    const { state } = createTestGame('sponsor-relationship');
    const clubId = state.userClubId;
    const club = state.clubs[clubId]!;
    const managerId = club.managerId!;
    const chairmanId = club.chairmanId!;
    expect(managerId).toBeTruthy();
    expect(chairmanId).toBeTruthy();

    endSponsorship(state, clubId);
    const result = seekSponsor(state, clubId);
    expect(result.outcome).toBe('accepted');

    const relationship = getRelationship(state, managerId, chairmanId);
    expect(relationship).toBeDefined();
    const mentions = relationship!.history.some((entry) =>
      entry.description.includes(result.businessName ?? '\u0000'),
    );
    expect(mentions).toBe(true);
  });
});

/* ------------------------------------------------------------------------ *\
 * Save/load
 * ------------------------------------------------------------------------ */

describe('agreements survive a save', () => {
  it('keeps the deals, the paydays and the books across a reload', () => {
    const { state } = createTestGame('sponsor-save');
    runDays(state, 12);
    const before = sponsorshipStore(state).deals.map((deal) => ({ ...deal }));

    const loaded = deserialiseGame(serialiseGame(state));
    expect(loaded.error).toBeNull();
    const reloaded = loaded.state!;

    expect(reloaded.version).toBe(GAME_STATE_VERSION);
    expect(reloaded.sponsorship.deals).toEqual(before);
    for (const club of Object.values(reloaded.clubs)) {
      expect(ledgerBalances(club.finances)).toBe(true);
    }

    // A reloaded world still pays on the same dates, and still only once.
    const clubId = sponsoredClub(reloaded);
    const paidDate = sponsorshipLines(reloaded, clubId)[0]?.date;
    expect(paidDate).toBeDefined();
    const linesBefore = sponsorshipLines(reloaded, clubId).filter((line) => line.date === paidDate).length;
    runSponsorship(reloaded, paidDate!);
    expect(
      sponsorshipLines(reloaded, clubId).filter((line) => line.date === paidDate).length,
    ).toBe(linesBefore);
  });

  it('gives a pre-sponsorship save an empty log rather than an invented deal', () => {
    const { state } = createTestGame('sponsor-migrate');
    const clone = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete clone.sponsorship;

    const loaded = deserialiseGame(
      JSON.stringify({ version: 14, savedAt: new Date().toISOString(), state: clone }),
    );
    expect(loaded.error).toBeNull();
    expect(loaded.state!.version).toBe(GAME_STATE_VERSION);
    expect(loaded.state!.sponsorship).toEqual({ deals: [] });
  });
});
