import { describe, expect, it } from 'vitest';
import type { Competition } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import { leagueCompetitions, type MovementRecord } from './pyramid';
import { applySeasonStanding, STANDING } from './standing';
import { createTestGame } from './testSupport';

/**
 * The standing layer, held to the three ideas it is built from.
 *
 * Reputation is the county's opinion of a club, and it used to be a fact about
 * the day the world was generated: a club could be promoted three times and the
 * county's view of it would not move, so the ladder had no reward in it and a
 * career felt flat at the top. The model is deliberately small — a finish is read
 * against the county's expectation of the club, going up or down a division is
 * worth more than a finish, and a season moves a club by a few points at most —
 * and these tests pin each of those down, including the arithmetic a reader
 * cannot guess (a place is not yet news; the cap is two points).
 *
 * The boundary hook that runs this at the real season boundary is guarded in
 * `progression.test.ts`, where a full season is already being played.
 */

/**
 * Play a division out so that its table comes out exactly in this order.
 *
 * The higher-ranked side wins every meeting, which is all a table needs: every
 * club beats everyone below it and loses to everyone above it, so the points
 * fall in step with the order and no two clubs are ever level.
 */
function playOut(state: GameState, competition: Competition, order: readonly string[]): void {
  const rank = new Map(order.map((clubId, index) => [clubId, index]));
  for (const match of Object.values(state.matches)) {
    if (match.competitionId !== competition.id) continue;
    const home = rank.get(match.homeClubId);
    const away = rank.get(match.awayClubId);
    if (home === undefined || away === undefined) continue;
    const homeWins = home < away;
    match.played = true;
    match.status = 'finished';
    match.result = {
      homeGoals: homeWins ? 2 : 0,
      awayGoals: homeWins ? 0 : 2,
      homeShots: 9,
      awayShots: 9,
      homePossession: homeWins ? 60 : 40,
      awayPossession: homeWins ? 40 : 60,
      attendance: 120,
    };
  }
}

/**
 * A county the county got exactly right.
 *
 * Every division finishes in the order its club list is in, and every club's
 * standing already places it there — so nobody has done better or worse than the
 * county thought, and with no movements from the ladder nothing at all should
 * move. That is the claim the first test makes, and the state every later test
 * starts from when it wants to change one thing and read one consequence.
 */
function readExactlyRight(state: GameState, top: number, gap: number): void {
  leagueCompetitions(state).forEach((competition, index) => {
    const order = [...competition.clubIds];
    const base = top - index * gap;
    order.forEach((clubId, place) => {
      state.clubs[clubId]!.reputation = base - place;
    });
    playOut(state, competition, order);
  });
}

/** The boundary's own record of a club going up or down. */
function movementFor(
  state: GameState,
  competition: Competition,
  clubId: string,
  direction: 'promoted' | 'relegated',
  blockedReason?: string,
): MovementRecord {
  return {
    seasonId: state.season.id,
    seasonLabel: state.season.label,
    competitionId: competition.id,
    divisionName: competition.name,
    tier: competition.tier,
    clubId,
    clubName: state.clubs[clubId]!.identity.name,
    direction,
    ...(blockedReason ? { blockedReason } : {}),
  };
}

/**
 * Set one division up so that a single club is the news in it.
 *
 * The promoted or relegated club is put at `standing`, everyone else at
 * `restOfDivision`, and the division is played out in the order those numbers
 * say the county reads it — so the club finishes exactly where its standing puts
 * it and the ladder is the only thing that moves it. Returns the club's id.
 */
function ladderClub(
  state: GameState,
  competition: Competition,
  standing: number,
  restOfDivision: number,
): string {
  const clubId = competition.clubIds.find((id) => id !== state.userClubId)!;
  const reputationOf = new Map(
    competition.clubIds.map((id) => [id, id === clubId ? standing : restOfDivision]),
  );
  // The county's reading of the division, in the order it reads equal clubs — and
  // the club finishes exactly there, so the ladder is the only thing that moves it.
  const order = [...competition.clubIds].sort(
    (a, b) => reputationOf.get(b)! - reputationOf.get(a)! || (a < b ? -1 : a > b ? 1 : 0),
  );
  for (const id of order) state.clubs[id]!.reputation = reputationOf.get(id)!;
  playOut(state, competition, order);
  return clubId;
}

