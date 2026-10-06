import { describe, expect, it } from 'vitest';
import { isCompetitiveMatch, type Match } from '@/domain/match';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { addDays, formatDayMonth } from './calendar';
import { processDay } from './day';
import { ledgerBalances } from './finance';
import { postponeFixture } from './postponement';
import { scheduleStore } from './schedule';
import { setStaffAvailability } from './staff';
import { createTestGame, type TestGame } from './testSupport';
import {
  clubSecretary,
  filedAdmin,
  outstandingAdmin,
  overdueAdmin,
  resolveAdminEvent,
  runSecretary,
  secretaryStore,
  secretarySummary,
} from './secretary';

/* ------------------------------------------------------------------------ *\
 * Helpers
 * ------------------------------------------------------------------------ */

type State = TestGame['state'];

function userClub(state: State) {
  return state.clubs[state.userClubId]!;
}

/** Put the paperwork in known hands, and give the man a known competence. */
function appointSecretary(game: TestGame, organisation = 12, reliability = 12): string {
  const club = userClub(game.state);
  const id = club.chairmanId!;
  const person = game.state.people[id]!;
  if (person.kind === 'official') {
    person.attributes.organisation = organisation;
    person.attributes.reliability = reliability;
  }
  club.staff.secretaryId = id;
  return id;
}

function noSecretary(game: TestGame): void {
  userClub(game.state).staff.secretaryId = null;
}

function seasonBounds(state: State): { first: string; last: string } {
  const calendar = state.season.calendar;
  return {
    first: calendar[0]?.date ?? state.season.startDate,
    last: calendar[calendar.length - 1]?.date ?? state.season.endDate,
  };
}

function eventWithKey(state: State, key: string) {
  return secretaryStore(state).events.find((event) => event.key === key);
}

function registrationKey(state: State): string {
  return `admin:registration:${state.season.id}`;
}

function firstUserMatch(state: State): Match {
  return Object.values(state.matches)
    .filter(
      (match) =>
        (match.homeClubId === state.userClubId || match.awayClubId === state.userClubId) &&
        match.status === 'scheduled' &&
        !match.played &&
        isCompetitiveMatch(state, match),
    )
    .sort((a, b) => (a.date < b.date ? -1 : 1))[0]!;
}

function fixtureFingerprint(state: State): string {
  return Object.values(state.matches)
    .map((match) => `${match.id}:${match.date}:${match.status}:${match.played}:${match.kickOff}`)
    .sort()
    .join('|');
}

/* ------------------------------------------------------------------------ *\
 * Receiving correspondence
 * ------------------------------------------------------------------------ */

describe('the secretary receives the club’s administration', () => {
  it('logs season paperwork the day it comes in', () => {
    const game = createTestGame('secretary-receives');
    appointSecretary(game);

    runSecretary(game.state, game.state.date);

    const registration = eventWithKey(game.state, registrationKey(game.state));
    expect(registration).toBeDefined();
    expect(registration!.category).toBe('registration');
    expect(registration!.source).toBe('league');
    expect(registration!.status).toBe('open');
  });

  it('flags what the manager himself has to do, and quietly files the rest', () => {
    const game = createTestGame('secretary-action');
    appointSecretary(game, 16, 16);
    const { first } = seasonBounds(game.state);

    runSecretary(game.state, game.state.date);
    const registration = eventWithKey(game.state, registrationKey(game.state))!;
    expect(registration.actionRequired).toBe(true);
    expect(registration.importance).toBe(3);

    // A routine bulletin lands too — but the competent secretary files it
    // himself rather than leaving it on the manager's desk.
    runSecretary(game.state, addDays(first, 30));
    const bulletin = eventWithKey(game.state, `admin:bulletin:${game.state.season.id}`)!;
    expect(bulletin.actionRequired).toBe(false);
    expect(bulletin.status).toBe('handled');
    expect(outstandingAdmin(game.state).some((event) => event.key === bulletin.key)).toBe(false);
  });

  it('does not post the same letter twice', () => {
    const game = createTestGame('secretary-dedupe');
    appointSecretary(game);

    runSecretary(game.state, game.state.date);
    runSecretary(game.state, game.state.date);

    const matches = secretaryStore(game.state).events.filter((event) => event.key === registrationKey(game.state));
    expect(matches).toHaveLength(1);
  });

  it('preserves the deadline it read off the calendar', () => {
    const game = createTestGame('secretary-deadline');
    appointSecretary(game);
    const { first } = seasonBounds(game.state);

    runSecretary(game.state, game.state.date);

    const registration = eventWithKey(game.state, registrationKey(game.state))!;
    expect(registration.deadline).toBe(addDays(first, -3));
  });
});

