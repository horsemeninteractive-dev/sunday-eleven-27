import type { Club, StandingRow } from '@/domain/club';
import type { Competition, FixtureList, Pyramid } from '@/domain/competition';
import {
  cupFieldOf,
  DEFAULT_PYRAMID,
  emptyFixtureList,
  FOUNDING_PYRAMID_ID,
  isCup,
  isLeague,
} from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { ClubId, CompetitionId, CountyId, PersonId, PyramidId, RegionId, TownId } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';
import { FOUNDING_COUNTY_ID, FOUNDING_COUNTY_NAME, FOUNDING_REGION_ID, type County } from '@/domain/world';
import { computeStandings } from './league';
import { createEvent } from './news';

/**
 * The local pyramid.
 *
 * A division is not a special kind of competition — it is a competition with a
 * tier, a set of clubs and a table — so most of the work here is not about the
 * ladder itself but about the handful of questions the rest of the simulation
 * used to answer by taking the first competition it could find:
 *
 *   - which division is this club in?
 *   - which division is this club's *next* fixture in?
 *   - whose subs are being collected on Friday?
 *
 * Every one of them is a question about a club, not about a competition, and
 * answering it by club is what lets three divisions share one calendar, one
 * matchday counter and one day loop.
 *
 * The county can hold more than one ladder, so a question about a *ladder* is
 * asked of a pyramid by id. The founding pyramid's id is `league`, and it is the
 * default wherever a caller means "the county's football" rather than "a
 * particular ladder" — which is what every caller in a one-pyramid world means.
 */

/** The id of the ladder a career's world reads first: the founding pyramid. */
export function foundingPyramidId(state: GameState): PyramidId {
  return state.pyramidIds?.[0] ?? FOUNDING_PYRAMID_ID;
}

/**
 * One ladder of the county, by id — the founding one unless told otherwise.
 *
 * A career written before pyramids existed has no record to hand back, and
 * neither has a pyramid whose entry has gone missing. Rather than returning
 * nothing and taking every caller down with it, the founding id is answered
 * from the competitions the world actually has, and any other id is answered
 * with a pyramid that owns nothing — so an unknown ladder yields no divisions
 * rather than the wrong ones.
 */
export function pyramidOf(state: GameState, pyramidId: PyramidId = foundingPyramidId(state)): Pyramid {
  const stored = state.pyramids?.[pyramidId];
  if (stored) return stored;
  if (pyramidId !== foundingPyramidId(state)) return { ...foundingPyramid(state), id: pyramidId, competitionIds: [], cupIds: [] };
  return foundingPyramid(state);
}

/** The county's ladders, founding pyramid first. */
export function pyramidsOf(state: GameState): Pyramid[] {
  const ids = state.pyramidIds?.length ? state.pyramidIds : [foundingPyramidId(state)];
  return ids.map((pyramidId) => pyramidOf(state, pyramidId));
}

/**
 * The founding ladder, read from the world itself: the divisions that exist, the
 * cups that were drawn, and the shape the career was generated with.
 *
 * This is the answer for a career whose pyramid record is missing entirely — a
 * save written before ladders existed, or a state built by hand — so it has to
 * read ownership off the world rather than off a record. A cup is claimed when
 * its *field* says the founding ladder owns it, and not merely because it is a
 * cup: a cup with no field at all is the founding ladder's own (which is what
 * every cup written before fields meant), while a county cup's field is the whole
 * county and a county cup belongs to no ladder. Claiming every cup in the world
 * would put a world-level competition in a ladder's `cupIds`, and from there into
 * every view and rollover that reads a ladder's cups as its own business.
 */
function foundingPyramid(state: GameState): Pyramid {
  const legacy = state as GameState & { pyramid?: Pyramid['config'] };
  return {
    id: FOUNDING_PYRAMID_ID,
    name: `${state.world?.regionName ?? 'County'} Sunday League`,
    regionId: state.world?.regionIds?.[0] ?? FOUNDING_REGION_ID,
    level: 1,
    config: legacy.pyramid ?? DEFAULT_PYRAMID,
    competitionIds: leagueCompetitions(state).map((competition) => competition.id),
    cupIds: cupCompetitions(state)
      .filter((competition) => {
        const field = cupFieldOf(competition.cup);
        return field.kind === 'pyramid' && field.pyramidId === FOUNDING_PYRAMID_ID;
      })
      .map((competition) => competition.id),
  };
}

