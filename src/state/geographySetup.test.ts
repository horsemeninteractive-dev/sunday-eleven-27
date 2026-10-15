import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { useGameStore } from './gameStore';
import * as idb from './indexedDb';
import { saveGame, serialiseGame, deserialiseGame } from './persistence';
import { generateDraft, startGameFromDraft, type ClubDesign } from '@/simulation/gameSetup';
import { GAME_STATE_VERSION } from '@/domain/game';
import { cupFieldOf, DEFAULT_PYRAMID } from '@/domain/competition';
import { ALDERFORDSHIRE_DISTRICTS } from '@/domain/districts';
import { COUNTY_CUP_ID, cupCompetitionId, divisionOf, divisionsOf, pyramidIdOf } from '@/simulation/pyramid';
import { districtGeography } from '@/geography/alderland';
import { containsPoint, fitPoints } from '@/geography/geometry';

const store = () => useGameStore.getState();
const profile = { firstName:'Atlas', surname:'Manager', nickname:'AM', birthday:'1988-03-12', occupation:'Builder', hometown:'Home' };
beforeEach(async () => {
  idb.resetForTests();
  vi.stubGlobal('indexedDB', new IDBFactory());
  const storage = new Map<string,string>();
  vi.stubGlobal('localStorage', {getItem:(key:string)=>storage.get(key)??null, setItem:(key:string,value:string)=>storage.set(key,value), removeItem:(key:string)=>storage.delete(key)});
  await store().quitToMenu();
  store().cancelSetup();
});
afterEach(async () => { await store().quitToMenu(); store().cancelSetup(); idb.resetForTests(); vi.unstubAllGlobals(); });
function open(mode: 'career'|'create-club' = 'career') {
  store().beginSetup(mode);
  store().setManagerProfile(profile);
  store().openGeography('atlas-onboarding');
}
function design(pyramidId:string, townId:string): ClubDesign {
  return {name:'Atlas United',shortName:'Atlas',nickname:'The Maps',motto:'Our local game',foundedYear:2010,primary:'#224422',secondary:'#ffffff',structure:'committee',backing:'modest',squadStandard:'mid-table',squadSize:16,townId,groundName:'Atlas Rec',capacity:100,surface:'grass',pyramidId};
}

