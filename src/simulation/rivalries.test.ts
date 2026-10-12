import { describe, expect, it } from 'vitest';
import type { ClubRivalry } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { ClubId } from '@/domain/ids';
import type { Match } from '@/domain/match';
import { addDays } from './calendar';
import { simulateFixture } from './fastMatch';
import { matchEnvironment, prepareMatchday } from './matchday';
import { applyMatchRivalry, applyOffFieldRivalry, coolRivalries, rivalryBaseline, rivalryBetween } from './rivalries';
import { createTestGame } from './testSupport';

/**
 * Bad blood, and how it moves.
 *
 * What is pinned here is not the size of any single number — the module's
 * constants are allowed to be tuned — but the *shape* of the rules it claims to
 * follow: that only football does it, that an afternoon is capped, that heat
 * cools while the waterline does not, and that two clubs who were nothing to each
 * other are not turned into enemies by one game.
 *
 * Fixtures are taken from a real generated world and then handed the scoreline
 * the test is about. That is deliberate. The module reads a played match, so the
 * test has to give it one, and giving it one directly keeps each case to the few
 * lines it is actually about instead of to a simulated afternoon — the one test
 * that needs the match's own record plays it properly and says so.
 */

/** Fixtures that can change a relationship: played football, in a real competition. */
function leagueFixtures(state: GameState, count: number): Match[] {
  const chosen: Match[] = [];
  const seen = new Set<string>();
  for (const match of Object.values(state.matches)) {
    if (state.competitions[match.competitionId]?.kind !== 'league') continue;
    const pair = [match.homeClubId, match.awayClubId].sort().join(':');
    // Two fixtures of the same pair would arrange over each other's record.
    if (seen.has(pair)) continue;
    seen.add(pair);
    chosen.push(match);
    if (chosen.length === count) return chosen;
  }
  throw new Error(`the generated world has fewer than ${count} usable league fixtures`);
}

/** The same fixture, in a cup. */
function cupCompetition(state: GameState) {
  const cup = Object.values(state.competitions).find((competition) => competition.kind === 'cup');
  if (!cup) throw new Error('the generated world has no cup competition');
  return cup;
}

interface PlayOptions {
  /** Play it as a cup tie rather than a league game. */
  cup?: boolean;
  /** Play the fixture first, so the match carries the real record of who was on the pitch. */
  simulated?: boolean;
  /** How many of the side were sent off. Only meaningful with `simulated`. */
  redCards?: number;
}

/** The afternoon itself: a result, a competition, and — where it is needed — its players. */
function play(state: GameState, match: Match, score: [number, number], options: PlayOptions = {}): Match {
  if (options.simulated) {
    prepareMatchday(state, match.matchday);
    simulateFixture(state.matches[match.id]!, matchEnvironment(state, match), 'fast');
  } else {
    // Nobody was on the pitch as far as this test is concerned, and nothing reads
    // a performance except the count of men sent off.
    match.performances = {};
  }
  match.result = {
    homeGoals: score[0],
    awayGoals: score[1],
    homeShots: 0,
    awayShots: 0,
    homePossession: 50,
    awayPossession: 50,
    attendance: 0,
  };
  if (options.cup) match.competitionId = cupCompetition(state).id;
  for (const performance of Object.values(match.performances).slice(0, options.redCards ?? 0)) {
    performance.redCards = 1;
  }
  return match;
}

/** Two clubs who already know each other, with the record the test starts from. */
function arrange(state: GameState, match: Match, rivalry: Partial<ClubRivalry>): void {
  const record: ClubRivalry = {
    intensity: 40,
    note: 'They have been at this for years.',
    baseline: 30,
    kind: 'competitive',
    since: state.season.startDate,
    lastMetOn: null,
    meetings: 2,
    heat: 10,
    ...rivalry,
  };
  state.clubs[match.homeClubId]!.rivalries[match.awayClubId] = { ...record };
  state.clubs[match.awayClubId]!.rivalries[match.homeClubId] = { ...record };
}

/** One club's view of the other, as the test needs to read it. */
function record(state: GameState, homeId: ClubId, awayId: ClubId): ClubRivalry {
  const found = rivalryBetween(state, homeId, awayId);
  if (!found) throw new Error('expected a relationship between the two clubs');
  return found;
}