/** The competitions a pyramid owns, in tier order (1 first). */
export function divisionsOf(state: GameState, pyramidId: PyramidId = foundingPyramidId(state)): Competition[] {
  const divisions: Competition[] = [];
  for (const competitionId of pyramidOf(state, pyramidId).competitionIds) {
    const competition = state.competitions[competitionId];
    if (competition && isLeague(competition)) divisions.push(competition);
  }
  return divisions.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}

/**
 * Which pyramid owns a competition, if any.
 *
 * Ownership is the pyramid's own list rather than the shape of the id, so a
 * competition can only ever belong to the ladder that says it does.
 */
export function pyramidForCompetition(state: GameState, competition: Competition): Pyramid | undefined {
  for (const pyramidId of state.pyramidIds ?? []) {
    const pyramid = state.pyramids?.[pyramidId];
    if (!pyramid) continue;
    if (pyramid.competitionIds.includes(competition.id) || pyramid.cupIds.includes(competition.id)) {
      return pyramid;
    }
  }
  return undefined;
}

/** The id of the pyramid that owns a competition, or null when none does. */
export function pyramidIdOf(state: GameState, competition: Competition): PyramidId | null {
  return pyramidForCompetition(state, competition)?.id ?? null;
}

/**
 * Every competition with a table, in tier order (1 first), across the world.
 *
 * This is the whole county's football rather than one ladder: use
 * `divisionsOf(state, pyramidId)` wherever one pyramid's ordered divisions are
 * what is actually wanted.
 */
export function leagueCompetitions(state: GameState): Competition[] {
  return Object.values(state.competitions)
    .filter(isLeague)
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}

