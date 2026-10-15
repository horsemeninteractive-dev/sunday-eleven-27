import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PYRAMID,
  FOUNDING_PYRAMID_ID,
  cupFieldOf,
  storedCupField,
  type Pyramid,
} from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { ClubId, CountyId, PyramidId, RegionId } from '@/domain/ids';
import { FOUNDING_COUNTY_ID, FOUNDING_COUNTY_NAME, FOUNDING_REGION_ID, SECOND_REGION_ID } from '@/domain/world';
import { firstSundayOfSeptember, generateDraft, startGameFromDraft } from './gameSetup';
import { foundDistrictPyramid } from './generation/worldGenerator';import {
  COUNTY_CUP_ID,
  COUNTY_CUP_NAME,
  countiesOf,
  countyClubIds,
  countyCupId,
  countyCupName,
  countyIdOfClub,
  countyIdOfPyramid,
  cupCompetitionId,
  divisionOf,
  divisionsOf,
  leagueCompetitions,
  levelOf,
  pyramidIdOf,
  pyramidIdsOfCounty,
  pyramidOf,
  regionNameFor,
} from './pyramid';
import { buildSeasonStructure, countyCupRequests, fieldClubs } from './seasonStructure';

/**
 * Two counties, and the competition that belongs to each of them.
 *
 * The world has been one county since it had more than one ladder: a district
 * next door is the founding county's own second ladder, and a county cup is drawn
 * from every club in the world because every club in the world is in the county.
 * What this file holds is the other half of that — that a second county can exist
 * beside the first with its own regions and its own ladders, that the cup drawn
 * for it is drawn from its own clubs and nobody else's, and that the ladders and
 * cups that belong to a single ladder are still nobody else's business.
 *
 * The second county is a *test* county: no production path founds one yet. It is
 * built by the real generator — real regions, real settlements, real clubs with
 * squads, grounds, committees and squads of their own — and registered the way
 * `worldExpansion.activateWorldExpansion` registers the county's own second
 * ladder. Nothing in the game is a special case for it: the season is built from
 * the same `buildSeasonStructure` the roll-over uses, the fields are resolved by
 * the same `fieldClubs` every screen reads, and the cups are the ones the same
 * `countyCupRequests` asks for.
 */

const SECOND_COUNTY: CountyId = 'county_2';
const SECOND_COUNTY_NAME = 'Marsworthshire';
const SECOND_COUNTY_REGIONS: [RegionId, RegionId] = ['region_3', 'region_4'];
const OPENING_SUNDAY = firstSundayOfSeptember(2027);

/**
 * The seeds the test districts are drawn from.
 *
 * Fixed rather than derived from the career's seed, because they are what the
 * district's own id, region and clubs are drawn from: the same three districts
 * every time, so the world this file builds is the same world however the county
 * it is founded beside was drawn. A district is named after the valley it is
 * given, and no two ladders may share one id — the guard below is what says so.
 */
const DISTRICT_SEEDS = {
  a: 'county-scope-district-a',
  b: 'county-scope-district-b',
  c: 'county-scope-district-c',
} as const;

/** The first free number in one of the world's id sequences, read off the ids. */
function nextIdIndex(ids: readonly string[], prefix: string): number {
  let highest = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const value = Number(id.slice(prefix.length));
    if (Number.isInteger(value)) highest = Math.max(highest, value);
  }
  return highest + 1;
}

/** A career founded with one ladder: the world before any district exists. */
function oneLadderCareer(seed: string): GameState {
  const draft = generateDraft({ seed, startYear: 2026, pyramids: 1 });
  return startGameFromDraft(draft, {
    seed,
    startYear: 2026,
    clubId: draft.divisionClubIds[0]!,
    saveName: `One ladder — ${seed}`,
  });
}

