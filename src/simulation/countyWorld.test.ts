import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PYRAMID, FOUNDING_PYRAMID_ID, cupFieldOf } from '@/domain/competition';
import { ALDERFORDSHIRE_DISTRICTS } from '@/domain/districts';
import { FOUNDING_COUNTY_ID, FOUNDING_COUNTY_NAME, FOUNDING_REGION_ID } from '@/domain/world';
import { districtCentreInWorld, districtGeography } from '@/geography/alderland';
import { resolveGeographySelection } from '@/geography/selection';
import { deserialiseGame, serialiseGame } from '@/state/persistence';
import { generateDraft, startGameFromDraft, type WorldDraft } from './gameSetup';
import {
  COUNTY_CUP_NAME,
  countyCupId,
  cupCompetitionId,
  cupCompetitions,
  cupNameFor,
  divisionNameFor,
  divisionsOf,
  levelOf,
  leagueCompetitions,
  pyramidClubIds,
  pyramidIdOf,
  pyramidOf,
  regionNameFor,
} from './pyramid';
import { finishSeason, startNextSeason } from './season';
import { fieldClubs } from './seasonStructure';
import { settleLeague } from './testSupport';
import { districtCount, missingDistricts } from './worldExpansion';

/**
 * Alderfordshire as one football world: six districts, six ladders, thirteen
 * competitions.
 *
 * `worldGenerator.test.ts` holds what a *district* is — a valley, its
 * settlements, its clubs — and `worldExpansion.test.ts` holds how a career gains
 * one at a season boundary. What this file holds is the county they make
 * together: that a career founded today is played in all six of them, that each
 * district's league, cup and plate are its own and nobody else's, that the
 * county cup is drawn from the whole county, and that a season of it can be
 * played to its end and rolled over with every ladder still standing.
 *
 * The world is built once and reused: a six-district career is six times the
 * world the game has always built and takes a couple of seconds, and a file that
 * rebuilt it for every assertion would take minutes to prove the same things.
 */
const SEED = 'county-world';

/** The career the county is examined through, built once for the file. */
function countyCareer() {
  const draft = generateDraft({ seed: SEED, startYear: 2026 });
  // The career is built from a copy: committing a draft to a career edits it —
  // the manager arrives, a club changes hands — and the draft left here is the
  // world as the generator wrote it, which is what the assertions below read.
  const state = startGameFromDraft(structuredClone(draft), {
    seed: draft.seed,
    startYear: draft.startYear,
    clubId: draft.divisionClubIds[0]!,
    saveName: `The whole county — ${SEED}`,
  });
  return { draft, state };
}

const career = countyCareer();

/** Every town a district's own region holds. */
function townsOf(draft: WorldDraft, regionId: string) {
  return draft.world.townIds.map((id) => draft.world.towns[id]!).filter((town) => town.regionId === regionId);
}

