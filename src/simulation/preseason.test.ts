import { describe, expect, it } from 'vitest';
import { FRIENDLY_COMPETITION_ID } from '@/domain/competition';
import { isCompetitiveMatch } from '@/domain/match';
import { isPlayer } from '@/domain/person';
import { addDays, dayOfWeek, daysBetween, PRE_SEASON_WEEKS, preSeasonStart } from '@/simulation/calendar';
import { processDay } from '@/simulation/day';
import { computeStandings } from '@/simulation/league';
import { arrangeFriendly, arrangePreSeason, friendliesFor } from '@/simulation/preseason';
import { nextFixtureFor, recursOn, recurringEvents } from '@/simulation/schedule';
import { sessionDatesFor } from '@/simulation/training/plan';
import { sessionsFor } from '@/simulation/training/store';
import { matchdaysPlayed, nextMatchday } from '@/simulation/timeline';
import { createTestGame } from '@/simulation/testSupport';

/**
 * Pre-season.
 *
 * The season used to start on the morning of the first league game, which left
 * a new manager no time to sign anybody and a squad no time to get fit. These
 * tests hold the summer open: six weeks, a weekly rhythm, and friendlies to
 * play in it that never touch the league.
 */

type State = ReturnType<typeof createTestGame>['state'];

const leagueOpener = (state: State) => state.season.calendar[0]!.date;

function runDays(state: State, days: number) {
  for (let i = 0; i < days; i += 1) processDay(state, state.date, { resolveUserMatch: true });
}

describe('a career begins in pre-season', () => {
  it('gives the manager weeks before the first league game', () => {
    const { state } = createTestGame('preseason-start');
    const opener = leagueOpener(state);
    expect(state.date).toBe(state.season.startDate);
    expect(dayOfWeek(state.date)).toBe(1);
    expect(daysBetween(state.date, opener)).toBeGreaterThan(PRE_SEASON_WEEKS * 7 - 1);
    expect(addDays(state.date, 7)).not.toBe(opener);
    // Six Thursdays of pre-season, plus the one that builds towards the opener.
    const preSeasonSessions = sessionDatesFor(state).filter((date) => date < opener);
    expect(preSeasonSessions).toHaveLength(PRE_SEASON_WEEKS + 1);
    expect(preSeasonSessions.every((date) => dayOfWeek(date) === 4)).toBe(true);
    expect(preSeasonSessions[0]).toBe(addDays(state.date, 3));
  });

  it('arranges friendlies for the club, and leaves the league calendar alone', () => {
    const { state } = createTestGame('preseason-friendlies');
    const friendlies = friendliesFor(state, state.userClubId);
    const opener = leagueOpener(state);

    expect(friendlies.length).toBeGreaterThanOrEqual(3);
    for (const match of friendlies) {
      expect(match.competitionId).toBe(FRIENDLY_COMPETITION_ID);
      expect(dayOfWeek(match.date)).toBe(0);
      expect(daysBetween(state.date, match.date)).toBeGreaterThan(0);
      expect(daysBetween(match.date, opener)).toBeGreaterThan(0);
      expect([match.homeClubId, match.awayClubId]).toContain(state.userClubId);
      expect(isCompetitiveMatch(state, match)).toBe(false);
    }
    // Home, away, home: somebody has to put the nets up.
    expect(friendlies[0]!.homeClubId).toBe(state.userClubId);
    // The league itself still starts on the first Sunday of September, and the
    // season's own calendar has not moved.
    expect(state.season.calendar.length).toBeGreaterThan(20);
    expect(opener).toBe(addDays(preSeasonStart(opener), 7 * PRE_SEASON_WEEKS));
    expect(nextMatchday(state)).toBe(1);
  });

  it('keeps friendlies out of the table and out of the season record', () => {
    const { state } = createTestGame('preseason-not-counted');
    const club = state.clubs[state.userClubId]!;
    const friendlies = friendliesFor(state, state.userClubId);
    expect(friendlies.length).toBeGreaterThan(0);

    // Play the whole summer out.
    runDays(state, daysBetween(state.date, leagueOpener(state)));

    for (const match of friendlies) expect(match.played).toBe(true);

    const competition = Object.values(state.competitions)[0]!;
    const table = computeStandings({
      clubIds: competition.clubIds,
      matches: Object.values(state.matches),
      competitionId: competition.id,
      clubName: (id) => state.clubs[id]?.identity.name ?? id,
    });
    expect(table.every((row) => row.played === 0)).toBe(true);
    const record = club.history.seasons.find((season) => season.seasonId === state.season.id)!;
    expect(record.played).toBe(0);
    expect(record.goalsFor).toBe(0);
    // Nobody's career figures were written in July either.
    const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer);
    expect(squad.every((player) => player.record.appearances === 0)).toBe(true);
    // But it was football: they are fitter for having played it.
    expect(squad.some((player) => player.fitness < 100)).toBe(true);
  });

  it('runs the club week through the summer: training and costs', () => {
    const { state } = createTestGame('preseason-rhythm');
    const rules = recurringEvents(state);
    const firstMonday = state.date;
    expect(rules.every((rule) => rule.startsOn <= firstMonday)).toBe(true);
    // The pitch is paid for in July, not just September. Player subs are no
    // longer a weekly rule at all: they are raised per match.
    const costs = rules.find((rule) => rule.id === 'rec_costs')!;
    expect(recursOn(costs, addDays(firstMonday, 2))).toBe(true);
    expect(rules.some((rule) => rule.id === 'rec_subs')).toBe(false);

    runDays(state, 14);

    const sessions = sessionsFor(state, state.userClubId);
    // Two Thursdays have been and gone, and both were trained.
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.every((session) => daysBetween(session.date, leagueOpener(state)) > 0)).toBe(true);
    const club = state.clubs[state.userClubId]!;
    expect(club.finances.ledger.some((line) => line.category === 'pitch-hire')).toBe(true);
    // No squad-wide weekly subs line, ever.
    expect(club.finances.ledger.some((line) => /^Player subs \(/.test(line.description))).toBe(false);
  });

  it('stops the clock on a friendly before the league begins', () => {
    const { state } = createTestGame('preseason-first-game');
    const match = nextFixtureFor(state, state.userClubId, state.date)!;
    expect(match.competitionId).toBe(FRIENDLY_COMPETITION_ID);
    expect(daysBetween(match.date, leagueOpener(state))).toBeGreaterThan(0);
    expect(matchdaysPlayed(state)).toBe(0);
  });
});

