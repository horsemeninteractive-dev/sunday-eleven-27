import type { GameState, WorldExpansionState } from '@/domain/game';
import { FOUNDING_PYRAMID_ID, type Pyramid } from '@/domain/competition';
import type { DistrictDefinition } from '@/domain/districts';
import { FOUNDING_REGION_ID } from '@/domain/world';
import type { ClubId, ISODate, PyramidId, SeasonId } from '@/domain/ids';
import type { GameEvent } from '@/domain/news';
import { alderfordshireDistricts } from '@/geography/alderland';
import { foundDistrictPyramid, highestIdNumber, type FoundedDistrict } from './generation/worldGenerator';
import { capitalise } from './generation/names';
import { createEvent } from './news';

/**
 * The districts a career is still owed, founded at a season boundary.
 *
 * A career is founded with the districts the county had when it began. A career
 * that has been played since before some of them existed is *waiting* for them:
 * `migrateSave` marks it (`state.worldExpansion`) when it is opened, and this is
 * what spends that mark — one district or four, founded from the world
 * generator's own machinery rather than from a second generator, and handed back
 * to the caller so that the season about to be built is built for every ladder at
 * once.
 *
 * Three rules make it safe to run against a career that is already being played.
 *
 *   - **Nothing the county already has moves.** Every district is drawn from
 *     streams of its own (`foundDistrictPyramid`) and appended to the world; not
 *     one club, town, ground, person, competition, fixture or result the career
 *     already holds is re-homed, renamed or re-minted. Every existing town keeps
 *     the region it was drawn in — which is why a district is populated with
 *     settlements of its own rather than by handing it the county's club-less
 *     villages, however tempting that shortcut is.
 *   - **It is the world, not the marker, that says what is owed.** Which
 *     districts a career is missing is read off the regions it holds against the
 *     county's authored districts, so the operation is idempotent by
 *     construction: a district that already exists is not one that gets founded
 *     again, however many times the roll-over runs, and a fourth district is
 *     founded beside three rather than instead of them.
 *   - **It happens once, or not at all.** The mark is spent the moment it is
 *     read, before anything is generated, so nothing below can leave a career
 *     that founds its missing districts on the next roll-over as well.
 */

/** What the roll-over knows about the season being built. */
export interface WorldExpansionContext {
  seasonId: SeasonId;
  seasonLabel: string;
  /** The first day of the new season: when the districts' clubs are founded. */
  seasonStart: ISODate;
  /** The calendar year the new season starts in, for founding records. */
  currentYear: number;
}

/** One district founded into a running career, and what the roll-over needs of it. */
export interface FoundedLadder {
  pyramidId: PyramidId;
  /** Its divisions, tier 1 first, strongest first within a division. */
  divisions: ClubId[][];
  /** The story the manager is told, dated the first day of the new season. */
  event: GameEvent;
}

/** True while this career is waiting for districts it does not have yet. */
export function expansionPending(state: GameState): boolean {
  return state.worldExpansion?.pending === true;
}

/**
 * How many of the county's districts this career has, the founding county's own
 * included: six in a career founded today, fewer in one founded before they all
 * were playable.
 */
export function districtCount(state: GameState): number {
  const regions = new Set(state.world?.regionIds ?? []);
  return alderfordshireDistricts().filter((district) => regions.has(district.regionId)).length;
}

/**
 * The county's districts this career does not have, in the map's own order.
 *
 * Read off the regions the world actually holds rather than off any marker: a
 * district a career has is one whose region it holds, whatever founded it and
 * whenever. That is what makes founding the missing ones safe to run twice —
 * there is no second time, because after the first the list is empty.
 */
export function missingDistricts(state: GameState): DistrictDefinition[] {
  const regions = new Set(state.world?.regionIds ?? []);
  return alderfordshireDistricts().filter(
    (district) => district.regionId !== FOUNDING_REGION_ID && !regions.has(district.regionId),
  );
}

/**
 * Whether this career's world is still the one-ladder county a district belongs
 * next to.
 *
 * Read off the world rather than off the marker: the marker says *that* a
 * district is owed, this says whether the world is still the smallest county the
 * game has ever founded — which is what a career written before there was a
 * district next door is.
 */
