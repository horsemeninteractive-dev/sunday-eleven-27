import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PYRAMID, FOUNDING_PYRAMID_ID } from '@/domain/competition';
import {
  FOUNDING_COUNTY_ID,
  FOUNDING_COUNTY_NAME,
  FOUNDING_REGION_ID,
  FOUNDING_REGION_NAME,
  SECOND_REGION_ID,
  SECOND_REGION_NAME,
} from '@/domain/world';
import { isPlayer } from '@/domain/person';
import { ALL_POSITION_CODES } from '@/domain/positions';
import { generateDraft } from '../gameSetup';
import { foundDistrictPyramid, type FoundDistrictOptions } from './worldGenerator';
import { generatePlayer } from './playerGenerator';
import { Rng } from '../rng';

/** A draft's own content, hashed: one number for "the world did not move". */
function hashOf(draft: ReturnType<typeof generateDraft>): string {
  return createHash('sha256').update(JSON.stringify(draft)).digest('hex').slice(0, 16);
}

/**
 * The world as it was generated *before* a ladder could be given an id.
 *
 * The hashes below were taken from the generator as it stood before that change,
 * and every id named beside them is the id it minted then. They are a baseline
 * rather than a self-check on purpose: two post-change runs matching each other
 * would say only that the change is deterministic, not that it left the world
 * where it was.
 *
 * The `drawn…` fields are the valley names these worlds wore back then. The two
 * live regions are named by the map now rather than by the valley a seed draws,
 * so the names are put back before the hash is taken (see
 * `asTheBaselineRecorded`): these hashes still say exactly what they were written
 * to say — that the ids, the settlements, the clubs and the people have not moved
 * — and the names themselves are asserted on their own, as the map's.
 */
const LEGACY_DRAFTS = [
  { seed: 'identity-baseline-a', pyramids: 1, hash: '5446526a9f91ce71', drawn: 'Cale Valley', district: null },
  {
    seed: 'identity-baseline-a',
    pyramids: 2,
    hash: '781c0024ea22b4d0',
    drawn: 'Cale Valley',
    district: {
      id: 'dene',
      drawnRegionName: 'Dene Valley',
      firstClub: 'club_dene_1',
      lastClub: 'club_dene_9',
      ground: 'ground_dene_1',
      manager: 'mgr_dene_1',
      chairman: 'chm_dene_1',
    },
  },
  { seed: 'identity-baseline-b', pyramids: 1, hash: '08b3c738caaea278', drawn: 'Stour Valley', district: null },
  {
    seed: 'identity-baseline-b',
    pyramids: 2,
    hash: 'fc17f974cf692353',
    drawn: 'Stour Valley',
    district: {
      id: 'brue',
      drawnRegionName: 'Brue Valley',
      firstClub: 'club_brue_1',
      lastClub: 'club_brue_9',
      ground: 'ground_brue_1',
      manager: 'mgr_brue_1',
      chairman: 'chm_brue_1',
    },
  },
  { seed: 'district-ids', pyramids: 1, hash: 'a11e8f693db1e5e1', drawn: 'Cale Valley', district: null },
  {
    seed: 'district-ids',
    pyramids: 2,
    hash: '13dc3098cd99a990',
    drawn: 'Cale Valley',
    district: {
      id: 'wyre',
      drawnRegionName: 'Wyre Valley',
      firstClub: 'club_wyre_1',
      lastClub: 'club_wyre_9',
      ground: 'ground_wyre_1',
      manager: null,
      chairman: 'chm_wyre_1',
    },
  },
] as const;

/**
 * The draft as this baseline recorded it: its two live regions wearing the valley
 * names the seed drew, which is what every hash below was taken over.
 *
 * Only the fields a region's name reaches are put back — the world's own name,
 * the two region records, each ladder's name, and the league name built from it —
 * so a hash that still matches says the ids, the settlements, the clubs, the
 * people and the divisions are exactly the ones this seed has always minted, and
 * that naming the districts after the map is all that has changed.
 */
