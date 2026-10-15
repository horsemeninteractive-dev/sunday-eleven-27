import { describe, expect, it } from 'vitest';
import { FOUNDING_PYRAMID_ID, cupFieldOf } from '@/domain/competition';
import { ALDERFORDSHIRE_DISTRICTS } from '@/domain/districts';
import { FOUNDING_COUNTY_ID, FOUNDING_COUNTY_NAME, SECOND_REGION_ID } from '@/domain/world';
import type { WorldDraft } from './gameSetup';
import {
  applyCustomClub,
  bottomDivisionClubIds,
  displacedClubId,
  draftLadders,
  generateDraft,
  startGameFromDraft,
  type ClubDesign,
} from './gameSetup';
import { countyCupRequests, fieldClubs } from './seasonStructure';
import {
  COUNTY_CUP_ID,
  COUNTY_CUP_NAME,
  countyIdOfPyramid,
  cupCompetitionId,
  cupCompetitions,
  divisionOf,
  divisionsOf,
  LEAGUE_CUP_ID,
  pyramidForCompetition,
  pyramidIdOf,
  readFixtureList,
  standingsFor,
  userCompetition,
} from './pyramid';

/**
 * A career that begins in the district next door.
 *
 * The world is founded with the county's six ladders, and a manager may take over
 * a club in any of them — but until the career-creation screens read the draft's
 * ladders, the thirty-six clubs of each district were offered to nobody. What
 * this suite holds is the half of that which is not a screen: that a district's
 * ladder is a *real* ladder — complete clubs, its own divisions and cups, its own
 * region — and that a career started in one is initialised against that ladder's
 * own records rather than the founding county's.
 *
 * The screens themselves are held in `ui/worldNav.test.ts`; what is proved here
 * is the world they are reading.
 */

const DISTRICT_SEED = 'career-setup-district';

function draftWithDistrict(seed = DISTRICT_SEED): WorldDraft {
  return generateDraft({ seed, startYear: 2026 });
}

/** The design every "build a club" case starts from, with its own town. */
function designFor(draft: WorldDraft, overrides: Partial<ClubDesign> = {}): ClubDesign {
  return {
    name: 'The Latecomers',
    shortName: 'Late',
    nickname: 'Latecomers',
    motto: 'Better late than never.',
    foundedYear: 2010,
    primary: '#1f6feb',
    secondary: '#ffffff',
    structure: 'committee',
    backing: 'modest',
    squadStandard: 'mid-table',
    squadSize: 16,
    townId: draft.world.townIds[0]!,
    groundName: 'The Rec',
    capacity: 400,
    surface: 'grass',
    ...overrides,
  };
}