describe('what an afternoon does to two clubs', () => {
  it('adds a little heat when two clubs who know each other play a tight game', () => {
    const { state } = createTestGame('rivalry-tight');
    const match = leagueFixtures(state, 1)[0]!;
    arrange(state, match, { heat: 10, baseline: 30 });
    // The case is about the scoreline, so the afternoon is handed its own rather
    // than simulated: one goal in it, which is the tightest kind there is.
    play(state, match, [2, 1]);

    const { outcome, events } = applyMatchRivalry(state, match);

    expect(outcome).not.toBeNull();
    // A game that could have gone either way is worth a point or two and never
    // more: it is the least of the things that can build a rivalry.
    expect(outcome!.delta).toBeGreaterThanOrEqual(1);
    expect(outcome!.delta).toBeLessThanOrEqual(3);

    const home = record(state, match.homeClubId, match.awayClubId);
    const away = record(state, match.awayClubId, match.homeClubId);
    expect(home.heat).toBe(10 + outcome!.delta);
    expect(home.intensity).toBe(30 + home.heat!);
    expect(home.meetings).toBe(3);
    expect(home.lastMetOn).toBe(match.date);

    // The waterline is what the two clubs are to each other with nothing
    // happening, and a close game does not move it.
    expect(home.baseline).toBe(30);

    // Neither club has a different relationship from the other end of it: the two
    // records are mirror images, and only the sentence differs.
    expect(away.intensity).toBe(home.intensity);
    expect(away.baseline).toBe(home.baseline);
    expect(away.heat).toBe(home.heat);
    expect(away.meetings).toBe(home.meetings);
    expect(away.kind).toBe(home.kind);
    expect(away.lastMetOn).toBe(home.lastMetOn);
    // A quiet game of that sort is not news either.
    expect(events).toHaveLength(0);
  });

  it('leaves nothing behind when two strangers play an ordinary game', () => {
    const { state } = createTestGame('rivalry-strangers');
    const match = leagueFixtures(state, 1)[0]!;
    // Whether geography gave them anything is not the point of this test, so the
    // slate is wiped: two clubs who were nothing to each other meet.
    delete state.clubs[match.homeClubId]!.rivalries[match.awayClubId];
    delete state.clubs[match.awayClubId]!.rivalries[match.homeClubId];
    play(state, match, [3, 0]);

    const { outcome, events } = applyMatchRivalry(state, match);

    expect(outcome).toBeNull();
    expect(events).toHaveLength(0);
    expect(rivalryBetween(state, match.homeClubId, match.awayClubId)).toBeNull();
    expect(rivalryBetween(state, match.awayClubId, match.homeClubId)).toBeNull();
  });

  it('counts a cup tie for more than the same scoreline in the league', () => {
    const { state } = createTestGame('rivalry-cup');
    const match = leagueFixtures(state, 1)[0]!;

    // One pair, three afternoons: a league game that could have gone either way, a
    // cup tie won comfortably, and a cup tie won by a single goal. Going out of a
    // competition is the thing that lasts.
    const measure = (options: PlayOptions, score: [number, number]) => {
      arrange(state, match, { heat: 0, baseline: 30, meetings: 0 });
      play(state, match, score, options);
      const { outcome } = applyMatchRivalry(state, match);
      return outcome?.delta ?? 0;
    };

    const tightLeague = measure({}, [1, 0]);
    const comfortableCup = measure({ cup: true }, [3, 0]);
    const tightCup = measure({ cup: true }, [1, 0]);

    expect(tightLeague).toBeGreaterThanOrEqual(1);
    expect(comfortableCup).toBeGreaterThan(tightLeague);
    expect(tightCup).toBeGreaterThan(comfortableCup);
    expect(comfortableCup).toBe(5);
  });

  it('caps one afternoon, however much is stacked into it', () => {
    const { state } = createTestGame('rivalry-cap');
    const match = leagueFixtures(state, 1)[0]!;
    // Everything at once: a cup tie, decided by a goal, with two men sent off, and
    // the second meeting inside a month.
    arrange(state, match, { heat: 0, baseline: 95, intensity: 95, meetings: 3, lastMetOn: addDays(match.date, -14) });
    play(state, match, [1, 0], { cup: true, simulated: true, redCards: 2 });

    const { outcome } = applyMatchRivalry(state, match);

    expect(outcome!.delta).toBe(12);
    // And the pairing never goes past the ceiling, whatever is added to it: a
    // rivalry is a slow thing, and one bad-tempered afternoon is one afternoon.
    const home = record(state, match.homeClubId, match.awayClubId);
    expect(home.intensity).toBe(98);
  });

  it('adds more when the two clubs have just met', () => {
    // The same seed and the same afternoon twice, so the only difference between
    // the two cases is how recently the two clubs last played each other.
    const seed = 'rivalry-repeat';
    const date = leagueFixtures(createTestGame(seed).state, 1)[0]!.date;
    const measure = (lastMetOn: string) => {
      const { state } = createTestGame(seed);
      const match = leagueFixtures(state, 1)[0]!;
      arrange(state, match, { heat: 0, baseline: 30, meetings: 2, lastMetOn });
      play(state, match, [1, 0]);
      return applyMatchRivalry(state, match).outcome?.delta ?? 0;
    };

    const fresh = measure(addDays(date, -200));
    const again = measure(addDays(date, -14));

    expect(again).toBe(fresh + 2);
  });

  it('adds heat for a sending off, all of its own', () => {
    // A game nobody would remember at 3-0, except for what happened in it.
    const withRedCard = createTestGame('rivalry-sending-off');
    const match = leagueFixtures(withRedCard.state, 1)[0]!;
    arrange(withRedCard.state, match, { heat: 0, baseline: 30 });
    play(withRedCard.state, match, [3, 0], { simulated: true, redCards: 1 });
    const sent = applyMatchRivalry(withRedCard.state, match);

    // The same afternoon without the sending off is nothing at all.
    const withoutRedCard = createTestGame('rivalry-sending-off');
    const quiet = leagueFixtures(withoutRedCard.state, 1)[0]!;
    arrange(withoutRedCard.state, quiet, { heat: 0, baseline: 30 });
    play(withoutRedCard.state, quiet, [3, 0]);

    expect(applyMatchRivalry(withoutRedCard.state, quiet).outcome).toBeNull();
    expect(sent.outcome!.delta).toBe(2);
    expect(record(withRedCard.state, match.homeClubId, match.awayClubId).heat).toBe(2);
  });
});