/* ------------------------------------------------------------------------ *\
 * AGMs
 * ------------------------------------------------------------------------ */

describe('the AGMs are represented as administrative events', () => {
  it('carries both the club AGM and the league AGM, with agendas', () => {
    const game = createTestGame('secretary-agm');
    appointSecretary(game, 20, 20);
    const { last } = seasonBounds(game.state);

    runSecretary(game.state, addDays(last, 3));
    runSecretary(game.state, addDays(last, 8));

    const clubAgm = eventWithKey(game.state, `admin:club-agm:${game.state.season.id}`)!;
    const leagueAgm = eventWithKey(game.state, `admin:league-agm:${game.state.season.id}`)!;
    expect(clubAgm.category).toBe('agm');
    expect(clubAgm.attendanceRequired).toBe(true);
    expect(clubAgm.agenda.length).toBeGreaterThan(0);
    expect(leagueAgm.source).toBe('league');
    expect(leagueAgm.attendanceRequired).toBe(true);
    expect(leagueAgm.agenda.length).toBeGreaterThan(0);
    expect(leagueAgm.deadline).toBe(addDays(last, 7));
  });
});

/* ------------------------------------------------------------------------ *\
 * Fixture administration
 * ------------------------------------------------------------------------ */

describe('fixture changes are read out of the record, never duplicated', () => {
  it('writes up a called-off fixture without touching the fixture list', () => {
    const game = createTestGame('secretary-fixture');
    appointSecretary(game);
    const match = firstUserMatch(game.state);

    postponeFixture(game.state, match, match.date, 'Standing water in the goalmouth');
    const replacementId = match.replacedByMatchId!;
    expect(game.state.matches[replacementId]).toBeDefined();

    const matchesBefore = fixtureFingerprint(game.state);
    const scheduledBefore = scheduleStore(game.state).events.length;

    runSecretary(game.state, game.state.date);

    const notice = eventWithKey(game.state, `admin:fixture:${match.id}`)!;
    expect(notice.category).toBe('fixture-admin');
    expect(notice.detail).toContain('Standing water');
    expect(notice.detail).toContain('rearranged');
    expect(notice.matchId).toBe(match.id);

    // The calendar and the fixture record are the authorities, and neither was
    // altered by the secretary: he wrote a letter, not a fixture.
    expect(fixtureFingerprint(game.state)).toBe(matchesBefore);
    expect(scheduleStore(game.state).events.length).toBe(scheduledBefore);
  });
});

/* ------------------------------------------------------------------------ *\
 * Deadlines
 * ------------------------------------------------------------------------ */

describe('deadlines are kept and enforced without breaking anything', () => {
  it('marks an item missed once its deadline has gone by', () => {
    const game = createTestGame('secretary-missed');
    appointSecretary(game);
    const { first } = seasonBounds(game.state);

    runSecretary(game.state, game.state.date);
    const outcome = runSecretary(game.state, addDays(first, -1));

    const registration = eventWithKey(game.state, registrationKey(game.state))!;
    expect(registration.status).toBe('missed');
    expect(outcome.missed.some((event) => event.key === registration.key)).toBe(true);
    expect(outcome.events.some((event: { type: string }) => event.type === 'club-event')).toBe(true);
  });

  it('closes an item when the manager marks it done', () => {
    const game = createTestGame('secretary-resolve');
    appointSecretary(game);
    runSecretary(game.state, game.state.date);
    const registration = eventWithKey(game.state, registrationKey(game.state))!;

    const closed = resolveAdminEvent(game.state, registration.id, game.state.date, userClub(game.state).managerId);

    expect(closed).not.toBeNull();
    expect(closed!.status).toBe('handled');
    expect(outstandingAdmin(game.state).some((event) => event.id === registration.id)).toBe(false);
    expect(filedAdmin(game.state).some((event) => event.id === registration.id)).toBe(true);
  });
});

/* ------------------------------------------------------------------------ *\
 * Absence, and no secretary at all
 * ------------------------------------------------------------------------ */

describe('a secretary who is away lets the post wait', () => {
  it('receives nothing while unavailable, then catches up when back', () => {
    const game = createTestGame('secretary-absence');
    const secretaryId = appointSecretary(game, 12, 12);
    const { first } = seasonBounds(game.state);
    const bulletinKey = `admin:bulletin:${game.state.season.id}`;

    // Nothing but the season's first letter yet.
    runSecretary(game.state, game.state.date);
    expect(eventWithKey(game.state, bulletinKey)).toBeUndefined();

    setStaffAvailability(game.state, secretaryId, 'unavailable', 'A week away');
    expect(clubSecretary(game.state).available).toBe(false);
    runSecretary(game.state, addDays(first, 25));
    expect(eventWithKey(game.state, bulletinKey)).toBeUndefined();

    // He is back, and the letter that was waiting is finally logged.
    setStaffAvailability(game.state, secretaryId, 'available');
    runSecretary(game.state, addDays(first, 26));
    expect(eventWithKey(game.state, bulletinKey)).toBeDefined();
    // What was already on the desk is untouched.
    expect(eventWithKey(game.state, registrationKey(game.state))).toBeDefined();
  });
});