describe('the county a career is generated in', () => {
  it('is six ladders, and each of the five beside the county is a ladder rather than a list of clubs', () => {
    const draft = draftWithDistrict();
    const ladders = draftLadders(draft);
    expect(ladders).toHaveLength(ALDERFORDSHIRE_DISTRICTS.length);

    const [county, district] = ladders;
    expect(county!.id).toBe(FOUNDING_PYRAMID_ID);
    expect(district!.id).not.toBe(FOUNDING_PYRAMID_ID);
    expect(district!.regionId).toBe(SECOND_REGION_ID);
    expect(district!.level).toBe(2);
    expect(district!.name).not.toBe(county!.name);

    // Three divisions of twelve, like the county's own: a district is the same
    // sort of place with the same sort of football in it — and there are six of
    // them, in the map's own order, each standing in a region of its own.
    for (const [index, ladder] of ladders.entries()) {
      expect(ladder.regionId, ladder.id).toBe(ALDERFORDSHIRE_DISTRICTS[index]!.regionId);
      expect(ladder.level, ladder.id).toBe(ALDERFORDSHIRE_DISTRICTS[index]!.level);
      expect(ladder.divisions).toHaveLength(3);
      expect(ladder.divisions.map((division) => division.length)).toEqual([12, 12, 12]);
    }
    expect(new Set(ladders.map((ladder) => ladder.regionId)).size).toBe(ladders.length);
    expect(new Set(ladders.map((ladder) => ladder.id)).size).toBe(ladders.length);

    // No club is in two ladders, and every new club is a club: a town of its own
    // district's region, a ground, a squad and a committee.
    const everyone = draftLadders(draft).flatMap((ladder) => ladder.divisions.flat());
    expect(new Set(everyone).size).toBe(everyone.length);
    for (const ladder of ladders.slice(1)) {
      for (const clubId of ladder.divisions.flat()) {
        const club = draft.clubs[clubId]!;
        expect(club, `${clubId} is in the district and not in the world`).toBeTruthy();
        expect(draft.world.towns[club.townId]!.regionId, clubId).toBe(ladder.regionId);
        expect(draft.world.grounds[club.groundId]).toBeTruthy();
        expect(club.squadIds.length).toBeGreaterThan(10);
        expect(club.chairmanId).toBeTruthy();
        expect(club.managerId).toBeTruthy();
      }
    }
    // And the founding county's clubs were not re-homed to make room for them.
    for (const clubId of county!.divisions.flat()) {
      expect(draft.clubs[clubId]!.townId).toBeTruthy();
      expect(draft.world.towns[draft.clubs[clubId]!.townId]!.regionId).toBe(draft.world.regionIds[0]);
    }
  });

  it('is a county with an id, owning all six ladders and every club’s football', () => {
    const draft = draftWithDistrict();

    // The world carries one county, and it holds the regions the map was drawn
    // from — the district's as well as the county's, because a district next door
    // is a piece of the same county's football rather than a county of its own.
    expect(draft.world.countyIds).toEqual([FOUNDING_COUNTY_ID]);
    const county = draft.world.counties[FOUNDING_COUNTY_ID]!;
    expect(county.name).toBe(FOUNDING_COUNTY_NAME);
    expect(county.regionIds).toEqual(draft.world.regionIds);
    for (const region of Object.values(draft.world.regions)) expect(region.countyId).toBe(FOUNDING_COUNTY_ID);
    for (const town of Object.values(draft.world.towns)) expect(town.countyId).toBe(FOUNDING_COUNTY_ID);

    // A career founded in it resolves every one of its six ladders to that one
    // county, and the county cup is that county's own — drafted from every club
    // in it, all six ladders together, and named after it.
    const state = startGameFromDraft(draft, {
      seed: draft.seed,
      startYear: draft.startYear,
      clubId: draft.divisionClubIds[0]!,
      saveName: 'County save',
    });
    for (const pyramidId of state.pyramidIds) expect(countyIdOfPyramid(state, pyramidId)).toBe(FOUNDING_COUNTY_ID);

    const requests = countyCupRequests(state);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.id).toBe(COUNTY_CUP_ID);
    expect(requests[0]!.name).toBe(COUNTY_CUP_NAME);
    expect(requests[0]!.field).toEqual({ kind: 'county', countyId: FOUNDING_COUNTY_ID });

    // The entrants are every active club in the county — all two hundred and
    // sixteen of them, from all six ladders — which is the set this cup has
    // always entered, grown with the county rather than split with it.
    const everyActiveClub = Object.values(state.clubs)
      .filter((club) => club.active)
      .map((club) => club.id);
    expect(new Set(fieldClubs(state, { kind: 'county' }))).toEqual(new Set(everyActiveClub));
    expect(state.competitions[COUNTY_CUP_ID]!.clubIds).toHaveLength(
      ALDERFORDSHIRE_DISTRICTS.length * 36,
    );
    expect(new Set(state.competitions[COUNTY_CUP_ID]!.clubIds)).toEqual(new Set(everyActiveClub));
  });

  it('reads a world with no ladders as the one ladder it was', () => {
    // The defensive path: every draft generated today carries its ladders, and a
    // draft that does not is the county every career written before them was.
    const draft = draftWithDistrict('career-setup-legacy-draft');
    const legacy = { ...draft, pyramids: undefined } as unknown as WorldDraft;
    const ladders = draftLadders(legacy);
    expect(ladders).toHaveLength(1);
    expect(ladders[0]!.id).toBe(FOUNDING_PYRAMID_ID);
    expect(ladders[0]!.divisions).toEqual(draft.divisions);
    expect(ladders[0]!.level).toBe(1);
  });
});

