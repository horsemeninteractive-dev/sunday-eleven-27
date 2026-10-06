import { describe, expect, it } from 'vitest';
import type { Message } from '@/domain/communication';
import { MANAGER_PERSON_ID } from '@/domain/communication';
import type { GameState } from '@/domain/game';
import type { ISODate } from '@/domain/ids';
import { refreshSubSummary, type Official, type Player } from '@/domain/person';
import { emptyClubStaff } from '@/domain/staff';
import { addDays, dayOfWeek } from '@/simulation/calendar';
import { addLedgerEntry } from '@/simulation/finance';
import { postponeFixture } from '@/simulation/postponement';
import { nextFixtureFor } from '@/simulation/schedule';
import { runSecretary } from '@/simulation/secretary';
import { setStaffAvailability } from '@/simulation/staff';
import { getRelationship } from '@/simulation/relationships';
import { sponsorshipSummary } from '@/simulation/sponsorship';
import { createTestGame } from '@/simulation/testSupport';
import { conversationCanSettleADebt, sendPaymentMessage } from './paymentComms';
import { communicationStore } from './store';
import {
  ensureOrganisationConsequences,
  officeRoleOf,
  officerFor,
  runOrganisationComms,
  sendOrganisationMessage,
  type OfficeRole,
} from './organisationComms';

/**
 * The club organisation, talking.
 *
 * These are the chains the whole layer exists to make true: a debt that reaches
 * the treasurer and stops with the words; a fixture the league moved that the
 * manager hears about once; a club in trouble that brings the chairman out; a
 * staff member who cannot come in; a sponsor moving towards renewal; a promise
 * that changes nothing. Every one of them ends in the same assertion — the
 * *systems* are authoritative and the conversation only reports them.
 */

/* ------------------------------------------------------------------------ *\
 * Fixtures for the tests
 * ------------------------------------------------------------------------ */

/** Everybody who ran the club, with the manager included, get the whole crew. */
function makeOfficial(state: GameState, role: OfficeRole): Official {
  const id = `test_${role}`;
  const official: Official = {
    id,
    kind: 'official',
    firstName: role.charAt(0).toUpperCase() + role.slice(1),
    surname: 'Test',
    age: 48,
    townId: null,
    occupation: 'Volunteer',
    reputation: 40,
    roles: [{ clubId: state.userClubId, role, since: state.date }],
    role,
    clubId: state.userClubId,
    attributes: {
      coaching: 10,
      manManagement: 10,
      motivation: 10,
      tacticalKnowledge: 10,
      recruitmentEye: 10,
      organisation: 10,
    },
    patience: 60,
    notes: [],
  };
  state.people[id] = official;
  return official;
}

/** A person in the role, made if the generated backroom was short of one. */
function ensureOfficer(state: GameState, role: OfficeRole): Official {
  const existing = officerFor(state, role);
  const club = state.clubs[state.userClubId]!;
  // A person who holds several offices resolves to the senior one, so this suite
  // needs somebody who holds *this* office and nothing above it — otherwise the
  // chairman who also keeps the book would answer as the chairman.
  if (existing && officeRoleOf(state, existing.id) === role) return existing;

  const official = makeOfficial(state, role);
  if (!club.staff) club.staff = emptyClubStaff();
  if (role === 'chairman') club.chairmanId = official.id;
  else if (role === 'treasurer') club.staff.treasurerId = official.id;
  else if (role === 'secretary') club.staff.secretaryId = official.id;
  else if (role === 'assistant') club.staff.assistantId = official.id;
  else if (role === 'physio') club.staff.physioId = official.id;
  else if (role === 'coach') club.staff.coachIds = [official.id];
  else if (role === 'scout') club.staff.scoutIds = [official.id];
  return official;
}

/** Everything a person has sent to the manager across every thread. */
function messagesFrom(state: GameState, personId: string): Message[] {
  const out: Message[] = [];
  for (const conversation of Object.values(communicationStore(state).conversations)) {
    for (const message of conversation.messages) {
      if (message.senderId === personId && message.direction === 'inbound') out.push(message);
    }
  }
  return out;
}

/** A player of the user's club, owing a given amount on one match liability. */
function oweSubs(state: GameState, index: number, amount: number): Player {
  const club = state.clubs[state.userClubId]!;
  const playerId = club.squadIds[index]!;
  const player = state.people[playerId] as Player;
  player.subs = {
    owed: 0,
    missedWeeks: 0,
    lastPaidOn: null,
    liabilities: [
      { id: `test-match:${playerId}`, matchId: 'test-match', date: state.date, category: 'starter', amount, paid: 0, paidOn: null },
    ],
    payments: [],
  };
  refreshSubSummary(player.subs);
  return player;
}

