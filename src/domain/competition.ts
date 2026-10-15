import type { ClubId, CompetitionId, CountyId, MatchId, PyramidId, RegionId, SeasonId } from './ids';
import { FOUNDING_COUNTY_ID } from './world';

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
 * The shape the county's second ladder is founded with.
 *
 * The same three divisions of twelve and the same two cups as the founding
 * county, because a district next door is the same sort of place with the same
 * sort of football in it. It was founded with its cups turned off, while the
 * calendar held one cup lane and two ladders' cups would have collided on it;
 * the lanes exist now, so a district's League Cup and Plate are drawn and played
 * on the same Sundays as the county's own — the two fields have no club in
 * common, which is what makes that safe — and the county cup takes the afternoons
 * neither of them can use.
 *
 * Kept as its own constant rather than folded into `DEFAULT_PYRAMID` because the
 * two answer different questions: that one is the shape a *county* is founded
 * with, this is what a district next door is given, and a later stage that wants
 * the district's ladder to be shorter, or its promotions to be fewer, changes it
 * here without touching the county the player has always played in.
 */
export const SECOND_PYRAMID_CONFIG: PyramidConfig = {
  ...DEFAULT_PYRAMID,
};

/**
 * One local ladder of football, and everything it owns.
 *
 * A pyramid is not a competition: it is the ladder the competitions belong to.
 * Its id is also the prefix of every competition id it owns — the founding
 * pyramid is `league`, so it owns `comp_league_t1`, `comp_league_cup` and
 * `comp_plate` — and that is the whole reason a second ladder can be founded
 * without renaming a single competition in a career that is already being
 * played.
 */
export interface Pyramid {
  /** Also the id prefix of every competition it owns: 'league' → comp_league_t1. */
  id: PyramidId;
  /** 'Alderford Sunday League'. */
  name: string;
  /** The region it draws its clubs from. */
  regionId: RegionId;
  /**
   * 1 = the county's strongest ladder. A rung of a second pyramid at level 2 is
   * a level of football below the founding top division, whatever its own tier
   * number says, which is what separates "rung" from "level" (see `levelOf`).
   */
  level: number;
  /** Tiers, clubs per tier, places swapped at a boundary, and whether cups run. */
  config: PyramidConfig;
  /** The divisions it owns, tier 1 first. */
  competitionIds: CompetitionId[];
  /** The cups it runs, and no other. */
  cupIds: CompetitionId[];
}

/**
 * The id of the pyramid every career begins with.
 *
 * It is `league` because that is already the prefix of every competition id the
 * game has ever written, so the founding ladder keeps its own name and nothing
 * is re-homed.
 */
export const FOUNDING_PYRAMID_ID: PyramidId = 'league';

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
 * Where a cup's entrants come from.
 *
 * A competition says so itself rather than having it inferred from the shape of
 * its id, because the world's cups are drawn from three different populations:
 * a ladder's own cup from that ladder's divisions, a county cup from the clubs
 * of one county whatever ladder they play on, and an invitation cup from a list
 * somebody wrote down. Ownership is a separate question with a separate answer —
 * `Pyramid.cupIds` — because a cup the whole county plays in belongs to no
 * ladder at all.
 *
 * A county's field names its county, so two counties' cups are two fields rather
 * than one population read twice: a cup that says nothing about which county it
 * belongs to is the career's own, which is exactly what every county cup written
 * before counties had ids meant, and is the founding county's for as long as a
 * career has one.
 */
export type CupField =
  | { kind: 'pyramid'; pyramidId: PyramidId }
  | { kind: 'county'; countyId?: CountyId }
  | { kind: 'invitation'; clubIds: ClubId[] };

/**
 * The one place an absent field becomes a field.
 *
 * A cup that says nothing about its field is the founding pyramid's own, which
 * is what every cup written before fields existed meant and what every ladder's
 * own cup still means. Resolving it here rather than at each reader is what keeps
 * a legacy save readable by the season builder, the cup generation and anything
 * else that asks without three copies of the same fallback.
 */
export function cupFieldOf(cup: CupState | undefined): CupField {
  return cup?.field ?? { kind: 'pyramid', pyramidId: FOUNDING_PYRAMID_ID };
}

/**
 * The field as it is *stored*: the founding pyramid's own, and the founding
 * county's own, are left unsaid.
 *
 * Absent already means the founding pyramid exactly, so a ladder's own cup writes
 * nothing and a save written before fields existed is shaped exactly like one
 * written after. The founding county's cup is stored as a plain `county` field
 * for the same reason: every county cup ever written says that, and a career with
 * one county is the career that field was always about. Anything else — another
 * ladder's field, another county's, an invitation — is written down, because for
 * those the silence would mean the wrong thing.
 */
export function storedCupField(field: CupField): CupField | undefined {
  if (field.kind === 'pyramid' && field.pyramidId === FOUNDING_PYRAMID_ID) return undefined;
  if (field.kind === 'county' && (field.countyId === undefined || field.countyId === FOUNDING_COUNTY_ID)) {
    return { kind: 'county' };
  }
  return field;
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
  /**
   * Where its entrants come from. Absent means the founding pyramid's own — see
   * {@link cupFieldOf} — which is what every cup in a one-pyramid career means,
   * and a `county` field without a county id means the career's own county.
   */
  field?: CupField;
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
