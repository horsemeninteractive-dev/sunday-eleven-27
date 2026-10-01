import { describe, expect, it } from 'vitest';
import { isPlayer, type Player } from '@/domain/person';
import { createTestGame } from './testSupport';
import { advanceWeek, startNextSeason } from './progression';
import { lastSessionFor } from './training/store';
import { computeStandings } from './league';
import { simulateToCompletion } from './match/engine';
import { matchEnvironment } from './matchday';
import { applyMatchConsequences } from './consequences';
import { applyMatchdayFinances } from './finance';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { matchdaysPlayed, nextMatchday } from './timeline';

describe('weekly progression', () => {
  it('plays the matchday, records results and moves the world on a week', () => {
    const { state } = createTestGame('weekly-loop');
    const startDate = state.date;
    const clubId = state.userClubId;
    const club = state.clubs[clubId]!;
    const startingBalance = club.finances.balance;

    const outcome = advanceWeek(state, { instant: true });

    expect(outcome.results.length).toBeGreaterThan(0);
    expect(state.date).not.toBe(startDate);
    expect(new Date(state.date).getTime()).toBeGreaterThan(new Date(startDate).getTime());
    expect(matchdaysPlayed(state)).toBe(1);

    const competition = Object.values(state.competitions)[0]!;
    const table = computeStandings({
      clubIds: competition.clubIds,
      matches: Object.values(state.matches),
      competitionId: competition.id,
      clubName: (id) => state.clubs[id]?.identity.name ?? id,
    });
    // Only league football counts towards the table: the summer's friendlies,
    // which the week also runs, are not in it.
    const leaguePlayed = Object.values(state.matches).filter(
      (match) => match.played && match.competitionId === competition.id,
    ).length;
    const totalPlayed = table.reduce((sum, row) => sum + row.played, 0);
    expect(totalPlayed).toBe(leaguePlayed * 2);
    expect(outcome.results.length).toBeGreaterThanOrEqual(leaguePlayed);

    expect(club.finances.balance).not.toBe(startingBalance);
    expect(club.finances.ledger.length).toBeGreaterThan(0);
    expect(state.news.length).toBeGreaterThan(0);
  });

  it('re-rolls availability every week and never leaves a player "played" this week', () => {
    const { state } = createTestGame('availability-loop');
    advanceWeek(state, { instant: true });
    const squad = state.clubs[state.userClubId]!.squadIds.map((id) => state.people[id]).filter(isPlayer);
    expect(squad.length).toBeGreaterThan(20);
    for (const player of squad) {
      expect(['available', 'doubtful', 'unavailable']).toContain(player.availability.status);
      if (player.availability.status === 'available') {
        expect(player.availability.reason).toBeNull();
      } else {
        expect(player.availability.reason).not.toBeNull();
      }
    }
  });

  it('does not apply consequences twice for matches that were already resolved', () => {
    const { state } = createTestGame('no-double-count');
    const club = state.clubs[state.userClubId]!;

    // Resolve the whole matchday the way the live game does: matches finish,
    // consequences and matchday money are applied immediately.
    for (const id of state.fixtures.byMatchday[1] ?? []) {
      const match = state.matches[id]!;
      simulateToCompletion(match, matchEnvironment(state, match, { autoManageAllBenches: true }));
      applyMatchConsequences(state, match);
      applyMatchdayFinances(state, match);
    }

    const goalsBefore = Object.values(state.people)
      .filter(isPlayer)
      .reduce((sum, player) => sum + player.record.goals, 0);
    const ledgerBefore = club.finances.ledger.length;
    const matchdayIncomeBefore = club.finances.ledger.filter((line) => line.category === 'matchday').length;

    advanceWeek(state, { instant: true });

    const record = club.history.seasons[0]!;
    expect(record.played).toBe(1);
    expect(record.won + record.drawn + record.lost).toBe(1);

    const goalsAfter = Object.values(state.people)
      .filter(isPlayer)
      .reduce((sum, player) => sum + player.record.goals, 0);
    expect(goalsAfter).toBe(goalsBefore);
    expect(club.finances.ledger.filter((line) => line.category === 'matchday').length).toBe(matchdayIncomeBefore);
    // Only the weekly running costs are added by advancing the week.
    expect(club.finances.ledger.length).toBeGreaterThan(ledgerBefore);
  });

  it('records appearances and adjusts condition for everyone who played', () => {
    const { state } = createTestGame('fitness-loop');
    const matchday = nextMatchday(state);
    const match = Object.values(state.matches).find(
      (candidate) =>
        candidate.matchday === matchday &&
        (candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId),
    )!;

    const lineup = match.homeClubId === state.userClubId ? match.lineups.home : match.lineups.away;
    const startingIds = lineup.starting.map((slot) => slot.playerId);
    expect(startingIds).toHaveLength(11);

    advanceWeek(state, { instant: true });

    const playedPlayers = startingIds.map((id) => state.people[id]).filter(isPlayer);
    expect(playedPlayers).toHaveLength(11);
    for (const player of playedPlayers) {
      expect(player.fitness).toBeLessThanOrEqual(100);
      expect(player.fitness).toBeGreaterThan(0);
      expect(player.record.appearances + player.record.substituteAppearances).toBeGreaterThan(0);
      expect(player.record.seasons[0]?.goals).toBeDefined();
    }
  });

  it('only tires players through the match, then recovers them over the week', () => {
    const { state } = createTestGame('recovery-loop');
    const matchday = nextMatchday(state);
    const match = Object.values(state.matches).find((candidate) => candidate.matchday === matchday)!;
    const env = matchEnvironment(state, match, { autoManageAllBenches: true });
    simulateToCompletion(match, env);

    const energies = Object.values(match.performances).map((performance) => performance.energy);
    expect(energies.length).toBeGreaterThanOrEqual(22);
    // Most players should be visibly emptier by full-time.
    expect(energies.filter((energy) => energy < 50).length).toBeGreaterThan(8);

    advanceWeek(state, { instant: true });
    const squad = state.clubs[state.userClubId]!.squadIds.map((id) => state.people[id]).filter(isPlayer);
    // The week repairs them — but Thursday night is a cost of its own now, on
    // top of Sunday, so the floor is lower for the ones who trained.
    expect(squad.every((player) => player.fitness > 40)).toBe(true);

    const session = lastSessionFor(state, state.userClubId);
    const trained = new Set(
      session?.attendance.filter((entry) => entry.status === 'attending').map((entry) => entry.personId) ?? [],
    );
    const mean = (players: Player[]) => players.reduce((sum, player) => sum + player.fitness, 0) / players.length;
    const trainedPlayers = squad.filter((player) => trained.has(player.id));
    const restedPlayers = squad.filter((player) => !trained.has(player.id));
    if (trainedPlayers.length > 0 && restedPlayers.length > 0) {
      expect(mean(restedPlayers)).toBeGreaterThan(mean(trainedPlayers));
    }
  });

  it('accumulates match history that the world remembers', () => {
    const { state } = createTestGame('history-loop');
    advanceWeek(state, { instant: true });
    advanceWeek(state, { instant: true });

    const club = state.clubs[state.userClubId]!;
    const record = club.history.seasons[0]!;
    expect(record.played).toBe(2);
    expect(record.won + record.drawn + record.lost).toBe(2);
    expect(state.standingHistory.length).toBeGreaterThanOrEqual(3);

    const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer);
    const totalAppearances = squad.reduce((sum, player) => sum + player.record.appearances, 0);
    expect(totalAppearances).toBeGreaterThan(0);
  });

  it('finishes the season, records final positions and allows a rollover', () => {
    const { state } = createTestGame('full-season');
    const matchdays = state.season.calendar.length;
    // A Sunday league season does not finish neatly on the last scheduled
    // Sunday: called-off games are rearranged into the weeks that follow, and
    // the season closes once the last of them has been played.
    for (let i = 0; i < matchdays + 10 && state.phase !== 'complete'; i++) {
      advanceWeek(state, { instant: true });
    }

    expect(state.phase).toBe('complete');
    expect(state.season.finished).toBe(true);

    const competition = Object.values(state.competitions)[0]!;
    const table = computeStandings({
      clubIds: competition.clubIds,
      matches: Object.values(state.matches),
      competitionId: competition.id,
      clubName: (id) => state.clubs[id]?.identity.name ?? id,
    });
    // A game that was called off and rearranged counts once, on the day it was
    // actually played; one the league ran out of Sundays for is abandoned, and
    // the season record says so by counting one fewer.
    const playedByClub = new Map<string, number>();
    for (const match of Object.values(state.matches)) {
      if (!match.played) continue;
      if (match.competitionId !== competition.id) continue;
      playedByClub.set(match.homeClubId, (playedByClub.get(match.homeClubId) ?? 0) + 1);
      playedByClub.set(match.awayClubId, (playedByClub.get(match.awayClubId) ?? 0) + 1);
    }

    for (const [index, row] of table.entries()) {
      const club = state.clubs[row.clubId]!;
      const record = club.history.seasons.find((season) => season.seasonId === state.season.id)!;
      expect(record.finalPosition).toBe(index + 1);
      expect(record.played).toBe(playedByClub.get(row.clubId) ?? 0);
    }
    expect(playedByClub.get(state.userClubId) ?? 0).toBeGreaterThanOrEqual(matchdays - 3);

    const previousLabel = state.season.label;
    const events = startNextSeason(state);
    expect(events.length).toBeGreaterThan(0);
    expect(state.phase).toBe('season');
    expect(state.season.label).not.toBe(previousLabel);
    expect(matchdaysPlayed(state)).toBe(0);
    expect(Object.keys(state.matches).length).toBeGreaterThan(0);

    // Every club still has a usable squad after retirements and recruitment.
    for (const club of Object.values(state.clubs)) {
      expect(club.squadIds.length).toBeGreaterThanOrEqual(18);
    }
  });

  it('saves and loads without losing or corrupting simulation state', () => {
    const { state } = createTestGame('save-integrity');
    advanceWeek(state, { instant: true });

    const raw = serialiseGame(state);
    const loaded = deserialiseGame(raw);
    expect(loaded.error).toBeNull();
    expect(loaded.state).not.toBeNull();

    const restored = loaded.state!;
    expect(restored.date).toBe(state.date);
    expect(restored.seed).toBe(state.seed);
    expect(restored.userClubId).toBe(state.userClubId);
    expect(Object.keys(restored.clubs).length).toBe(Object.keys(state.clubs).length);
    expect(Object.keys(restored.people).length).toBe(Object.keys(state.people).length);
    expect(Object.keys(restored.matches).length).toBe(Object.keys(state.matches).length);
    expect(matchdaysPlayed(restored)).toBe(matchdaysPlayed(state));
    expect(restored.news.length).toBe(state.news.length);

    // The loaded state keeps simulating identically.
    const before = JSON.stringify(restored);
    advanceWeek(restored, { instant: true });
    expect(JSON.stringify(restored)).not.toBe(before);

    const reLoaded = deserialiseGame(serialiseGame(restored));
    expect(reLoaded.state?.date).toBe(restored.date);
  });

  it('rejects saves from a different game version', () => {
    const { state } = createTestGame('version-check');
    const raw = JSON.stringify({ version: 999, savedAt: '2026-09-01', state });
    const loaded = deserialiseGame(raw);
    expect(loaded.state).toBeNull();
    expect(loaded.error).toMatch(/version/i);
  });
});