describe('new-career geographic confirmation', () => {
  it('holds the profile and seed without generating a draft until explicit confirmation', () => {
    open();
    expect(store().view).toBe('select-geography');
    expect(store().draft).toBeNull();
    expect(store().setup?.profile).toEqual(profile);
    for (const [county,district] of [['atlas_c02','atlas_c02_d1'],['county_1','county_1_d3'],['county_1','Alderford'],['foreign','region_1']]) {
      expect(store().confirmGeography(county!,district!)).toBe(false);
      expect(store().draft).toBeNull();
      expect(store().game).toBeNull();
    }
  });
  it.each(ALDERFORDSHIRE_DISTRICTS.map(district => district.regionId))('confirms %s, filters ownership and starts that pyramid with original cups', districtId => {
    open();
    expect(store().confirmGeography('county_1',districtId)).toBe(true);
    expect(store().view).toBe('select-club');
    const draft = store().draft!;
    expect(draft).toEqual(generateDraft({seed:'atlas-onboarding',startYear:2026}));
    const selection = store().setup!.geography!;
    const pyramid = draft.pyramids.find(p => p.regionId === districtId)!;
    // The district a manager picked on the map is the district his football is
    // named after: the atlas's own name for it, on the ladder, on every league
    // table, and on the district next door's cups — never a valley a seed drew.
    const districtName = districtGeography('county_1', districtId)!.name;
    expect(draft.world.regions[districtId]!.name).toBe(districtName);
    expect(pyramid.name).toBe(`${districtName} Sunday League`);
    expect(selection).toEqual({countyId:'county_1',districtId,pyramidId:pyramid.id});
    expect(store().setup?.profile).toEqual(profile);
    expect(store().confirmGeography('county_1',districtId)).toBe(false);
    expect(store().draft).toBe(draft);
    const foreignClub = draft.pyramids.find(p=>p.id!==pyramid.id)!.divisions[0]![0]!;
    store().chooseClub(foreignClub);
    expect(store().game).toBeNull();
    const clubId = pyramid.divisions[1]![0]!;
    store().chooseClub(clubId);
    const game = store().game!;
    expect(store().view).toBe('dashboard');
    expect(game.managerProfile).toMatchObject(profile);
    expect(pyramidIdOf(game,divisionOf(game,clubId)!)).toBe(pyramid.id);
    expect(game.world.countyIds).toEqual(['county_1']);
    expect(game.world.regionIds).toEqual(ALDERFORDSHIRE_DISTRICTS.map(district => district.regionId));
    expect(cupFieldOf(game.competitions[COUNTY_CUP_ID]!.cup)).toEqual({kind:'county'});
    // The county cup is the whole county: six ladders of thirty-six clubs, every
    // district the manager could have chosen included rather than only his own.
    expect(game.competitions[COUNTY_CUP_ID]!.clubIds).toHaveLength(
      ALDERFORDSHIRE_DISTRICTS.length * DEFAULT_PYRAMID.tiers * DEFAULT_PYRAMID.clubsPerTier,
    );
    for (const division of divisionsOf(game, pyramid.id)) {
      expect(division.name.startsWith(`${districtName} Sunday League Division`)).toBe(true);
    }
    // Both ladders' cups wear the district's name, whichever district the manager
    // chose — so a newcomer reads Alderford on his trophy as well as his table.
    for (const suffix of ['cup', 'plate'] as const) {
      expect(game.competitions[cupCompetitionId(pyramid.id, suffix)]!.name).toBe(
        `${districtName} Sunday League ${suffix === 'cup' ? 'Cup' : 'Plate'}`,
      );
    }
    for (const suffix of ['cup','plate'] as const) expect(cupFieldOf(game.competitions[cupCompetitionId(pyramid.id,suffix)]!.cup)).toEqual({kind:'pyramid',pyramidId:pyramid.id});
    expect(game.version).toBe(GAME_STATE_VERSION);
    expect('geography' in game).toBe(false);
  });
  it.each(['region_1','region_2'])('opens %s as a district map of that district’s own towns', districtId => {
    open();
    // The step is a map until a district is opened: browsing is not a reason to
    // build a country, and a district whose football is not playable is not one.
    expect(store().draft).toBeNull();
    expect(store().previewDistrict('county_1','county_1_d3')).toBe(false);
    expect(store().previewDistrict('atlas_c02','atlas_c02_d1')).toBe(false);
    expect(store().draft).toBeNull();

    expect(store().previewDistrict('county_1', districtId)).toBe(true);
    const draft = store().draft!;
    expect(draft.seed).toBe('atlas-onboarding');
    // One seed, one country: opening the district next door is the same world,
    // which is what lets the club list be the list he was reading the towns from.
    const other = districtId === 'region_1' ? 'region_2' : 'region_1';
    expect(store().previewDistrict('county_1', other)).toBe(true);
    expect(store().draft).toBe(draft);

    // The towns the district's page draws are the towns this district holds, and
    // every one of them is drawn on its own ground.
    const district = districtGeography('county_1', districtId)!;
    const towns = Object.values(draft.world.towns).filter(town => town.regionId === districtId);
    expect(towns.length).toBeGreaterThan(3);
    const marks = fitPoints(district.polygon, towns, { interior: district.label });
    expect(marks).toHaveLength(towns.length);
    for (const mark of marks) expect(containsPoint(district.polygon, mark, false)).toBe(true);
    // And the neighbouring district's towns are not drawn on this district's page.
    const neighbourTowns = Object.values(draft.world.towns).filter(town => town.regionId === other);
    expect(neighbourTowns.length).toBeGreaterThan(3);
    for (const town of neighbourTowns) expect(towns.includes(town)).toBe(false);

    // Confirming reuses that world rather than building a second one.
    expect(store().confirmGeography('county_1', districtId)).toBe(true);
    expect(store().view).toBe('select-club');
    expect(store().draft).toBe(draft);
  });

  it.each(['region_1','region_2'])('builds a club only in the selected %s region', districtId => {
    open('create-club');
    expect(store().confirmGeography('county_1',districtId)).toBe(true);
    expect(store().view).toBe('create-club');
    const draft = store().draft!;
    const pyramid = draft.pyramids.find(p=>p.regionId===districtId)!;
    const other = draft.pyramids.find(p=>p.id!==pyramid.id)!;
    const town = draft.world.townIds.find(id=>draft.world.towns[id]!.regionId===districtId)!;
    const wrongTown = draft.world.townIds.find(id=>draft.world.towns[id]!.regionId===other.regionId)!;
    const before = JSON.stringify(draft);
    store().createCustomClub(design(other.id,wrongTown));
    store().createCustomClub(design(pyramid.id,wrongTown));
    expect(store().game).toBeNull();
    expect(JSON.stringify(draft)).toBe(before);
    store().createCustomClub(design(pyramid.id,town));
    const game = store().game!;
    expect(game.clubs[game.userClubId]!.identity.name).toBe('Atlas United');
    expect(game.world.towns[game.clubs[game.userClubId]!.townId]!.regionId).toBe(districtId);
    expect(pyramidIdOf(game,divisionOf(game,game.userClubId)!)).toBe(pyramid.id);
    expect(game.managerProfile).toMatchObject(profile);
  });
  it('returns to the national selection without stale context or losing the profile', () => {
    open();
    store().confirmGeography('county_1','region_2');
    store().abandonDraft();
    expect(store().view).toBe('select-geography');
    expect(store().draft).toBeNull();
    expect(store().setup?.geography).toBeUndefined();
    expect(store().setup?.profile).toEqual(profile);
    expect(store().setup?.seed).toBe('atlas-onboarding');
  });
});

