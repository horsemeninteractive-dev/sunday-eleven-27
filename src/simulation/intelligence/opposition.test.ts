import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { ClubId } from '@/domain/ids';
import type { Match } from '@/domain/match';
import { isOfficial, isPlayer } from '@/domain/person';
import { emptyClubStaff } from '@/domain/staff';
import { createTestGame } from '../testSupport';
import { applyMatchConsequences } from '../consequences';
import { simulateFixture } from '../fastMatch';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { fixtureIdsOnMatchday } from '../pyramid';
import { clubMatches, matchOpponent } from '../queries';
import { dossierFreshness, oppositionDossier, oppositionPublicForm } from './opposition';

/**
 * The opposition report.
 *
 * What is held down here is the reading rather than the words: that every line
 * rests on a match that was actually played, that the results are exact and need
 * nobody to have watched, that the detail needs somebody to have watched, that
 * one afternoon is not an identity, and that a change in what a side does shows
 * up when it happens instead of being smoothed away.
 *
 * The worlds are built a fixture at a time rather than by running whole weeks of
 * the county, because what is being read is one club's record and paying for
 * fifty-four matches a Sunday would make this the slowest file in the suite for
 * no extra evidence.
 */

/** A club in the manager's division that is not his own. */
function divisionClubs(state: GameState): ClubId[] {
  const competition = Object.values(state.competitions).find((entry) =>
    entry.clubIds.includes(state.userClubId),
  );
  return (competition?.clubIds ?? []).filter((id) => id !== state.userClubId);
}

/** The club the manager faces on the first Sunday: he will be there himself. */
function firstOpponent(state: GameState): ClubId {
  const fixture = Object.values(state.matches).find(
    (match) =>
      match.matchday === 1 &&
      (match.homeClubId === state.userClubId || match.awayClubId === state.userClubId),
  );
  expect(fixture, 'no opening fixture').toBeTruthy();
  return matchOpponent(fixture!, state.userClubId);
}

/** Somebody the manager does not meet in the weeks being played. */
function unmetOpponent(state: GameState, matchdays: number): ClubId {
  const met = new Set<ClubId>([state.userClubId]);
  for (const match of Object.values(state.matches)) {
    if (match.matchday > matchdays) continue;
    if (match.homeClubId === state.userClubId) met.add(match.awayClubId);
    if (match.awayClubId === state.userClubId) met.add(match.homeClubId);
  }
  const candidates = divisionClubs(state)
    .filter((id) => !met.has(id))
    .sort((a, b) => a.localeCompare(b));
  expect(candidates.length, 'every club is met inside the window').toBeGreaterThan(0);
  return candidates[0]!;
}

type Whose = 'opponent' | 'both' | 'all';

/**
 * A world with real football in it, played a fixture at a time.
 *
 * `opponent` plays only the opponent's matches (so the manager has never seen
 * them), `both` plays the manager's fixtures too (so he has), and `all` plays
 * the county's card the way a Sunday does.
 */
function playedWorld(
  seed: string,
  matchdays: number,
  opponentId: ClubId,
  whose: Whose = 'both',
): GameState {
  const { state } = createTestGame(seed);
  const userId = state.userClubId;
  for (let matchday = 1; matchday <= matchdays; matchday += 1) {
    prepareMatchday(state, matchday);
    for (const id of fixtureIdsOnMatchday(state, matchday)) {
      const match = state.matches[id];
      if (!match) continue;
      const involvesOpponent = match.homeClubId === opponentId || match.awayClubId === opponentId;
      const involvesUser = match.homeClubId === userId || match.awayClubId === userId;
      if (whose === 'opponent' && !involvesOpponent) continue;
      if (whose === 'both' && !involvesOpponent && !involvesUser) continue;
      simulateFixture(match, matchEnvironment(state, match, { autoManageAllBenches: true }), 'fast');
      applyMatchConsequences(state, match);
    }
  }
  return state;
}