describe('a career taken over in the district', () => {
  const draft = draftWithDistrict();
  const district = draftLadders(draft)[1]!;

  it('starts at that club, in that ladder, with its own league and cups', () => {
    const clubId = district.divisions[1]![0]!;
    const state = startGameFromDraft(draft, {
      seed: draft.seed,
      startYear: draft.startYear,
      clubId,
      saveName: 'District save',
    });

    expect(state.userClubId).toBe(clubId);
    // The county's six ladders, the founding one first, the one he took over in
    // among them: a career begun in a district is a career in the whole county.
    expect(state.pyramidIds).toHaveLength(ALDERFORDSHIRE_DISTRICTS.length);
    expect(state.pyramidIds[0]).toBe(FOUNDING_PYRAMID_ID);
    expect(state.pyramidIds).toContain(district.id);

    // His division is the district's, and it is the one he is a member of.
    const division = divisionOf(state, clubId)!;
    expect(division, 'the club he manages is in no league').toBeTruthy();
    expect(division.tier).toBe(2);
    expect(division.clubIds).toContain(clubId);
    expect(division.clubIds).toHaveLength(12);
    expect(pyramidIdOf(state, division)).toBe(district.id);
    expect(pyramidForCompetition(state, division)!.name).toBe(district.name);
    expect(userCompetition(state)!.id).toBe(division.id);
    expect(standingsFor(state, division)).toHaveLength(12);

    // And he has a season to play in it: fixtures, in his own competition, on a
    // calendar.
    const fixtures = readFixtureList(state, division.id)!;
    expect(Object.keys(fixtures.byMatchday).length).toBeGreaterThan(10);
    expect(state.season.calendar.length).toBeGreaterThan(20);

    // His ladder's cups are his; the county's own are not.
    const cups = cupCompetitions(state);
    const districtCup = cups.find((cup) => cup.id === cupCompetitionId(district.id, 'cup'))!;
    const districtPlate = cups.find((cup) => cup.id === cupCompetitionId(district.id, 'plate'))!;
    expect(districtCup.clubIds).toContain(clubId);
    expect(cupFieldOf(districtCup.cup)).toEqual({ kind: 'pyramid', pyramidId: district.id });
    // A Plate opens the season with nobody in it — it is filled by the League
    // Cup's first-round losers — so the ladder it belongs to is what makes it his,
    // and its field is his ladder's clubs.
    expect(districtPlate.clubIds).toEqual([]);
    expect(cupFieldOf(districtPlate.cup)).toEqual({ kind: 'pyramid', pyramidId: district.id });
    expect(fieldClubs(state, cupFieldOf(districtPlate.cup))).toEqual(district.divisions.flat());
    expect(cups.find((cup) => cup.id === LEAGUE_CUP_ID)!.clubIds).not.toContain(clubId);

    // The county cup is the one competition that takes both: it is the whole
    // county's field, and it holds clubs from each ladder.
    const countyCup = cups.find((cup) => cup.id === COUNTY_CUP_ID)!;
    expect(cupFieldOf(countyCup.cup)).toEqual({ kind: 'county' });
    const foundingClubIds = draftLadders(draft)[0]!.divisions.flat();
    for (const id of [clubId, foundingClubIds[0]!, foundingClubIds.at(-1)!]) {
      expect(countyCup.clubIds, `${id} is not in the county cup`).toContain(id);
    }
  });

  it('is the same world whatever ladder he ends up managing in', () => {
    // Two careers off one seed — one taken over in the district, one in the
    // county's own ladder — because that is the claim choosing a club has to make
    // good: the world a manager is handed is the world the seed builds, whether he
    // picked a club thirty-six deep in it or the strongest one in it. Nothing is
    // regenerated for his ladder, and nothing of the other one is re-homed.
    const countyDraft = draftWithDistrict();
    const districtState = startGameFromDraft(draftWithDistrict(), {
      seed: draft.seed,
      startYear: draft.startYear,
      clubId: district.divisions[0]![0]!,
      saveName: 'District save',
    });
    const countyState = startGameFromDraft(countyDraft, {
      seed: countyDraft.seed,
      startYear: countyDraft.startYear,
      clubId: countyDraft.divisions[0]![0]!,
      saveName: 'County save',
    });

    expect(Object.keys(districtState.clubs).sort()).toEqual(Object.keys(countyState.clubs).sort());
    for (const [id, club] of Object.entries(countyState.clubs)) {
      const same = districtState.clubs[id]!;
      expect(same.identity.name, `${id} is a different club`).toBe(club.identity.name);
      expect(same.townId, `${id} moved`).toBe(club.townId);
      expect(same.groundId).toBe(club.groundId);
      expect(same.reputation).toBe(club.reputation);
      expect(same.squadIds).toEqual(club.squadIds);
      expect(same.active).toBe(club.active);
    }
    // And membership is each ladder's own in both careers: the district career's
    // leagues hold exactly the clubs the draft drew them with.
    for (const ladder of draftLadders(countyDraft)) {
      const bySize = (a: readonly string[], b: readonly string[]) => a.length - b.length;
      expect(divisionsOf(districtState, ladder.id).map((division) => [...division.clubIds].sort()).sort(bySize)).toEqual(
        ladder.divisions.map((clubIds) => [...clubIds].sort()).sort(bySize),
      );
    }
  });
});