/** A county beside the first one, owning nothing until it is given regions. */
function addCounty(state: GameState, id: CountyId, name: string): void {
  state.world.counties = { ...state.world.counties, [id]: { id, name, regionIds: [] } };
  state.world.countyIds = [...state.world.countyIds, id];
}

/**
 * A district founded into a career, as a piece of a county that already exists.
 *
 * The generator is the real one, so the district has settlements of its own, real
 * club identities, grounds to play on and people to run them. The registration is
 * the step `activateWorldExpansion` performs for the county's second ladder: the
 * new region and its settlements are appended to the world, the county is given
 * the region it now owns, and the ladder is written where the world reads ladders.
 */
function addDistrict(
  state: GameState,
  options: {
    seed: string;
    regionId: RegionId;
    countyId: CountyId;
    /**
     * Identity, for the ladders that are named rather than drawn. Left out, the
     * district is what the valley it draws makes it — which is what every test
     * that does not care about naming asks for.
     */
    id?: PyramidId;
    name?: string;
    regionName?: string;
    level?: number;
  },
): { pyramid: Pyramid; divisions: ClubId[][] } {
  const towns = Object.values(state.world.towns);
  const businesses = Object.values(state.world.businesses);
  const district = foundDistrictPyramid({
    seed: options.seed,
    currentYear: Number(state.season.startDate.slice(0, 4)),
    seasonStart: state.season.startDate,
    towns,
    businesses,
    grounds: state.world.grounds,
    clubs: state.clubs,
    people: state.people,
    regions: Object.values(state.world.regions),
    regionId: options.regionId,
    countyId: options.countyId,
    id: options.id,
    name: options.name,
    regionName: options.regionName,
    level: options.level,
    // The career's own ladders, so founding one is held to the same collision
    // check `activateWorldExpansion` is in production.
    pyramidIds: [...state.pyramidIds],
    config: { ...DEFAULT_PYRAMID, clubsPerTier: 6 },
    firstTownIndex: nextIdIndex(state.world.townIds, 'town_'),
    firstBusinessIndex: nextIdIndex(Object.keys(state.world.businesses), 'biz_'),
  });

  state.world.towns = Object.fromEntries(towns.map((town) => [town.id, town]));
  state.world.townIds = towns.map((town) => town.id);
  state.world.businesses = Object.fromEntries(businesses.map((business) => [business.id, business]));
  state.world.groundIds = Object.keys(state.world.grounds);
  state.world.regions = { ...state.world.regions, [district.region.id]: district.region };
  state.world.regionIds = [...state.world.regionIds, district.region.id];

  const county = state.world.counties[district.region.countyId]!;
  state.world.counties = {
    ...state.world.counties,
    [county.id]: { ...county, regionIds: [...county.regionIds, district.region.id] },
  };

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
  state.pyramidIds = [...state.pyramidIds, pyramid.id];
  return { pyramid, divisions: district.divisions };
}

/** Build a season for every ladder the world has, as the roll-over does. */
function buildSeason(state: GameState, founded: ReadonlyMap<PyramidId, ClubId[][]>) {
  return buildSeasonStructure({
    state,
    seasonId: state.season.id,
    seasonLabel: state.season.label,
    firstLeagueDate: OPENING_SUNDAY,
    pyramids: state.pyramidIds.map((pyramidId) => ({
      pyramidId,
      regionName: regionNameFor(state, pyramidId),
      divisions: founded.get(pyramidId) ?? divisionsOf(state, pyramidId).map((division) => [...division.clubIds]),
    })),
    cups: countyCupRequests(state),
  });
}

interface TwoCounties {
  state: GameState;
  /** The second county's own two ladders, in the order they were founded. */
  ladders: PyramidId[];
  /** What each ladder was handed, before the season existed. */
  divisions: Map<PyramidId, ClubId[][]>;
}