/** Appoint the first official in the world as the club's scout. */
function appointAScout(state: GameState): { id: string; name: string; reach: number } {
  const club = state.clubs[state.userClubId]!;
  const scout = Object.values(state.people).find(
    (person) => isOfficial(person) && person.id !== club.managerId,
  );
  expect(scout, 'no official in the world to appoint').toBeTruthy();
  club.staff = { ...emptyClubStaff(), scoutIds: [scout!.id] };
  return { id: scout!.id, name: `${scout!.firstName} ${scout!.surname}`, reach: 1 };
}

/** Nobody at the club goes out to watch anybody. */
function noWatchers(state: GameState): void {
  const club = state.clubs[state.userClubId];
  if (club) club.staff = emptyClubStaff();
}

const goalsIn = (match: Match, clubId: ClubId): number =>
  Object.values(match.performances)
    .filter((performance) => performance.clubId === clubId)
    .reduce((sum, performance) => sum + performance.goals, 0);

describe('the opposition report', () => {
  it('reads the results exactly, straight off the record', () => {
    const { state } = createTestGame('dossier-results');
    const opponentId = unmetOpponent(state, 6);
    const world = playedWorld('dossier-results', 6, opponentId, 'all');
    const dossier = oppositionDossier(world, opponentId);

    const theirs = clubMatches(world, opponentId).filter((match) => match.played && match.result);
    expect(theirs.length).toBeGreaterThanOrEqual(5);
    expect(dossier.results.length).toBeGreaterThan(0);
    expect(dossier.results.length).toBeLessThanOrEqual(6);

    for (const entry of dossier.results) {
      const match = theirs.find((candidate) => candidate.id === entry.matchId)!;
      expect(match).toBeTruthy();
      const home = match.homeClubId === opponentId;
      const goalsFor = home ? match.result!.homeGoals : match.result!.awayGoals;
      const goalsAgainst = home ? match.result!.awayGoals : match.result!.homeGoals;
      expect(entry.score).toBe(`${goalsFor}–${goalsAgainst}`);
      expect(entry.goalsFor).toBe(goalsFor);
      expect(entry.goalsAgainst).toBe(goalsAgainst);
      expect(entry.date).toBe(match.date);
      expect(entry.venue).toBe(match.neutralVenue ? 'N' : home ? 'H' : 'A');
      // The goals the report counts are the goals the record has.
      expect(goalsIn(match, opponentId)).toBe(goalsFor);
      // A background match holds no possession figure for the report to claim.
      expect(entry.possession === null || typeof entry.possession === 'number').toBe(true);
    }

    const won = dossier.results.filter((entry) => entry.outcome === 'W').length;
    expect(dossier.form.startsWith(`${won}W `)).toBe(true);
    expect(dossier.form).toContain(dossier.results.length.toString());

    const publicForm = oppositionPublicForm(world, opponentId, 5);
    const lastFive = dossier.results.slice(0, 5);
    expect(publicForm.won).toBe(lastFive.filter((entry) => entry.outcome === 'W').length);
    expect(publicForm.goalsFor).toBe(lastFive.reduce((sum, entry) => sum + entry.goalsFor, 0));
  });

  it('says nothing it has no grounds for', () => {
    const { state } = createTestGame('dossier-nothing');
    const opponentId = unmetOpponent(state, 6);

    // Before a ball is kicked there is no football to report on at all.
    const nothing = oppositionDossier(state, opponentId);
    expect(nothing.empty).toBe(true);
    expect(nothing.reads).toEqual([]);
    expect(nothing.results).toEqual([]);
    expect(nothing.summary.join(' ')).toMatch(/not played a match this season/i);

    // And a side the manager has never met, at a club where nobody watches
    // anybody, is a set of results and nothing more.
    const world = playedWorld('dossier-nothing', 6, opponentId, 'opponent');
    noWatchers(world);
    const stranger = oppositionDossier(world, opponentId);
    expect(stranger.results.length).toBeGreaterThan(0);
    expect(stranger.empty).toBe(true);
    expect(stranger.reads).toEqual([]);
    expect(stranger.keyPlayers).toEqual([]);
    expect(stranger.summary.join(' ')).toMatch(/nobody at the club has watched them/i);
    // The plan survives, because it is what they say they do rather than
    // something anybody had to see.
    expect(stranger.plan.formation).toBeTruthy();
    expect(stranger.plan.lines).toHaveLength(2);
  });

  it('gets its detail from watching, and a scout brings more of it back', () => {
    const { state } = createTestGame('dossier-watching');
    const opponentId = unmetOpponent(state, 6);
    const world = playedWorld('dossier-watching', 6, opponentId, 'opponent');

    noWatchers(world);
    const unwatched = oppositionDossier(world, opponentId);
    expect(unwatched.evidence.matches).toBe(0);
    expect(unwatched.evidence.staffName).toBeNull();
    expect(unwatched.empty).toBe(true);

    // Somebody goes out and watches the county, and the same fixtures become
    // evidence — the reach is the scout's rather than the record's.
    const scout = appointAScout(world);
    const watched = oppositionDossier(world, opponentId);
    expect(watched.evidence.matches).toBeGreaterThan(0);
    expect(watched.evidence.watchedByStaff).toBe(watched.evidence.matches);
    expect(watched.evidence.watchedByYou).toBe(0);
    expect(watched.evidence.staffName).toBe(scout.name);
    expect(watched.empty).toBe(false);
    // All of it is second hand, and it says so rather than claiming he was there.
    expect(watched.reads.every((read) => read.confidence !== 'known')).toBe(true);
    expect(watched.reads.every((read) => read.source.length > 0)).toBe(true);
    expect(dossierFreshness(watched)).not.toMatch(/nothing seen/i);
  });

  it('counts the manager’s own fixtures as first hand', () => {
    const { state } = createTestGame('dossier-first-hand');
    const opponentId = firstOpponent(state);
    const world = playedWorld('dossier-first-hand', 1, opponentId, 'both');
    noWatchers(world);

    const dossier = oppositionDossier(world, opponentId);
    // Nobody is out watching, so the only match with detail behind it is the one
    // the manager was at — and it is recorded as his own eyes rather than as a
    // report from somebody he has never met.
    expect(dossier.evidence.matches).toBe(1);
    expect(dossier.evidence.watchedByYou).toBe(1);
    expect(dossier.evidence.watchedByStaff).toBe(0);
    expect(dossier.evidence.staffName).toBeNull();
    expect(dossier.observed.every((entry) => entry.source === 'you')).toBe(true);
    expect(dossier.reads.length).toBeGreaterThan(0);
    expect(dossier.reads[0]!.source).toMatch(/the match you were at/);
  });

  it('does not treat one afternoon as an identity', () => {
    const { state } = createTestGame('dossier-one-match');
    const opponentId = firstOpponent(state);
    // One matchday: the manager has seen them once and nobody has been out.
    const world = playedWorld('dossier-one-match', 1, opponentId, 'both');
    noWatchers(world);

    const dossier = oppositionDossier(world, opponentId);
    expect(dossier.evidence.matches).toBe(1);
    // One afternoon is the shape and nothing else: no goals a game, no
    // defensive read, no key player, and it is called a hunch.
    expect(dossier.reads.map((read) => read.id)).toEqual(['shape']);
    expect(dossier.reads[0]!.confidence).toBe('hunch');
    expect(dossier.reads[0]!.lines.join(' ')).toMatch(/Usually/);
    expect(dossier.keyPlayers).toEqual([]);
    expect(dossier.summary.join(' ')).toMatch(/not a pattern|all there is/i);
  });

  it('counts goals, scorers and ratings from the record, never from a guess', () => {
    const { state } = createTestGame('dossier-goals');
    const opponentId = unmetOpponent(state, 6);
    const world = playedWorld('dossier-goals', 6, opponentId, 'opponent');
    appointAScout(world);

    const dossier = oppositionDossier(world, opponentId);
    const watched = dossier.observed;
    expect(watched.length).toBeGreaterThanOrEqual(2);

    const goals = watched.reduce((sum, entry) => sum + entry.goalsFor, 0);
    const output = dossier.reads.find((read) => read.id === 'output');
    expect(output, 'no attacking read with this much evidence').toBeTruthy();
    expect(output!.matches).toBe(watched.length);
    // Goals a game is the watched matches' own goals, averaged — not the whole
    // season's record and not a roll.
    expect(output!.lines[0]).toContain((goals / watched.length).toFixed(1));

    // Every scorer named is a man on their books, with the goals he actually got
    // in the matches that were watched.
    for (const player of dossier.keyPlayers) {
      expect(isPlayer(world.people[player.playerId])).toBe(true);
      const inTheRecord = watched
        .flatMap((entry) => entry.scorers)
        .filter((scorer) => scorer.playerId === player.playerId).length;
      expect(player.goals).toBe(inTheRecord);
      expect(player.note).toMatch(/\d/);
    }
  });

  it('notices when a side changes how it sets up', () => {
    const { state } = createTestGame('dossier-change');
    const opponentId = unmetOpponent(state, 6);
    const world = playedWorld('dossier-change', 6, opponentId, 'opponent');
    appointAScout(world);

    const before = oppositionDossier(world, opponentId);
    expect(before.evidence.matches).toBeGreaterThanOrEqual(3);

    // The record is written to say what it would say if they had gone to a back
    // three in their most recent match after a season of 4-4-2. Only the record
    // changes, because the record is where the report reads it from.
    const changed = before.observed[0]!.matchId;
    for (const match of clubMatches(world, opponentId)) {
      if (!match.played) continue;
      const side = match.homeClubId === opponentId ? match.lineups.home : match.lineups.away;
      side.tactics = { ...side.tactics, formation: match.id === changed ? '3-5-2' : '4-4-2' };
    }

    const after = oppositionDossier(world, opponentId);
    const change = after.reads.find((read) => read.id === 'change');
    expect(change, 'no change read').toBeTruthy();
    expect(change!.kind).toBe('interpretation');
    expect(change!.lines.join(' ')).toMatch(/3-5-2/);
    expect(change!.lines.join(' ')).toMatch(/after 4-4-2 earlier on/);
    // And the shape read has both of them in it, with the counts.
    const shape = after.reads.find((read) => read.id === 'shape')!.lines.join(' ');
    expect(shape).toMatch(/3-5-2/);
    expect(shape).toMatch(/4-4-2/);
  });

  it('is the same reading twice, and covers a range of dates', () => {
    const { state } = createTestGame('dossier-determinism');
    const opponentId = unmetOpponent(state, 5);
    const world = playedWorld('dossier-determinism', 5, opponentId, 'opponent');
    appointAScout(world);
    const first = oppositionDossier(world, opponentId);
    const second = oppositionDossier(world, opponentId);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(dossierFreshness(first)).toMatch(/to|One match/);
    expect(first.evidence.earliest! <= first.evidence.latest!).toBe(true);
  });

  it('names faces that have moved on, when the squad says they have', () => {
    const { state } = createTestGame('dossier-personnel');
    const opponentId = unmetOpponent(state, 6);
    const world = playedWorld('dossier-personnel', 6, opponentId, 'opponent');
    appointAScout(world);

    const dossier = oppositionDossier(world, opponentId);
    const personnel = dossier.reads.find((read) => read.id === 'personnel');
    // The read only exists when a man the club actually watched has gone, which
    // is a fact about their squad rather than a note about the fixture.
    if (personnel) {
      const stillThere = new Set(world.clubs[opponentId]!.squadIds);
      const watchedMen = new Set(dossier.observed.flatMap((entry) => entry.startingIds));
      const gone = [...watchedMen].filter((id) => !stillThere.has(id) && world.people[id]);
      expect(gone.length).toBeGreaterThan(0);
      expect(personnel.kind).toBe('fact');
      expect(personnel.lines[0]).toMatch(/no longer at the club/);
      return;
    }

    // Otherwise the same world with a man taken off their books must produce it.
    const opponent = world.clubs[opponentId]!;
    const first = dossier.observed[0]!.startingIds[0]!;
    opponent.squadIds = opponent.squadIds.filter((id) => id !== first);
    const after = oppositionDossier(world, opponentId);
    const reported = after.reads.find((read) => read.id === 'personnel');
    expect(reported, 'a man has gone and nobody noticed').toBeTruthy();
    expect(reported!.lines[0]).toMatch(/no longer at the club/);
  });
});