describe('the county, founded whole', () => {
  it('founds every one of its six districts, each with a ladder of its own', () => {
    const { draft } = career;

    // Six ladders, the founding county's first, and each of the other five
    // standing in its own district of the map.
    expect(draft.pyramids).toHaveLength(ALDERFORDSHIRE_DISTRICTS.length);
    expect(draft.pyramids[0]!.id).toBe(FOUNDING_PYRAMID_ID);
    expect(new Set(draft.pyramids.map((ladder) => ladder.id)).size).toBe(6);

    for (const [index, definition] of ALDERFORDSHIRE_DISTRICTS.entries()) {
      const ladder = draft.pyramids[index]!;
      expect(ladder.regionId, definition.name).toBe(definition.regionId);
      expect(draft.world.regions[definition.regionId]!.name).toBe(definition.name);
      expect(regionNameFor(career.state, ladder.id)).toBe(definition.name);
      // Three divisions of twelve, and thirty-six clubs in the district.
      expect(ladder.divisions).toHaveLength(DEFAULT_PYRAMID.tiers);
      for (const division of ladder.divisions) expect(division).toHaveLength(DEFAULT_PYRAMID.clubsPerTier);
      expect(ladder.divisions.flat()).toHaveLength(36);
      expect(levelOf(career.state, ladder.divisions[0]![0]!)).toBe(definition.level);
      // The founding county's own ladder is the one the map calls `league`, and
      // every district beside it is at the level of football the map gives it.
      expect(ladder.id === FOUNDING_PYRAMID_ID).toBe(index === 0);
    }

    // Two hundred and sixteen clubs, in eighteen divisions, in one county.
    expect(Object.keys(draft.clubs)).toHaveLength(216);
    expect(leagueCompetitions(career.state)).toHaveLength(18);
    expect(career.state.world.counties[FOUNDING_COUNTY_ID]!.name).toBe(FOUNDING_COUNTY_NAME);
    expect(career.state.world.counties[FOUNDING_COUNTY_ID]!.regionIds).toEqual(
      ALDERFORDSHIRE_DISTRICTS.map((district) => district.regionId),
    );
  });

  it('gives every town, club, ground and person an id nobody else has', () => {
    const { draft } = career;
    for (const ids of [
      Object.keys(draft.clubs),
      Object.keys(draft.world.towns),
      Object.keys(draft.world.grounds),
      Object.keys(draft.people),
      Object.keys(draft.world.businesses),
    ]) {
      expect(new Set(ids).size).toBe(ids.length);
    }
    // And each district's own ids are minted under its own ladder's name, so a
    // district can never collide with the county or with its neighbour.
    for (const ladder of draft.pyramids.slice(1)) {
      for (const clubId of ladder.divisions.flat()) expect(clubId.startsWith(`club_${ladder.id}_`)).toBe(true);
    }
  });

  it('keeps every town and every club in the district it was drawn for', () => {
    const { draft } = career;
    const regions = new Set(ALDERFORDSHIRE_DISTRICTS.map((district) => district.regionId));
    for (const town of Object.values(draft.world.towns)) {
      expect(regions.has(town.regionId), `${town.id} is in no district`).toBe(true);
      expect(town.countyId).toBe(FOUNDING_COUNTY_ID);
    }
    for (const [index, definition] of ALDERFORDSHIRE_DISTRICTS.entries()) {
      const ladder = draft.pyramids[index]!;
      const districtTowns = townsOf(draft, definition.regionId);
      // A district is its settlements, and every seed lays them out differently:
      // nine or twenty is the same football, and none of them is no district.
      expect(districtTowns.length, `${definition.name} has no towns`).toBeGreaterThanOrEqual(5);
      // Every club of the district stands in a town of the district, and every
      // one of those towns is the district's own region — which is what makes a
      // town-based club name a name from the place it actually plays in.
      for (const clubId of ladder.divisions.flat()) {
        const club = draft.clubs[clubId]!;
        expect(draft.world.towns[club.townId]!.regionId, `${clubId} plays outside its district`).toBe(
          definition.regionId,
        );
      }
      // And a town drawn for a district is nearer its own district's centre than
      // any district that existed when it was drawn, which is the rule that
      // decides where a settlement belongs. The founding county's own towns are
      // the exception and always have been: the county *is* the map, and its
      // settlements are drawn over the whole of it rather than into one corner of
      // it, so a county town is very often nearest a district founded later.
      if (index === 0) continue;
      const centre = draft.world.regions[definition.regionId]!.centre;
      for (const town of districtTowns) {
        const mine = Math.hypot(centre.x - town.x, centre.y - town.y);
        for (const earlier of ALDERFORDSHIRE_DISTRICTS.slice(0, index)) {
          const theirs = draft.world.regions[earlier.regionId]!.centre;
          expect(mine, `${town.name} drifted out of ${definition.name}`).toBeLessThanOrEqual(
            Math.hypot(theirs.x - town.x, theirs.y - town.y),
          );
        }
      }
    }
  });

  it('stands every district where the atlas draws it', () => {
    const { draft } = career;
    for (const definition of ALDERFORDSHIRE_DISTRICTS) {
      const geography = districtGeography(FOUNDING_COUNTY_ID, definition.regionId);
      expect(geography, `${definition.name} is not on the map`).toBeTruthy();
      expect(geography!.availability).toBe('available');
      expect(geography!.name).toBe(definition.name);
      expect(geography!.football?.regionId).toBe(definition.regionId);
      // The four districts the county has added to a world that was two stand
      // where the map puts them, so the district a manager chose is the district
      // he manages in. The founding county and the valley next door keep the
      // ground they have always had — see `alderfordshireDistricts`.
      if (definition.regionId === FOUNDING_REGION_ID || definition.regionId === 'region_2') continue;
      const onTheMap = districtCentreInWorld(FOUNDING_COUNTY_ID, definition.regionId)!;
      const centre = draft.world.regions[definition.regionId]!.centre;
      expect(centre.x, definition.name).toBeCloseTo(onTheMap.x, 6);
      expect(centre.y, definition.name).toBeCloseTo(onTheMap.y, 6);
    }
    // And every district a manager can choose resolves to the one ladder that
    // draws its clubs, by the region rather than by a name or an array position.
    for (const [index, definition] of ALDERFORDSHIRE_DISTRICTS.entries()) {
      const selection = resolveGeographySelection(draft, FOUNDING_COUNTY_ID, definition.regionId);
      expect(selection, definition.name).not.toBeNull();
      expect(selection!.pyramidId).toBe(draft.pyramids[index]!.id);
    }
  });

  it('is the two-district county with four districts beside it, and the two are unmoved', () => {
    // The county has grown by addition and never by rearrangement. A career
    // founded with the whole county starts with exactly the two ladders a career
    // founded with a district next door has always started with — the same two
    // regions, the same towns in the same places, the same clubs under the same
    // ids with the same squads — and the four districts the map has added are
    // founded beside them. It is what makes every two-district save, test and
    // measurement still a measurement of this game.
    const { draft } = career;
    const two = generateDraft({ seed: SEED, startYear: 2026, pyramids: 2 });

    expect(two.pyramids).toHaveLength(2);
    expect(draft.pyramids.slice(0, 2).map((ladder) => ladder.id)).toEqual(two.pyramids.map((ladder) => ladder.id));
    for (const [index, ladder] of two.pyramids.entries()) {
      const grown = draft.pyramids[index]!;
      expect(grown.config).toEqual(ladder.config);
      expect(grown.level).toBe(ladder.level);
      expect(grown.regionId).toBe(ladder.regionId);
      expect(grown.divisions).toEqual(ladder.divisions);
    }
    expect(draft.world.regionIds.slice(0, 2)).toEqual(two.world.regionIds);
    for (const regionId of two.world.regionIds) {
      expect(draft.world.regions[regionId]).toEqual(two.world.regions[regionId]);
    }

    // The county's own settlements and football, entry for entry.
    for (const town of Object.values(two.world.towns)) expect(draft.world.towns[town.id]).toEqual(town);
    for (const ground of Object.values(two.world.grounds)) {
      expect(draft.world.grounds[ground.id]).toEqual(ground);
    }
    for (const club of Object.values(two.clubs)) {
      expect(draft.clubs[club.id], club.id).toEqual(club);
    }
    // Every man the county's clubs hold — squads, chairmen, backroom staff — is
    // the same man with the same standing. The officials the *world* holds are
    // not compared: a county of six ladders draws a deeper pool of referees for a
    // longer fixture list, and that is a fact about the county's size rather than
    // about its football.
    const held = new Set<string>();
    for (const club of Object.values(two.clubs)) {
      club.squadIds.forEach((id) => held.add(id));
      for (const id of [club.managerId, club.chairmanId]) if (id) held.add(id);
      Object.values(club.staff).flat().forEach((id) => {
        if (typeof id === 'string') held.add(id);
      });
    }
    expect(held.size).toBeGreaterThan(500);
    for (const personId of held) {
      expect(draft.people[personId], personId).toEqual(two.people[personId]);
    }
    // And the four the map added are the only clubs the two do not share.
    const twoClubs = new Set(Object.keys(two.clubs));
    const added = Object.keys(draft.clubs).filter((id) => !twoClubs.has(id));
    expect(added).toHaveLength(4 * DEFAULT_PYRAMID.tiers * DEFAULT_PYRAMID.clubsPerTier);
    for (const clubId of added) {
      const club = draft.clubs[clubId]!;
      expect(draft.world.towns[club.townId]!.regionId).not.toBe(FOUNDING_REGION_ID);
    }
  });

  it('is the same county from the same seed, and the founding county is untouched', () => {
    const { draft } = career;
    // Hashed rather than compared whole: a six-district world is seventeen
    // megabytes of JSON, and a failed comparison of two of them is a failure
    // nobody can read.
    const hash = (world: WorldDraft) => createHash('sha256').update(JSON.stringify(world)).digest('hex');
    const again = generateDraft({ seed: SEED, startYear: 2026 });
    expect(hash(again)).toBe(hash(draft));

    // The county a career has always been founded in, one district or six: the
    // founding ladder's clubs, their names, their divisions and its towns are
    // the ones they were before the other four districts existed.
    const alone = generateDraft({ seed: SEED, startYear: 2026, pyramids: 1 });
    expect(alone.pyramids).toHaveLength(1);
    expect(alone.divisions).toEqual(draft.pyramids[0]!.divisions);
    for (const clubId of alone.divisions.flat()) {
      expect(draft.clubs[clubId]!.identity.name).toBe(alone.clubs[clubId]!.identity.name);
      expect(draft.clubs[clubId]!.townId).toBe(alone.clubs[clubId]!.townId);
    }
    const countyTowns = Object.values(alone.world.towns);
    for (const town of countyTowns) expect(draft.world.towns[town.id]).toEqual(town);
  });
});

