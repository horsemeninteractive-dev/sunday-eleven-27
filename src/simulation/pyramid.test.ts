import { describe, expect, it } from 'vitest';
import { DEFAULT_PYRAMID, FOUNDING_PYRAMID_ID, type Competition, type Pyramid } from '@/domain/competition';
import { FOUNDING_REGION_ID } from '@/domain/world';
import type { GameState } from '@/domain/game';
import type { PyramidId } from '@/domain/ids';
import {
  COUNTY_CUP_ID,
  LEAGUE_CUP_ID,
  PLATE_ID,
  cupCompetitionId,
  divisionAbove,
  divisionBelow,
  divisionCompetitionId,
  divisionOf,
  divisionsOf,
  leagueCompetitions,
  levelOf,
  pyramidForCompetition,
  pyramidIdOf,
  pyramidOf,
  pyramidsOf,
  regionNameFor,
  tierOf,
} from './pyramid';
import { createTestGame } from './testSupport';

/**
 * The county the game actually builds, and the ladder next door inside it.
 *
 * A career is born with two ladders — the county's and the district's — so the
 * interesting questions (can a lookup walk into the wrong one? do two ladders at
 * the same tier numbers stay apart?) are asked of a real world rather than of a
 * second ladder bolted on for the test. `foundingGame` is that world;
 * `districtOf` is the ladder in it that is not the founding one.
 */
function foundingGame(seed = 'one-pyramid') {
  return createTestGame(seed);
}

/** The ladder a career is born with that is not the founding one. */
function districtOf(state: GameState): Pyramid {
  const id = state.pyramidIds.find((entry) => entry !== FOUNDING_PYRAMID_ID) as PyramidId;
  return state.pyramids[id]!;
}

/**
 * The clubs of one rung of a ladder, in table order — the ladders' own members,
 * whatever tier numbers the other ladder happens to be using.
 */
function rung(state: GameState, pyramidId: PyramidId, tier: number): string[] {
  return [...(divisionsOf(state, pyramidId).find((competition) => competition.tier === tier)?.clubIds ?? [])];
}

describe('the ladders a career is born with', () => {
  it('gives the county one ladder and the district next door another', () => {
    const state = foundingGame().state;

    // Two regions, drawn once and never rewritten, and every town in exactly one
    // of them.
    expect(Object.values(state.world.regions)).toHaveLength(2);
    const regionIds = new Set(state.world.regionIds);
    expect(regionIds.size).toBe(2);
    for (const town of Object.values(state.world.towns)) expect(regionIds.has(town.regionId)).toBe(true);

    // Two ladders, and the founding one is still first.
    expect(state.pyramidIds).toHaveLength(2);
    expect(state.pyramidIds[0]).toBe(FOUNDING_PYRAMID_ID);
    const pyramid = pyramidOf(state, FOUNDING_PYRAMID_ID);
    expect(pyramid.id).toBe(FOUNDING_PYRAMID_ID);
    expect(pyramid.regionId).toBe(FOUNDING_REGION_ID);
    expect(pyramid.level).toBe(1);
    expect(pyramid.config).toEqual(DEFAULT_PYRAMID);
    expect(pyramid.name).toBe(`${state.world.regionName} Sunday League`);
    expect(pyramidsOf(state)).toHaveLength(2);
    expect(pyramidOf(state)).toBe(pyramid);

    // The county's ladder: three divisions, tier 1 first, all of them its own,
    // and the county's cups on top of them.
    expect(pyramid.competitionIds).toEqual(['comp_league_t1', 'comp_league_t2', 'comp_league_t3']);
    expect(divisionsOf(state).map((competition) => competition.id)).toEqual(pyramid.competitionIds);
    expect(divisionsOf(state).map((competition) => competition.tier)).toEqual([1, 2, 3]);
    expect(pyramid.cupIds).toEqual([LEAGUE_CUP_ID, PLATE_ID]);

    for (const competition of [...divisionsOf(state), ...pyramid.cupIds.map((id) => state.competitions[id]!)]) {
      expect(pyramidForCompetition(state, competition)?.id).toBe(FOUNDING_PYRAMID_ID);
      expect(pyramidIdOf(state, competition)).toBe(FOUNDING_PYRAMID_ID);
    }

    // The district next door: its own region, its own three divisions at its own
    // tiers, named after its own valley — and its own League Cup and Plate, drawn
    // from its own clubs. Stage 3 turned those on. The two ladders' cups have no
    // club in common, which is what lets them play on the same Sundays.
    const district = districtOf(state);
    expect(district.regionId).not.toBe(FOUNDING_REGION_ID);
    expect(district.level).toBe(2);
    expect(district.name).toBe(`${state.world.regions[district.regionId]!.name} Sunday League`);
    expect(divisionsOf(state, district.id).map((competition) => competition.tier)).toEqual([1, 2, 3]);
    expect(divisionsOf(state, district.id).map((competition) => competition.name)).toEqual([
      `${regionNameFor(state, district.id)} Sunday League Division One`,
      `${regionNameFor(state, district.id)} Sunday League Division Two`,
      `${regionNameFor(state, district.id)} Sunday League Division Three`,
    ]);
    expect(district.cupIds).toEqual([cupCompetitionId(district.id, 'cup'), cupCompetitionId(district.id, 'plate')]);
    for (const competition of divisionsOf(state, district.id)) {
      expect(pyramidIdOf(state, competition)).toBe(district.id);
      expect(pyramidForCompetition(state, competition)?.id).toBe(district.id);
    }

    // Every club that plays is in exactly one division, and it is the division of
    // the ladder that draws its town's region.
    for (const club of Object.values(state.clubs)) {
      if (!club.active) continue;
      const memberships = leagueCompetitions(state).filter((competition) =>
        competition.clubIds.includes(club.id),
      );
      expect(memberships).toHaveLength(1);
      expect(divisionOf(state, club.id)!.id).toBe(memberships[0]!.id);
      const regionId = state.world.towns[club.townId]!.regionId;
      const ladder = [pyramid, district].find((entry) => entry.regionId === regionId);
      expect(ladder?.id).toBe(pyramidIdOf(state, memberships[0]!));
    }
  });

  it('keeps every competition id the founding pyramid already had', () => {
    expect(divisionCompetitionId(FOUNDING_PYRAMID_ID, 1)).toBe('comp_league_t1');
    expect(divisionCompetitionId(FOUNDING_PYRAMID_ID, 3)).toBe('comp_league_t3');
    expect(cupCompetitionId(FOUNDING_PYRAMID_ID, 'cup')).toBe('comp_league_cup');
    expect(cupCompetitionId(FOUNDING_PYRAMID_ID, 'plate')).toBe('comp_plate');
    expect(LEAGUE_CUP_ID).toBe('comp_league_cup');
    expect(PLATE_ID).toBe('comp_plate');

    // A second ladder names its own, and collides with none of them.
    expect(divisionCompetitionId('vale', 1)).toBe('comp_vale_t1');
    expect(cupCompetitionId('vale', 'cup')).toBe('comp_vale_cup');
    expect(cupCompetitionId('vale', 'plate')).toBe('comp_vale_plate');
  });

  it('steps up and down its own ladder, and off neither end', () => {
    const state = foundingGame().state;
    const [top, second, bottom] = divisionsOf(state) as [Competition, Competition, Competition];

    expect(divisionAbove(state, top)).toBeUndefined();
    expect(divisionAbove(state, second)?.id).toBe(top.id);
    expect(divisionAbove(state, bottom)?.id).toBe(second.id);
    expect(divisionBelow(state, bottom)).toBeUndefined();
    expect(divisionBelow(state, second)?.id).toBe(bottom.id);
    expect(divisionBelow(state, top)?.id).toBe(second.id);

    // A step up and back down is the same division: rung, not arithmetic.
    expect(divisionAbove(state, divisionBelow(state, top)!)?.id).toBe(top.id);
    expect(divisionBelow(state, divisionAbove(state, bottom)!)?.id).toBe(bottom.id);
  });
});