describe('arranging friendlies', () => {
  it('will not arrange one on a day the club already plays', () => {
    const { state } = createTestGame('preseason-clash');
    const existing = friendliesFor(state, state.userClubId)[0]!;
    const opponent = Object.values(state.clubs).find((club) => club.id !== state.userClubId)!;
    const before = friendliesFor(state, state.userClubId).length;
    const clash = arrangeFriendly(state, state.userClubId, opponent.id, existing.date, true);
    expect(clash).toBeNull();
    expect(friendliesFor(state, state.userClubId)).toHaveLength(before);
  });

  it('will not arrange one once the league has started', () => {
    const { state } = createTestGame('preseason-late');
    const opponent = Object.values(state.clubs).find((club) => club.id !== state.userClubId)!;
    const opener = leagueOpener(state);
    expect(arrangeFriendly(state, state.userClubId, opponent.id, opener, true)).toBeNull();
    expect(arrangeFriendly(state, state.userClubId, opponent.id, addDays(opener, 14), true)).toBeNull();
  });

  it('arranges another when there is room, and registers it on the club list', () => {
    const { state } = createTestGame('preseason-extra');
    const opponent = Object.values(state.clubs).find((club) => club.id !== state.userClubId)!;
    const freeThursday = addDays(state.date, 10);
    const arranged = arrangeFriendly(state, state.userClubId, opponent.id, freeThursday, false);
    expect(arranged).not.toBeNull();
    // Asked to play it away, so the opponent is the host.
    expect(arranged!.homeClubId).toBe(opponent.id);
    expect(arranged!.awayClubId).toBe(state.userClubId);
    expect(state.matchOrder).toContain(arranged!.id);
    expect(friendliesFor(state, state.userClubId).map((match) => match.id)).toContain(arranged!.id);
  });

  it('never arranges the same club twice in one summer', () => {
    const { state } = createTestGame('preseason-opponents');
    const friendlies = friendliesFor(state, state.userClubId);
    const opponents = friendlies.map((match) =>
      match.homeClubId === state.userClubId ? match.awayClubId : match.homeClubId,
    );
    expect(new Set(opponents).size).toBe(opponents.length);
  });

  it('replaces a summer that was never arranged', () => {
    const { state } = createTestGame('preseason-rearrange');
    // A career picked up with no summer behind it gets one.
    for (const match of friendliesFor(state, state.userClubId)) {
      delete state.matches[match.id];
      state.matchOrder = state.matchOrder.filter((id) => id !== match.id);
    }
    const created = arrangePreSeason(state, state.userClubId, preSeasonStart(leagueOpener(state)));
    expect(created.length).toBeGreaterThan(0);
    expect(friendliesFor(state, state.userClubId).length).toBe(created.length);
  });
});