/** A division whose company sits at one number: the level a promoted club joins. */
function divisionStandingAt(state: GameState, competition: Competition, reputation: number): void {
  const order = [...competition.clubIds].sort();
  order.forEach((clubId) => {
    state.clubs[clubId]!.reputation = reputation;
  });
  // Equal standings are read in club-id order, which is the order it is played
  // out in — so this division moves nobody either.
  playOut(state, competition, order);
}

describe('a finish is read against the county’s expectation', () => {
  it('leaves every club where it stands when the county had the season right', () => {
    const { state } = createTestGame('standing-neutral');
    readExactlyRight(state, 60, 5);
    const division = leagueCompetitions(state)[0]!;
    expect(division.clubIds.length).toBeGreaterThan(10);
    const before = new Map(Object.entries(state.clubs).map(([id, club]) => [id, club.reputation]));

    const changes = applySeasonStanding(state, []);

    expect(changes).toEqual([]);
    for (const [clubId, reputation] of before) {
      expect(state.clubs[clubId]!.reputation, clubId).toBe(reputation);
    }
  });

  /**
   * What a finish is worth, in places above the county's reading of the club.
   *
   * A single place is not yet news, a couple of places are a point, and the cap
   * is two points however far a club runs — which is what stops a side that
   * keeps winning running away with the county's opinion of it, and gives the
   * model its shape: reputation converges on the truth about a club instead of
   * chasing every result.
   */
  it.each([
    [1, 0],
    [2, 1],
    [3, 1],
    [4, 2],
    [5, 2],
    [6, 2],
    [10, 2],
  ])('moves a club finishing %i places above its standing by %i points', (places, expected) => {
    const { state } = createTestGame(`standing-form-${places}`);
    readExactlyRight(state, 60, 5);
    const division = leagueCompetitions(state)[0]!;
    const order = [...division.clubIds];
    const size = order.length;
    const climber = order[size - 1]!;
    // The county read the division in its own order and put this club at the
    // foot of it; it now finishes `places` above the foot.
    order.forEach((clubId, place) => {
      state.clubs[clubId]!.reputation = clubId === climber ? 30 : 60 - place;
    });
    // Somebody has to fall for it: the side whose place the climber takes drops
    // to the bottom, and nobody else in the division moves a place.
    const table = order.filter((clubId) => clubId !== climber);
    const displaced = table[size - 1 - places]!;
    table[size - 1 - places] = climber;
    table.push(displaced);
    playOut(state, division, table);
    const climberFrom = state.clubs[climber]!.reputation;
    const displacedFrom = state.clubs[displaced]!.reputation;

    const changes = applySeasonStanding(state, []);
    const climb = changes.find((change) => change.clubId === climber);
    const fall = changes.find((change) => change.clubId === displaced);

    if (expected === 0) {
      // Under a point of movement: neither club is news, and both keep the
      // standing they had.
      expect(climb).toBeUndefined();
      expect(fall).toBeUndefined();
      expect(state.clubs[climber]!.reputation).toBe(climberFrom);
      expect(state.clubs[displaced]!.reputation).toBe(displacedFrom);
    } else {
      expect(climb).toMatchObject({ from: climberFrom, to: climberFrom + expected, form: places });
      // The same arithmetic reads the side that fell for it downward.
      expect(fall).toMatchObject({ from: displacedFrom, to: displacedFrom - expected, form: -places });
    }
  });
});

