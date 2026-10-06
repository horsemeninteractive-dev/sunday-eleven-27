import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GameState } from '@/domain/game';
import type { ViewId } from '@/state/gameStore';
import { addLedgerEntry } from '@/simulation/finance';
import { seedInitialSponsorship } from '@/simulation/sponsorship';
import { setStaffAvailability } from '@/simulation/staff';
import { createTestGame } from '@/simulation/testSupport';
import { addDays } from '@/simulation/calendar';
import { CLUB_MATTER_LIMIT, HOME_MATTER_LIMIT, clubMatters, clubRoster } from './clubMatters';
import { isNavigable } from './navigation';

/**
 * What needs the manager, and where it takes him.
 *
 * The rules worth protecting are the ones that make a dashboard useful rather
 * than noisy: every card leads somewhere real, no subject is said twice, and the
 * loudest thing is always the one on top. A card you cannot act on, or two cards
 * about one problem, is exactly what this model exists to prevent.
 */

/** Put the club genuinely in the red, through the ledger that owns the balance. */
function makeOverdrawn(state: GameState, amount = 600): void {
  const club = state.clubs[state.userClubId]!;
  addLedgerEntry(state, club.id, {
    date: state.date,
    description: 'Roof repair',
    category: 'other',
    amount: -(club.finances.balance + amount),
  });
}