describe('a club with no secretary still runs', () => {
  it('receives paperwork and keeps the books straight without one', () => {
    const game = createTestGame('secretary-none');
    noSecretary(game);

    for (let i = 0; i < 25; i += 1) processDay(game.state, game.state.date);

    // The season's first letter still arrived — nobody is required to read the post.
    expect(secretaryStore(game.state).events.length).toBeGreaterThan(0);
    expect(clubSecretary(game.state).personId).toBeNull();
    for (const club of Object.values(game.state.clubs)) expect(ledgerBalances(club.finances)).toBe(true);
  });
});

/* ------------------------------------------------------------------------ *\
 * A poor secretary creates work, never damage
 * ------------------------------------------------------------------------ */

describe('a poor secretary costs the manager time and nothing else', () => {
  it('never touches the fixtures, the books or the calendar', () => {
    const game = createTestGame('secretary-poor');
    appointSecretary(game, 1, 1);

    const matchesBefore = fixtureFingerprint(game.state);
    const scheduledBefore = scheduleStore(game.state).events.length;

    // A fortnight of days, run through the secretary alone, in isolation.
    for (let i = 0; i < 14; i += 1) runSecretary(game.state, addDays(game.state.date, i));

    expect(fixtureFingerprint(game.state)).toBe(matchesBefore);
    expect(scheduleStore(game.state).events.length).toBe(scheduledBefore);
    for (const club of Object.values(game.state.clubs)) expect(ledgerBalances(club.finances)).toBe(true);

    // And no letter is ever logged twice.
    const keys = secretaryStore(game.state).events.map((event) => event.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('leaves routine noise on the manager’s desk where a good man would file it', () => {
    const game = createTestGame('secretary-poor-noise');
    appointSecretary(game, 1, 1);
    const { first } = seasonBounds(game.state);

    runSecretary(game.state, addDays(first, 30));

    const bulletin = eventWithKey(game.state, `admin:bulletin:${game.state.season.id}`)!;
    expect(bulletin.status).toBe('open');
  });
});

/* ------------------------------------------------------------------------ *\
 * The desk survives a save
 * ------------------------------------------------------------------------ */

describe('administrative state is saved with the career', () => {
  it('keeps the desk — keys, deadlines, agendas and status — across a reload', () => {
    const game = createTestGame('secretary-save');
    appointSecretary(game, 16, 16);
    const { last } = seasonBounds(game.state);
    runSecretary(game.state, game.state.date);
    runSecretary(game.state, addDays(last, 8));

    const loaded = deserialiseGame(serialiseGame(game.state));
    expect(loaded.error).toBeNull();
    const reloaded = loaded.state!;

    const before = secretaryStore(game.state).events;
    const after = secretaryStore(reloaded).events;
    expect(after).toHaveLength(before.length);
    for (const event of before) {
      const copy = after.find((item) => item.key === event.key)!;
      expect(copy).toMatchObject({ status: event.status, deadline: event.deadline, importance: event.importance });
      expect(copy.agenda).toEqual(event.agenda);
    }
  });
});

/* ------------------------------------------------------------------------ *\
 * Reading the desk
 * ------------------------------------------------------------------------ */

describe('the summary tells the manager what is outstanding', () => {
  it('separates what needs him from what has been filed', () => {
    const game = createTestGame('secretary-summary');
    appointSecretary(game, 16, 16);
    const { first } = seasonBounds(game.state);
    runSecretary(game.state, game.state.date);
    const early = secretarySummary(game.state);
    expect(early.identity.personId).toBe(userClub(game.state).staff.secretaryId);
    expect(early.needsManager).toBeGreaterThan(0);

    runSecretary(game.state, addDays(first, 30));
    const later = secretarySummary(game.state);
    expect(later.filed).toBeGreaterThan(0);
    expect(later.outstanding.every((event) => event.status === 'open')).toBe(true);
  });

  it('reports overdue items by the calendar', () => {
    const game = createTestGame('secretary-overdue');
    appointSecretary(game);
    const { first } = seasonBounds(game.state);
    runSecretary(game.state, game.state.date);

    expect(overdueAdmin(game.state, addDays(first, -1))).toHaveLength(1);
    expect(formatDayMonth(addDays(first, -3))).toBeTruthy();
  });
});