describe('the ladder is worth more than a finish', () => {
  /**
   * A county read exactly right, with the division above standing at `company`
   * and a club promoted out of the second division on `promoted`.
   */
  function promotedMatch(seed: string, company: number, promoted: number) {
    const { state } = createTestGame(seed);
    readExactlyRight(state, 70, 5);
    const [top, second] = leagueCompetitions(state) as [Competition, Competition];
    divisionStandingAt(state, top, company);
    const promotedId = ladderClub(state, second, promoted, 20);
    return applySeasonStanding(state, [movementFor(state, second, promotedId, 'promoted')]);
  }

  it('lifts a promoted club to the company of the division it is joining', () => {
    // The division above stands at 45: two points more than the promotion alone
    // is worth, so anything above 46 is the lift rather than the bonus.
    const changes = promotedMatch('standing-promoted', 45, 40);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      from: 40,
      to: 45,
      form: 0,
      promoted: true,
      relegated: false,
    });
    expect(changes[0]!.to).toBeGreaterThan(40 + STANDING.promotionBonus);
  });

  it('will not carry a promoted club further than the summer it has had', () => {
    // The company is far above the club — sixty to its forty — and the lift
    // still stops eight points up, short of the division it is joining: a
    // promotion is a step, not a revolution.
    const changes = promotedMatch('standing-promotion-cap', 60, 40);

    expect(changes).toHaveLength(1);
    expect(changes[0]!.from).toBe(40);
    expect(changes[0]!.to).toBe(40 + STANDING.maxPromotionRise);
    expect(changes[0]!.to).toBeLessThan(60);
  });

  it('pays the promotion alone to a club already standing above the division it joins', () => {
    const changes = promotedMatch('standing-promotion-bonus', 45, 60);

    expect(changes).toHaveLength(1);
    expect(changes[0]!.from).toBe(60);
    expect(changes[0]!.to).toBe(60 + STANDING.promotionBonus);
  });

  it('lowers a relegated club by the ladder’s own weight', () => {
    const { state } = createTestGame('standing-relegated');
    readExactlyRight(state, 70, 5);
    const [, second] = leagueCompetitions(state) as [Competition, Competition];
    const relegatedId = ladderClub(state, second, 20, 40);

    const changes = applySeasonStanding(state, [movementFor(state, second, relegatedId, 'relegated')]);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      clubId: relegatedId,
      from: 20,
      to: 20 - STANDING.relegationHit,
      form: 0,
      promoted: false,
      relegated: true,
    });
  });

  it('leaves a club where it stands when its promotion is refused', () => {
    const { state } = createTestGame('standing-promotion-refused');
    readExactlyRight(state, 70, 5);
    const [, second] = leagueCompetitions(state) as [Competition, Competition];
    const promotedId = ladderClub(state, second, 40, 20);

    const changes = applySeasonStanding(state, [
      movementFor(state, second, promotedId, 'promoted', 'the club is still in administration'),
    ]);

    // The club stayed where it was, so its standing has no reason to move: a
    // refusal is the committee's decision, not a season.
    expect(changes).toEqual([]);
  });
});

describe('standing stays inside the county’s own scale', () => {
  it('clamps a promotion at the ceiling and a relegation at the floor', () => {
    const ceiling = createTestGame('standing-ceiling');
    readExactlyRight(ceiling.state, 70, 5);
    const [top, second] = leagueCompetitions(ceiling.state) as [Competition, Competition];
    divisionStandingAt(ceiling.state, top, 60);
    // A club the county already puts a point off the top of its scale, promoted:
    // the bonus and the lift would carry it past the scale, and the scale is
    // what stops them.
    const celebratedId = ladderClub(ceiling.state, second, STANDING.ceiling - 1, 20);
    const climbed = applySeasonStanding(ceiling.state, [
      movementFor(ceiling.state, second, celebratedId, 'promoted'),
    ]);
    expect(climbed).toHaveLength(1);
    expect(climbed[0]).toMatchObject({ to: STANDING.ceiling });

    const floor = createTestGame('standing-floor');
    readExactlyRight(floor.state, 70, 5);
    const [, doomed] = leagueCompetitions(floor.state) as [Competition, Competition];
    const doomedId = ladderClub(floor.state, doomed, STANDING.floor + 1, 40);
    const fell = applySeasonStanding(floor.state, [
      movementFor(floor.state, doomed, doomedId, 'relegated'),
    ]);
    expect(fell).toHaveLength(1);
    expect(fell[0]).toMatchObject({ to: STANDING.floor });
  });
});