function asTheBaselineRecorded(
  draft: ReturnType<typeof generateDraft>,
  expected: (typeof LEGACY_DRAFTS)[number],
): ReturnType<typeof generateDraft> {
  const restored = structuredClone(draft);
  const founding = expected.drawn;
  const district = expected.district?.drawnRegionName ?? null;
  restored.world.regionName = founding;
  restored.world.regions[FOUNDING_REGION_ID]!.name = founding;
  if (district) restored.world.regions[SECOND_REGION_ID]!.name = district;
  restored.leagueName = `${founding} Sunday League Division One`;
  for (const pyramid of restored.pyramids) {
    pyramid.name = pyramid.id === FOUNDING_PYRAMID_ID ? `${founding} Sunday League` : `${district} Sunday League`;
  }
  return restored;
}

/**
 * The world a district is founded into, handed over the way the generator takes
 * it: a one-ladder county's own towns, businesses, grounds, clubs and people.
 */
function intoTheCounty(seed: string): { draft: ReturnType<typeof generateDraft>; options: FoundDistrictOptions } {
  const draft = generateDraft({ seed, pyramids: 1 });
  return {
    draft,
    options: {
      seed: `${seed}::district`,
      currentYear: draft.startYear,
      seasonStart: draft.seasonStart,
      towns: Object.values(draft.world.towns),
      businesses: Object.values(draft.world.businesses),
      grounds: draft.world.grounds,
      clubs: draft.clubs,
      people: draft.people,
      regions: Object.values(draft.world.regions),
    },
  };
}