describe('the clubs a district offers are the places its own map draws', () => {
  /**
   * The map a manager reads before a career and the town he then plays in are one
   * fact about the seed: the district page is drawn from the very draft the career
   * is built from, so a club can never be registered in a place the map did not
   * draw — which would be a map that lies about where the game is played.
   */
  it('registers every club of a ladder in a town that district’s map draws', () => {
    for (const seed of ['club-towns-a', 'club-towns-b', 'club-towns-c']) {
      const draft = generateDraft({ seed });
      for (const districtId of ['region_1', 'region_2']) {
        const district = districtGeography('county_1', districtId)!;
        const drawn = new Set(
          draft.world.townIds
            .map((id) => draft.world.towns[id]!)
            .filter((town) => town.regionId === districtId)
            .map((town) => town.name),
        );
        const ladder = draft.pyramids.find((pyramid) => pyramid.regionId === districtId)!;
        const clubs = ladder.divisions.flat().map((id) => draft.clubs[id]!);
        expect(clubs.length).toBeGreaterThan(0);
        for (const club of clubs) {
          const town = draft.world.towns[club.townId]!;
          expect(drawn.has(town.name), `${district.name}: ${club.identity.name} is in ${town.name}`).toBe(true);
          expect(town.regionId).toBe(districtId);
        }
      }
    }
  });
});

describe('existing careers are not atlas snapshots', () => {
  it('loads an existing saved county directly into the dashboard without replacing its geography', async () => {
    const draft = generateDraft({seed:'atlas-existing',pyramids:1});
    const game = startGameFromDraft(draft,{seed:draft.seed,clubId:draft.divisionClubIds[0]!,saveName:'Existing career',manager:profile});
    game.world.counties.county_1!.name = 'My saved county';
    game.world.towns[game.world.townIds[0]!]!.x = 17.25;
    const world = structuredClone(game.world);
    const result = await saveGame(game,'atlas-existing');
    expect(result.info).toBeTruthy();
    const roundTrip = deserialiseGame(serialiseGame(game))!;
    expect(roundTrip.error).toBeNull();
    expect(roundTrip.state!.world).toEqual(world);
    open();
    await store().loadGame('atlas-existing');
    expect(store().view).toBe('dashboard');
    expect(store().game!.world).toEqual(world);
    expect(store().game!.managerProfile).toEqual(game.managerProfile);
    expect(store().game!.pyramidIds).toEqual(['league']);
    expect(store().confirmGeography('county_1','region_1')).toBe(false);
  });
});
