import type { ClubId, CompetitionId, MatchId, SeasonId } from './ids';

export type CompetitionKind = 'league' | 'cup';

/**
 * The shape of the local pyramid.
 *
 * Everything about the ladder is data rather than a constant scattered through
 * the simulation: how many divisions there are, how many clubs are in each, and
 * how many move across each boundary. A save carries its own copy, so a career
 * generated as a three-tier pyramid keeps being a three-tier pyramid after the
 * defaults change.
 */
export interface PyramidConfig {
  /** League divisions, numbered 1 (top) to `tiers`. */
  tiers: number;
  /** Clubs per division. */
  clubsPerTier: number;
  /** Places swapped across each internal boundary. */
  promotionPlaces: number;
  relegationPlaces: number;
  /** Whether the whole-pyramid League Cup runs. */
  leagueCup: boolean;
  /** Whether first-round losers get a consolation competition. */
  consolationCup: boolean;
}

export const DEFAULT_PYRAMID: PyramidConfig = {
  tiers: 3,
  clubsPerTier: 12,
  promotionPlaces: 2,
  relegationPlaces: 2,
  leagueCup: true,
  consolationCup: true,
};

/**
 * What a boundary did to a club.
 *
 * The permanent record of movement through the pyramid: which club, out of which
 * division, in which direction, and — where promotion was refused — why it was
 * refused. Kept on the save rather than only on the club's season line, because
 * a refusal is not something the club's own archive should have to carry.
 */
export interface MovementRecord {
  seasonId: SeasonId;
  seasonLabel: string;
  competitionId: CompetitionId;
  divisionName: string;
  /** Division the club was in when the boundary was settled: 1 is the top. */
  tier: number;
  clubId: ClubId;
  clubName: string;
  direction: 'promoted' | 'relegated';
  /** Set when promotion was refused; the club stayed where it was. */
  blockedReason?: string;
}

/**
 * One round of a knockout, as the competition was planned at the start of the
 * season.
 *
 * `field` is every club the round knows about — the ones playing and the ones
 * on a bye — while `entrants` is how many of them actually appear in a tie. The
 * gap between the two is the byes, and it is why a cup's opening round can hold
 * eight clubs in front of a round of thirty-two without anybody having to be
 * knocked out to make room.
 */
export interface CupRound {
  /** 1-based round number. */
  round: number;
  /** Clubs still in the competition when this round is drawn. */
  field: number;
  /**
   * Clubs that play a tie. Below `field` means the rest get a bye: they are
   * still in `competition.clubIds`, and a round that finishes reads them back
   * out as survivors because they never lost.
   */
  entrants: number;
}

/**
 * A knockout competition's own state.
 *
 * The ladder itself is held by the competition record; this is only the
 * progress *through* the knockout, which has no table and no standings. Ties
 * themselves are ordinary matches carrying this competition's id, so the bracket
 * is read back out of `state.matches` rather than stored twice.
 */
export interface CupState {
  /** Which round is being played, 1-based. */
  round: number;
  /** The club that has won it, once decided. */
  winnerClubId: ClubId | null;
  /** The club that lost the final. */
  runnerUpClubId: ClubId | null;
  /**
   * True once the last tie has been played. A cup that is complete is never
   * drawn again that season, which is what stops a re-entered team being given
   * a second run at it.
   */
  complete: boolean;
  /**
   * The competition whose first-round losers enter this one. Set on a
   * consolation cup and left absent everywhere else.
   */
  consolationFor?: CompetitionId;
  /**
   * How many matchdays this competition's rounds are numbered above the main
   * cup's.
   *
   * A cup round is numbered `leagueMatchdays + offset + round`, so two
   * competitions both counting from the league would put their first rounds on
   * the same midweek and a club eliminated by one would be asked to play the
   * other on the same night. The consolation cup takes the main cup's round
   * count as its offset, which puts it strictly after.
   */
  matchdayOffset?: number;
  /**
   * How many clubs each round holds, fixed when the season was built.
   *
   * Stored rather than recomputed because the shape of a cup depends on how many
   * clubs entered it, and that number changes under the competition's feet as
   * clubs are relegated out of the pyramid. A competition with no plan is a
   * pre-planning save, and is read as a plain knockout with no byes.
   */
  plan?: CupRound[];
}

export interface Competition {
  id: CompetitionId;
  name: string;
  kind: CompetitionKind;
  /** 1 = top of the local pyramid. 0 for a cup. */
  tier: number;
  seasonId: SeasonId;
  clubIds: ClubId[];
  /** Places that go up at the boundary above. Undefined at the top division. */
  promotionPlaces?: number;
  /** Places that go down at the boundary below. Undefined at the bottom. */
  relegationPlaces?: number;
  /** Knockout progress. Present on cups only. */
  cup?: CupState;
}

/** True for a competition whose clubs sit in a division with a table. */
export function isLeague(competition: Competition | undefined): boolean {
  return competition?.kind === 'league';
}

/** True for a knockout. */
export function isCup(competition: Competition | undefined): boolean {
  return competition?.kind === 'cup';
}

/**
 * Friendlies are not a competition the world runs.
 *
 * Nothing is at stake, so they have no competition record, no table and no
 * effect on the season's figures — but they are still football, and still the
 * way a squad gets fit and a new shape gets tried out.
 */
export const FRIENDLY_COMPETITION_ID: CompetitionId = 'friendly';
export const FRIENDLY_COMPETITION_NAME = 'Pre-season friendly';

export interface FixtureList {
  competitionId: CompetitionId;
  /** matchday number (1-based) -> match ids. */
  byMatchday: Record<number, MatchId[]>;
  /** match id -> matchday. */
  matchdayOf: Record<MatchId, number>;
}

/** An empty fixture list for a competition that has not been drawn yet. */
export function emptyFixtureList(competitionId: CompetitionId): FixtureList {
  return { competitionId, byMatchday: {}, matchdayOf: {} };
}