describe('two ladders at the same tier numbers', () => {
  it('never steps into the other ladder at the same tier', () => {
    const state = foundingGame('two-pyramids').state;
    const district = districtOf(state);
    const [top, second, bottom] = divisionsOf(state, FOUNDING_PYRAMID_ID) as [Competition, Competition, Competition];
    const [districtTop, districtSecond, districtBottom] = divisionsOf(state, district.id) as [
      Competition,
      Competition,
      Competition,
    ];

    // The county's own steps stay on the county's ladder even though the district
    // has a division at the tier next door.
    expect(divisionAbove(state, second)?.id).toBe(top.id);
    expect(divisionBelow(state, top)?.id).toBe(second.id);
    // And the bottom of the county's ladder does not fall into the district's.
    expect(divisionBelow(state, bottom)).toBeUndefined();
    expect(divisionAbove(state, top)).toBeUndefined();

    // The district's steps are its own, at its own level.
    expect(divisionAbove(state, districtSecond)?.id).toBe(districtTop.id);
    expect(divisionAbove(state, districtTop)).toBeUndefined();
    expect(divisionBelow(state, districtTop)?.id).toBe(districtSecond.id);
    expect(divisionBelow(state, districtBottom)).toBeUndefined();

    // Ownership, not the shape of an id, is what says whose a division is.
    expect(pyramidIdOf(state, districtTop)).toBe(district.id);
    expect(pyramidIdOf(state, districtSecond)).toBe(district.id);
    expect(pyramidForCompetition(state, state.competitions['comp_league_t1']!)?.id).toBe(FOUNDING_PYRAMID_ID);
    expect(divisionsOf(state, district.id).map((competition) => competition.id)).toEqual(district.competitionIds);
    expect(leagueCompetitions(state)).toHaveLength(6);
    // A pyramid nobody has heard of owns nothing rather than something wrong.
    expect(divisionsOf(state, 'nowhere')).toEqual([]);
  });

  it('separates a rung of a ladder from a level of football', () => {
    const state = foundingGame('two-levels').state;
    const district = districtOf(state);
    const county = divisionsOf(state, FOUNDING_PYRAMID_ID) as [Competition, Competition, Competition];
    const districtLadder = divisionsOf(state, district.id) as [Competition, Competition, Competition];
    const clubOf = (competition: Competition) => competition.clubIds[0]!;

    // Tier is the rung; level is where that rung sits in the county. Both ladders
    // start at tier 1, and the district's is a level below the county's.
    expect(tierOf(state, clubOf(districtLadder[0]))).toBe(1);
    expect(levelOf(state, clubOf(districtLadder[0]))).toBe(2);
    expect(tierOf(state, clubOf(districtLadder[1]))).toBe(2);
    expect(levelOf(state, clubOf(districtLadder[1]))).toBe(3);
    expect(tierOf(state, clubOf(districtLadder[2]))).toBe(3);
    expect(levelOf(state, clubOf(districtLadder[2]))).toBe(4);

    expect(tierOf(state, clubOf(county[0]))).toBe(1);
    expect(levelOf(state, clubOf(county[0]))).toBe(1);
    expect(levelOf(state, clubOf(county[2]))).toBe(3);
    expect(levelOf(state, 'club_nowhere')).toBeNull();
  });

  it('keeps each club in the region its ladder draws from', () => {
    const state = foundingGame('two-regions').state;
    const district = districtOf(state);
    const countyClubs = new Set([...rung(state, FOUNDING_PYRAMID_ID, 1), ...rung(state, FOUNDING_PYRAMID_ID, 2), ...rung(state, FOUNDING_PYRAMID_ID, 3)]);

    let districtClubs = 0;
    for (const tier of [1, 2, 3]) {
      for (const clubId of rung(state, district.id, tier)) {
        districtClubs += 1;
        // Nobody plays in two ladders, and the county's clubs are not the
        // district's.
        expect(countyClubs.has(clubId)).toBe(false);
        expect(state.world.towns[state.clubs[clubId]!.townId]!.regionId).toBe(district.regionId);
      }
    }
    expect(districtClubs).toBe(DEFAULT_PYRAMID.tiers * DEFAULT_PYRAMID.clubsPerTier);
    expect(countyClubs.size).toBe(DEFAULT_PYRAMID.tiers * DEFAULT_PYRAMID.clubsPerTier);
    // And the county's clubs are all in the county's own region.
    for (const clubId of countyClubs) {
      expect(state.world.towns[state.clubs[clubId]!.townId]!.regionId).toBe(FOUNDING_REGION_ID);
    }
  });
});