/** The county, and the county beside it with two ladders of its own. */
function twoCounties(seed: string): TwoCounties {
  const state = oneLadderCareer(seed);
  addCounty(state, SECOND_COUNTY, SECOND_COUNTY_NAME);
  const first = addDistrict(state, { seed: DISTRICT_SEEDS.a, regionId: SECOND_COUNTY_REGIONS[0], countyId: SECOND_COUNTY });
  const second = addDistrict(state, { seed: DISTRICT_SEEDS.b, regionId: SECOND_COUNTY_REGIONS[1], countyId: SECOND_COUNTY });
  // Two ladders with one id would be one ladder: the generator names a district
  // after its valley, so a test world asking for two of them has to get two.
  expect(first.pyramid.id).not.toBe(second.pyramid.id);
  return {
    state,
    ladders: [FOUNDING_PYRAMID_ID, first.pyramid.id, second.pyramid.id],
    divisions: new Map([
      [first.pyramid.id, first.divisions],
      [second.pyramid.id, second.divisions],
    ]),
  };
}

/** The clubs two fields have in common: what a leak between them would be. */
function shared(a: ReadonlySet<ClubId>, b: ReadonlySet<ClubId>): ClubId[] {
  return [...a].filter((clubId) => b.has(clubId));
}

describe('two counties in one world', () => {
  it('places every region, town and club in exactly one of them', () => {
    const { state, ladders } = twoCounties('county-scope-ownership');

    expect(countiesOf(state).map((county) => county.id)).toEqual([FOUNDING_COUNTY_ID, SECOND_COUNTY]);

    // The second county owns both of the regions drawn for it, and the founding
    // county still owns its own two — the world grew, it did not move.
    const second = state.world.counties[SECOND_COUNTY]!;
    expect(second.name).toBe(SECOND_COUNTY_NAME);
    expect(second.regionIds).toEqual(SECOND_COUNTY_REGIONS);
    // The career was founded with one ladder, so the founding county still has
    // the one region it has always had: the world grew a county, it did not move
    // the one it had.
    expect(state.world.counties[FOUNDING_COUNTY_ID]!.regionIds).toEqual([FOUNDING_REGION_ID]);
    for (const regionId of [...second.regionIds, ...state.world.counties[FOUNDING_COUNTY_ID]!.regionIds]) {
      expect(state.world.regions[regionId], `${regionId} is owned and missing`).toBeTruthy();
    }

    // Every town says which county it is in, and so does every club of it. The
    // second county's regions are the only place its towns are.
    for (const town of Object.values(state.world.towns)) {
      const owner = town.countyId;
      expect([FOUNDING_COUNTY_ID, SECOND_COUNTY]).toContain(owner);
      expect(new Set(second.regionIds).has(town.regionId)).toBe(owner === SECOND_COUNTY);
    }
    let secondCountyClubs = 0;
    for (const club of Object.values(state.clubs)) {
      const town = state.world.towns[club.townId]!;
      expect(countyIdOfClub(state, club.id)).toBe(town.countyId);
      if (town.countyId === SECOND_COUNTY) secondCountyClubs += 1;
    }

    // A ladder belongs to the county its region is in, and no ladder is in two.
    expect(pyramidIdsOfCounty(state, FOUNDING_COUNTY_ID)).toEqual([FOUNDING_PYRAMID_ID]);
    expect(pyramidIdsOfCounty(state, SECOND_COUNTY)).toEqual([ladders[1], ladders[2]]);
    for (const pyramidId of ladders) {
      const regionId = state.pyramids[pyramidId]!.regionId;
      expect(countyIdOfPyramid(state, pyramidId)).toBe(state.world.regions[regionId]!.countyId);
    }

    // Two populations of clubs, thirty-six each: eighteen per district ladder.
    expect(countyClubIds(state, FOUNDING_COUNTY_ID)).toHaveLength(36);
    expect(countyClubIds(state, SECOND_COUNTY)).toHaveLength(secondCountyClubs);
    expect(secondCountyClubs).toBe(36);
    expect(shared(new Set(countyClubIds(state, SECOND_COUNTY)), new Set(countyClubIds(state, FOUNDING_COUNTY_ID)))).toEqual([]);
  });

  it('runs no county cup for a county with a single ladder of its own', () => {
    const state = oneLadderCareer('county-scope-single');
    addCounty(state, SECOND_COUNTY, SECOND_COUNTY_NAME);
    addDistrict(state, { seed: 'county-scope-single-east', regionId: SECOND_COUNTY_REGIONS[0], countyId: SECOND_COUNTY });

    // Two ladders in the world, one in each county: neither county runs a cup.
    // Counting the world's ladders would have drawn one, for the wrong county.
    expect(state.pyramidIds).toHaveLength(2);
    expect(countyCupRequests(state)).toEqual([]);
  });

  it('asks for one cup per county that has more than one ladder, each its own', () => {
    const { state, ladders } = twoCounties('county-scope-requests');

    const requests = countyCupRequests(state);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.id).toBe(countyCupId(SECOND_COUNTY));
    expect(requests[0]!.id).toBe('comp_cup_county_2');
    expect(requests[0]!.id).not.toBe(COUNTY_CUP_ID);
    expect(requests[0]!.name).toBe(countyCupName(SECOND_COUNTY_NAME));
    expect(requests[0]!.name).toBe('Marsworthshire County Cup');
    expect(requests[0]!.field).toEqual({ kind: 'county', countyId: SECOND_COUNTY });

    // The founding county has one ladder in this world, so it is owed nothing —
    // and the cup it has always had is not asked for on its behalf.
    expect(countyIdOfPyramid(state, FOUNDING_PYRAMID_ID)).toBe(FOUNDING_COUNTY_ID);
    expect(pyramidIdsOfCounty(state, FOUNDING_COUNTY_ID)).toHaveLength(1);
    expect(ladders[0]).toBe(FOUNDING_PYRAMID_ID);
  });

  it('asks for two cups, under two ids, when two counties each have two ladders', () => {
    const state = oneLadderCareer('county-scope-two-cups');
    addCounty(state, SECOND_COUNTY, SECOND_COUNTY_NAME);
    // The founding county's own second ladder, in a region of its own (which is
    // the district next door, in the county it is a piece of), and two ladders of
    // the second county's beside it.
    const mine = addDistrict(state, { seed: DISTRICT_SEEDS.c, regionId: SECOND_REGION_ID, countyId: FOUNDING_COUNTY_ID });
    const theirs = addDistrict(state, { seed: DISTRICT_SEEDS.a, regionId: SECOND_COUNTY_REGIONS[0], countyId: SECOND_COUNTY });
    const alsoTheirs = addDistrict(state, { seed: DISTRICT_SEEDS.b, regionId: SECOND_COUNTY_REGIONS[1], countyId: SECOND_COUNTY });

    const requests = countyCupRequests(state);
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.id)).toEqual([COUNTY_CUP_ID, countyCupId(SECOND_COUNTY)]);
    expect(requests.map((request) => request.name)).toEqual([
      countyCupName(FOUNDING_COUNTY_NAME),
      'Marsworthshire County Cup',
    ]);
    expect(requests[0]!.name).toBe(COUNTY_CUP_NAME);
    expect(new Set(requests.map((request) => request.id)).size).toBe(2);
    expect(requests[0]!.field).toEqual({ kind: 'county', countyId: FOUNDING_COUNTY_ID });
    expect(requests[1]!.field).toEqual({ kind: 'county', countyId: SECOND_COUNTY });

    // Two fields, two populations: the founding county's own clubs, both ladders
    // of it, and the second county's — and no club in both.
    const first = new Set(fieldClubs(state, requests[0]!.field));
    const second = new Set(fieldClubs(state, requests[1]!.field));
    expect(first.size).toBe(36 + 18);
    expect(second.size).toBe(36);
    expect(shared(first, second)).toEqual([]);
    expect(new Set(fieldClubs(state, { kind: 'county' }))).toEqual(first);

    // Two counties can never ask for one competition: an id is its own county's,
    // and the founding county keeps the one its cup has always had.
    expect(countyCupId(FOUNDING_COUNTY_ID)).toBe(COUNTY_CUP_ID);
    expect(countyCupId(SECOND_COUNTY)).toBe('comp_cup_county_2');
    expect(countyCupId('county_3')).not.toBe(countyCupId(SECOND_COUNTY));

    // And both of them are built, on the one calendar, beside four ladders' own
    // cups — two county cups in a season, each its own competition.
    const structure = buildSeason(
      state,
      new Map([
        [mine.pyramid.id, mine.divisions],
        [theirs.pyramid.id, theirs.divisions],
        [alsoTheirs.pyramid.id, alsoTheirs.divisions],
      ]),
    );
    expect(state.competitions[COUNTY_CUP_ID]).toBeTruthy();
    expect(state.competitions[countyCupId(SECOND_COUNTY)]).toBeTruthy();
    expect(state.competitions[COUNTY_CUP_ID]!.name).toBe(COUNTY_CUP_NAME);
    expect(state.competitions[countyCupId(SECOND_COUNTY)]!.name).toBe('Marsworthshire County Cup');
    expect(state.competitions[COUNTY_CUP_ID]!.clubIds).toHaveLength(54);
    expect(state.competitions[countyCupId(SECOND_COUNTY)]!.clubIds).toHaveLength(36);
    expect(structure.calendar.length).toBeGreaterThan(22);
  });

  it('draws a county cup from its own county’s clubs, and from nobody else’s', () => {
    const { state, divisions } = twoCounties('county-scope-field');
    buildSeason(state, divisions);

    const second = countyCupId(SECOND_COUNTY);
    const cup = state.competitions[second]!;
    expect(cup, 'the second county cups was never built').toBeTruthy();
    expect(cup.name).toBe('Marsworthshire County Cup');
    expect(state.competitions[COUNTY_CUP_ID], 'the founding county was given a cup it has no second ladder for').toBeUndefined();

    // The field the competition declares is its own county's, and it says so:
    // this cup is not the founding county's and cannot be read as it.
    expect(cupFieldOf(cup.cup)).toEqual({ kind: 'county', countyId: SECOND_COUNTY });
    expect(storedCupField({ kind: 'county', countyId: SECOND_COUNTY })).toEqual({ kind: 'county', countyId: SECOND_COUNTY });
    expect(storedCupField({ kind: 'county', countyId: FOUNDING_COUNTY_ID })).toEqual({ kind: 'county' });

    // Exactly the second county's clubs — not a subset of them, and not one club
    // of the first county's.
    const expected = [...countyClubIds(state, SECOND_COUNTY)].sort();
    expect([...fieldClubs(state, cupFieldOf(cup.cup))].sort()).toEqual(expected);
    expect([...cup.clubIds].sort()).toEqual(expected);
    expect(expected).toHaveLength(36);
    const founding = new Set(countyClubIds(state, FOUNDING_COUNTY_ID));
    for (const clubId of cup.clubIds) expect(founding.has(clubId), `${clubId} plays in two counties`).toBe(false);

    // It belongs to no ladder, and the ladder records say so rather than being
    // asked to guess from the shape of an id.
    expect(pyramidIdOf(state, cup)).toBeNull();

    // A county field that names no county is the career's own — the founding
    // county — and never a licence to enter every county in the world.
    expect(new Set(fieldClubs(state, { kind: 'county' }))).toEqual(founding);
    expect(fieldClubs(state, { kind: 'county' })).toHaveLength(36);
  });

  it('keeps every ladder’s own cups to that ladder', () => {
    const { state, ladders, divisions } = twoCounties('county-scope-ladders');
    buildSeason(state, divisions);

    const fieldsOf = ladders.map((pyramidId) => {
      const cup = state.competitions[cupCompetitionId(pyramidId, 'cup')]!;
      const plate = state.competitions[cupCompetitionId(pyramidId, 'plate')]!;
      expect(cup, `${pyramidId} has no cup`).toBeTruthy();
      expect(plate, `${pyramidId} has no plate`).toBeTruthy();
      expect(cupFieldOf(cup.cup)).toEqual({ kind: 'pyramid', pyramidId });
      expect(cupFieldOf(plate.cup)).toEqual({ kind: 'pyramid', pyramidId });
      // A ladder's cup is that ladder's clubs and nobody else's: every division
      // of it, and no club of either of the other two ladders.
      const clubs = new Set(fieldClubs(state, cupFieldOf(cup.cup)));
      const config = state.pyramids[pyramidId]!.config;
      expect(clubs.size).toBe(config.tiers * config.clubsPerTier);
      expect(clubs.size).toBe(divisionsOf(state, pyramidId).flatMap((competition) => competition.clubIds).length);
      return { pyramidId, clubs };
    });
    // The ladders are three: the county's own thirty-six, and two districts of
    // eighteen each, cut small so that the season fits one calendar.
    expect(fieldsOf.map((field) => field.clubs.size)).toEqual([36, 18, 18]);

    // No ladder's cup shares a club with another ladder's, and the founding
    // county's clubs are in none of the second county's.
    for (let i = 0; i < fieldsOf.length; i += 1) {
      for (let j = i + 1; j < fieldsOf.length; j += 1) {
        expect(shared(fieldsOf[i]!.clubs, fieldsOf[j]!.clubs)).toEqual([]);
      }
    }
    const secondCounty = new Set(countyClubIds(state, SECOND_COUNTY));
    for (const clubId of fieldsOf[0]!.clubs) expect(secondCounty.has(clubId)).toBe(false);
  });

  it('seasons a ladder whose id, name and level were chosen for it like any other', () => {
    // Two counties, and the second one's two ladders: one drawn the way a district
    // has always been drawn, and one a caller named — its id, its name, its
    // region's name and its level of its own. Nothing downstream of generation is
    // allowed to care which of the two it is looking at.
    const state = oneLadderCareer('county-scope-named-ladder');
    addCounty(state, SECOND_COUNTY, SECOND_COUNTY_NAME);
    const named = addDistrict(state, {
      seed: DISTRICT_SEEDS.c,
      regionId: SECOND_COUNTY_REGIONS[0],
      countyId: SECOND_COUNTY,
      id: 'aldermarket',
      name: 'Aldermarket & District Sunday League',
      regionName: 'Aldermarket',
      level: 4,
    });
    const drawn = addDistrict(state, {
      seed: DISTRICT_SEEDS.a,
      regionId: SECOND_COUNTY_REGIONS[1],
      countyId: SECOND_COUNTY,
    });

    // The ladder, its region and its clubs are what it was told they are.
    expect(named.pyramid.id).toBe('aldermarket');
    expect(named.pyramid.name).toBe('Aldermarket & District Sunday League');
    expect(named.pyramid.level).toBe(4);
    expect(named.pyramid.regionId).toBe(SECOND_COUNTY_REGIONS[0]);
    expect(state.world.regions[SECOND_COUNTY_REGIONS[0]]!.name).toBe('Aldermarket');
    expect(state.world.regions[SECOND_COUNTY_REGIONS[0]]!.countyId).toBe(SECOND_COUNTY);
    expect(countyIdOfPyramid(state, 'aldermarket')).toBe(SECOND_COUNTY);
    for (const clubId of named.divisions.flat()) {
      expect(clubId.startsWith('club_aldermarket_')).toBe(true);
      expect(countyIdOfClub(state, clubId)).toBe(SECOND_COUNTY);
    }

    // The same season build every other ladder goes through, and the same
    // ownership: its own divisions, its own two cups, and a table for every club
    // of it in exactly one of them.
    buildSeason(
      state,
      new Map([
        [named.pyramid.id, named.divisions],
        [drawn.pyramid.id, drawn.divisions],
      ]),
    );
    expect(divisionsOf(state, 'aldermarket').map((competition) => competition.id)).toEqual([
      'comp_aldermarket_t1',
      'comp_aldermarket_t2',
      'comp_aldermarket_t3',
    ]);
    expect(pyramidOf(state, 'aldermarket').cupIds).toEqual([
      cupCompetitionId('aldermarket', 'cup'),
      cupCompetitionId('aldermarket', 'plate'),
    ]);
    const membership = leagueCompetitions(state).flatMap((competition) => competition.clubIds);
    expect(new Set(membership).size).toBe(membership.length);
    for (const clubId of named.divisions.flat()) {
      expect(pyramidIdOf(state, divisionOf(state, clubId)!)).toBe('aldermarket');
    }
    // Its level is the level its clubs play at: the option reaches the football.
    expect(levelOf(state, named.divisions[0]![0]!)).toBe(4);
    expect(levelOf(state, named.divisions[2]![0]!)).toBe(6);

    // And the county cup is the second county's, drawn from both of its ladders —
    // the named one included, because of where its clubs are rather than what it
    // is called — and from nobody else's.
    const cup = state.competitions[countyCupId(SECOND_COUNTY)]!;
    const entrants = new Set(cup.clubIds);
    expect(entrants.size).toBe(36);
    expect(shared(entrants, new Set(countyClubIds(state, FOUNDING_COUNTY_ID)))).toEqual([]);
    for (const clubId of named.divisions.flat()) expect(entrants.has(clubId)).toBe(true);
    expect(pyramidIdOf(state, cup)).toBeNull();
  });

  it('builds one season with every club in one division and one calendar', () => {
    const { state, ladders, divisions } = twoCounties('county-scope-season');
    const structure = buildSeason(state, divisions);

    // Three ladders of three divisions: nine competitions with a table, each id
    // its own, and every club in exactly one of them.
    const league = leagueCompetitions(state);
    expect(league).toHaveLength(9);
    expect(new Set(league.map((competition) => competition.id)).size).toBe(9);
    const membership = league.flatMap((competition) => competition.clubIds);
    expect(new Set(membership).size).toBe(membership.length);
    expect(new Set(membership).size).toBe(Object.keys(state.clubs).length);
    for (const pyramidId of ladders) {
      expect(divisionsOf(state, pyramidId).map((competition) => competition.id).length).toBe(3);
      expect(state.pyramids[pyramidId]!.cupIds.length).toBeGreaterThan(0);
    }

    // The calendar is one calendar, dated once, and the cups were placed on it
    // rather than left undated.
    expect(structure.calendar.length).toBeGreaterThan(22);
    expect(state.season.calendar).toEqual(structure.calendar);
    expect(state.season.endDate).toBe(structure.calendar[structure.calendar.length - 1]!.date);
    expect(structure.cupSlots.length).toBeGreaterThan(0);
    expect(structure.cupSlots.every((slot) => slot.date !== null)).toBe(true);

    // Five cups for the three ladders plus the second county's own.
    const cups = Object.values(state.competitions).filter((competition) => competition.kind === 'cup');
    expect(cups.map((cup) => cup.id).sort()).toEqual(
      [
        cupCompetitionId(ladders[0]!, 'cup'),
        cupCompetitionId(ladders[0]!, 'plate'),
        cupCompetitionId(ladders[1]!, 'cup'),
        cupCompetitionId(ladders[1]!, 'plate'),
        cupCompetitionId(ladders[2]!, 'cup'),
        cupCompetitionId(ladders[2]!, 'plate'),
        countyCupId(SECOND_COUNTY),
      ].sort(),
    );
  });
});
