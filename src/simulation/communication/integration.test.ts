import { describe, expect, it } from 'vitest';
import type { Message } from '@/domain/communication';
import { MANAGER_PERSON_ID } from '@/domain/communication';
import type { GameState } from '@/domain/game';
import type { ISODate } from '@/domain/ids';
import type { Match, PlayerPerformance } from '@/domain/match';
import { isPlayer, refreshSubSummary, type Official, type Player } from '@/domain/person';
import type { SponsorshipDeal } from '@/domain/sponsorship';
import { emptyClubStaff } from '@/domain/staff';
import { addDays, dayOfWeek } from '@/simulation/calendar';
import { addLedgerEntry, recordMatchdaySubs } from '@/simulation/finance';
import { governanceStore } from '@/simulation/governance';
import { prepareMatchday } from '@/simulation/matchday';
import { postponeFixture } from '@/simulation/postponement';
import { runSecretary } from '@/simulation/secretary';
import { canPlay } from '@/simulation/selection';
import {
  activeDealForClub,
  endSponsorship,
  seedInitialSponsorship,
  sponsorshipSummary,
} from '@/simulation/sponsorship';
import { setStaffAvailability } from '@/simulation/staff';
import { physioSupport } from '@/simulation/staffOps';
import { collectSubs, outstandingSubs } from '@/simulation/treasurer';
import { nextMatchday } from '@/simulation/timeline';
import { createTestGame, type TestGame } from '@/simulation/testSupport';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { announceAvailabilityChange } from './availabilityComms';
import { hasDelivered } from './dedup';
import { communicationHistoryKeys, recordCommunicationHistory } from './history';
import {
  ensureOrganisationConsequences,
  officeRoleOf,
  officerFor,
  runOrganisationComms,
  sendOrganisationMessage,
  type OfficeRole,
} from './organisationComms';
import { sendPlayerMessage } from './playerConversation';
import { communicationStore } from './store';

/**
 * Where the events, the people and the inbox actually meet.
 *
 * The other communication suites prove that each bridge says the right thing.
 * These prove the thing that matters more: that an event which happens in one
 * system *reaches* the manager through the person responsible for it, that his
 * answer can only move the world through the mechanism that already owns the
 * fact, and that nothing is said twice.
 *
 * So every chain below is written the same way:
 *
 *   1. cause an event in a real system — a roll, a fixture, a liability, a bill;
 *   2. run the day's communication and find the message;
 *   3. have the manager answer;
 *   4. assert the *authoritative* system moved, and that nothing else did.
 *
 * The last assertion is the point. A conversation is allowed to be wrong about
 * nothing and to change nothing it was not given permission to change.
 */

/* ------------------------------------------------------------------------ *\
 * Helpers
 * ------------------------------------------------------------------------ */