describe('a career with no pyramid record', () => {
  it('reads the founding ladder out of the world it already has', () => {
    // A save written before pyramids existed is a one-ladder county: a world with
    // a district next door always carries both ladders as records, so the
    // fallback is only ever asked about the county's own football.
    const state = createTestGame('no-record', 0, 2026, 1).state;
    delete (state as { pyramids?: unknown }).pyramids;
    delete (state as { pyramidIds?: unknown }).pyramidIds;

    expect(pyramidOf(state).id).toBe(FOUNDING_PYRAMID_ID);
    expect(pyramidOf(state).config).toEqual(DEFAULT_PYRAMID);
    expect(divisionsOf(state).map((competition) => competition.id)).toEqual([
      'comp_league_t1',
      'comp_league_t2',
      'comp_league_t3',
    ]);
    const [top, second] = divisionsOf(state) as [Competition, Competition];
    expect(divisionAbove(state, top)).toBeUndefined();
    expect(divisionAbove(state, second)?.id).toBe(top.id);
    expect(levelOf(state, top.clubIds[0]!)).toBe(1);
  });

  it('claims the founding ladder’s cups off the world, and leaves the county cup to the county', () => {
    // With no pyramid record to read, ownership comes off the world — and the one
    // thing that must not happen is a county cup ending up in a ladder's list. A
    // county cup's field is the whole county, so it is nobody's ladder's; the
    // district's own cup names the district; and the founding ladder's Plate says
    // nothing at all, which is what a cup written before fields existed says too.
    const state = createTestGame('no-record-cups').state;
    delete (state as { pyramids?: unknown }).pyramids;
    delete (state as { pyramidIds?: unknown }).pyramidIds;

    const district = state.pyramidIds?.find((id) => id !== FOUNDING_PYRAMID_ID);
    const founded = pyramidOf(state);
    expect(founded.id).toBe(FOUNDING_PYRAMID_ID);
    // The cups the founding ladder was founded with, claimed; the world-level one
    // and the district's, not.
    expect(founded.cupIds).toEqual([LEAGUE_CUP_ID, PLATE_ID]);
    expect(founded.cupIds).not.toContain(COUNTY_CUP_ID);
    if (district) expect(founded.cupIds).not.toContain(cupCompetitionId(district, 'cup'));
    // And the county cup is owned by nobody under the recordless read either.
    expect(pyramidIdOf(state, state.competitions[COUNTY_CUP_ID]!)).toBeNull();
    // A ladder that is not in the world owns nothing rather than the county's own.
    expect(pyramidOf(state, 'nowhere').cupIds).toEqual([]);
  });
});