/** Every knockout in the world, in draw order. */
export function cupCompetitions(state: GameState): Competition[] {
  return Object.values(state.competitions)
    .filter(isCup)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A competition by id, or undefined when the world has never heard of it. */
export function competitionOf(state: GameState, competitionId: CompetitionId | null | undefined): Competition | undefined {
  return competitionId ? state.competitions[competitionId] : undefined;
}

/** The division a club is in this season, or undefined if it is in no league. */
export function divisionOf(state: GameState, clubId: ClubId): Competition | undefined {
  return leagueCompetitions(state).find((competition) => competition.clubIds.includes(clubId));
}

/** Which tier a club is in: 1 is the top. Null when it is in no league. */
export function tierOf(state: GameState, clubId: ClubId): number | null {
  return divisionOf(state, clubId)?.tier ?? null;
}

/**
 * Which level of football a club plays at: 1 is the county's strongest.
 *
 * A tier is a rung *within* a ladder, and two ladders of different standing both
 * start at tier 1 — so a reader that means the level of football a club plays at
 * (what a crowd is worth, what a sponsor pays, what a committee expects) asks
 * this, and a reader that means the rung reads `tier`. With one pyramid the two
 * are the same number.
 */
export function levelOf(state: GameState, clubId: ClubId): number | null {
  const division = divisionOf(state, clubId);
  if (!division) return null;
  const pyramid = pyramidForCompetition(state, division);
  return (pyramid?.level ?? 1) + division.tier - 1;
}

/** The division one tier below (numerically higher) — where a relegated club goes. */
export function divisionBelow(state: GameState, competition: Competition): Competition | undefined {
  return adjacentDivision(state, competition, 1);
}

/** The division one tier above — where a promoted club goes. */
export function divisionAbove(state: GameState, competition: Competition): Competition | undefined {
  return adjacentDivision(state, competition, -1);
}

/**
 * The division a step up (-1) or down (+1) the ladder from this one.
 *
 * The step is taken through the pyramid's own ordered divisions rather than by
 * looking for a competition numbered one tier away, because the county has more
 * than one ladder: a worldwide search for "the division at tier 2" would hand a
 * club promoted out of one pyramid's bottom division the *other* pyramid's
 * second division. A competition no pyramid claims is read against the founding
 * ladder, which is the only ladder a one-pyramid world has ever had.
 */
function adjacentDivision(state: GameState, competition: Competition, step: 1 | -1): Competition | undefined {
  const pyramid = pyramidForCompetition(state, competition) ?? pyramidOf(state);
  const divisions = divisionsOf(state, pyramid.id);
  const index = divisions.findIndex((entry) => entry.id === competition.id);
  if (index < 0) return undefined;
  return divisions[index + step];
}

/**
 * The name of the region a pyramid draws its clubs from.
 *
 * Division names are built from it, so a second ladder's divisions are named
 * after its own region rather than the founding one's. A pyramid whose region the
 * world no longer holds — or a career written before regions existed — reads the
 * county's own name, which is the name the founding pyramid has always used.
 */
export function regionNameFor(state: GameState, pyramidId: PyramidId): string {
  const regionId = pyramidOf(state, pyramidId).regionId;
  return state.world?.regions?.[regionId]?.name ?? state.world?.regionName ?? 'County';
}

// ---------------------------------------------------------------------------
// Counties
// ---------------------------------------------------------------------------

/**
 * The id of the county a career is played in.
 *
 * The founding county: the only one a career has ever been generated with, and
 * the one every save written before counties existed belongs to. Read from the
 * world so a world that names a different county first is answered as it says,
 * and falling back to the founding id for a state the migration has not been
 * through.
 */
export function foundingCountyId(state: GameState): CountyId {
  return state.world?.countyIds?.[0] ?? FOUNDING_COUNTY_ID;
}

/**
 * One county of the world, by id — the career's own unless told otherwise.
 *
 * A save written before counties existed has one county's worth of world and no
 * record of it, and neither has a state built by hand. Rather than returning
 * nothing and taking every caller down with it, the founding county is answered
 * from the world it is the county of — the same way `foundingPyramid` answers for
 * a career whose ladder record is missing — and any other unknown county is
 * answered as a county that owns nothing, so an unknown id yields no football
 * rather than the wrong county's.
 */
export function countyOf(state: GameState, countyId: CountyId = foundingCountyId(state)): County {
  const stored = state.world?.counties?.[countyId];
  if (stored) return stored;
  // A world that *has* counties but not this one genuinely does not have it, and
  // a county with no regions owns no football.
  if (Object.keys(state.world?.counties ?? {}).length > 0) {
    return { id: countyId, name: countyId, regionIds: [] };
  }
  return {
    id: countyId,
    name: state.world?.countyName || FOUNDING_COUNTY_NAME,
    regionIds: [...(state.world?.regionIds ?? [])],
  };
}

/** Every county the world has, in the order it reads them. */
export function countiesOf(state: GameState): County[] {
  const ids = state.world?.countyIds?.length ? state.world.countyIds : [foundingCountyId(state)];
  return ids.map((countyId) => countyOf(state, countyId));
}

/**
 * The county a region is a piece of, or null when the world does not hold it.
 *
 * Read from the region itself, and read as the founding county's for a region
 * written before counties existed — which is the same reading
 * `migrateToCounties` writes down when it gives a save its county.
 */
export function countyIdOfRegion(state: GameState, regionId: RegionId): CountyId | null {
  const region = state.world?.regions?.[regionId];
  if (!region) return null;
  return region.countyId ?? foundingCountyId(state);
}

/**
 * The county a town is in.
 *
 * Read from the town's own `countyId`, and — for a town written before counties
 * existed, or one whose world does not hold its region — from its region, and
 * then from the founding county. The forgiveness is deliberate and is the same
 * one the region migration has: a career written before any of this existed keeps
 * the entrants its cups have always had.
 */
export function countyIdOfTown(state: GameState, townId: TownId): CountyId {
  const town = state.world?.towns?.[townId];
  if (!town) return foundingCountyId(state);
  if (town.countyId) return town.countyId;
  return countyIdOfRegion(state, town.regionId) ?? foundingCountyId(state);
}

/**
 * The county a club belongs to: the one its town is in.
 *
 * Read from the town and never from the division, so a club cannot be entered in
 * a county cup by changing league and cannot leave its county's cup by being
 * promoted out of it. Null only for a club the world does not hold at all.
 */
export function countyIdOfClub(state: GameState, clubId: ClubId): CountyId | null {
  const club = state.clubs?.[clubId];
  if (!club) return null;
  return countyIdOfTown(state, club.townId);
}

/**
 * The county a ladder belongs to: the one the region it draws its clubs from is
 * in. Null for a ladder whose region the world does not hold, which is a ladder
 * with no football in this world to belong to.
 */
export function countyIdOfPyramid(state: GameState, pyramidId: PyramidId): CountyId | null {
  const regionId = pyramidOf(state, pyramidId).regionId;
  if (!state.world?.regions?.[regionId]) {
    // A world with no regions at all has one county and nothing to tell two
    // apart with: every ladder it has is the founding county's, which is the
    // reading a world that predates regions has always been given. A world that
    // *has* regions but not this one holds a ladder with no football to belong
    // to, and answering any county would be inventing one.
    return Object.keys(state.world?.regions ?? {}).length === 0 ? foundingCountyId(state) : null;
  }
  return countyIdOfRegion(state, regionId);
}

/** The ladders one county owns, in the order the world reads them. */
export function pyramidIdsOfCounty(state: GameState, countyId: CountyId): PyramidId[] {
  return pyramidsOf(state)
    .filter((pyramid) => countyIdOfPyramid(state, pyramid.id) === countyId)
    .map((pyramid) => pyramid.id);
}

/**
 * Every active club in a county, strongest first.
 *
 * A county read as one population rather than as ladders: the clubs a county cup
 * enters, and the ranking divisions are cut from. A club belongs to the county its
 * town is in — never to the county of a division it happens to be in — so a second
 * county's cup cannot reach a club of the first, and no cup's field has to be
 * inferred from a name, a reputation or an array position. A folded club is not in
 * it: `active` is the whole test, which is what stops a cup drawing a club that no
 * longer plays.
 */
export function countyClubIds(state: GameState, countyId: CountyId = foundingCountyId(state)): ClubId[] {
  return Object.values(state.clubs)
    .filter((club) => club.active && countyIdOfClub(state, club.id) === countyId)
    .map((club) => club.id)
    .sort((a, b) => {
      const repA = state.clubs[a]?.reputation ?? 0;
      const repB = state.clubs[b]?.reputation ?? 0;
      return repB - repA || a.localeCompare(b);
    });
}

/**
 * The clubs one ladder holds, tier 1 first, as the world has it recorded.
 *
 * A ladder's membership is its divisions' — the season builder writes them, and
 * `applyMovements` is the only other writer — so this is the ladder as it stands,
 * not as it is being built.
 */
export function pyramidClubIds(state: GameState, pyramidId: PyramidId): ClubId[] {
  return divisionsOf(state, pyramidId).flatMap((division) => [...division.clubIds]);
}

/**
 * The clubs an invitation names, less the ones the world cannot enter.
 *
 * Nothing is added: an invitation is the list somebody wrote down, in that order,
 * with a club the world has never heard of or one that has folded dropped out.
 * A folded club in a cup would be a tie nobody turns up for.
 */
export function invitedClubIds(state: GameState, clubIds: readonly ClubId[]): ClubId[] {
  const seen = new Set<ClubId>();
  const invited: ClubId[] = [];
  for (const clubId of clubIds) {
    if (seen.has(clubId)) continue;
    const club = state.clubs[clubId];
    if (!club || !club.active) continue;
    seen.add(clubId);
    invited.push(clubId);
  }
  return invited;
}

/** Every club playing in any league, de-duplicated and in tier order. */
export function leagueClubIds(state: GameState): ClubId[] {
  const seen = new Set<ClubId>();
  const ids: ClubId[] = [];
  for (const competition of leagueCompetitions(state)) {
    for (const clubId of competition.clubIds) {
      if (seen.has(clubId)) continue;
      seen.add(clubId);
      ids.push(clubId);
    }
  }
  return ids;
}

/** Every club that is playing anything at all this season. */
export function activeClubIds(state: GameState): ClubId[] {
  const ids = new Set<ClubId>(leagueClubIds(state));
  for (const cup of cupCompetitions(state)) for (const clubId of cup.clubIds) ids.add(clubId);
  return [...ids].filter((clubId) => state.clubs[clubId]?.active);
}

/**
 * The competition the manager's own club plays in, and the one every screen
 * should open on when it has not been told otherwise.
 */
export function userCompetition(state: GameState): Competition | undefined {
  return divisionOf(state, state.userClubId) ?? leagueCompetitions(state)[0];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The fixture list for a competition, created empty if it has none.
 *
 * Every competition in the world has one from the moment it exists — a club that
 * folds and a draw that has not happened yet are both just an empty list, so
 * there is no "is this competition drawn?" branch anywhere else.
 */
export function fixtureListFor(state: GameState, competitionId: CompetitionId): FixtureList {
  const existing = state.fixtures?.[competitionId];
  if (existing) return existing;
  if (!state.fixtures) state.fixtures = {};
  const created = emptyFixtureList(competitionId);
  state.fixtures[competitionId] = created;
  return created;
}

/** A competition's fixture list without creating one. */
export function readFixtureList(state: GameState, competitionId: CompetitionId): FixtureList | undefined {
  return state.fixtures?.[competitionId];
}

/** Every fixture on a matchday, across every competition that has one. */
export function fixtureIdsOnMatchday(state: GameState, matchday: number): string[] {
  const ids: string[] = [];
  for (const list of Object.values(state.fixtures ?? {})) {
    ids.push(...(list.byMatchday[matchday] ?? []));
  }
  return ids;
}

/** The fixture ids for a matchday in one competition. */
export function fixtureIdsFor(state: GameState, competitionId: CompetitionId, matchday: number): string[] {
  return readFixtureList(state, competitionId)?.byMatchday[matchday] ?? [];
}

/** Put a match on the calendar of the competition it belongs to. */
export function registerFixture(state: GameState, competitionId: CompetitionId, matchId: string, matchday: number): void {
  const list = fixtureListFor(state, competitionId);
  list.byMatchday[matchday] = [...(list.byMatchday[matchday] ?? []), matchId];
  list.matchdayOf[matchId] = matchday;
  if (!state.matchOrder.includes(matchId)) state.matchOrder.push(matchId);
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

/** One division's table, derived from its own played matches. */
export function standingsFor(state: GameState, competition: Competition): StandingRow[] {
  return computeStandings({
    clubIds: competition.clubIds,
    matches: Object.values(state.matches),
    competitionId: competition.id,
    clubName: (id) => state.clubs[id]?.identity.name ?? id,
  });
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

const ORDINALS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];

/** "Alderford Sunday League Division Two". */
export function divisionNameFor(regionName: string, tier: number): string {
  const ordinal = ORDINALS[tier] ?? String(tier);
  return `${regionName} Sunday League Division ${ordinal}`;
}

/**
 * The competition id for a division, stable across seasons of a career.
 *
 * The pyramid's id is the prefix, so the founding pyramid's divisions keep the
 * ids they have always had (`comp_league_t1`) and a second ladder's are named
 * after it (`comp_vale_t1`) without either colliding with the other.
 */
export function divisionCompetitionId(pyramidId: PyramidId, tier: number): CompetitionId {
  return `comp_${pyramidId}_t${tier}`;
}

export const LEAGUE_CUP_ID: CompetitionId = 'comp_league_cup';
export const LEAGUE_CUP_NAME = 'Sunday League Cup';
/**
 * The founding pyramid's Plate. Its id predates the `comp_<pyramid>_` convention
 * and is left exactly as it is: it is the one cup id that would move if the
 * naming were applied to it, and a save's Plate is not worth renaming.
 */
export const PLATE_ID: CompetitionId = 'comp_plate';
export const PLATE_NAME = 'Sunday League Plate';
/**
 * The county's own cup: the one competition no ladder runs.
 *
 * Its id is not built from a pyramid's, because it has no pyramid: the county
 * cup is the whole county's, drawn from every active club whichever ladder it
 * plays on, and its ownership is nobody's — which is exactly what
 * `pyramidIdOf`'s null means and why every reader of it has to tolerate one.
 */
export const COUNTY_CUP_ID: CompetitionId = 'comp_county_cup';

/**
 * The competition id of a county's cup.
 *
 * The founding county keeps the id its cup has always had — `comp_county_cup` —
 * so no career written before a county had an id re-homes a trophy. Every other
 * county's cup is named after its own id (`comp_cup_county_2`), which is stable,
 * opaque and derived from nothing a rename can move. The two can never collide:
 * one cup per county, and one county per id.
 */
export function countyCupId(countyId: CountyId = FOUNDING_COUNTY_ID): CompetitionId {
  return countyId === FOUNDING_COUNTY_ID ? COUNTY_CUP_ID : `comp_cup_${countyId}`;
}

/**
 * A county's cup, named after the county it is the cup of.
 *
 * A cup belongs to the football it is drawn from, and a county cup is drawn from
 * every club in its own county whichever ladder it plays on — so it carries the
 * county's name rather than the word for the kind of thing it is. "County Cup"
 * was nobody's competition in particular: two counties' cups would read the
 * same, and a manager reading a bracket should be able to say which county's he
 * is in without being told. The founding county's is therefore 'Alderfordshire
 * County Cup', which is what its cup has been called since the county was named.
 */
export function countyCupName(countyName: string): string {
  return `${countyName} County Cup`;
}

/** The founding county's cup: the one every save's own cup has always been. */
export const COUNTY_CUP_NAME = countyCupName(FOUNDING_COUNTY_NAME);

/**
 * The name of one of a ladder's cups.
 *
 * A cup belongs to the district its ladder draws its clubs from, so it is named
 * after it — `Alderford Sunday League Cup`, `Westbrook Valley Sunday League
 * Plate` — for the same reason its divisions are. The district's name is the
 * map's, so a manager who chose Alderford reads Alderford on both his trophies,
 * which is the whole of what a name is for.
 *
 * Every ladder is named this way, the founding one included: its two cups used to
 * carry the bare 'Sunday League Cup' and 'Sunday League Plate' from the days when
 * a career had one ladder and no district to name it after, and a career still
 * reads *a* Sunday League Cup — its own. A save written then is brought forward
 * with its trophies by `nameTheLadderCups`.
 *
 * One name per ladder is not only a display rule. An honour is a string,
 * `${season} ${name} winners`, so two ladders' cups sharing a name would file one
 * ladder's winner under the other's trophy — one honour on two clubs, which is
 * what the soak's `honours-not-duplicated` reads.
 */
export function cupNameFor(regionName: string, kind: 'cup' | 'plate'): string {
  return `${regionName} ${kind === 'cup' ? LEAGUE_CUP_NAME : PLATE_NAME}`;
}

/**
 * The competition id for one of a pyramid's cups.
 *
 * Every other pyramid's cups are named after the ladder that runs them —
 * `comp_vale_cup`, `comp_vale_plate` — so no two ladders can claim one id.
 */
export function cupCompetitionId(pyramidId: PyramidId, kind: 'cup' | 'plate'): CompetitionId {
  if (kind === 'plate' && pyramidId === FOUNDING_PYRAMID_ID) return PLATE_ID;
  return `comp_${pyramidId}_${kind}`;
}

// ---------------------------------------------------------------------------
// Promotion and relegation
// ---------------------------------------------------------------------------

/**
 * Whether a club may be admitted to the division above.
 *
 * Two rules, and both are the ones a real committee enforces: you must have a
 * ground to play on that is fit to host league football, and you must not be a
 * club in administration. A club that fails either is not promoted — the
 * boundary promotes the next club down instead, so the division above never
 * runs a club short and the ladder never has a hole in it.
 */
export interface Eligibility {
  eligible: boolean;
  reason: string | null;
}

export function promotionEligibility(state: GameState, club: Club): Eligibility {
  if (!club.active) return { eligible: false, reason: 'the club has folded' };

  const ground = state.world.grounds[club.groundId];
  if (!ground) return { eligible: false, reason: 'the club has no ground' };
  if (ground.quality < PROMOTION_ELIGIBILITY.minimumGroundQuality) {
    return {
      eligible: false,
      reason: `the ground does not meet the standard for the division above (quality ${ground.quality})`,
    };
  }
  const inAdministration = (club.finances.administrationSeasons ?? 0) > 0;
  if (inAdministration) {
    return { eligible: false, reason: 'the club is still in administration' };
  }
  return { eligible: true, reason: null };
}

export const PROMOTION_ELIGIBILITY = {
  /**
   * A 1-20 pitch standard. At 9 the surface is good enough for the division
   * above; below it, the committee will not admit the club.
   */
  minimumGroundQuality: 9,
} as const;

export interface MovementRecord {
  seasonId: string;
  seasonLabel: string;
  competitionId: CompetitionId;
  divisionName: string;
  tier: number;
  clubId: ClubId;
  clubName: string;
  direction: 'promoted' | 'relegated';
  /** Set when promotion was refused; the club stayed where it was. */
  blockedReason?: string;
}

/** Where a club ends up after a season, and why. */
export function moveWithinTier(
  state: GameState,
  competition: Competition,
  seasonId: string,
  seasonLabel: string,
): MovementRecord[] {
  const standings = standingsFor(state, competition);
  const promotionPlaces = competition.promotionPlaces ?? 0;
  const relegationPlaces = competition.relegationPlaces ?? 0;
  const records: MovementRecord[] = [];

  const describe = (clubId: ClubId): string => state.clubs[clubId]?.identity.name ?? clubId;

  const promote = standings.slice(0, promotionPlaces).reverse();
  for (const row of promote) {
    const club = state.clubs[row.clubId];
    if (!club) continue;
    const check = promotionEligibility(state, club);
    records.push({
      seasonId,
      seasonLabel,
      competitionId: competition.id,
      divisionName: competition.name,
      tier: competition.tier,
      clubId: club.id,
      clubName: describe(club.id),
      direction: 'promoted',
      ...(check.eligible ? {} : { blockedReason: check.reason ?? 'not eligible' }),
    });
  }

  for (const row of standings.slice(Math.max(0, standings.length - relegationPlaces))) {
    records.push({
      seasonId,
      seasonLabel,
      competitionId: competition.id,
      divisionName: competition.name,
      tier: competition.tier,
      clubId: row.clubId,
      clubName: describe(row.clubId),
      direction: 'relegated',
    });
  }

  return records;
}

export interface PromotionOutcome {
  events: GameEvent[];
  movements: MovementRecord[];
}

/**
 * Settle every boundary in the ladder.
 *
 * Each boundary is solved on its own: the clubs that finished in the promotion
 * places at the top of the lower division, and the clubs in the relegation
 * places at the bottom of the upper one. Where a promoted club turns out to be
 * ineligible the boundary walks down the table until it finds one that is, so
 * the same number of clubs crosses in each direction and the divisions above and
 * below come out exactly the size they went in.
 *
 * Nothing is written to the ladder here — this decides and reports. The move
 * itself happens when the next season is built, because that is the moment the
 * competitions are rebuilt anyway.
 */
export function resolvePromotionAndRelegation(
  state: GameState,
  context: { seasonId: string; seasonLabel: string; competitionIds?: CompetitionId[] },
): PromotionOutcome {
  const events: GameEvent[] = [];
  const movements: MovementRecord[] = [];
  const divisions = pyramidsOf(state).flatMap((pyramid) => divisionsOf(state, pyramid.id)).filter(
    (competition) => !context.competitionIds || context.competitionIds.includes(competition.id),
  );

  // --- Relegation: the bottom of each division that has somewhere to go ----
  for (const division of divisions) {
    const standings = standingsFor(state, division);
    const relegationPlaces = division.relegationPlaces ?? 0;
    if (relegationPlaces <= 0) continue;
    for (const row of standings.slice(Math.max(0, standings.length - relegationPlaces))) {
      movements.push({
        seasonId: context.seasonId,
        seasonLabel: context.seasonLabel,
        competitionId: division.id,
        divisionName: division.name,
        tier: division.tier,
        clubId: row.clubId,
        clubName: state.clubs[row.clubId]?.identity.name ?? row.clubId,
        direction: 'relegated',
      });
    }
  }

  // --- Promotion: the top of each division that has somewhere to go up -----
  for (const division of divisions) {
    const promotionPlaces = division.promotionPlaces ?? 0;
    if (promotionPlaces <= 0) continue;
    const standings = standingsFor(state, division);
    // Walk the promotion places downwards, so a refused club is replaced by the
    // one that finished immediately behind it rather than leaving a hole.
    let taken = 0;
    for (const row of standings) {
      if (taken >= promotionPlaces) break;
      const club = state.clubs[row.clubId];
      if (!club) continue;
      const check = promotionEligibility(state, club);
      if (!check.eligible) {
        movements.push({
          seasonId: context.seasonId,
          seasonLabel: context.seasonLabel,
          competitionId: division.id,
          divisionName: division.name,
          tier: division.tier,
          clubId: club.id,
          clubName: club.identity.name,
          direction: 'promoted',
          blockedReason: check.reason ?? 'not eligible',
        });
        continue;
      }
      taken += 1;
      movements.push({
        seasonId: context.seasonId,
        seasonLabel: context.seasonLabel,
        competitionId: division.id,
        divisionName: division.name,
        tier: division.tier,
        clubId: club.id,
        clubName: club.identity.name,
        direction: 'promoted',
      });
    }
  }

  events.push(...promotionNews(state, movements));
  return { events, movements };
}

/**
 * What a boundary does to a club, said the way a local paper says it.
 *
 * The player's own club gets a proper story; the rest of the ladder is news the
 * manager reads about other people, which is the point — a pyramid he is not in
 * the middle of still has to be a pyramid he can hear about.
 */
export function promotionNews(state: GameState, movements: readonly MovementRecord[]): GameEvent[] {
  const events: GameEvent[] = [];
  for (const movement of movements) {
    if (movement.blockedReason) {
      events.push(
        createEvent(state, {
          type: 'league-movement',
          importance: 2,
          clubIds: [movement.clubId],
          data: {
            headline: `${movement.clubName} stay put`,
            body: `${movement.clubName} have won promotion from ${movement.divisionName} but cannot take it up — ${movement.blockedReason}. The place passes to the club behind them.`,
            competition: movement.divisionName,
            movement: 'blocked',
          },
        }),
      );
      continue;
    }
    const isUser = movement.clubId === state.userClubId;
    const body =
      movement.direction === 'promoted'
        ? `${movement.clubName} have finished in the promotion places of ${movement.divisionName} and go up a division. A bigger pitch, bigger gates and a committee that expects more.`
        : `${movement.clubName} have finished in the relegation places of ${movement.divisionName} and go down a division. It will be a long season.`;
    events.push(
      createEvent(state, {
        type: 'league-movement',
        importance: isUser ? 3 : 1,
        clubIds: [movement.clubId],
        data: {
          headline:
            movement.direction === 'promoted'
              ? `${movement.clubName} are promoted`
              : `${movement.clubName} are relegated`,
          body,
          competition: movement.divisionName,
          movement: movement.direction,
        },
      }),
    );
  }
  return events;
}

/** Write the outcome onto the clubs' own season records, for the archive. */
export function recordMovementsOnClubs(state: GameState, movements: readonly MovementRecord[]): void {
  for (const movement of movements) {
    if (movement.blockedReason) continue;
    const record = state.clubs[movement.clubId]?.history.seasons.find(
      (entry) => entry.seasonId === movement.seasonId,
    );
    if (record) record.movement = movement.direction;
  }
}

// ---------------------------------------------------------------------------
// Tier-scaled money
// ---------------------------------------------------------------------------

/**
 * What a division pays out.
 *
 * Prize money is the honest reason a club wants to go up: the top division's
 * champions are paid, the bottom division's are not, and the gap between them is
 * what a committee is promising when it asks a manager to get a team out of the
 * bottom two. Set against a weekly wage bill of a few hundred pounds it is
 * small, which is exactly right for this level of football.
 */
export const TIER_PRIZE_MONEY = {
  /** Paid to the champions of each tier, 1 = top. */
  champion: [900, 350, 120] as const,
  /** Paid to the runners-up of each tier. */
  runnerUp: [250, 90, 30] as const,
} as const;

/** How much a crowd is worth, and what a sponsor will pay, by division. */
export const TIER_EXPECTATIONS = {
  /** Multiplier on gate money for the home club, by tier. */
  gate: [1.35, 1.0, 0.8] as const,
  /** Multiplier applied to a sponsor's weekly instalment, by tier. */
  sponsor: [1.4, 1.0, 0.75] as const,
  /** How many places below expectations a finish has to be to worry anyone. */
  slack: [3, 4, 5] as const,
} as const;

/** A multiplier for a tier, clamped to the ends of the table. */
export function tierFactor(table: readonly number[], tier: number | null): number {
  if (tier === null || tier < 1) return table[table.length - 1] ?? 1;
  return table[Math.min(tier, table.length) - 1] ?? 1;
}

/** The prize a club has earned by finishing where it finished. */
export function tierPrizeMoney(tier: number | null, position: number): number {
  if (position === 1) return tierFactor(TIER_PRIZE_MONEY.champion, tier);
  if (position === 2) return tierFactor(TIER_PRIZE_MONEY.runnerUp, tier);
  return 0;
}

/** How far below its own division a finish has to fall to worry a manager. */
export function sackingSlackFor(state: GameState, clubId: ClubId): number {
  const tier = tierOf(state, clubId);
  return tierFactor(TIER_EXPECTATIONS.slack, tier);
}

/** The officials a club should remember it has to work with. */
export function officialsOf(club: Club): { managerId: PersonId | null; chairmanId: PersonId | null } {
  return { managerId: club.managerId, chairmanId: club.chairmanId };
}