describe('the close season', () => {
  it('takes the heat away and leaves the waterline where it was', () => {
    const { state } = createTestGame('rivalry-cooling');
    const match = leagueFixtures(state, 1)[0]!;
    const closeSeason = addDays(state.date, 365);
    arrange(state, match, {
      heat: 20,
      baseline: 40,
      intensity: 60,
      lastMetOn: addDays(closeSeason, -30),
    });

    coolRivalries(state, closeSeason);

    const home = record(state, match.homeClubId, match.awayClubId);
    // Heat is what a summer takes: most of it and not all of it. What two clubs
    // are to each other with nothing happening is untouched.
    expect(home.heat).toBe(9);
    expect(home.intensity).toBe(49);
    expect(home.baseline).toBe(40);
  });

  it('lets the waterline drift for a pairing nobody has played, but never for a derby', () => {
    const { state } = createTestGame('rivalry-drift');
    const closeSeason = addDays(state.date, 365);
    const [stale, recent, derby] = leagueFixtures(state, 3) as [Match, Match, Match];

    arrange(state, stale, { heat: 0, baseline: 30, intensity: 30, lastMetOn: addDays(closeSeason, -500) });
    arrange(state, recent, { heat: 0, baseline: 30, intensity: 30, lastMetOn: addDays(closeSeason, -30) });
    arrange(state, derby, { heat: 0, baseline: 70, intensity: 70, kind: 'derby', lastMetOn: addDays(closeSeason, -500) });

    coolRivalries(state, closeSeason);

    // Two clubs who have not met for more than a year are a little less to each
    // other than they were; two who met last season are exactly as much.
    expect(record(state, stale.homeClubId, stale.awayClubId).baseline).toBe(28);
    expect(record(state, recent.homeClubId, recent.awayClubId).baseline).toBe(30);
    // A derby is geography, and geography does not drift. It is the one kind of
    // relationship the game is not allowed to forget.
    expect(record(state, derby.homeClubId, derby.awayClubId).baseline).toBe(70);
    expect(record(state, derby.homeClubId, derby.awayClubId).kind).toBe('derby');
  });

  it('promotes a pairing that has earned it, and forgets one that has nothing behind it', () => {
    const { state } = createTestGame('rivalry-historic');
    const closeSeason = addDays(state.date, 365);
    const [earned, nothing] = leagueFixtures(state, 2) as [Match, Match];

    arrange(state, earned, {
      heat: 0,
      baseline: 30,
      intensity: 30,
      meetings: 8,
      lastMetOn: addDays(closeSeason, -30),
    });
    arrange(state, nothing, { heat: 1, baseline: 2, intensity: 3, meetings: 0, lastMetOn: null });

    coolRivalries(state, closeSeason);

    // Enough afternoons that mattered and competitive tension becomes an old
    // rivalry: the waterline rises, and it is no longer this season's weather.
    const historic = record(state, earned.homeClubId, earned.awayClubId);
    expect(historic.kind).toBe('historic');
    expect(historic.baseline).toBe(34);

    // And one with nothing behind it, cooled below the floor, is not a
    // relationship with a small number in it — it is not a relationship.
    expect(rivalryBetween(state, nothing.homeClubId, nothing.awayClubId)).toBeNull();
    expect(rivalryBetween(state, nothing.awayClubId, nothing.homeClubId)).toBeNull();
  });
});