describe('a club the manager builds himself', () => {
  it('joins the foot of the ladder he chose, and only that ladder', () => {
    const draft = draftWithDistrict('career-setup-built');
    const district = draftLadders(draft)[1]!;
    const foundingBefore = draftLadders(draft)[0]!.divisions.map((clubIds) => [...clubIds]);
    const districtBottom = bottomDivisionClubIds(draft, district.id);
    const displaced = displacedClubId(draft, district.id);

    // The two ladders displace different clubs — the weakest of each ladder's own
    // bottom division — which is the whole of what choosing a ladder does.
    expect(displacedClubId(draft)).toBe(displacedClubId(draft, FOUNDING_PYRAMID_ID));
    expect(displacedClubId(draft)).not.toBe(displaced);
    expect(districtBottom).toContain(displaced);

    const townId = draft.world.townIds.find(
      (id) => draft.world.towns[id]!.regionId === SECOND_REGION_ID,
    )!;
    const clubId = applyCustomClub(draft, designFor(draft, { townId, pyramidId: district.id }));

    expect(clubId).toBe(displaced);
    const club = draft.clubs[clubId]!;
    expect(club.identity.name).toBe('The Latecomers');
    expect(club.townId).toBe(townId);
    expect(club.groundId).toBe(`ground_custom_${displaced}`);
    expect(draft.world.grounds[club.groundId]!.townId).toBe(townId);
    // A club built in the district keeps the district's place in the league: the
    // registration is the displaced side's, the players are his own.
    expect(districtBottom).toContain(clubId);

    // And the county's ladder was not touched at all.
    expect(draftLadders(draft)[0]!.divisions).toEqual(foundingBefore);
  });

  it('still joins the county\u2019s own ladder when no ladder is named', () => {
    // The default is not a new rule: a design that says nothing about ladders is
    // every design written before a second one existed, and it builds the club at
    // the foot of the county's ladder, exactly as it did.
    const draft = draftWithDistrict('career-setup-built-default');
    // Read before the club is built, because building it re-rates the side it
    // takes over — the place is decided by who was weakest, and asking again
    // afterwards would name whoever is weakest now.
    const expected = displacedClubId(draft, FOUNDING_PYRAMID_ID);
    const clubId = applyCustomClub(draft, designFor(draft));
    expect(clubId).toBe(expected);
    expect(bottomDivisionClubIds(draft, FOUNDING_PYRAMID_ID)).toContain(clubId);

    // And the career it starts is in the founding ladder's bottom division.
    const state = startGameFromDraft(draft, {
      seed: draft.seed,
      startYear: draft.startYear,
      clubId,
      saveName: 'County save',
    });
    const division = divisionOf(state, clubId)!;
    expect(pyramidIdOf(state, division)).toBe(FOUNDING_PYRAMID_ID);
    expect(division.tier).toBe(3);
  });
});
