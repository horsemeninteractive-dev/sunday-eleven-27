import { describe, expect, it } from 'vitest';
import { FOUNDING_PYRAMID_ID, cupFieldOf } from '@/domain/competition';
import { ALDERFORDSHIRE_DISTRICTS } from '@/domain/districts';
import { FOUNDING_COUNTY_NAME, SECOND_REGION_ID } from '@/domain/world';
import type { WorldDraft } from '@/simulation/gameSetup';
import { draftLadders, generateDraft, startGameFromDraft } from '@/simulation/gameSetup';
import {
  COUNTY_CUP_ID,
  COUNTY_CUP_NAME,
  LEAGUE_CUP_NAME,
  PLATE_NAME,
  leagueCompetitions,
} from '@/simulation/pyramid';
import { fieldClubs } from '@/simulation/seasonStructure';
import { createTestGame } from '@/simulation/testSupport';
import {
  cupGroups,
  cupOptions,
  defaultPyramidId,
  divisionShortName,
  draftLadderOptions,
  ladderChoices,
  levelLabel,
  ownPyramidId,
  pyramidOptions,
  townChoicesFor,
} from './worldNav';

/**
 * The world, as the screens have to show it.
 *
 * Career creation offers the clubs of the county, and the league, cup and world
 * screens let a manager read any of its ladders, so four screens ask the same
 * four questions: which ladders are there, which one is his, which divisions make
 * up this one, and whose cup is this. They are answered once, here, so this is
 * where the answers are held: the founding ladder first, the manager's own
 * marked, two ladders' divisions never confused for one another, and a county cup
 * whose field is both ladders where a ladder's cup is its own.
 *
 * Everything is exercised on a world the game actually generates — the two-ladder
 * career a manager starts today, and the one-ladder county every save written
 * before the district existed holds — because the point of the model is to read
 * those two correctly and not to be tidy about a fixture.
 */

/** A career taken over in the district next door's top division. */
function districtCareer(seed: string) {
  const draft = generateDraft({ seed, startYear: 2026 });
  const district = draftLadders(draft)[1]!;
  const clubId = district.divisions[0]![0]!;
  const state = startGameFromDraft(draft, {
    seed: draft.seed,
    startYear: draft.startYear,
    clubId,
    saveName: 'District save',
  });
  return { state, draft, district, clubId };
}

