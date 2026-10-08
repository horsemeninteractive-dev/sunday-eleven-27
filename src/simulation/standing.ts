import type { GameState } from '@/domain/game';
import type { ClubId } from '@/domain/ids';
import type { MovementRecord } from './pyramid';
import { leagueCompetitions, standingsFor } from './pyramid';

/**
 * What a season does to a club's standing.
 *
 * Reputation is the county's opinion of a club, and until now it was a fact
 * about the day the world was generated: the only thing that could move it was
 * going into administration. A club could be promoted three times and its
 * standing would not budge, so the ladder had no reward in it — the rungs were
 * held up by their members' reputation and nothing ever climbed. This is the
 * missing half of the ladder: a good finish lifts a club and a bad one lowers
 * it, and promotion is worth more than either.
 *
 * Three ideas, and that is the whole model:
 *
 *  - **A finish is read against expectation**, not against the table alone. A
 *    club's standing already predicts roughly where it should finish in the
 *    division it is in — order the division by reputation and that is the
 *    expectation — so a side that ends the season above its own standing has
 *    done better than the county thought it would, and one below has done worse.
 *    This is what keeps the model from running away: a club that keeps winning
 *    keeps climbing until its standing catches up with its results, and then a
 *    mid-table finish stops moving it at all. Reputation converges on the truth
 *    about a side instead of drifting to a wall.
 *  - **Going up or down a division is worth more than a place or two**, because
 *    it is not an opinion — it is the level the club now plays at. A promoted
 *    club is lifted, and a promoted club whose standing is still far below the
 *    division it is entering is lifted *to* that division's company, because a
 *    rung of the ladder is a level of football and a club promoted into it is
 *    playing there next season whatever the county used to think.
 *  - **It is bounded, and slow.** A season moves a club by a few points at most
 *    and the county's scale has a floor and a ceiling, so a career is a story
 *    about clubs rather than a random walk: sixteen seasons of good management
 *    built a club up, and one bad one does not undo it.
 *
 * Nothing is stored that was not already there: `club.reputation` is the same
 * field the world generator wrote, so an old save wakes up with its standing
 * intact and starts moving from the next boundary.
 */

export const STANDING = {
  /**
   * How much one place above or below expectation is worth, before rounding.
   *
   * Deliberately small: finishing six places above the county's reading of a
   * side is worth a couple of points, not ten. A club's standing should be a
   * slow-moving judgement, and it has to stay slower than the football, or the
   * ladder turns into a taxi meter.
   */
  perPlace: 0.4,
  /** The most a finish alone can move a club, in either direction. */
  maxFormMovement: 2,
  /** What going up a division is worth on its own, and what coming down costs. */
  promotionBonus: 3,
  relegationHit: 3,
  /**
   * The most a promotion can lift a club in one summer, including the lift to
   * the level of the division it is joining.
   *
   * Capped because the alternative is a yo-yo club whose standing doubles in a
   * season and takes the county's best players with it; a promotion is a step,
   * not a revolution.
   */
  maxPromotionRise: 8,
  /** The county's scale. Below this nobody is a club worth watching; above it, nobody is better. */
  floor: 8,
  ceiling: 90,
} as const;

export interface StandingChange {
  clubId: ClubId;
  name: string;
  from: number;
  to: number;
  /** 1 is the top division. */
  tier: number;
  position: number | null;
  /** Places finished above (positive) or below (negative) the club's standing expected. */
  form: number;
  promoted: boolean;
  relegated: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Where each club in a division was expected to finish, from standing alone.
 *
 * Ties are broken by club id so the same world always produces the same
 * expectation: this is a judgement about a season, and it must not depend on the
 * order a record happened to be enumerated in.
 */
function expectedOrder(state: GameState, clubIds: readonly ClubId[]): Map<ClubId, number> {
  const ordered = [...clubIds].sort((a, b) => {
    const reputationA = state.clubs[a]?.reputation ?? 0;
    const reputationB = state.clubs[b]?.reputation ?? 0;
    if (reputationA !== reputationB) return reputationB - reputationA;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return new Map(ordered.map((clubId, index) => [clubId, index + 1]));
}

/** The standing a division's company carries, as the level a promoted club joins. */
function divisionFloor(state: GameState, tier: number): number | null {
  const division = leagueCompetitions(state).find((competition) => competition.tier === tier);
  if (!division || division.clubIds.length === 0) return null;
  const reputations = division.clubIds
    .map((clubId) => state.clubs[clubId]?.reputation)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b);
  if (reputations.length === 0) return null;
  // The bottom quarter of the division: the standard a side needs to be a member
  // of it rather than a visitor. Not the median — a promoted club is the weakest
  // thing in the division until it proves otherwise, and that is exactly what it
  // should be paid for.
  const index = Math.floor((reputations.length - 1) * 0.25);
  if (tier <= 1) return null;
  return reputations[index]!;
}

/**
 * Move every club's standing to where this season says it belongs.
 *
 * Called at the season boundary, once the final tables are the archive and the
 * ladder's movements are known. Returns what changed, so a caller (the soak, a
 * test, the news) can read it rather than guess.
 */
export function applySeasonStanding(state: GameState, movements: readonly MovementRecord[]): StandingChange[] {
  const changes: StandingChange[] = [];
  const movementByClub = new Map<ClubId, MovementRecord>();
  for (const movement of movements) movementByClub.set(movement.clubId, movement);

  for (const competition of leagueCompetitions(state)) {
    const standings = standingsFor(state, competition);
    const expected = expectedOrder(state, competition.clubIds);

    standings.forEach((row, index) => {
      const club = state.clubs[row.clubId];
      if (!club) return;
      const position = index + 1;
      const expectedPosition = expected.get(club.id) ?? position;
      const movement = movementByClub.get(club.id);
      const promoted = Boolean(movement && movement.direction === 'promoted' && !movement.blockedReason);
      const relegated = Boolean(movement && movement.direction === 'relegated');

      const previous = club.reputation;
      let next = previous;
      // How the season went, against what the county thought of the club before
      // a ball was kicked.
      next += clamp(Math.round((expectedPosition - position) * STANDING.perPlace), -STANDING.maxFormMovement, STANDING.maxFormMovement);
      if (promoted) next += STANDING.promotionBonus;
      if (relegated) next -= STANDING.relegationHit;

      if (promoted) {
        // A promoted club joins a division, and its standing is lifted towards
        // that division's company: the level it plays at next season is a fact,
        // and the county's opinion of it can only lag so far behind.
        const floor = divisionFloor(state, competition.tier - 1);
        if (floor !== null) next = Math.max(next, Math.min(floor, previous + STANDING.maxPromotionRise));
      }

      next = clamp(next, STANDING.floor, STANDING.ceiling);
      if (next === previous) return;
      club.reputation = next;
      changes.push({
        clubId: club.id,
        name: club.identity.name,
        from: previous,
        to: next,
        tier: competition.tier,
        position,
        form: expectedPosition - position,
        promoted,
        relegated,
      });
    });
  }

  return changes;
}