describe('the county’s competitions', () => {
  it('runs thirteen of them, each owned by the district it belongs to', () => {
    const { state } = career;
    expect(leagueCompetitions(state)).toHaveLength(18);
    const cups = cupCompetitions(state);
    // Six League Cups, six Plates, and the county cup across the lot.
    expect(cups).toHaveLength(13);
    expect(new Set(cups.map((cup) => cup.id)).size).toBe(13);

    for (const ladder of state.pyramidIds) {
      const pyramid = pyramidOf(state, ladder);
      expect(pyramid.competitionIds).toHaveLength(DEFAULT_PYRAMID.tiers);
      expect(pyramid.cupIds).toEqual([cupCompetitionId(ladder, 'cup'), cupCompetitionId(ladder, 'plate')]);
      for (const competitionId of pyramid.competitionIds) {
        expect(state.competitions[competitionId]!.name).toBe(
          divisionNameFor(regionNameFor(state, ladder), state.competitions[competitionId]!.tier),
        );
      }
      const cup = state.competitions[cupCompetitionId(ladder, 'cup')]!;
      const plate = state.competitions[cupCompetitionId(ladder, 'plate')]!;
      expect(cup.name).toBe(cupNameFor(regionNameFor(state, ladder), 'cup'));
      expect(plate.name).toBe(cupNameFor(regionNameFor(state, ladder), 'plate'));
      expect(cupFieldOf(cup.cup)).toEqual({ kind: 'pyramid', pyramidId: ladder });
      expect(cupFieldOf(plate.cup)).toEqual({ kind: 'pyramid', pyramidId: ladder });
      expect(pyramidIdOf(state, cup)).toBe(ladder);
    }

    // The county cup belongs to no ladder, and is named after the county every
    // club in it plays in.
    const countyCup = state.competitions[countyCupId(FOUNDING_COUNTY_ID)]!;
    expect(countyCup.name).toBe(COUNTY_CUP_NAME);
    expect(countyCup.name).toBe('Alderfordshire County Cup');
    expect(pyramidIdOf(state, countyCup)).toBeNull();
    expect(cupFieldOf(countyCup.cup)).toEqual({ kind: 'county' });

    // Thirteen names, thirteen trophies: no two of them could file a winner
    // under one honour.
    const names = [...cups.map((cup) => cup.name), ...leagueCompetitions(state).map((entry) => entry.name)];
    expect(new Set(names).size).toBe(names.length);
  });

  it('draws every cup from its own ladder, and the county cup from all six', () => {
    const { state } = career;
    for (const ladder of state.pyramidIds) {
      const field = new Set(pyramidClubIds(state, ladder));
      expect(field.size).toBe(36);
      const cup = state.competitions[cupCompetitionId(ladder, 'cup')]!;
      // A cup's own members, and nobody else's: not the county's, not a
      // neighbour's, not one club of another district.
      for (const clubId of cup.clubIds) expect(field.has(clubId), `${clubId} is in two ladders' cups`).toBe(true);
      expect(cup.clubIds).toHaveLength(36);
    }

    const countyCup = state.competitions[countyCupId(FOUNDING_COUNTY_ID)]!;
    const entrants = new Set(countyCup.clubIds);
    expect(entrants.size).toBe(216);
    expect(fieldClubs(state, { kind: 'county', countyId: FOUNDING_COUNTY_ID })).toHaveLength(216);
    expect(new Set(fieldClubs(state, { kind: 'county', countyId: FOUNDING_COUNTY_ID }))).toEqual(entrants);
    for (const ladder of state.pyramidIds) {
      for (const clubId of pyramidClubIds(state, ladder)) {
        expect(entrants.has(clubId), `${clubId} is missing from the county cup`).toBe(true);
      }
    }
    // Every club in the county is in exactly one division and in the cup.
    const membership = leagueCompetitions(state).flatMap((competition) => competition.clubIds);
    expect(new Set(membership).size).toBe(216);
    expect(new Set([...membership, ...entrants]).size).toBe(216);
  });

  it('never asks a club to play twice on one day, and keeps every round in order', () => {
    const { state } = career;
    const onADay = new Map<string, string[]>();
    for (const match of Object.values(state.matches)) {
      for (const clubId of [match.homeClubId, match.awayClubId]) {
        const key = `${match.date}::${clubId}`;
        onADay.set(key, [...(onADay.get(key) ?? []), match.id]);
      }
    }
    expect([...onADay.values()].filter((ids) => ids.length > 1)).toEqual([]);

    // A competition's rounds are played in the order they are numbered, and
    // every cup round has a date of its own: a round with no date is a trophy
    // nobody can win.
    for (const cup of cupCompetitions(state)) {
      const ties = Object.values(state.matches).filter((match) => match.competitionId === cup.id);
      // A competition's rounds are laid out when the season is built, but a
      // Plate's ties only exist once the round above it has been played: a club
      // cannot be drawn into the Plate before it has lost the cup. What is
      // asserted here is every round the competition actually has dated.
      const placeholder = cup.cup?.plan?.length ?? 0;
      expect(placeholder, `${cup.name} has no rounds planned`).toBeGreaterThan(0);
      if (ties.length === 0) continue;
      const datesByRound = new Map<number, string[]>();
      for (const tie of ties) {
        const round = tie.cupRound ?? 0;
        datesByRound.set(round, [...(datesByRound.get(round) ?? []), tie.date]);
      }
      const rounds = [...datesByRound.keys()].sort((a, b) => a - b);
      let previous = '';
      for (const round of rounds) {
        const earliest = datesByRound.get(round)!.sort()[0]!;
        expect(earliest > previous, `${cup.name} round ${round} is played out of order`).toBe(true);
        previous = datesByRound.get(round)!.sort().reverse()[0]!;
      }
    }
  });

  it('finishes the season and rolls over with all six ladders still standing', () => {
    const { state } = career;
    const before = state.pyramidIds.slice();
    const countyCupBefore = Object.keys(state.competitions[countyCupId(FOUNDING_COUNTY_ID)]!.clubIds).length;

    // The league is settled by hand — the football is not what this test is
    // about — and the season is closed by the game's own rules. Its cups are
    // left unplayed, which is what a season whose calendar ran out with football
    // still on it means: the competitions are archived as they stand.
    settleLeague(state);
    finishSeason(state);
    const events = startNextSeason(state);

    // Six ladders, eighteen divisions, thirteen competitions again: the whole
    // county is rebuilt for the new season, and nothing was founded twice.
    expect(state.pyramidIds).toEqual(before);
    expect(leagueCompetitions(state)).toHaveLength(18);
    expect(cupCompetitions(state)).toHaveLength(13);
    expect(state.world.regionIds).toEqual(ALDERFORDSHIRE_DISTRICTS.map((district) => district.regionId));
    expect(missingDistricts(state)).toEqual([]);
    expect(districtCount(state)).toBe(6);
    // Nothing was founded, so nothing is announced as founded: a career that
    // already has the whole county is not told about districts it did not gain.
    expect(events.filter((event) => /district/i.test(JSON.stringify(event.data)))).toEqual([]);

    // The county cup is the same competition, drawn again from the same county.
    const countyCup = state.competitions[countyCupId(FOUNDING_COUNTY_ID)]!;
    expect(countyCup.name).toBe(COUNTY_CUP_NAME);
    expect(countyCup.clubIds).toHaveLength(countyCupBefore);
    expect(cupFieldOf(countyCup.cup)).toEqual({ kind: 'county' });

    // Every club is in exactly one division of the county, and one of them is
    // the manager's own.
    const membership = leagueCompetitions(state).flatMap((competition) => competition.clubIds);
    expect(new Set(membership).size).toBe(216);
    expect(membership).toContain(state.userClubId);
    expect(divisionsOf(state).some((division) => division.clubIds.includes(state.userClubId))).toBe(true);
  });

  it('keeps the whole county through a save and back', () => {
    const { state } = career;
    const restored = deserialiseGame(serialiseGame(state));
    expect(restored.error).toBeNull();
    const back = restored.state!;
    expect(back.pyramidIds).toEqual(state.pyramidIds);
    expect(Object.keys(back.competitions).sort()).toEqual(Object.keys(state.competitions).sort());
    expect(back.world.regionIds).toEqual(state.world.regionIds);
    expect(Object.keys(back.clubs)).toHaveLength(216);
    expect(cupCompetitions(back)).toHaveLength(13);
    // Read by the same functions the game reads them with: the county cup is
    // still the county's, and each ladder still owns its own two cups.
    expect(pyramidIdOf(back, back.competitions[countyCupId(FOUNDING_COUNTY_ID)]!)).toBeNull();
    for (const ladder of back.pyramidIds) {
      expect(pyramidOf(back, ladder).cupIds).toEqual([cupCompetitionId(ladder, 'cup'), cupCompetitionId(ladder, 'plate')]);
    }
  });
});