describe('the ladders a manager can browse', () => {
  it('lists both of them, the county\u2019s own first, and marks his', () => {
    const { state } = createTestGame('nav-ladders');
    const ladders = pyramidOptions(state);
    expect(ladders).toHaveLength(2);

    const [county, district] = ladders;
    expect(county!.id).toBe(FOUNDING_PYRAMID_ID);
    expect(county!.mine).toBe(true);
    expect(county!.level).toBe(1);
    expect(county!.region).toBe(state.world.regionName);
    expect(district!.mine).toBe(false);
    expect(district!.level).toBe(2);
    expect(district!.region).toBe(state.world.regions[SECOND_REGION_ID]!.name);
    expect(district!.name).not.toBe(county!.name);

    // Three divisions of twelve each, in tier order, and every club in the world
    // is in exactly one of the two ladders.
    for (const ladder of ladders) {
      expect(ladder.divisions.map((division) => division.tier)).toEqual([1, 2, 3]);
      expect(ladder.clubCount).toBe(36);
    }
    const everyone = ladders.flatMap((ladder) => ladder.divisions.flatMap((division) => division.clubIds));
    expect(new Set(everyone).size).toBe(72);
  });

  it('is a picker of two, and the two tabs do not read the same', () => {
    const { state } = createTestGame('nav-labels');
    const ladders = pyramidOptions(state);
    const choices = ladderChoices(ladders, ownPyramidId(state));
    expect(choices).toHaveLength(2);
    // Two ladders named after their own regions: the old tabstrip stripped
    // "Sunday League" off both and left a manager with two tabs reading alike.
    expect(new Set(choices.map((choice) => choice.label)).size).toBe(2);
    expect(choices[0]!.label).toBe(ladders[0]!.region);
    expect(choices[0]!.mine).toBe(true);
    expect(choices[1]!.mine).toBe(false);
    expect(choices[0]!.hint).toContain(ladders[0]!.name);
    expect(choices[0]!.hint).toContain('The county’s own');
    expect(choices[1]!.hint).toContain('One level below');
  });

  it('opens on the manager\u2019s own ladder, wherever he is managing', () => {
    const county = createTestGame('nav-default-county');
    expect(defaultPyramidId(county.state)).toBe(FOUNDING_PYRAMID_ID);
    expect(ownPyramidId(county.state)).toBe(FOUNDING_PYRAMID_ID);

    const district = districtCareer('nav-default-district');
    expect(ownPyramidId(district.state)).toBe(district.district.id);
    expect(defaultPyramidId(district.state)).toBe(district.district.id);
    expect(pyramidOptions(district.state).find((ladder) => ladder.id === district.district.id)!.mine).toBe(true);
    expect(pyramidOptions(district.state)[0]!.mine).toBe(false);
  });

  it('has exactly one ladder in a career written before the district existed', () => {
    const { state } = createTestGame('nav-one-ladder', 0, 2026, 1);
    const ladders = pyramidOptions(state);
    expect(ladders).toHaveLength(1);
    expect(ladders[0]!.id).toBe(FOUNDING_PYRAMID_ID);
    expect(ladders[0]!.mine).toBe(true);
    expect(ladders[0]!.divisions).toHaveLength(3);
    // And a picker with one ladder draws nothing at all: there is no second
    // answer for a tab to give.
    expect(ladderChoices(ladders, ownPyramidId(state))).toHaveLength(1);
  });

  it('reads a world whose ladder records have gone missing as the one ladder it can still see', () => {
    // The defensive path, and it has to be deterministic rather than clever: a
    // state with no ladder records at all — a save written long before them —
    // yields the founding ladder and the divisions the world actually holds.
    const { state } = createTestGame('nav-no-records');
    const stripped = { ...state, pyramidIds: [], pyramids: {} };
    const ladders = pyramidOptions(stripped);
    expect(ladders).toHaveLength(1);
    expect(ladders[0]!.id).toBe(FOUNDING_PYRAMID_ID);
    expect(ladders[0]!.divisions).toHaveLength(leagueCompetitions(stripped).length);
  });

  it('reads the world without writing to it', () => {
    // Browsing is a screen's own state: no ladder, division or cup a manager looks
    // at may change his club, his membership or the world behind him.
    const { state } = createTestGame('nav-read-only');
    const before = JSON.stringify(state);
    pyramidOptions(state);
    cupOptions(state);
    ladderChoices(pyramidOptions(state), ownPyramidId(state));
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('the divisions of one ladder', () => {
  it('are that ladder\u2019s own clubs, and its own names', () => {
    const { state } = createTestGame('nav-divisions');
    const [county, district] = pyramidOptions(state);
    const countyOne = county!.divisions[0]!;
    const districtOne = district!.divisions[0]!;

    expect(countyOne.id).not.toBe(districtOne.id);
    expect(countyOne.name).not.toBe(districtOne.name);
    expect(countyOne.name).toBe(`${county!.region} Sunday League Division One`);
    expect(districtOne.name).toBe(`${district!.region} Sunday League Division One`);
    expect(countyOne.clubIds.filter((clubId) => districtOne.clubIds.includes(clubId))).toEqual([]);

    // Two ladders both have a Division One, and the short name of each is the
    // rung within its own ladder: the tabstrip names rungs, and the header names
    // the ladder they belong to.
    expect(divisionShortName(countyOne, county!)).toBe('Division One');
    expect(divisionShortName(districtOne, district!)).toBe('Division One');
    // A competition the ladder's region does not prefix is left as it is.
    const odd = { ...countyOne, name: 'Wessex Combination' };
    expect(divisionShortName(odd, county!)).toBe('Wessex Combination');
  });
});

describe('the cups in the county', () => {
  it('are five: a cup and a plate for each ladder, and the county\u2019s own', () => {
    const { state } = createTestGame('nav-cups');
    const [county, district] = pyramidOptions(state);
    const cups = cupOptions(state);

    expect(cups).toHaveLength(5);
    // Every one of them is offered under its own full name, and no two of them
    // read alike: a cup and a plate for each ladder, and the county's cup named
    // after the county.
    expect(new Set(cups.map((cup) => cup.name)).size).toBe(5);
    expect(cups.map((cup) => cup.name)).toEqual([
      `${county!.region} ${LEAGUE_CUP_NAME}`,
      `${county!.region} ${PLATE_NAME}`,
      `${district!.region} ${LEAGUE_CUP_NAME}`,
      `${district!.region} ${PLATE_NAME}`,
      COUNTY_CUP_NAME,
    ]);
    // And each is the competition's own name rather than the screen's word for
    // it: a selector that printed 'Cup' twice would be offering one competition
    // for two.
    for (const cup of cups) expect(cup.name).toBe(cup.competition.name);
    // The county's cup wears the county's name, so it can never be mistaken for
    // another county's — which is what 'County Cup' was.
    expect(COUNTY_CUP_NAME).toBe(`${FOUNDING_COUNTY_NAME} County Cup`);
    expect(cups[4]!.name).toBe('Alderfordshire County Cup');
    expect(cups.map((cup) => cup.isPlate)).toEqual([false, true, false, true, false]);
    // Whose competition it is, said in full, and in the order a manager thinks of
    // them: his ladder's, the one next door, then the one that spans the lot.
    expect(cups.map((cup) => cup.owner)).toEqual([
      county!.name,
      county!.name,
      district!.name,
      district!.name,
      state.world.countyName,
    ]);
    // What the header says about each: who is in it, in words rather than a
    // second name for the same thing.
    expect(cups[0]!.note).toBe('Drawn from every club in this ladder');
    expect(cups[1]!.note).toContain('beaten in the');
    expect(cups[1]!.note).toContain(LEAGUE_CUP_NAME);
    expect(cups[4]!.note).toContain(state.world.countyName);
    expect(cups.map((cup) => cup.pyramid?.id ?? 'county')).toEqual([
      FOUNDING_PYRAMID_ID,
      FOUNDING_PYRAMID_ID,
      district!.id,
      district!.id,
      'county',
    ]);
  });

  it('draws each from the field the competition itself declares', () => {
    const { state } = createTestGame('nav-fields');
    const [county, district] = pyramidOptions(state);
    const cups = cupOptions(state);
    const countyClubs = county!.divisions.flatMap((division) => division.clubIds);
    const districtClubs = district!.divisions.flatMap((division) => division.clubIds);

    for (const cup of cups.slice(0, 2)) {
      expect(cup.scope).toBe('pyramid');
      expect(fieldClubs(state, cupFieldOf(cup.competition.cup))).toEqual(countyClubs);
      for (const clubId of districtClubs) expect(cup.competition.clubIds).not.toContain(clubId);
    }
    for (const cup of cups.slice(2, 4)) {
      expect(cup.scope).toBe('pyramid');
      expect(fieldClubs(state, cupFieldOf(cup.competition.cup))).toEqual(districtClubs);
      for (const clubId of countyClubs) expect(cup.competition.clubIds).not.toContain(clubId);
    }

    // The county cup is the one competition that spans both, and it is not a
    // ladder's: it is nobody's `cupIds`, which is what `owner` says.
    const countyCup = cups[4]!;
    expect(countyCup.scope).toBe('county');
    expect(countyCup.pyramid).toBeNull();
    expect(countyCup.competition.id).toBe(COUNTY_CUP_ID);
    expect(fieldClubs(state, cupFieldOf(countyCup.competition.cup)).sort()).toEqual(
      [...countyClubs, ...districtClubs].sort(),
    );
  });

  it('marks the ones the manager\u2019s own club is in', () => {
    const { state, clubId } = districtCareer('nav-cups-mine');
    const districtRegion = state.world.regions[SECOND_REGION_ID]!.name;
    const cups = cupOptions(state);
    const mine = cups.filter((cup) => cup.mine);
    // His ladder's cup and plate, and the county's — and never the ladder next
    // door's, whatever competition he is reading.
    expect(mine.map((cup) => cup.name)).toEqual([
      `${districtRegion} ${LEAGUE_CUP_NAME}`,
      `${districtRegion} ${PLATE_NAME}`,
      COUNTY_CUP_NAME,
    ]);
    // "His" is read off the field, so a Plate that has not been filled yet is
    // still his ladder's Plate: eligibility is the competition's own statement of
    // who may enter, and it does not depend on a round having been drawn.
    for (const cup of mine) expect(fieldClubs(state, cupFieldOf(cup.competition.cup))).toContain(clubId);
    // And the ones already drawn hold him: his ladder's Cup, and the county's.
    for (const cup of mine.filter((entry) => !entry.isPlate)) {
      expect(cup.competition.clubIds).toContain(clubId);
    }
    expect(cups.filter((cup) => cup.pyramid?.id === FOUNDING_PYRAMID_ID).every((cup) => !cup.mine)).toBe(true);
  });

  it('is two cups and no county cup in a career written before the district existed', () => {
    const { state } = createTestGame('nav-cups-one-ladder', 0, 2026, 1);
    const cups = cupOptions(state);
    expect(cups.map((cup) => cup.name)).toEqual([
      `${state.world.regionName} ${LEAGUE_CUP_NAME}`,
      `${state.world.regionName} ${PLATE_NAME}`,
    ]);
    expect(cups.every((cup) => cup.scope === 'pyramid')).toBe(true);
    expect(cups.every((cup) => cup.mine)).toBe(true);
    expect(cups.some((cup) => cup.scope === 'county')).toBe(false);
    // The founding ladder's own name for its cups is a full one in its own right:
    // it is the county's League Cup, wearing the district's name, not 'Cup'.
    expect(cups[0]!.name).toBe(`${state.world.regionName} Sunday League Cup`);
  });

  it('is offered to the screens in one list per ladder, county/district together', () => {
    // What the league and cup screens are built from: the ladder is the group, so
    // one control chooses the ladder and the competition inside it at once.
    const { state, clubId } = districtCareer('nav-cup-groups');
    const ladders = pyramidOptions(state);
    const groups = cupGroups(state);

    // Six ladders, each with its own pair of cups, and the county's own cup last —
    // thirteen competitions, in the order a manager reads them.
    expect(ladders).toHaveLength(ALDERFORDSHIRE_DISTRICTS.length);
    expect(groups.map((group) => group.label)).toEqual([
      ...ladders.map((ladder) => ladder.name),
      state.world.countyName,
    ]);
    expect(groups.map((group) => group.cups.length)).toEqual([...ladders.map(() => 2), 1]);
    // The manager's own ladder is marked, and so is the county's cup — his club is
    // in its field — while every other ladder's group is not: a district he is not
    // in is a district he reads rather than plays in.
    expect(groups.map((group) => group.mine)).toEqual([...ladders.map((ladder) => ladder.mine), true]);
    expect(groups.at(-1)!.pyramid).toBeNull();
    // Every cup in the county appears exactly once, and nothing is invented.
    expect(groups.flatMap((group) => group.cups.map((cup) => cup.name)).sort()).toEqual(
      cupOptions(state).map((cup) => cup.name).sort(),
    );
    for (const group of groups) {
      for (const cup of group.cups) {
        expect(cup.mine).toBe(fieldClubs(state, cupFieldOf(cup.competition.cup)).includes(clubId));
      }
    }
  });
});

describe('the ladders a career is chosen from', () => {
  it('offers the county and its five districts, each with its own divisions and clubs', () => {
    const draft = generateDraft({ seed: 'nav-draft', startYear: 2026 });
    const ladders = draftLadderOptions(draft);
    expect(ladders).toHaveLength(ALDERFORDSHIRE_DISTRICTS.length);

    const [county, district] = ladders;
    expect(county!.id).toBe(FOUNDING_PYRAMID_ID);
    expect(district!.id).not.toBe(FOUNDING_PYRAMID_ID);
    // Six regions, not one county name six times: the whole of the reason a
    // district's divisions cannot be read off the founding county's.
    expect(new Set(ladders.map((ladder) => ladder.region)).size).toBe(ladders.length);
    expect(county!.region).not.toBe(district!.region);
    for (const ladder of ladders) expect(ladder.clubCount).toBe(36);

    for (const ladder of ladders) {
      expect(ladder.divisions.map((division) => division.tier)).toEqual([1, 2, 3]);
      for (const division of ladder.divisions) {
        expect(division.clubIds).toHaveLength(12);
        expect(division.name).toBe(`${ladder.region} Sunday League ${division.shortName}`);
      }
    }

    // Every club in the world is reachable from these six lists, none of them
    // twice, and no club is in two: a screen built on them can offer all 216 and
    // cannot offer one of them twice.
    const everyone = ladders.flatMap((ladder) => ladder.divisions.flatMap((division) => division.clubIds));
    expect(new Set(everyone).size).toBe(216);
    const seen = new Set<string>();
    for (const ladder of ladders) {
      const clubs = ladder.divisions.flatMap((division) => division.clubIds);
      for (const clubId of clubs) {
        expect(seen.has(clubId), `${clubId} is offered by two ladders`).toBe(false);
        seen.add(clubId);
      }
    }
    expect(seen.size).toBe(everyone.length);
  });

  it('names each rung the way the league table names it — words, not a bare ordinal', () => {
    const draft = generateDraft({ seed: 'nav-draft-labels', startYear: 2026 });
    for (const ladder of draftLadderOptions(draft)) {
      expect(ladder.divisions.map((division) => division.shortName)).toEqual([
        'Division One',
        'Division Two',
        'Division Three',
      ]);
    }
  });

  it('reads a draft written before ladders existed as the one ladder it was', () => {
    const draft = generateDraft({ seed: 'nav-draft-legacy', startYear: 2026 });
    const legacy = { ...draft, pyramids: undefined } as unknown as WorldDraft;
    const ladders = draftLadderOptions(legacy);
    expect(ladders).toHaveLength(1);
    expect(ladders[0]!.id).toBe(FOUNDING_PYRAMID_ID);
    // The founding county's flat division list, offered exactly as it is — a
    // career choosing from it sees the thirty-six clubs it always did.
    expect(ladders[0]!.divisions.map((division) => division.clubIds)).toEqual(draft.divisions);
    expect(ladders[0]!.clubCount).toBe(draft.divisions.flat().length);
    expect(ladders[0]!.divisions.map((division) => division.shortName)).toEqual([
      'Division One',
      'Division Two',
      'Division Three',
    ]);
  });
});

describe('the towns a club can be built in', () => {
  it('are the region\u2019s own, and the two regions do not overlap', () => {
    const draft = generateDraft({ seed: 'nav-towns', startYear: 2026 });
    const [county, district] = draftLadders(draft);
    const countyTowns = townChoicesFor(draft, county!.id);
    const districtTowns = townChoicesFor(draft, district!.id);

    expect(countyTowns.length).toBeGreaterThan(0);
    expect(districtTowns.length).toBeGreaterThan(0);
    expect(countyTowns.every((town) => town.region === draft.world.regions[county!.regionId]!.name)).toBe(true);
    expect(districtTowns.every((town) => town.region === draft.world.regions[district!.regionId]!.name)).toBe(true);
    expect(countyTowns.filter((town) => districtTowns.some((other) => other.id === town.id))).toEqual([]);
    // Biggest first, and each town's own region named on it.
    expect(countyTowns.map((town) => town.population)).toEqual(
      [...countyTowns.map((town) => town.population)].sort((a, b) => b - a),
    );
  });

  it('are every town the world has when the ladder\u2019s region has none', () => {
    // A world whose towns carry no region of their own — one written before
    // regions existed — offers what it has rather than refusing every town.
    const draft = generateDraft({ seed: 'nav-towns-nameless', startYear: 2026 });
    const ladders = draftLadders(draft);
    const orphan = { ...ladders[0]!, regionId: 'region_nowhere' } as (typeof ladders)[number];
    const odd = { ...draft, pyramids: [orphan] } as unknown as WorldDraft;
    expect(townChoicesFor(odd, orphan.id)).toHaveLength(draft.world.townIds.length);
  });
});

describe('a level of football', () => {
  it('is the county\u2019s own at the top and a level below under it', () => {
    expect(levelLabel(1)).toBe('The county’s own');
    expect(levelLabel(2)).toBe('One level below');
    expect(levelLabel(3)).toBe('Two levels below');
  });
});