describe('a grudge that did not happen on a pitch', () => {
  it('is bounded like an afternoon, and is a grudge rather than a derby', () => {
    const { state } = createTestGame('rivalry-signing-raid');
    const match = leagueFixtures(state, 1)[0]!;
    const club = state.clubs[match.homeClubId]!;
    const other = state.clubs[match.awayClubId]!;
    delete club.rivalries[other.id];
    delete other.rivalries[club.id];

    // Asking for far more than a transfer can be worth: the cap belongs to the
    // module, not to the caller.
    applyOffFieldRivalry(club, other, 40, `${club.identity.shortName} took their centre-forward off them.`, state.season.startDate);

    const view = record(state, club.id, other.id);
    expect(view.intensity).toBe(20);
    // The grudge is heat: what they did about it this summer, not what the two
    // towns have been to each other for a hundred years.
    expect(view.heat).toBe(12);
    expect(view.baseline).toBe(8);
    expect(rivalryBaseline(view)).toBe(8);
    // And it is not a derby, because nothing about it was geographical.
    expect(view.kind).toBe('competitive');
    expect(view.since).toBe(state.season.startDate);
    // The club on the other end of it knows what happened.
    expect(record(state, other.id, club.id).intensity).toBeGreaterThanOrEqual(20);
    expect(record(state, other.id, club.id).heat).toBe(12);
  });
});

describe('the same afternoon, twice', () => {
  it('leaves two identical careers with the same relationship', () => {
    const seed = 'rivalry-determinism';
    const first = createTestGame(seed);
    const second = createTestGame(seed);
    const matchA = leagueFixtures(first.state, 1)[0]!;
    const matchB = leagueFixtures(second.state, 1)[0]!;
    expect(matchA.id).toBe(matchB.id);

    arrange(first.state, matchA, { heat: 4, baseline: 25, meetings: 5, lastMetOn: addDays(matchA.date, -10) });
    arrange(second.state, matchB, { heat: 4, baseline: 25, meetings: 5, lastMetOn: addDays(matchB.date, -10) });
    play(first.state, matchA, [1, 0], { cup: true });
    play(second.state, matchB, [1, 0], { cup: true });

    const one = applyMatchRivalry(first.state, matchA);
    const two = applyMatchRivalry(second.state, matchB);

    expect(one.outcome).toEqual(two.outcome);
    expect(record(first.state, matchA.homeClubId, matchA.awayClubId)).toEqual(
      record(second.state, matchB.homeClubId, matchB.awayClubId),
    );
  });
});