function summarise(world: ReturnType<typeof generateDraft>) {
  return Object.values(world.clubs)
    .map((club) => ({
      name: club.identity.name,
      town: club.townId,
      ground: world.world.grounds[club.groundId]?.name,
      structure: club.structure,
      reputation: club.reputation,
      squad: club.squadIds
        .map((id) => world.people[id])
        .filter(isPlayer)
        .map((player) => `${player.firstName} ${player.surname} ${player.preferredPosition} ${player.attributes.technical.passing}`),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe('world generation', () => {
  it('is deterministic for a given seed', () => {
    const a = generateDraft({ seed: 'ash-tree-7' });
    const b = generateDraft({ seed: 'ash-tree-7' });
    expect(summarise(a)).toEqual(summarise(b));
    expect(a.leagueName).toBe(b.leagueName);
  });

  it('draws two regions, and every town belongs to exactly one of them', () => {
    const world = generateDraft({ seed: 'region-and-towns', pyramids: 2 });
    const county = generateDraft({ seed: 'region-and-towns', pyramids: 1 });

    const regions = Object.values(world.world.regions);
    expect(regions).toHaveLength(2);
    expect(world.world.regionIds).toEqual(regions.map((region) => region.id));

    const founding = regions[0]!;
    const district = regions[1]!;
    expect(founding.id).toBe(FOUNDING_REGION_ID);
    expect(founding.name).toBe(world.world.regionName);
    expect(district.id).toBe(SECOND_REGION_ID);
    expect(district.name).not.toBe(founding.name);
    // Two centres, and they are two places: a district drawn on top of the county
    // is not a district.
    expect(Math.hypot(founding.centre.x - district.centre.x, founding.centre.y - district.centre.y)).toBeGreaterThan(10);

    // The county's region is the county's own settlements — the ones it has
    // always had, wearing the map's name for the district and centred on the
    // middle of them — and not one of them has moved regions to make room for
    // anybody.
    const countyTowns = Object.values(county.world.towns);
    expect(countyTowns.length).toBeGreaterThan(5);
    const mean = (of: (town: (typeof countyTowns)[number]) => number) =>
      countyTowns.reduce((sum, town) => sum + of(town), 0) / countyTowns.length;
    expect(founding.centre.x).toBeCloseTo(mean((town) => town.x));
    expect(founding.centre.y).toBeCloseTo(mean((town) => town.y));
    for (const town of countyTowns) expect(world.world.towns[town.id]!.regionId).toBe(FOUNDING_REGION_ID);

    // Every town in the world is in exactly one of the two regions, and a
    // district town is nearer its own region's centre than the county's — which is
    // the rule that put it there.
    const regionIds = new Set(regions.map((region) => region.id));
    for (const town of Object.values(world.world.towns)) expect(regionIds.has(town.regionId)).toBe(true);
    const districtTowns = Object.values(world.world.towns).filter((town) => town.regionId === SECOND_REGION_ID);
    expect(districtTowns.length).toBeGreaterThan(5);
    for (const town of districtTowns) {
      const toDistrict = Math.hypot(district.centre.x - town.x, district.centre.y - town.y);
      const toCounty = Math.hypot(founding.centre.x - town.x, founding.centre.y - town.y);
      expect(toDistrict).toBeLessThan(toCounty);
    }
  });

  it('draws one county, and every region and town of the world is in it', () => {
    const world = generateDraft({ seed: 'region-and-towns', pyramids: 2 });
    const county = generateDraft({ seed: 'region-and-towns', pyramids: 1 });

    // One county, named what the career has always called it, holding both of the
    // regions the world was drawn from — the district's as well as the county's,
    // because a district next door is a piece of the same county's football.
    expect(world.world.countyIds).toEqual([FOUNDING_COUNTY_ID]);
    const record = world.world.counties[FOUNDING_COUNTY_ID]!;
    expect(record.name).toBe(FOUNDING_COUNTY_NAME);
    expect(record.regionIds).toEqual(world.world.regionIds);
    expect(record.regionIds).toEqual([FOUNDING_REGION_ID, SECOND_REGION_ID]);

    // Every region says which county it is a piece of and every town which county
    // it is in, and with one county there is only one answer they can give.
    for (const region of Object.values(world.world.regions)) expect(region.countyId).toBe(FOUNDING_COUNTY_ID);
    for (const town of Object.values(world.world.towns)) expect(town.countyId).toBe(FOUNDING_COUNTY_ID);

    // A county founded with one ladder is the same county: the district is not a
    // second county, and the county that has one region still has an id.
    expect(county.world.countyIds).toEqual([FOUNDING_COUNTY_ID]);
    expect(county.world.counties[FOUNDING_COUNTY_ID]!.regionIds).toEqual([FOUNDING_REGION_ID]);
    for (const town of Object.values(county.world.towns)) expect(town.countyId).toBe(FOUNDING_COUNTY_ID);
  });

  it('produces different worlds for different seeds', () => {
    const a = generateDraft({ seed: 'ash-tree-7' });
    const b = generateDraft({ seed: 'willow-lane-2' });
    expect(summarise(a)).not.toEqual(summarise(b));
  });

  it('builds a believable local area of clubs, towns and grounds', () => {
    const world = generateDraft({ seed: 'grassroots-1', pyramids: 2 });
    const clubs = Object.values(world.clubs);
    // Two ladders' worth of clubs: the county's thirty-six and the district's.
    expect(clubs.length).toBe(2 * DEFAULT_PYRAMID.tiers * DEFAULT_PYRAMID.clubsPerTier);
    expect(world.divisionClubIds.length).toBe(DEFAULT_PYRAMID.clubsPerTier);
    expect(world.pyramids.map((pyramid) => pyramid.divisions.length)).toEqual([
      DEFAULT_PYRAMID.tiers,
      DEFAULT_PYRAMID.tiers,
    ]);

    // The ladder: three divisions, full, and ranked so the top division is the
    // strongest. Reputation drove both the ranking and the squads, so this is
    // stratification from the moment the world is built rather than something
    // the first few seasons sort out.
    expect(world.divisions.length).toBe(DEFAULT_PYRAMID.tiers);
    const divisionReputations = world.divisions.map((division) =>
      division.map((id) => world.clubs[id]!.reputation),
    );
    for (const division of divisionReputations) {
      expect(division.length).toBe(DEFAULT_PYRAMID.clubsPerTier);
    }
    const tierMean = (reputations: number[]) =>
      reputations.reduce((sum, value) => sum + value, 0) / reputations.length;
    expect(tierMean(divisionReputations[0]!)).toBeGreaterThan(tierMean(divisionReputations[1]!));
    expect(tierMean(divisionReputations[1]!)).toBeGreaterThan(tierMean(divisionReputations[2]!));

    const towns = Object.values(world.world.towns);
    expect(towns.length).toBeGreaterThanOrEqual(5);
    for (const town of towns) {
      expect(town.population).toBeGreaterThan(100);
      expect(town.description.length).toBeGreaterThan(10);
    }

    for (const club of clubs) {
      expect(club.identity.name.length).toBeGreaterThan(3);
      expect(club.identity.foundedYear).toBeGreaterThan(1880);
      expect(world.world.grounds[club.groundId]).toBeTruthy();
      expect(club.squadIds.length).toBeGreaterThanOrEqual(20);
      expect(club.squadIds.length).toBeLessThanOrEqual(25);
      expect(club.managerId).toBeTruthy();
      expect(club.chairmanId).toBeTruthy();
      expect(club.identity.colours.primary).toMatch(/^#/);
    }
  });

  it('generates squads with credible depth in every area of the pitch', () => {
    const world = generateDraft({ seed: 'squad-depth' });
    for (const club of Object.values(world.clubs)) {
      const squad = club.squadIds.map((id) => world.people[id]).filter(isPlayer);
      expect(squad.filter((player) => player.preferredPosition === 'GK').length).toBeGreaterThanOrEqual(2);
      expect(squad.filter((player) => player.positionGroup === 'DEF').length).toBeGreaterThanOrEqual(5);
      expect(squad.filter((player) => player.positionGroup === 'MID').length).toBeGreaterThanOrEqual(5);
      expect(squad.filter((player) => player.positionGroup === 'FWD').length).toBeGreaterThanOrEqual(4);
    }
  });

  it('creates rivalries between nearby clubs, symmetrically', () => {
    const world = generateDraft({ seed: 'derby-day' });
    const withRivalries = Object.values(world.clubs).filter((club) => Object.keys(club.rivalries).length > 0);
    expect(withRivalries.length).toBeGreaterThan(0);
    for (const club of withRivalries) {
      for (const [opponentId, rivalry] of Object.entries(club.rivalries)) {
        expect(world.clubs[opponentId]?.rivalries[club.id]?.intensity).toBe(rivalry.intensity);
        expect(rivalry.intensity).toBeGreaterThan(0);
      }
    }
  });

  it('founds the same district, and the same second ladder, from the same seed', () => {
    const a = generateDraft({ seed: 'district-repeat', pyramids: 2 });
    const b = generateDraft({ seed: 'district-repeat', pyramids: 2 });
    const district = (draft: ReturnType<typeof generateDraft>) => ({
      towns: Object.values(draft.world.towns)
        .filter((town) => town.regionId === SECOND_REGION_ID)
        .map((town) => `${town.id} ${town.name} ${town.kind} ${town.population} ${town.x},${town.y}`),
      clubs: Object.values(draft.clubs)
        .filter((club) => draft.world.towns[club.townId]!.regionId === SECOND_REGION_ID)
        .map((club) => `${club.id} ${club.identity.name} ${club.townId} ${club.groundId} ${club.reputation} ${club.squadIds.join('/')}`),
    });

    expect(b.pyramids).toEqual(a.pyramids);
    expect(Object.values(b.world.regions)).toEqual(Object.values(a.world.regions));
    expect(district(b)).toEqual(district(a));

    // And it is a ladder of its own, with a region of its own.
    expect(a.pyramids[1]!.id).not.toBe(a.pyramids[0]!.id);
    expect(a.pyramids[1]!.regionId).toBe(SECOND_REGION_ID);
    expect(a.pyramids[1]!.level).toBe(2);
  });

  it('leaves the founding county exactly as it was when the districts are founded', () => {
    const county = generateDraft({ seed: 'district-continuity', pyramids: 1 });
    const world = generateDraft({ seed: 'district-continuity' });

    // The whole county founded beside it: five districts, a hundred and eighty
    // clubs, and not one of the county's own touched by any of them.
    expect(county.pyramids).toHaveLength(1);
    expect(world.pyramids).toHaveLength(6);
    expect(Object.keys(world.clubs).length).toBe(Object.keys(county.clubs).length * 6);

    // The county's clubs are the same clubs: the same names, towns, grounds,
    // standing, squads, committees, rivalries and books.
    for (const [id, before] of Object.entries(county.clubs)) {
      const after = world.clubs[id]!;
      expect(after, id).toBeTruthy();
      expect(after.identity).toEqual(before.identity);
      expect(after.townId).toBe(before.townId);
      expect(after.groundId).toBe(before.groundId);
      expect(after.reputation).toBe(before.reputation);
      expect(after.squadIds).toEqual(before.squadIds);
      expect(after.staff).toEqual(before.staff);
      expect(after.rivalries).toEqual(before.rivalries);
      expect(after.finances).toEqual(before.finances);
      expect(after.history).toEqual(before.history);
    }
    for (const [id, town] of Object.entries(county.world.towns)) expect(world.world.towns[id]).toEqual(town);
    for (const [id, ground] of Object.entries(county.world.grounds)) expect(world.world.grounds[id]).toEqual(ground);
    expect(world.world.regions[FOUNDING_REGION_ID]).toEqual(county.world.regions[FOUNDING_REGION_ID]);

    // And its ladder is the ladder it has always been.
    expect(world.pyramids[0]!.divisions).toEqual(county.divisions);
    expect(world.divisions).toEqual(county.divisions);
    expect(world.divisionClubIds).toEqual(county.divisionClubIds);
    expect(world.leagueName).toBe(county.leagueName);
  });

  it('gives the district a ladder of its own, with ids nobody else has', () => {
    const world = generateDraft({ seed: 'district-ids', pyramids: 2 });
    const county = world.pyramids[0]!;
    const district = world.pyramids[1]!;

    // Three divisions of twelve, cut from the district's own clubs — and a ladder
    // that runs a League Cup and a Plate like any other, because Stage 3 dates a
    // second ladder's cups rather than leaving them out of the county's calendar.
    expect(district.config).toEqual(DEFAULT_PYRAMID);
    expect(district.config.leagueCup).toBe(true);
    expect(district.config.consolationCup).toBe(true);
    expect(district.config.tiers).toBe(DEFAULT_PYRAMID.tiers);
    expect(district.divisions.map((division) => division.length)).toEqual([
      DEFAULT_PYRAMID.clubsPerTier,
      DEFAULT_PYRAMID.clubsPerTier,
      DEFAULT_PYRAMID.clubsPerTier,
    ]);

    // The two ladders are two populations of clubs, and no club is in both.
    const countyClubs = new Set(county.divisions.flat());
    expect(countyClubs.size).toBe(36);
    const districtClubs = district.divisions.flat();
    expect(new Set(districtClubs).size).toBe(36);
    for (const clubId of districtClubs) expect(countyClubs.has(clubId)).toBe(false);

    // Every id in the world is minted once...
    for (const names of [
      Object.keys(world.clubs),
      Object.keys(world.people),
      Object.keys(world.world.grounds),
      Object.keys(world.world.towns),
      Object.keys(world.world.businesses),
    ]) {
      expect(new Set(names).size).toBe(names.length);
    }

    // ...and the district's carry its own ladder's id, so nothing it mints can
    // ever collide with the county's.
    for (const clubId of districtClubs) {
      const club = world.clubs[clubId]!;
      expect(club.id.startsWith(`club_${district.id}_`)).toBe(true);
      expect(club.groundId.startsWith(`ground_${district.id}_`)).toBe(true);
      const town = world.world.towns[club.townId]!;
      expect(town.regionId).toBe(district.regionId);
      const ground = world.world.grounds[club.groundId]!;
      expect(ground.townId).toBe(club.townId);
      // The club either owns the pitch it plays on or shares one in its own town.
      expect(ground.tenantClubId === club.id || ground.sharedWith.includes(club.id)).toBe(true);
      expect(world.people[club.managerId!]).toBeTruthy();
      expect(world.people[club.chairmanId!]).toBeTruthy();
      expect(club.squadIds.length).toBeGreaterThanOrEqual(20);
      for (const playerId of club.squadIds) expect(world.people[playerId]).toBeTruthy();
    }
  });
});

describe('a ladder that is handed its own identity', () => {
  it('generates exactly the world it generated before a ladder could be given an id, under the map’s names', () => {
    for (const expected of LEGACY_DRAFTS) {
      const draft = generateDraft({ seed: expected.seed, pyramids: expected.pyramids });
      const where = `${expected.seed} / ${expected.pyramids} ladder(s)`;

      // The world the seed has always built: with the drawing valleys' names on
      // the two regions it is the baseline's, field for field.
      expect(hashOf(asTheBaselineRecorded(draft, expected)), where).toBe(expected.hash);
      expect(draft.world.regionIds, where).toEqual(
        expected.district ? [FOUNDING_REGION_ID, SECOND_REGION_ID] : [FOUNDING_REGION_ID],
      );
      expect(draft.pyramids.map((pyramid) => pyramid.id), where).toEqual(
        expected.district ? [FOUNDING_PYRAMID_ID, expected.district.id] : [FOUNDING_PYRAMID_ID],
      );

      // And the names on it are the map's, whichever seed built it and whichever
      // district a manager starts in.
      expect(draft.world.regionName, where).toBe(FOUNDING_REGION_NAME);
      expect(draft.world.regions[FOUNDING_REGION_ID]!.name, where).toBe(FOUNDING_REGION_NAME);
      expect(draft.pyramids[0]!.name, where).toBe(`${FOUNDING_REGION_NAME} Sunday League`);
      expect(draft.leagueName, where).toBe(`${FOUNDING_REGION_NAME} Sunday League Division One`);
      if (!expected.district) continue;

      // The district's own ids, exactly as they were: its ladder, its region, and
      // the entities minted under it.
      const district = draft.pyramids[1]!;
      expect(district.name, where).toBe(`${SECOND_REGION_NAME} Sunday League`);
      expect(district.level, where).toBe(2);
      expect(district.regionId, where).toBe(SECOND_REGION_ID);
      expect(draft.world.regions[SECOND_REGION_ID]!.name, where).toBe(SECOND_REGION_NAME);

      const districtClubs = district.divisions.flat().slice().sort();
      expect(districtClubs[0], where).toBe(expected.district.firstClub);
      expect(districtClubs.at(-1), where).toBe(expected.district.lastClub);
      const first = draft.clubs[expected.district.firstClub]!;
      expect(first.groundId, where).toBe(expected.district.ground);
      if (expected.district.manager) expect(first.managerId, where).toBe(expected.district.manager);
      if (expected.district.chairman) expect(first.chairmanId, where).toBe(expected.district.chairman);
    }
  });

  it('uses the ladder id, name, level, region id and region name it is handed', () => {
    const { options } = intoTheCounty('handed-identity');
    const district = foundDistrictPyramid({
      ...options,
      id: 'aldermarket',
      name: 'Aldermarket Sunday League',
      regionId: 'region_aldermarket',
      regionName: 'Aldermarket',
      level: 3,
      countyId: FOUNDING_COUNTY_ID,
    });

    expect(district.id).toBe('aldermarket');
    expect(district.name).toBe('Aldermarket Sunday League');
    expect(district.level).toBe(3);
    expect(district.region.id).toBe('region_aldermarket');
    expect(district.region.name).toBe('Aldermarket');
    expect(district.region.countyId).toBe(FOUNDING_COUNTY_ID);

    // Nothing it mints is named after a valley: the ladder it was given is the
    // prefix of its clubs, their grounds, and the men who run them.
    const clubs = district.divisions.flat();
    expect(clubs).toHaveLength(DEFAULT_PYRAMID.tiers * DEFAULT_PYRAMID.clubsPerTier);
    for (const clubId of clubs) {
      expect(clubId.startsWith('club_aldermarket_')).toBe(true);
      const club = options.clubs[clubId]!;
      expect(club.groundId.startsWith('ground_aldermarket_')).toBe(true);
      // A manager is a manager, or a player-manager whose own id is his club's.
      expect(club.managerId).toContain('aldermarket');
      expect(club.chairmanId!.startsWith('chm_aldermarket_')).toBe(true);
      expect(options.people[club.managerId!]).toBeTruthy();
      expect(options.people[club.chairmanId!]).toBeTruthy();

      // The map has the last word on where a settlement lands, and a club is only
      // ever minted in one that landed in the district's own region — so every
      // club of the ladder is in the county and region it was founded for.
      const town = options.towns.find((entry) => entry.id === club.townId)!;
      expect(town.regionId).toBe('region_aldermarket');
      expect(town.countyId).toBe(FOUNDING_COUNTY_ID);
      expect(district.towns.map((entry) => entry.id)).toContain(town.id);
    }
  });

  it('draws exactly the same district when it is only labelled, not renamed', () => {
    // Naming a ladder or a region is not a draw: a caller that gives the district
    // its display names, and nothing else, is handed the district it would have
    // been handed anyway — same valley, same map position, same settlements, same
    // clubs — with two strings of its own on it.
    const plain = intoTheCounty('labelled-not-renamed');
    const labelled = intoTheCounty('labelled-not-renamed');
    const asDrawn = foundDistrictPyramid(plain.options);
    const asLabelled = foundDistrictPyramid({
      ...labelled.options,
      name: 'Aldermarket Sunday League',
      regionName: 'Aldermarket',
    });

    expect(asLabelled.id).toBe(asDrawn.id);
    expect(asLabelled.region.id).toBe(asDrawn.region.id);
    expect(asLabelled.region.centre).toEqual(asDrawn.region.centre);
    expect(asLabelled.towns).toEqual(asDrawn.towns);
    expect(asLabelled.divisions).toEqual(asDrawn.divisions);
    expect(asLabelled.config).toEqual(asDrawn.config);
    expect(asLabelled.level).toBe(asDrawn.level);

    // The two strings are the caller's, and the valley's name is not lost: the
    // region is what the caller called it and the ladder is what the caller
    // called it, while the id stays the valley's.
    expect(asLabelled.name).toBe('Aldermarket Sunday League');
    expect(asLabelled.region.name).toBe('Aldermarket');
    expect(asDrawn.name).toBe(`${asDrawn.region.name} Sunday League`);
  });

  it('draws the same district twice for one identity', () => {
    // A supplied id is the district's own seed for the places it is drawn from —
    // the settlements and businesses of a district are drawn from streams keyed by
    // its id, exactly as a valley-drawn one is keyed by its valley — so the same
    // id draws the same district twice, and the name beside it changes nothing.
    const one = intoTheCounty('same-identity');
    const other = intoTheCounty('same-identity');
    const a = foundDistrictPyramid({ ...one.options, id: 'aldermarket', name: 'First Name', regionName: 'Aldermarket' });
    const b = foundDistrictPyramid({ ...other.options, id: 'aldermarket', name: 'Another Name', regionName: 'Aldermarket' });

    expect(b.towns.map((town) => `${town.id} ${town.name} ${town.x},${town.y}`)).toEqual(
      a.towns.map((town) => `${town.id} ${town.name} ${town.x},${town.y}`),
    );
    expect(b.divisions).toEqual(a.divisions);
    expect(b.region.centre).toEqual(a.region.centre);
    expect(b.name).toBe('Another Name');
    expect(a.name).toBe('First Name');
    for (const clubId of b.divisions.flat()) expect(clubId.startsWith('club_aldermarket_')).toBe(true);
    expect(Object.keys(other.options.businesses).length).toBeGreaterThan(0);
  });

  it('does not let the founding region’s label decide the district’s identity', () => {
    const one = intoTheCounty('renamed-region');
    const other = intoTheCounty('renamed-region');
    const renamed = (options: FoundDistrictOptions) => ({
      ...options,
      regions: options.regions.map((region) => ({ ...region, name: 'Somewhere Else Valley' })),
      takenValleyNames: ['Wyre'],
    });

    const a = foundDistrictPyramid({
      ...renamed(one.options),
      id: 'aldermarket',
      name: 'Aldermarket Sunday League',
      regionId: 'region_aldermarket',
      regionName: 'Aldermarket',
    });
    const b = foundDistrictPyramid({
      ...renamed(other.options),
      id: 'aldermarket',
      name: 'Aldermarket Sunday League',
      regionId: 'region_aldermarket',
      regionName: 'Aldermarket',
    });

    // The county's name is a label; the district's identity is what it was told.
    expect(a.id).toBe('aldermarket');
    expect(a.name).toBe('Aldermarket Sunday League');
    expect(a.region.name).toBe('Aldermarket');
    expect(b.id).toBe(a.id);
    expect(b.region.centre).toEqual(a.region.centre);
    expect(a.divisions.flat().every((clubId) => clubId.startsWith('club_aldermarket_'))).toBe(true);

    // Left to itself the district is still named after the valley it draws, and
    // the valley it cannot take is the one the caller named as taken.
    const alone = intoTheCounty('renamed-region');
    const asDrawn = foundDistrictPyramid(renamed(alone.options));
    expect(asDrawn.region.name).not.toBe('Wyre Valley');
    expect(asDrawn.id).toBe(asDrawn.region.name.split(' ')[0]!.toLowerCase());
  });

  it('refuses a ladder id the world already has, and mints nothing', () => {
    const { options } = intoTheCounty('ladder-collision');
    const towns = options.towns.length;
    const clubs = Object.keys(options.clubs);
    const people = Object.keys(options.people).length;
    const regions = options.regions.length;

    expect(() => foundDistrictPyramid({ ...options, id: FOUNDING_PYRAMID_ID, pyramidIds: [FOUNDING_PYRAMID_ID] })).toThrow(
      'already has a ladder',
    );
    expect(() =>
      foundDistrictPyramid({ ...options, id: 'aldermarket', pyramidIds: [FOUNDING_PYRAMID_ID, 'aldermarket'] }),
    ).toThrow('already has a ladder');

    // Nothing was founded: no settlement, club, ground or person was minted on
    // the way to being refused.
    expect(options.towns).toHaveLength(towns);
    expect(Object.keys(options.clubs)).toEqual(clubs);
    expect(Object.keys(options.people)).toHaveLength(people);
    expect(options.regions).toHaveLength(regions);
  });

  it('refuses a region id the world already has, and mints nothing', () => {
    const two = generateDraft({ seed: 'region-collision', pyramids: 2 });
    const options: FoundDistrictOptions = {
      seed: 'region-collision::district',
      currentYear: two.startYear,
      seasonStart: two.seasonStart,
      towns: Object.values(two.world.towns),
      businesses: Object.values(two.world.businesses),
      grounds: two.world.grounds,
      clubs: two.clubs,
      people: two.people,
      regions: Object.values(two.world.regions),
    };
    const towns = options.towns.length;
    const clubs = Object.keys(options.clubs).length;

    // The default is the district next door, and this world already has one.
    expect(() => foundDistrictPyramid(options)).toThrow('already has a region');
    expect(() => foundDistrictPyramid({ ...options, regionId: FOUNDING_REGION_ID })).toThrow(
      'already has a region',
    );

    expect(options.towns).toHaveLength(towns);
    expect(Object.keys(options.clubs)).toHaveLength(clubs);
  });
});

describe('player generation', () => {
  it('keeps every attribute on the 1-20 scale', () => {
    const rng = new Rng('attributes');
    for (let i = 0; i < 200; i++) {
      const player = generatePlayer({
        rng,
        id: `p${i}`,
        clubId: 'club',
        townId: 'town',
        homeGroundId: 'ground',
        quality: 10,
        seasonStart: '2026-09-06',
      });
      for (const group of Object.values(player.attributes)) {
        for (const value of Object.values(group as unknown as Record<string, number>)) {
          expect(value).toBeGreaterThanOrEqual(1);
          expect(value).toBeLessThanOrEqual(20);
          expect(Number.isInteger(value)).toBe(true);
        }
      }
      expect(player.age).toBeGreaterThanOrEqual(17);
      expect(player.age).toBeLessThanOrEqual(42);
      expect(ALL_POSITION_CODES).toContain(player.preferredPosition);
      expect(player.availability.status).toBe('available');
    }
  });

  it('makes goalkeepers good in goal and outfielders not', () => {
    const rng = new Rng('keepers');
    const keepers = Array.from({ length: 30 }, (_, i) =>
      generatePlayer({
        rng,
        id: `gk${i}`,
        clubId: 'club',
        townId: 'town',
        homeGroundId: 'ground',
        quality: 10,
        seasonStart: '2026-09-06',
        positionGroup: 'GK',
      }),
    );
    const outfield = Array.from({ length: 30 }, (_, i) =>
      generatePlayer({
        rng,
        id: `of${i}`,
        clubId: 'club',
        townId: 'town',
        homeGroundId: 'ground',
        quality: 10,
        seasonStart: '2026-09-06',
        positionGroup: 'MID',
      }),
    );
    const meanKeeping = (players: typeof keepers) =>
      players.reduce((sum, player) => sum + player.attributes.technical.goalkeeping, 0) / players.length;
    expect(meanKeeping(keepers)).toBeGreaterThan(meanKeeping(outfield) + 6);
  });

  it('produces meaningful differences between players rather than clones', () => {
    const rng = new Rng('variety');
    const players = Array.from({ length: 60 }, (_, i) =>
      generatePlayer({
        rng,
        id: `v${i}`,
        clubId: 'club',
        townId: 'town',
        homeGroundId: 'ground',
        quality: 10,
        seasonStart: '2026-09-06',
        positionGroup: 'MID',
      }),
    );
    const running = players.map((player) => player.attributes.physical.stamina);
    const passing = players.map((player) => player.attributes.technical.passing);
    expect(new Set(running).size).toBeGreaterThan(8);
    expect(new Set(passing).size).toBeGreaterThan(8);
    // Plenty of players are good at one thing and poor at another.
    const specialists = players.filter(
      (player) => Math.abs(player.attributes.technical.passing - player.attributes.physical.pace) >= 5,
    );
    expect(specialists.length).toBeGreaterThan(10);
  });
});