export function oneLadderWorld(state: GameState): boolean {
  const ladders = state.pyramidIds?.length ?? 1;
  const regions = state.world?.regionIds?.length ?? 1;
  return ladders < 2 && regions < 2;
}

/**
 * The valleys the county's existing football is already spoken for by.
 *
 * A district's id is the valley its own stream draws, so two districts under one
 * name would be one ladder twice: the valleys the world already names are passed
 * to the generator as taken, so it draws one that is free. Read off both the
 * regions (a region is named after the valley it was drawn in) and the ladders
 * (a ladder's id *is* the valley its clubs were minted under), because an
 * expansion into a career that has been played for ten seasons has to hold the
 * drawn valley against what that career actually holds rather than against what a
 * freshly generated world would have drawn.
 */
function spokenForValleys(state: GameState): string[] {
  const valleys = Object.values(state.world?.regions ?? {}).map((region) => region.name.split(' ')[0] ?? '');
  for (const pyramidId of state.pyramidIds ?? []) {
    if (pyramidId === FOUNDING_PYRAMID_ID) continue;
    valleys.push(capitalise(pyramidId));
  }
  return valleys.filter((valley) => valley.length > 0);
}

/**
 * Write a founded district into the world: its region, its settlements, its
 * businesses, its grounds and its ladder.
 *
 * The world's own lists, handed over rather than copied: the generator appends to
 * them as it mints (see `foundDistrictPyramid`), and this puts them back where
 * the world reads them. The county is the district's own county — a district
 * founded beside the county is a piece of it, and a county record that did not
 * name one of its regions would be a record that disagrees with the map.
 */
export function registerFoundedDistrict(state: GameState, district: FoundedDistrict): Pyramid {
  state.world.groundIds = Object.keys(state.world.grounds);
  state.world.regions = { ...state.world.regions, [district.region.id]: district.region };
  state.world.regionIds = [...(state.world.regionIds ?? []), district.region.id];

  const owner = state.world.counties?.[district.region.countyId];
  if (owner) {
    state.world.counties = {
      ...state.world.counties,
      [owner.id]: { ...owner, regionIds: [...owner.regionIds, district.region.id] },
    };
  }

  // The ladder itself. Its divisions and cups are written by the season build
  // that is about to run, because a ladder owns the competitions that exist and
  // none of this one's do yet — the same empty start a ladder founded with a new
  // career has.
  const pyramid: Pyramid = {
    id: district.id,
    name: district.name,
    regionId: district.region.id,
    level: district.level,
    config: district.config,
    competitionIds: [],
    cupIds: [],
  };
  state.pyramids = { ...state.pyramids, [pyramid.id]: pyramid };
  state.pyramidIds = [...(state.pyramidIds ?? []), pyramid.id];
  return pyramid;
}

/**
 * Found the districts this career is missing, once, at the season boundary.
 *
 * Returns the ladders that were founded, in the map's own order, or an empty list
 * when there was nothing to do — which is the answer for a career that was never
 * marked, for one that has already been through this boundary, and for one whose
 * world already has every district the county has. The caller builds the season
 * from the divisions handed back.
 */