describe('a career begun in any district', () => {
  /** A career started in one district of the county, from the one draft. */
  function careerIn(regionId: string) {
    const { draft } = career;
    const definition = ALDERFORDSHIRE_DISTRICTS.find((district) => district.regionId === regionId)!;
    const selection = resolveGeographySelection(draft, FOUNDING_COUNTY_ID, definition.regionId)!;
    const clubId = draft.pyramids.find((ladder) => ladder.id === selection.pyramidId)!.divisions[2]![0]!;
    const state = startGameFromDraft(draft, {
      seed: `${SEED}-${regionId}`,
      startYear: draft.startYear,
      clubId,
      saveName: `A club in ${definition.name}`,
    });
    return { definition, selection, clubId, state };
  }

  it('puts the manager in the district he chose, in a club of that district', () => {
    // The founding county, the valley next door, and one of the four districts
    // the county has added: the same flow for each, and no district is special.
    for (const regionId of [FOUNDING_REGION_ID, 'region_2', 'region_3']) {
      const { definition, selection, clubId, state } = careerIn(regionId);
      expect(state.userClubId).toBe(clubId);
      expect(state.pyramids[selection.pyramidId]!.regionId).toBe(definition.regionId);
      expect(state.world.regions[definition.regionId]!.name).toBe(definition.name);
      // His club plays in that ladder, and nowhere else.
      const division = divisionsOf(state, selection.pyramidId).find((entry) => entry.clubIds.includes(clubId))!;
      expect(division).toBeTruthy();
      expect(pyramidIdOf(state, division)).toBe(selection.pyramidId);
      // The world is the whole county, and it was not waiting for anything.
      expect(state.pyramidIds).toHaveLength(6);
      expect(state.worldExpansion).toBeUndefined();
      expect(districtCount(state)).toBe(6);
      // The selection cannot escape the district: a club of another ladder is
      // not a club this selection can be started with.
      const other = state.pyramidIds.find((ladder) => ladder !== selection.pyramidId)!;
      const elsewhere = pyramidClubIds(state, other)[0]!;
      expect(pyramidClubIds(state, selection.pyramidId)).not.toContain(elsewhere);
    }
  });

  it('names every ladder, cup and division after the district it belongs to', () => {
    const state = careerIn('region_5').state;
    const counties = state.world.counties[FOUNDING_COUNTY_ID]!;
    expect(counties.regionIds).toHaveLength(6);
    for (const ladder of state.pyramidIds) {
      const regionName = regionNameFor(state, ladder);
      expect(regionName.length).toBeGreaterThan(0);
      const cup = state.competitions[cupCompetitionId(ladder, 'cup')]!;
      expect(cup.name.startsWith(regionName)).toBe(true);
      expect(cup.name.endsWith('Sunday League Cup')).toBe(true);
      expect(cup.name).not.toContain('County');
    }
    // And one club of every district carries a town of that district's own.
    for (const definition of ALDERFORDSHIRE_DISTRICTS) {
      const selection = resolveGeographySelection(career.draft, FOUNDING_COUNTY_ID, definition.regionId)!;
      const townId = career.draft.clubs[pyramidClubIds(state, selection.pyramidId)[0]!]!.townId;
      expect(career.draft.world.towns[townId]!.regionId).toBe(definition.regionId);
    }
  });
});