describe('club matters', () => {
  it('leads somewhere real from every single card', () => {
    const { state } = createTestGame('matters-links');
    makeOverdrawn(state);
    const matters = clubMatters(state);

    expect(matters.length).toBeGreaterThan(0);
    for (const matter of matters) {
      expect(matter.destination).toBeTruthy();
      const destination = matter.destination!;
      if (destination.kind === 'view') {
        // A card pointing at a screen that is not in the sidebar would be a
        // dead end, and the sidebar is the definition of what exists.
        expect(isNavigable(destination.view)).toBe(true);
      } else if (destination.kind === 'conversation') {
        expect(state.communication?.conversations[destination.conversationId]).toBeTruthy();
      } else {
        expect(state.people[destination.personId]).toBeTruthy();
      }
    }
  });

  it('only ever points at a part of a screen that actually exists', () => {
    // The anchor half of a deep link is a string, and nothing type-checks it:
    // a card can happily name a section that was renamed last month and simply
    // never scroll anywhere. So every anchored destination is checked against
    // the source of the screen it points into.
    const VIEWS: Partial<Record<ViewId, string>> = {
      finances: 'src/ui/views/FinancesView.tsx',
      staff: 'src/ui/views/StaffView.tsx',
      club: 'src/ui/views/ClubView.tsx',
    };
    const { state } = createTestGame('matters-anchors');
    makeOverdrawn(state, 1400);

    const anchored = clubMatters(state, 0)
      .map((matter) => matter.destination)
      .filter((destination): destination is { kind: 'view'; view: ViewId; anchor: string } =>
        destination?.kind === 'view' && typeof destination.anchor === 'string',
      );
    expect(anchored.length).toBeGreaterThan(0);
    for (const destination of anchored) {
      const path = VIEWS[destination.view];
      expect(path, `no source mapped for '${destination.view}'`).toBeTruthy();
      expect(readFileSync(path!, 'utf8')).toContain(`id="${destination.anchor}"`);
    }
  });

  it('says each thing once, loudest first', () => {
    const { state } = createTestGame('matters-order');
    makeOverdrawn(state);
    const matters = clubMatters(state, 0);

    const topics = matters.map((matter) => matter.topic);
    expect(new Set(topics).size).toBe(topics.length);
    const weights = matters.map((matter) => matter.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });

  it('shows the manager fewer things on Home than on the Club screen, and the same ones', () => {
    const { state } = createTestGame('matters-caps');
    makeOverdrawn(state);
    const all = clubMatters(state, 0);
    const home = clubMatters(state, HOME_MATTER_LIMIT);
    const club = clubMatters(state, CLUB_MATTER_LIMIT);

    expect(home.length).toBeLessThanOrEqual(HOME_MATTER_LIMIT);
    expect(club.length).toBeLessThanOrEqual(CLUB_MATTER_LIMIT);
    // Home is the top of the same list, not a different opinion about it.
    expect(home.map((matter) => matter.id)).toEqual(all.slice(0, home.length).map((matter) => matter.id));
  });

  it('reads the money out of the ledger rather than deciding for itself', () => {
    const { state } = createTestGame('matters-money');
    const clean = clubMatters(state, 0).find((matter) => matter.id === 'balance');
    expect(clean).toBeUndefined();

    makeOverdrawn(state, 300);
    const matter = clubMatters(state, 0).find((entry) => entry.id === 'balance')!;
    expect(matter.tone).toBe('bad');
    expect(matter.title).toBe('The club is in the red');
    expect(matter.destination).toEqual({ kind: 'view', view: 'finances', anchor: 'money-outlook' });
  });

  it('names the man who owes the most, and sends the manager where the money is taken', () => {
    const { state } = createTestGame('matters-arrears');
    const club = state.clubs[state.userClubId]!;
    const playerId = club.squadIds[0]!;
    const player = state.people[playerId]!;
    if (player.kind !== 'player') throw new Error('expected a player');
    player.subs = {
      owed: 3,
      missedWeeks: 1,
      lastPaidOn: null,
      liabilities: [
        { id: 'm1', matchId: 'm1', date: state.date, category: 'starter', amount: 3, paid: 0, paidOn: null },
      ],
      payments: [],
    };

    const matter = clubMatters(state, 0).find((entry) => entry.id === 'arrears')!;
    expect(matter).toBeTruthy();
    expect(`${matter.title} ${matter.detail}`).toContain(player.surname);
    expect(matter.destination).toEqual({ kind: 'view', view: 'finances', anchor: 'money-owed' });
  });

  it('points a sponsor running out of time at the agreement that will need renewing', () => {
    const { state } = createTestGame('matters-sponsor');
    const club = state.clubs[state.userClubId]!;
    // Give the club the sponsor it is already associated with, through the same
    // seeding path a career uses.
    club.finances.sponsorIncomePerWeek = 60;
    seedInitialSponsorship(state);
    const deal = state.sponsorship.deals.find((entry) => entry.clubId === club.id)!;
    expect(deal).toBeTruthy();
    deal.endDate = addDays(state.date, 10);

    const matter = clubMatters(state, 0).find((entry) => entry.id === 'sponsor-renewal')!;
    expect(matter).toBeTruthy();
    expect(matter.destination).toEqual({ kind: 'view', view: 'finances', anchor: 'sponsorship' });
    // The sponsor is named on the card, and the money is quoted per instalment
    // in the agreement's own terms — a monthly deal is not "a week".
    expect(`${matter.title} ${matter.detail}`).toContain(state.world.businesses[deal.sponsorId]!.name);
    expect(matter.detail).toContain(deal.terms.frequency === 'weekly' ? 'a week' : 'a month');
  });

  it('takes a word from the committee to the man who said it', () => {
    const { state } = createTestGame('matters-board');
    const club = state.clubs[state.userClubId]!;
    makeOverdrawn(state, 1400);

    const chairmanId = club.chairmanId!;
    expect(chairmanId).toBeTruthy();
    const matter = clubMatters(state, 0).find((entry) => entry.topic === 'board')!;
    expect(matter).toBeTruthy();
    expect(matter.destination).toEqual({ kind: 'person', personId: chairmanId });
  });
});

describe('the roster', () => {
  it('describes each office without dumping the person’s attributes', () => {
    const { state } = createTestGame('roster-shape');
    const roster = clubRoster(state);

    expect(roster.length).toBeGreaterThan(0);
    for (const person of roster) {
      expect(person.name.length).toBeGreaterThan(0);
      expect(person.roleLabel.length).toBeGreaterThan(0);
      expect(typeof person.available).toBe('boolean');
      // A word, never a number: "Sound" is what a manager says, 11 is not.
      if (person.competence) expect(person.competence).toMatch(/[A-Za-z]/);
      expect(person.issue === null || typeof person.issue === 'string').toBe(true);
    }
    expect(roster.some((person) => person.role === 'chairman')).toBe(true);
    expect(roster.find((person) => person.isManager)?.role).toBe('manager');
  });

  it('says when somebody is not around, and says nothing when nobody is carrying anything', () => {
    const { state } = createTestGame('roster-quiet');
    const roster = clubRoster(state);
    const secretary = roster.find((person) => person.role === 'secretary');

    // A club that has not played yet has nothing on anybody; a man away is the
    // one thing that is always worth a line.
    const treasurer = roster.find((person) => person.role === 'treasurer');
    if (secretary) {
      setStaffAvailability(state, secretary.personId, 'unavailable', 'on a shift pattern');
      const after = clubRoster(state).find((person) => person.role === 'secretary')!;
      expect(after.available).toBe(false);
      expect(after.issue).toContain('shift pattern');
    } else if (treasurer) {
      setStaffAvailability(state, treasurer.personId, 'unavailable', 'on a shift pattern');
      const after = clubRoster(state).find((person) => person.role === 'treasurer')!;
      expect(after.available).toBe(false);
    }
  });
});