export function activateWorldExpansion(
  state: GameState,
  context: WorldExpansionContext,
): FoundedLadder[] {
  if (!expansionPending(state)) return [];

  // Spent before a single club is minted. A career that was opened, rolled over
  // and saved is not a career that gets its districts at the boundary after that
  // one as well, and a failure anywhere below leaves the county with the football
  // it has rather than growing half a district on the next attempt.
  state.worldExpansion = { pending: false, expandedInSeasonId: context.seasonId };

  const owed = missingDistricts(state);
  if (owed.length === 0) return [];

  const founded: FoundedLadder[] = [];
  const valleys = spokenForValleys(state);
  const towns = Object.values(state.world.towns);
  const businesses = Object.values(state.world.businesses);

  for (const definition of owed) {
    const district = foundDistrictPyramid({
      seed: state.seed,
      currentYear: context.currentYear,
      seasonStart: context.seasonStart,
      towns,
      businesses,
      grounds: state.world.grounds,
      clubs: state.clubs,
      people: state.people,
      regions: Object.values(state.world.regions ?? {}),
      // The ladders this career already holds, so a district cannot be founded
      // under an id one of them is using — the same check `generateWorld` makes
      // for a world being born.
      pyramidIds: [...(state.pyramidIds ?? [FOUNDING_PYRAMID_ID]), ...founded.map((ladder) => ladder.pyramidId)],
      // The district is the map's own, so it wears the map's name for it and
      // stands where the map draws it: a career that has been played since before
      // the district was playable gains the same Marlowe Vale a career founded
      // today starts with. Its id is still the valley this career's own stream
      // draws — the name and the region are the map's, and the settlements are
      // keyed to the draw, so a district founded into a played career is the same
      // *district* under a valley of its own.
      regionId: definition.regionId,
      regionName: definition.name,
      level: definition.level,
      config: definition.config,
      centre: definition.centre,
      // The same stream this district would have been founded from in a world
      // generated in one go: a district the county has always had draws from the
      // county's own stream (`::district`), and every district the map has added
      // from one keyed to its region, so two careers given the same district are
      // given the same kind of place.
      stream: definition.legacy ? undefined : definition.regionId,
      takenValleyNames: valleys,
      // The ids continue *this* career's own count rather than the count a world
      // freshly generated from the same seed would happen to have. A save that
      // has been played for ten seasons is not the world the generator would
      // write today, and a new town numbered from the wrong end of the map is a
      // town id that already belongs to the county.
      firstTownIndex: highestIdNumber(state.world.townIds ?? [], 'town_') + 1,
      // The business counter is stepped before its id is written, so the district
      // is told the last number in use rather than the next one.
      firstBusinessIndex: highestIdNumber(Object.keys(state.world.businesses ?? {}), 'biz_'),
    });

    // The county's own towns, businesses and grounds are the objects they already
    // were — listed again here and otherwise untouched — and the district's
    // follow them.
    state.world.towns = Object.fromEntries(towns.map((town) => [town.id, town]));
    state.world.townIds = towns.map((town) => town.id);
    state.world.businesses = Object.fromEntries(businesses.map((business) => [business.id, business]));
    const pyramid = registerFoundedDistrict(state, district);
    valleys.push(district.valley);

    const clubs = district.divisions.flat();
    const event = createEvent(state, {
      type: 'world',
      importance: 3,
      clubIds: [state.userClubId],
      data: {
        headline:
          founded.length === 0
            ? `A district next door: ${district.name}`
            : `Another district joins the county: ${district.name}`,
        body: `The ${district.name} joins the county for ${context.seasonLabel}: ${clubs.length} clubs in ${
          district.divisions.length
        } divisions, playing its Sundays out of ${district.region.name}. Nothing in the county's existing football moves — not a club, a division, a ground or a date — and every ladder meets in the County Cup.`,
      },
    });
    // The story belongs to the season being built rather than to the afternoon
    // the last one ended on, which is the day the state is still standing on here.
    event.date = context.seasonStart;
    founded.push({ pyramidId: pyramid.id, divisions: district.divisions, event });
  }

  return founded;
}

/**
 * The marker a migration writes: nothing generated, just the question answered.
 *
 * It answers one question — *is this career owed districts it does not have?* —
 * and it is asked again whenever a save is brought forward from a version that
 * predates a district, because a career can be missing football the game has
 * added twice: the county it was founded in, and the four districts beside it
 * that were mapped before they were playable. The season it was last expanded in
 * is kept, so a career carries the date it happened whether or not it is owed
 * anything now.
 */
export function markWorldExpansion(state: GameState): void {
  const owed = missingDistricts(state).length > 0;
  if (state.worldExpansion?.pending === owed) return;
  state.worldExpansion = {
    pending: owed,
    ...(state.worldExpansion?.expandedInSeasonId
      ? { expandedInSeasonId: state.worldExpansion.expandedInSeasonId }
      : {}),
  } satisfies WorldExpansionState;
}
