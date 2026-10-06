import { fixtureIdsOnMatchday } from '@/simulation/pyramid';

/**
 * The match that actually happened for a fixture.
 *
 * A postponed fixture keeps its date and its record and hangs a replacement off
 * itself, so a chain of them can be followed to the game that was played. Guarded
 * so a genuinely abandoned fixture fails the test rather than looping for ever.
 */
function resolveToPlayedMatch(state: ReturnType<typeof createTestGame>['state'], match: (typeof state.matches)[string]) {
  let current = match;
  for (let step = 0; step < 10; step += 1) {
    if (current.played) return current;
    const nextId = current.replacedByMatchId;
    if (!nextId) break;
    const next = state.matches[nextId];
    if (!next) break;
    current = next;
  }
  return current;
}
import { describe, expect, it } from 'vitest';
import { isOfficial, isPlayer, type Player } from '@/domain/person';
import { createTestGame } from './testSupport';
import { advanceWeek, startNextSeason } from './progression';
import { lastSessionFor } from './training/store';
import { computeStandings } from './league';
import { simulateMatchHeadless } from './match/matchEngine';
import { matchEnvironment } from './matchday';
import { applyMatchConsequences } from './consequences';
import { applyMatchdayFinances } from './finance';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { isLeagueMatchday, matchdaysPlayed, nextMatchday } from './timeline';

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
    for (const id of fixtureIdsOnMatchday(state, 1)) {
      const match = state.matches[id]!;
      simulateMatchHeadless(match, matchEnvironment(state, match, { autoManageAllBenches: true }));
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
    const scheduled = Object.values(state.matches).find(
      (candidate) =>
        candidate.matchday === matchday &&
        (candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId),
    )!;

    // The XI is picked for the fixture that was scheduled. If that game is
    // called off, the replacement is the game that actually happens and carries
    // the consequences — so the reading follows the fixture through to whatever
    // was played rather than expecting an abandoned game to have a record.
    // Days are driven until the chain is settled, because that is how long a
    // rearranged game genuinely takes to come round.
    for (let day = 0; day < 60 && !resolveToPlayedMatch(state, scheduled).played; day += 1) {
      advanceWeek(state, { instant: true });
      if (state.phase === 'complete') break;
    }
    const played = resolveToPlayedMatch(state, scheduled);
    expect(played.played).toBe(true);
    const lineup = played.homeClubId === state.userClubId ? played.lineups.home : played.lineups.away;
    const startingIds = lineup.starting.map((slot) => slot.playerId);
    expect(startingIds).toHaveLength(11);

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
    // The engine the game actually plays: the old one is being retired, and a
    // test that kept driving it would stop saying anything about the cricket.
    simulateMatchHeadless(match, env);

    const energies = Object.values(match.performances).map((performance) => performance.energy);
    expect(energies.length).toBeGreaterThanOrEqual(22);
    // Most players should be visibly emptier by full-time.
    expect(energies.filter((energy) => energy < 50).length).toBeGreaterThan(8);

    advanceWeek(state, { instant: true });
    const squad = state.clubs[state.userClubId]!.squadIds.map((id) => state.people[id]).filter(isPlayer);
    // The week repairs them — but Thursday night is a cost of its own now, on
    // top of Sunday, so the floor is lower for the ones who trained.
    expect(squad.every((player) => player.fitness > 40)).toBe(true);

    // Training costs freshness on top of the match does. The comparison has to
    // be drawn among the men no match touched: a week contains a fixture, and
    // who played is a far bigger effect on freshness than whether a man turned
    // up on Thursday, so comparing every attendee against every non-attendee
    // measures the team sheet rather than the session. Among the men who did
    // not play, the session is the only thing that differed, and the rested
    // group is fitter by roughly its cost. Averaged over several worlds because
    // the two groups are small in any one of them.
    const mean = (players: Player[]) => players.reduce((sum, player) => sum + player.fitness, 0) / players.length;
    const appearances = (player: Player) => player.record.appearances + player.record.substituteAppearances;
    let balance = 0;
    let worlds = 0;
    for (const seed of ['recovery-loop', 'recovery-b', 'recovery-c', 'recovery-d', 'recovery-e', 'recovery-f', 'recovery-g']) {
      const world = createTestGame(seed);
      const worldClub = world.state.clubs[world.state.userClubId]!;
      const before = new Map<string, number>(
        worldClub.squadIds.map((id) => [id, appearances(world.state.people[id] as Player)]),
      );
      advanceWeek(world.state, { instant: true });
      const worldSquad = worldClub.squadIds.map((id) => world.state.people[id]).filter(isPlayer);
      const worldSession = lastSessionFor(world.state, world.state.userClubId);
      const attendees = new Set(
        worldSession?.attendance.filter((entry) => entry.status === 'attending').map((entry) => entry.personId) ?? [],
      );
      const idle = worldSquad.filter((player) => appearances(player) === (before.get(player.id) ?? 0));
      const trainedGroup = idle.filter((player) => attendees.has(player.id));
      const restedGroup = idle.filter((player) => !attendees.has(player.id));
      if (trainedGroup.length === 0 || restedGroup.length === 0) continue;
      balance += mean(restedGroup) - mean(trainedGroup);
      worlds += 1;
    }
    expect(worlds).toBeGreaterThan(4);
    expect(balance / worlds).toBeGreaterThan(0);
  });

  it('accumulates match history that the world remembers', () => {
    const { state } = createTestGame('history-loop');
    const club = state.clubs[state.userClubId]!;
    // A Sunday can be called off — a waterlogged pitch, a frozen one, no referee
    // — and a postponed game is rearranged rather than counted, so two weeks are
    // not reliably two league games. Advance until the club has actually played
    // twice, which is what this test is about.
    for (let guard = 0; guard < 6 && (club.history.seasons[0]?.played ?? 0) < 2; guard += 1) {
      advanceWeek(state, { instant: true });
    }

    // A season record is the club's competitive log, so it covers the league
    // Sundays and the cup ties the draw slotted between them.
    const record = club.history.seasons[0]!;
    expect(record.played).toBeGreaterThanOrEqual(2);
    expect(record.won + record.drawn + record.lost).toBe(record.played);
    expect(record.points).toBe(record.won * 3 + record.drawn);
    expect(state.standingHistory.length).toBeGreaterThanOrEqual(3);

    const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer);
    const totalAppearances = squad.reduce((sum, player) => sum + player.record.appearances, 0);
    expect(totalAppearances).toBeGreaterThan(0);
  });

  it('finishes the season, records final positions and allows a rollover', () => {
    const { state } = createTestGame('full-season');
    // The season calendar also carries the cup rounds, which are midweek games
    // numbered after the league's matchdays. A club's league season is as long
    // as the league's Sundays, not the calendar's entries.
    const matchdays = state.season.calendar.filter((entry) => isLeagueMatchday(state, entry.matchday)).length;
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

  it('keeps a player-manager in the dugout when he stops playing, as a real person', () => {
    const { state } = createTestGame('player-manager-retires');
    const club = state.clubs[state.userClubId]!;

    // Set the club up the way the world generator does for the minority of
    // sides run by a player-manager: a squad member picks the team and plays.
    const playerManager = club.squadIds.map((id) => state.people[id]).filter(isPlayer)[0]!;
    playerManager.isPlayerManager = true;
    playerManager.age = 41; // over the hill: this summer takes him as a player
    club.managerId = playerManager.id;

    startNextSeason(state);

    // He has stopped playing: he is out of the squad and the player world.
    expect(state.clubs[club.id]!.squadIds).not.toContain(playerManager.id);
    expect(isPlayer(state.people[playerManager.id])).toBe(false);

    // But he has not stopped managing: he is the club's manager still, now an
    // official rather than a player, so the reference never dangles.
    expect(state.clubs[club.id]!.managerId).toBe(playerManager.id);
    const manager = state.people[playerManager.id];
    expect(isOfficial(manager)).toBe(true);
    if (isOfficial(manager)) {
      expect(manager.role).toBe('manager');
      expect(manager.clubId).toBe(club.id);
      expect(manager.roles).toEqual([{ clubId: club.id, role: 'manager', since: expect.any(String) }]);
    }
  });
});

/**
 * Rolling the calendar over.
 *
 * A season is as long as its own calendar plus the rearranged fixtures played
 * before the rearrangement deadline, and that tail can run a week or more past
 * the fixed early-September rollover. The new season has to wait for the old one
 * to finish: winding the clock backwards would open pre-season before the last
 * ball of the season before it had been kicked.
 */
describe('rolling the season over', () => {
  it('never opens the new season before the old one has finished', () => {
    const { state } = createTestGame('season-rollover-overrun');
    // A date past the Monday the next pre-season would naturally begin: what a
    // season whose last game was rearranged looks like on the day it closes.
    const overrun = '2027-07-22';
    state.date = overrun;
    state.season.endDate = overrun;

    startNextSeason(state);

    expect(state.season.startDate > overrun).toBe(true);
    expect(state.date).toBe(state.season.startDate);
  });
});