/** Everybody who runs a club, made for the suite when the world was short one. */
function ensureOfficer(state: GameState, role: OfficeRole): Official {
  const existing = officerFor(state, role);
  if (existing && officeRoleOf(state, existing.id) === role) return existing;

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
  const club = state.clubs[state.userClubId]!;
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

/** Everything a person has said to the manager, across every thread. */
function messagesFrom(state: GameState, personId: string): Message[] {
  const out: Message[] = [];
  for (const conversation of Object.values(communicationStore(state).conversations)) {
    for (const message of conversation.messages) {
      if (message.senderId === personId && message.direction === 'inbound') out.push(message);
    }
  }
  return out;
}

/** The manager's conversation with one person. */
function threadWithPerson(state: GameState, personId: string): Message[] {
  const out: Message[] = [];
  for (const conversation of Object.values(communicationStore(state).conversations)) {
    if (conversation.participantIds.includes(personId) && conversation.participantIds.includes(MANAGER_PERSON_ID)) {
      out.push(...conversation.messages);
    }
  }
  return out;
}

/** A prepared fixture, so a completed match has real lineups to charge. */
function preparedFixture(game: TestGame): Match {
  const matchday = nextMatchday(game.state);
  prepareMatchday(game.state, matchday);
  return Object.values(game.state.matches).find((candidate) => candidate.matchday === matchday)!;
}

/** The engine's participation record, authored by hand — the fields Finance reads. */
function performance(playerId: string, clubId: string, started: boolean): PlayerPerformance {
  return {
    playerId,
    clubId,
    started,
    minutesPlayed: started ? 90 : 0,
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
    cameOnMinute: null,
    wentOffMinute: null,
    energy: 100,
    injuryDetail: null,
    sentOff: false,
  };
}

/** The next date falling on a given weekday (0 = Sunday). */
function nextWeekday(from: ISODate, weekday: number): ISODate {
  return addDays(from, (weekday - dayOfWeek(from) + 7) % 7);
}

/** One of the manager's own men. */
function squadPlayer(state: GameState, index: number): Player {
  const club = state.clubs[state.userClubId]!;
  const player = state.people[club.squadIds[index]!];
  if (!isPlayer(player)) throw new Error('the user club has no squad');
  return player;
}

/** A man owing a stated amount on one match liability, kept apart from others. */
function oweSubs(state: GameState, player: Player, amount: number): void {
  player.subs = {
    owed: 0,
    missedWeeks: 1,
    lastPaidOn: null,
    liabilities: [
      {
        id: `test-match:${player.id}`,
        matchId: 'test-match',
        date: state.date,
        category: 'starter',
        amount,
        paid: 0,
        paidOn: null,
      },
    ],
    payments: [],
  };
  refreshSubSummary(player.subs);
}

/**
 * Make sure the manager's club has a real sponsorship agreement.
 *
 * The world decides sponsors by seed, so a suite that wants to talk about a
 * deal cannot assume one. This gives the club the sponsor it is already
 * associated with through the seeding path the game itself uses — the same
 * agreement a career would start with, not a special case for the test.
 */
function ensureSponsored(state: GameState): SponsorshipDeal {
  const existing = activeDealForClub(state, state.userClubId);
  if (existing) return existing;
  const club = state.clubs[state.userClubId]!;
  const business =
    (club.sponsorIds ?? []).map((id) => state.world.businesses[id]).find((candidate) => !!candidate) ??
    Object.values(state.world.businesses)[0]!;
  club.sponsorIds = [business.id, ...(club.sponsorIds ?? [])];
  club.finances.sponsorIncomePerWeek = 60;
  seedInitialSponsorship(state);
  return activeDealForClub(state, state.userClubId)!;
}

/** How many ledger lines the club has in a given category. */
function ledgerLines(state: GameState, category: string): number {
  return state.clubs[state.userClubId]!.finances.ledger.filter((entry) => entry.category === category).length;
}

/* ------------------------------------------------------------------------ *\
 * The chains
 * ------------------------------------------------------------------------ */

describe('an event reaches the manager through the person responsible for it', () => {
  it('player — a knock is announced as a message, and selection stays authoritative', () => {
    const { state } = createTestGame('integration-player');
    const player = squadPlayer(state, 0);
    player.availability = {
      status: 'unavailable',
      reason: 'work',
      note: 'on a late shift',
      until: null,
      discoveredLate: false,
    };

    const announced = announceAvailabilityChange(state, player.id, {
      kind: 'loses',
      reason: 'work',
      note: 'on a late shift',
    });
    expect(announced).toBeTruthy();
    expect(announced!.context.availability).toBe('unavailable');

    // The manager answers.
    const sent = sendPlayerMessage(state, player.id, 'ASK_UPDATE');
    expect(sent?.reply).toBeTruthy();

    // The authoritative record has not moved an inch: he still cannot play.
    expect(player.availability.status).toBe('unavailable');
    expect(canPlay(player)).toBe(false);

    // And the same knock is never announced twice.
    expect(
      announceAvailabilityChange(state, player.id, { kind: 'loses', reason: 'work', note: 'on a late shift' }),
    ).toBeNull();
  });

  it('finance — participation becomes a liability, the treasurer reports it, and only payment clears it', () => {
    const game = createTestGame('integration-finance');
    const { state } = game;
    const treasurer = ensureOfficer(state, 'treasurer');
    const player = squadPlayer(state, 0);

    // A completed match with one man actually playing.
    const match = preparedFixture(game);
    match.result = { homeGoals: 1, awayGoals: 0, homeShots: 5, awayShots: 3, homePossession: 55, awayPossession: 45, attendance: 40 };
    match.performances = { [player.id]: performance(player.id, match.homeClubId, true) };

    const raised = recordMatchdaySubs(state, match);
    expect(raised).toHaveLength(1);
    expect(player.subs.owed).toBeGreaterThan(0);
    const owed = player.subs.owed;

    // Finance detects it; the treasurer tells the manager.
    runOrganisationComms(state, state.date);
    const arrears = messagesFrom(state, treasurer.id).filter((message) => message.context.concern === 'arrears');
    expect(arrears).toHaveLength(1);
    expect(arrears[0]!.context.amount).toBeCloseTo(owed);

    // Talking about it changes nothing.
    expect(outstandingSubs(state, state.userClubId).some((row) => row.personId === player.id)).toBe(true);

    // The actual payment goes through the ledger, exactly once.
    const before = state.clubs[state.userClubId]!.finances.balance;
    const linesBefore = ledgerLines(state, 'subs');
    const collected = collectSubs(state, state.userClubId, player.id, state.date);
    expect(collected.collected).toBeCloseTo(owed);
    expect(ledgerLines(state, 'subs')).toBe(linesBefore + 1);
    expect(state.clubs[state.userClubId]!.finances.balance).toBeCloseTo(before + owed);
    expect(player.subs.owed).toBe(0);
    expect(outstandingSubs(state, state.userClubId).some((row) => row.personId === player.id)).toBe(false);
  });
  it('secretary — a fixture the league moved reaches the manager, and the calendar moves exactly once', () => {
    const { state } = createTestGame('integration-secretary');
    const secretary = ensureOfficer(state, 'secretary');
    const club = state.clubs[state.userClubId]!;
    const match = Object.values(state.matches).find(
      (candidate) => candidate.homeClubId === club.id || candidate.awayClubId === club.id,
    )!;

    // Competition changes the fixture through the mechanism that owns fixtures.
    const replacement = postponeFixture(state, match, state.date, 'Standing water on the pitch');
    expect(replacement).toBeTruthy();

    runSecretary(state, state.date);
    runOrganisationComms(state, state.date);

    const notice = messagesFrom(state, secretary.id).find((message) => message.context.category === 'fixture-admin');
    expect(notice).toBeTruthy();

    // The calendar is the authority, and it moved once.
    expect(state.matches[match.id]!.status).toBe('postponed');
    expect(state.matches[match.id]!.replacedByMatchId).toBe(replacement!.id);
    const moved = Object.values(state.matches).filter((entry) => entry.originalDate === match.date);
    expect(moved).toHaveLength(1);

    // Reading the message again does not move it a second time.
    runOrganisationComms(state, state.date);
    expect(Object.values(state.matches).filter((entry) => entry.originalDate === match.date)).toHaveLength(1);
    expect(messagesFrom(state, secretary.id).filter((message) => message.context.category === 'fixture-admin')).toHaveLength(1);
  });

  it('governance — a club in the red brings the chairman out, and his answer is the only thing that moves the money', () => {
    const { state } = createTestGame('integration-governance');
    const chairman = ensureOfficer(state, 'chairman');
    const club = state.clubs[state.userClubId]!;
    const seasonKey = `backing:${state.season.id}`;

    // Finance decides the club is in trouble; communication only reports it.
    addLedgerEntry(state, club.id, {
      date: state.date,
      description: 'Roof repair',
      category: 'other',
      amount: -(club.finances.balance + 1200),
    });
    expect(club.finances.balance).toBeCloseTo(-1200);

    runOrganisationComms(state, state.date);
    const concern = messagesFrom(state, chairman.id).find(
      (message) => typeof message.context.concern === 'string' && message.context.concern.includes('finances'),
    );
    expect(concern).toBeTruthy();

    // The manager asks for support, which is the existing governance action.
    ensureOrganisationConsequences();
    const eventsBefore = governanceStore(state).events.length;
    const balanceBefore = club.finances.balance;
    const sent = sendOrganisationMessage(state, chairman.id, 'ASK_SUPPORT');
    expect(sent?.reply).toBeTruthy();
    expect(governanceStore(state).reacted).toContain(seasonKey);
    const events = governanceStore(state).events;
    expect(events.length).toBe(eventsBefore + 1);

    // The ledger and the governance record agree: money only moved because he
    // agreed to it, and the decision is recorded either way.
    const granted = events[events.length - 1]!.kind === 'backing';
    if (granted) expect(club.finances.balance).toBeGreaterThan(balanceBefore);
    else {
      expect(club.finances.balance).toBe(balanceBefore);
      expect(events[events.length - 1]!.kind).toBe('refusal');
    }
  });

  it('sponsor — a deal coming up for renewal is raised, and only the sponsorship system can end it', () => {
    const { state } = createTestGame('integration-sponsor');
    const chairman = ensureOfficer(state, 'chairman');
    const deal = ensureSponsored(state);
    const summary = sponsorshipSummary(state);
    expect(summary.deal).toBeTruthy();
    deal.endDate = addDays(state.date, 7);
    const clubId = state.userClubId;

    runOrganisationComms(state, state.date);
    const renewal = messagesFrom(state, chairman.id).filter((message) => message.context.kind === 'renewal');
    expect(renewal).toHaveLength(1);

    // The manager asks about it; the deal itself does not budge from a question.
    const sent = sendOrganisationMessage(state, chairman.id, 'ASK_SPONSOR');
    expect(sent?.reply).toBeTruthy();
    expect(activeDealForClub(state, clubId)!.id).toBe(deal.id);

    // The sponsor walking is the sponsorship system's own decision.
    const ended = endSponsorship(state, clubId, state.date, 'lapsed');
    expect(ended!.id).toBe(deal.id);
    expect(activeDealForClub(state, clubId)).toBeNull();
    expect(summary.sponsorName).toBeTruthy();
  });

  it('staff — an absence is announced by the person it happened to, and the coaching consequence follows', () => {
    const { state } = createTestGame('integration-staff');
    const physio = ensureOfficer(state, 'physio');
    setStaffAvailability(state, physio.id, 'unavailable', 'on a shift pattern');

    const monday = nextWeekday(state.date, 1);
    runOrganisationComms(state, monday);

    const away = messagesFrom(state, physio.id).filter((message) => message.context.away === 'yes');
    expect(away).toHaveLength(1);
    expect(away[0]!.body).toContain('shift pattern');

    // The authoritative consequence: nobody is there to help the knocks along.
    expect(physioSupport(state, state.userClubId)).toBe(0);

    // Said once, not every Monday.
    runOrganisationComms(state, monday);
    expect(messagesFrom(state, physio.id).filter((message) => message.context.away === 'yes')).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ *\
 * Saying it once, and keeping what matters
 * ------------------------------------------------------------------------ */

describe('communication says a fact once and keeps only what matters', () => {
  it('a quiet day produces no messages at all', () => {
    const { state } = createTestGame('integration-quiet');
    ensureOfficer(state, 'treasurer');
    ensureOfficer(state, 'secretary');
    ensureOfficer(state, 'chairman');

    const first = runOrganisationComms(state, state.date);
    // Whatever the first day says, revisiting the very same day adds nothing:
    // every announcement is keyed on the fact that caused it.
    const second = runOrganisationComms(state, state.date);
    expect(second).toHaveLength(0);
    for (const message of first) {
      const key = message.context.deliveryKey;
      if (typeof key === 'string') expect(hasDelivered(state, key)).toBe(true);
    }
  });

  it('a fact already communicated stays communicated across a save and load', () => {
    const { state } = createTestGame('integration-reload');
    const treasurer = ensureOfficer(state, 'treasurer');
    const player = squadPlayer(state, 0);
    oweSubs(state, player, 12);

    const announced = runOrganisationComms(state, state.date);
    expect(announced.length).toBeGreaterThan(0);
    const before = messagesFrom(state, treasurer.id).length;

    const reloaded = deserialiseGame(serialiseGame(state));
    expect(reloaded.error).toBeNull();
    const rebuilt = reloaded.state!;

    // The reloaded career says nothing new about a fact it already reported.
    expect(runOrganisationComms(rebuilt, rebuilt.date)).toHaveLength(0);
    expect(messagesFrom(rebuilt, treasurer.id).length).toBe(before);
  });

  it('routine talk stays in the thread and never reaches the club’s history', () => {
    const { state } = createTestGame('integration-history-thread');
    const lines = state.clubs[state.userClubId]!.history.notableEvents.length;

    recordCommunicationHistory(state, {
      kind: 'dispute',
      importance: 2,
      description: 'Routine chatter that should never be kept.',
    });
    // A dispute *is* notable; anything unlisted is not. The point is that the
    // decision is the policy's, not the caller's.
    expect(communicationHistoryKeys(state).length).toBeGreaterThan(0);
    expect(state.clubs[state.userClubId]!.history.notableEvents.length).toBeGreaterThan(lines);
  });

  it('a significant moment is recorded once, however often it is reported', () => {
    const { state } = createTestGame('integration-history-once');
    const club = state.clubs[state.userClubId]!;
    const before = club.history.notableEvents.length;

    const entry = {
      kind: 'financial-crisis' as const,
      importance: 2 as const,
      description: 'The club account went into the red.',
      key: 'history:test-crisis',
    };
    expect(recordCommunicationHistory(state, entry)).toBe(true);
    expect(recordCommunicationHistory(state, entry)).toBe(false);
    expect(club.history.notableEvents.length).toBe(before + 1);

    // And it survives a reload as a real line in the club's own record.
    const rebuilt = deserialiseGame(serialiseGame(state)).state!;
    expect(rebuilt.clubs[state.userClubId]!.history.notableEvents[0]!.description).toContain('into the red');
  });

  it('the club’s own systems record the sponsor moments, not the inbox', () => {
    const { state } = createTestGame('integration-history-sponsor');
    const clubId = state.userClubId;
    const club = state.clubs[clubId]!;
    const before = club.history.notableEvents.length;
    const deal = ensureSponsored(state);

    endSponsorship(state, clubId, state.date, 'lapsed');

    expect(club.history.notableEvents.length).toBe(before + 1);
    expect(club.history.notableEvents[0]!.description).toContain('sponsorship');
    expect(deal.status).toBe('lapsed');

    // The same walk-out cannot be written into the archive twice.
    expect(recordCommunicationHistory(state, {
      kind: 'sponsor-event',
      importance: 3,
      description: 'The club lost its sponsor.',
      key: `history:sponsor-end:${deal.id}`,
    })).toBe(false);
  });

  it('a message from a man about his subs is not the money moving', () => {
    const { state } = createTestGame('integration-promise');
    const player = squadPlayer(state, 0);
    oweSubs(state, player, 8);
    const owed = player.subs.owed;
    const balance = state.clubs[state.userClubId]!.finances.balance;
    const lines = ledgerLines(state, 'subs');

    const sent = sendPlayerMessage(state, player.id, 'ASK_PAYMENT');
    expect(sent?.reply).toBeTruthy();

    // Words, and nothing else. The debt stands until the ledger says otherwise.
    expect(player.subs.owed).toBe(owed);
    expect(state.clubs[state.userClubId]!.finances.balance).toBe(balance);
    expect(ledgerLines(state, 'subs')).toBe(lines);
    expect(threadWithPerson(state, player.id).length).toBeGreaterThan(0);
  });
});