/** The next date that falls on a given weekday (0 = Sunday). */
function nextWeekday(from: ISODate, weekday: number): ISODate {
  return addDays(from, (weekday - dayOfWeek(from) + 7) % 7);
}

/* ------------------------------------------------------------------------ *\
 * The chains
 * ------------------------------------------------------------------------ */

describe('the club organisation in conversation', () => {
  it('chain 1 — a man owing subs reaches the treasurer, who tells the manager once', () => {
    const { state } = createTestGame('org-chain-1');
    const treasurer = ensureOfficer(state, 'treasurer');
    oweSubs(state, 0, 3);

    runOrganisationComms(state, state.date);

    const arrears = messagesFrom(state, treasurer.id).filter((message) => message.context.concern === 'arrears');
    expect(arrears).toHaveLength(1);
    expect(arrears[0]!.body).toContain('£3');
    expect(arrears[0]!.context.amount).toBe(3);

    // The same fact does not become a second message.
    runOrganisationComms(state, state.date);
    expect(messagesFrom(state, treasurer.id).filter((message) => message.context.concern === 'arrears')).toHaveLength(1);
  });

  it('chain 2 & 7 — a called-off fixture is explained once, and the record moves exactly once', () => {
    const { state } = createTestGame('org-chain-2');
    const secretary = ensureOfficer(state, 'secretary');
    const match = nextFixtureFor(state, state.userClubId)!;

    const replacement = postponeFixture(state, match, state.date, 'Standing water in the goalmouth');
    expect(match.status).toBe('postponed');
    expect(replacement).toBeTruthy();
    expect(match.replacedByMatchId).toBe(replacement!.id);

    runSecretary(state, state.date);
    runOrganisationComms(state, state.date);

    const notices = messagesFrom(state, secretary.id).filter((message) => message.context.category === 'fixture-admin');
    expect(notices).toHaveLength(1);
    expect(notices[0]!.body.toLowerCase()).toContain('standing water');

    // Revisited, the day says nothing new — and the authoritative fixture has not
    // moved a second time.
    runOrganisationComms(state, state.date);
    expect(messagesFrom(state, secretary.id).filter((message) => message.context.category === 'fixture-admin')).toHaveLength(1);
    expect(state.matches[match.id]!.replacedByMatchId).toBe(replacement!.id);
    expect(Object.values(state.matches).filter((entry) => entry.originalDate === match.date && entry.id !== match.id)).toHaveLength(1);
  });

  it('chain 3 — a club in the red brings the chairman out', () => {
    const { state } = createTestGame('org-chain-3');
    const chairman = ensureOfficer(state, 'chairman');
    const club = state.clubs[state.userClubId]!;
    // Push the club genuinely into the red — past the committee's own threshold —
    // through the ledger, which stays the authority on the balance.
    addLedgerEntry(state, state.userClubId, {
      date: state.date,
      description: 'Emergency roof repair',
      category: 'other',
      amount: -(club.finances.balance + 800),
    });
    expect(club.finances.balance).toBeCloseTo(-800);

    runOrganisationComms(state, state.date);

    const concern = messagesFrom(state, chairman.id).find(
      (message) => typeof message.context.concern === 'string' && message.context.concern.includes('finances'),
    );
    expect(concern).toBeTruthy();
    expect(concern!.priority).toBe('important');
  });

  it('chain 4 — a staff member who cannot come in says so, once, on the Monday', () => {
    const { state } = createTestGame('org-chain-4');
    const physio = ensureOfficer(state, 'physio');
    setStaffAvailability(state, physio.id, 'unavailable', 'on a shift pattern');

    const monday = nextWeekday(state.date, 1);
    runOrganisationComms(state, monday);

    const away = messagesFrom(state, physio.id).filter((message) => message.context.away === 'yes');
    expect(away).toHaveLength(1);
    expect(away[0]!.body).toContain('shift pattern');

    runOrganisationComms(state, monday);
    expect(messagesFrom(state, physio.id).filter((message) => message.context.away === 'yes')).toHaveLength(1);
  });

  it('chain 5 — a deal coming up for renewal reaches the manager through the chairman', () => {
    const { state } = createTestGame('org-chain-5');
    const chairman = ensureOfficer(state, 'chairman');
    const summary = sponsorshipSummary(state);
    expect(summary.deal).toBeTruthy();
    summary.deal!.endDate = addDays(state.date, 10);

    runOrganisationComms(state, state.date);

    const renewal = messagesFrom(state, chairman.id).filter((message) => message.context.kind === 'renewal');
    expect(renewal).toHaveLength(1);
    expect(renewal[0]!.body).toContain(summary.sponsorName!);

    runOrganisationComms(state, state.date);
    expect(messagesFrom(state, chairman.id).filter((message) => message.context.kind === 'renewal')).toHaveLength(1);
  });

  it('chain 6 — a man saying he will pay is not a payment', () => {
    const { state } = createTestGame('org-chain-6');
    const player = oweSubs(state, 0, 6);
    const before = player.subs.owed;
    expect(before).toBe(6);

    const sent = sendPaymentMessage(state, player.id, 'ASK_PAYMENT');
    expect(sent).toBeTruthy();
    expect(player.subs.owed).toBe(before);
    expect(conversationCanSettleADebt()).toBe(false);
  });

  it('chain 8 — the treasurer quotes the ledger, not a figure of his own', () => {
    const { state } = createTestGame('org-chain-8');
    const treasurer = ensureOfficer(state, 'treasurer');
    addLedgerEntry(state, state.userClubId, { date: state.date, description: 'Gate money', category: 'matchday', amount: 137 });
    const balance = state.clubs[state.userClubId]!.finances.balance;

    const sent = sendOrganisationMessage(state, treasurer.id, 'ASK_FINANCES');

    expect(sent?.reply).toBeTruthy();
    expect(sent!.reply!.body).toContain(`£${Math.round(balance)}`);
    expect(sent!.reply!.context.balance).toBe(Math.round(balance * 100) / 100);
  });

  /* -------------------------------------------------------------------- *\
   * The consequence rule, and the things it forbids
   * -------------------------------------------------------------------- */

  it('asking about the bills settles the invoice through the ledger, exactly once', () => {
    const { state } = createTestGame('org-chain-bills');
    const club = state.clubs[state.userClubId]!;
    const treasurer = ensureOfficer(state, 'treasurer');
    club.finances.weeklyGroundCost = Math.max(club.finances.weeklyGroundCost, 40);
    // Clear any pitch-hire already in the book, so the invoice is genuinely unpaid.
    club.finances.ledger = club.finances.ledger.filter((line) => line.category !== 'pitch-hire');
    const line = (): number => club.finances.ledger.filter((entry) => entry.category === 'pitch-hire').length;
    expect(line()).toBe(0);

    ensureOrganisationConsequences();
    const first = sendOrganisationMessage(state, treasurer.id, 'ASK_BILLS');
    expect(line()).toBe(1);
    expect(first?.reply?.body.toLowerCase()).toContain('settled');

    sendOrganisationMessage(state, treasurer.id, 'ASK_BILLS');
    expect(line()).toBe(1);
  });

  it('the chairman speaks about the money from the club’s own position', () => {
    const { state } = createTestGame('org-chairman-money');
    const chairman = ensureOfficer(state, 'chairman');
    const sent = sendOrganisationMessage(state, chairman.id, 'DISCUSS_FINANCES');
    expect(sent?.reply).toBeTruthy();
    expect(sent!.reply!.context.balance).toBe(Math.round(state.clubs[state.userClubId]!.finances.balance * 100) / 100);
  });

  it('talking about the money does not move it', () => {
    const { state } = createTestGame('org-no-money');
    const treasurer = ensureOfficer(state, 'treasurer');
    const before = state.clubs[state.userClubId]!.finances.balance;
    sendOrganisationMessage(state, treasurer.id, 'ASK_FINANCES');
    sendOrganisationMessage(state, treasurer.id, 'ASK_ARREARS');
    sendOrganisationMessage(state, treasurer.id, 'ASK_TAKINGS');
    expect(state.clubs[state.userClubId]!.finances.balance).toBe(before);
  });

  it('a word with an officer moves the relationship through the existing service', () => {
    const { state } = createTestGame('org-relationship');
    const secretary = ensureOfficer(state, 'secretary');
    sendOrganisationMessage(state, secretary.id, 'ASK_LEAGUE_NEWS');
    expect(getRelationship(state, MANAGER_PERSON_ID, secretary.id)).toBeTruthy();
  });

  it('knows which office each person holds', () => {
    const { state } = createTestGame('org-roles');
    const treasurer = ensureOfficer(state, 'treasurer');
    const chairman = ensureOfficer(state, 'chairman');
    expect(officeRoleOf(state, treasurer.id)).toBe('treasurer');
    expect(officeRoleOf(state, chairman.id)).toBe('chairman');
    // The manager's own id is not an office.
    expect(officeRoleOf(state, MANAGER_PERSON_ID)).toBeNull();
  });
});
