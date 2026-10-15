import { describe, expect, it } from 'vitest';
import { cupFieldOf, DEFAULT_PYRAMID, type Competition, type Pyramid } from '@/domain/competition';
import { ALDERFORDSHIRE_DISTRICTS } from '@/domain/districts';
import { FOUNDING_COUNTY_ID, FOUNDING_REGION_ID, SECOND_REGION_ID } from '@/domain/world';
import type { GameState } from '@/domain/game';
import type { ClubId } from '@/domain/ids';
import { isPlayer } from '@/domain/person';
import { toDate } from './calendar';
import { processDay } from './day';
import { isActiveFixture } from './postponement';
import {
  COUNTY_CUP_ID,
  COUNTY_CUP_NAME,
  countyClubIds,
  cupCompetitionId,
  cupCompetitions,
  divisionOf,
  divisionsOf,
  LEAGUE_CUP_ID,
  leagueCompetitions,
  PLATE_ID,
  pyramidClubIds,
  pyramidIdOf,
  pyramidOf,
} from './pyramid';
import { finishSeason, startNextSeason } from './season';
import { createTestGame, settleLeague } from './testSupport';
import { isLeagueMatchday } from './timeline';
import { activateWorldExpansion, expansionPending, markWorldExpansion, oneLadderWorld } from './worldExpansion';

/**
 * The second region and its ladder, in a career that is actually being played.
 *
 * Stage 2's world generation is one thing (`worldGenerator.test.ts`); this is the
 * other half of it — that a career founded with a district next door is a career
 * the game can play: both ladders get their divisions and their fixtures, the
 * county's own season is the season it always was, and rolling over settles each
 * ladder against its own boundaries and nobody else's.
 *
 * Stage 3's half is here too: the district's own cups, the county cup drawn from
 * both ladders, and the lane model that lets the two ladders' cups share the
 * Sundays between them while the county cup takes afternoons of its own. What the
 * county played before it existed is asserted as unchanged throughout — the
 * founding ladder's season is still its own, entry for entry, and only the county
 * cup is new.
 */
const SEED = 'expansion-county';

/** The ladder a career is born with that is not the founding one. */
function districtOf(state: ReturnType<typeof createTestGame>['state']): Pyramid {
  return pyramidOf(state, state.pyramidIds.find((id) => id !== 'league')!);
}

/** Every division of both ladders, tier 1 first, in the order the world lists them. */
function bothLadders(state: ReturnType<typeof createTestGame>['state']) {
  return {
    county: divisionsOf(state),
    district: divisionsOf(state, districtOf(state).id),
  };
}

describe('a career founded with a district next door', () => {
  it('plays both ladders without touching the county’s own season', () => {
    const county = createTestGame(SEED, 0, 2026, 1);
    const world = createTestGame(SEED, 0, 2026);

    // Two ladders, six divisions, twelve clubs in each of them.
    expect(world.state.pyramidIds).toHaveLength(2);
    const ladders = bothLadders(world.state);
    expect(ladders.county.map((division) => division.id)).toEqual([
      'comp_league_t1',
      'comp_league_t2',
      'comp_league_t3',
    ]);
    expect(ladders.district).toHaveLength(DEFAULT_PYRAMID.tiers);
    expect(leagueCompetitions(world.state)).toHaveLength(6);
    for (const division of [...ladders.county, ...ladders.district]) {
      expect(division.clubIds).toHaveLength(DEFAULT_PYRAMID.clubsPerTier);
    }

    // The county's season is the season it has always been. Every league Sunday
    // and every one of the county's own cup rounds is on the matchday it was on
    // and the date it was on: the first entries of a two-ladder calendar are a
    // one-ladder career's calendar, entry for entry.
    const calendarLength = county.state.season.calendar.length;
    expect(world.state.season.calendar.filter((entry) => entry.matchday <= calendarLength)).toEqual(
      county.state.season.calendar,
    );
    expect(world.state.season.calendar.filter((entry) => isLeagueMatchday(world.state, entry.matchday))).toEqual(
      county.state.season.calendar.filter((entry) => isLeagueMatchday(county.state, entry.matchday)),
    );
    const countyMatches = Object.keys(county.state.matches);
    expect(countyMatches.length).toBeGreaterThan(0);
    for (const matchId of countyMatches) {
      expect(world.state.matches[matchId], matchId).toEqual(county.state.matches[matchId]);
    }
    for (const matchId of county.state.matchOrder) expect(world.state.matchOrder).toContain(matchId);

    // The one thing the county cup adds to the calendar is its own afternoons.
    // Its field is every club in the county, so there is no round of anybody
    // else's it could share a Sunday with, and none of its dates is a date the
    // one-ladder county played on.
    const countyCupDates = Object.values(world.state.matches)
      .filter((match) => match.competitionId === COUNTY_CUP_ID)
      .map((match) => match.date);
    expect(countyCupDates.length).toBeGreaterThan(0);
    for (const date of countyCupDates) {
      expect(county.state.season.calendar.some((entry) => entry.date === date), date).toBe(false);
    }

    // The district's fixtures are the district's, and every one of them is dated
    // by the same calendar the county plays on.
    const districtDivisionIds = new Set(ladders.district.map((division) => division.id));
    const districtFixtures = Object.values(world.state.fixtures).filter((list) =>
      districtDivisionIds.has(list.competitionId),
    );
    expect(districtFixtures).toHaveLength(DEFAULT_PYRAMID.tiers);
    const leagueDates = new Set(world.state.season.calendar.map((entry) => entry.date));
    for (const list of districtFixtures) {
      // Twelve clubs playing home and away is a hundred and thirty-two fixtures.
      expect(Object.values(list.byMatchday).flat()).toHaveLength(
        DEFAULT_PYRAMID.clubsPerTier * (DEFAULT_PYRAMID.clubsPerTier - 1),
      );
      for (const matchId of Object.values(list.byMatchday).flat()) {
        const match = world.state.matches[matchId]!;
        expect(leagueDates.has(match.date)).toBe(true);
        expect(match.played).toBe(false);
      }
    }

    // Five cups: each ladder's own League Cup and Plate, drawn from its own
    // clubs and sharing the Sundays between them, and the county cup drawn from
    // both and belonging to neither.
    const district = districtOf(world.state);
    expect(cupCompetitions(world.state).map((cup) => cup.id).sort()).toEqual(
      [
        LEAGUE_CUP_ID,
        PLATE_ID,
        COUNTY_CUP_ID,
        cupCompetitionId(district.id, 'cup'),
        cupCompetitionId(district.id, 'plate'),
      ].sort(),
    );
    expect(pyramidOf(world.state, 'league').cupIds).toEqual([LEAGUE_CUP_ID, PLATE_ID]);
    expect(district.cupIds).toEqual([cupCompetitionId(district.id, 'cup'), cupCompetitionId(district.id, 'plate')]);
    expect(district.config.leagueCup).toBe(true);
    expect(district.config.consolationCup).toBe(true);
    // The county cup is nobody's: it is on no ladder's list, which is what makes
    // `pyramidIdOf` answer null for it, and its entrants are the whole county's
    // active clubs rather than either ladder's thirty-six.
    const countyCup = world.state.competitions[COUNTY_CUP_ID]!;
    expect(countyCup.name).toBe(COUNTY_CUP_NAME);
    expect(pyramidIdOf(world.state, countyCup)).toBeNull();
    expect(countyCup.clubIds).toHaveLength(2 * DEFAULT_PYRAMID.clubsPerTier * DEFAULT_PYRAMID.tiers);
    expect(new Set(countyCup.clubIds)).toEqual(
      new Set([...ladders.county.flatMap((division) => division.clubIds), ...ladders.district.flatMap((division) => division.clubIds)]),
    );
  });

  it('keeps two populations of clubs, each in its own region and its own ladder', () => {
    const { state } = createTestGame(SEED, 0, 2026);
    const ladders = bothLadders(state);
    const district = districtOf(state);

    const countyClubs = new Set(ladders.county.flatMap((division) => division.clubIds));
    const districtClubs = ladders.district.flatMap((division) => division.clubIds);
    expect(countyClubs.size).toBe(36);
    expect(districtClubs).toHaveLength(36);
    for (const clubId of districtClubs) expect(countyClubs.has(clubId)).toBe(false);

    // A club's ladder is read from its town's region, and every club of the
    // district's plays in the district.
    for (const clubId of [...countyClubs, ...districtClubs]) {
      const club = state.clubs[clubId]!;
      const division = state.competitions[ladders.county.concat(ladders.district).find((entry) => entry.clubIds.includes(clubId))!.id]!;
      const regionId = state.world.towns[club.townId]!.regionId;
      const ladder = regionId === FOUNDING_REGION_ID ? 'league' : district.id;
      if (regionId !== FOUNDING_REGION_ID) expect(regionId).toBe(SECOND_REGION_ID);
      expect(pyramidIdOf(state, division)).toBe(ladder);
    }
  });

  it('rolls both ladders over at once, each on its own boundaries', () => {
    const { state } = createTestGame(SEED, 0, 2026);
    const district = districtOf(state);
    const before = bothLadders(state);
    const ladderOf = (clubId: ClubId) =>
      before.county.some((division) => division.clubIds.includes(clubId)) ? 'league' : district.id;

    // Play the league football out: the better-supported side wins, which is all
    // a table needs to settle a boundary without a match engine.
    for (const match of Object.values(state.matches)) {
      const division = state.competitions[match.competitionId];
      if (!division || division.kind !== 'league') continue;
      const home = state.clubs[match.homeClubId]!;
      const away = state.clubs[match.awayClubId]!;
      const homeWins = home.reputation >= away.reputation;
      match.played = true;
      match.status = 'finished';
      match.result = {
        homeGoals: homeWins ? 2 : 0,
        awayGoals: homeWins ? 0 : 2,
        homeShots: 9,
        awayShots: 9,
        homePossession: homeWins ? 60 : 40,
        awayPossession: homeWins ? 40 : 60,
        attendance: 120,
      };
    }

    const seasonId = state.season.id;
    finishSeason(state);
    const movements = state.promotionHistory.filter((movement) => movement.seasonId === seasonId);
    expect(movements.length).toBeGreaterThan(0);
    // Every movement was settled inside the ladder the club was already in.
    const movedLadders = new Set<string>();
    for (const movement of movements) {
      const ladder = ladderOf(movement.clubId);
      expect(pyramidIdOf(state, state.competitions[movement.competitionId]!)).toBe(ladder);
      movedLadders.add(ladder);
    }
    expect(movedLadders).toEqual(new Set(['league', district.id]));

    startNextSeason(state);

    // Both ladders are rebuilt, still their own, still full, and the county's own
    // competition ids have not moved.
    const after = bothLadders(state);
    expect(after.county.map((division) => division.id)).toEqual([
      'comp_league_t1',
      'comp_league_t2',
      'comp_league_t3',
    ]);
    expect(after.district.map((division) => division.id)).toEqual(
      [1, 2, 3].map((tier) => `comp_${district.id}_t${tier}`),
    );
    for (const division of [...after.county, ...after.district]) {
      expect(division.clubIds).toHaveLength(DEFAULT_PYRAMID.clubsPerTier);
    }
    expect(state.season.calendar.length).toBeGreaterThan(0);
    // Both ladders' cups and the county cup are rebuilt together, so the same
    // five competitions exist with fresh rounds rather than last season's.
    expect(cupCompetitions(state).map((cup) => cup.id).sort()).toEqual(
      [LEAGUE_CUP_ID, PLATE_ID, COUNTY_CUP_ID, cupCompetitionId(district.id, 'cup'), cupCompetitionId(district.id, 'plate')].sort(),
    );
    expect(pyramidOf(state, district.id).cupIds).toEqual([
      cupCompetitionId(district.id, 'cup'),
      cupCompetitionId(district.id, 'plate'),
    ]);
    expect(Object.values(state.competitions).filter((competition) => competition.seasonId === state.season.id)).toHaveLength(
      11,
    );

    // Nobody changed ladder over the summer, and every club's region still names
    // the ladder it plays in.
    const afterCounty = new Set(after.county.flatMap((division) => division.clubIds));
    const afterDistrict = after.district.flatMap((division) => division.clubIds);
    expect(afterCounty.size).toBe(36);
    for (const clubId of afterDistrict) expect(afterCounty.has(clubId)).toBe(false);
    for (const clubId of [...afterCounty, ...afterDistrict]) {
      const regionId = state.world.towns[state.clubs[clubId]!.townId]!.regionId;
      expect(regionId === FOUNDING_REGION_ID ? 'league' : district.id).toBe(ladderOf(clubId));
    }
  });
});

describe('a county with one ladder', () => {
  it('is a county with no second region, and is left that way', () => {
    const { state, draft } = createTestGame(SEED, 0, 2026, 1);

    expect(draft.pyramids).toHaveLength(1);
    expect(state.pyramidIds).toEqual(['league']);
    expect(Object.keys(state.world.regions)).toEqual([FOUNDING_REGION_ID]);
    expect(state.world.regionIds).toEqual([FOUNDING_REGION_ID]);
    // Every town the county has is the county's own, and always was.
    for (const town of Object.values(state.world.towns)) expect(town.regionId).toBe(FOUNDING_REGION_ID);
    // One ladder, three divisions, two cups, and every active club in a division.
    expect(leagueCompetitions(state)).toHaveLength(DEFAULT_PYRAMID.tiers);
    expect(cupCompetitions(state)).toHaveLength(2);
    const inDivisions = new Set(leagueCompetitions(state).flatMap((division) => division.clubIds));
    expect(inDivisions.size).toBe(36);
    expect(Object.keys(state.clubs)).toHaveLength(36);

    // And it plays the season a one-ladder county always played: its own cup
    // dates, drawn from its own clubs, with no county cup on the calendar — a
    // county with one ladder has no second ladder to invite, and the ladder's own
    // cup *is* the county's.
    const two = createTestGame(SEED, 0, 2026);
    const calendarLength = state.season.calendar.length;
    expect(two.state.season.calendar.filter((entry) => entry.matchday <= calendarLength)).toEqual(
      state.season.calendar,
    );
    for (const matchId of Object.keys(state.matches)) {
      expect(two.state.matches[matchId], matchId).toEqual(state.matches[matchId]);
    }
  });
});

describe('the division table a manager reads', () => {
  it('is his own ladder’s, not a tier number shared with somebody else’s', () => {
    const { state } = createTestGame(SEED, 0, 2026);
    const ladder = bothLadders(state);
    const district: Competition = ladder.district[0]!;

    // Both ladders have a tier 1, and they are different competitions with
    // different clubs: a lookup by tier alone would hand a manager next door's
    // table.
    expect(ladder.county[0]!.tier).toBe(district.tier);
    expect(ladder.county[0]!.id).not.toBe(district.id);
    expect(ladder.county[0]!.clubIds.filter((clubId) => district.clubIds.includes(clubId))).toEqual([]);
    expect(new Set(leagueCompetitions(state).map((division) => division.id)).size).toBe(6);
  });
});

/**
 * A career that is owed the districts the county has.
 *
 * The same world as the tests above, reached the other way round: a career that
 * has been played since before some of the county's districts existed — which is
 * what every save written before them holds — marked the way `migrateSave` marks
 * it when it is opened, and rolled over. This is the half of the whole-county
 * work an existing career uses, and what it has to prove is that the county gains
 * five leagues without any of the football it already had moving, and that the
 * second boundary does not found them all over again.
 */
describe('a career that is owed the districts the county has', () => {
  /** A one-ladder career, marked the way an opened old save is marked. */
  function markedCareer(seed: string) {
    const game = createTestGame(seed, 0, 2026, 1);
    markWorldExpansion(game.state);
    return game;
  }

  /** Every district founded beside the county, in the map's own order. */
  function districtsFounded(state: GameState): Pyramid[] {
    return state.pyramidIds.filter((id) => id !== 'league').map((id) => pyramidOf(state, id));
  }

  /** The county's own season: one ladder played out and rolled over. */
  function playAndRoll(state: GameState): void {
    settleLeague(state);
    finishSeason(state);
    startNextSeason(state);
  }

  /** Every id in the world that has to be unique, as one list. */
  function allIds(state: GameState): string[] {
    return [
      ...state.world.townIds,
      ...state.world.groundIds,
      ...Object.keys(state.world.businesses),
      ...Object.keys(state.clubs),
      ...Object.keys(state.people),
      ...state.pyramidIds,
      ...Object.keys(state.competitions),
    ];
  }

  it('is one ladder all season and two the moment the season turns', () => {
    const { state } = markedCareer('owed-district');
    expect(expansionPending(state)).toBe(true);
    expect(state.pyramidIds).toEqual(['league']);
    expect(state.world.regionIds).toEqual([FOUNDING_REGION_ID]);

    // Through the season itself: days pass, the world goes on around him, and
    // nothing about the county changes. A district cannot be founded in the
    // middle of a season without inventing the results of fixtures it would have
    // to have played.
    for (let day = 0; day < 14; day += 1) {
      processDay(state, state.date, { resolveUserMatch: true });
    }
    expect(state.pyramidIds).toEqual(['league']);
    expect(state.world.regionIds).toEqual([FOUNDING_REGION_ID]);
    expect(expansionPending(state)).toBe(true);

    // The season closes without it too: the tables are settled on the ladders
    // that played, and there is still only ever one.
    const closingSeason = state.season.id;
    settleLeague(state);
    finishSeason(state);
    expect(state.pyramidIds).toEqual(['league']);
    expect(state.world.regionIds).toEqual([FOUNDING_REGION_ID]);

    const events = startNextSeason(state);

    // The mark is spent, and names the season it was spent in.
    expect(expansionPending(state)).toBe(false);
    expect(state.worldExpansion).toEqual({ pending: false, expandedInSeasonId: state.season.id });
    expect(state.season.id).not.toBe(closingSeason);

    // Six regions and six ladders: the county the map has always drawn, founded
    // in one afternoon at the boundary. Each district is the map's own place,
    // under the map's own name, a level below the founding county's football.
    const founded = districtsFounded(state);
    expect(founded).toHaveLength(5);
    expect(state.pyramidIds).toEqual(['league', ...founded.map((district) => district.id)]);
    expect(state.world.regionIds).toEqual(ALDERFORDSHIRE_DISTRICTS.map((district) => district.regionId));
    for (const definition of ALDERFORDSHIRE_DISTRICTS.slice(1)) {
      const district = state.pyramids[
        state.pyramidIds.find((id) => state.pyramids[id]!.regionId === definition.regionId)!
      ]!;
      expect(district.regionId).toBe(definition.regionId);
      expect(district.level).toBe(definition.level);
      expect(state.world.regions[definition.regionId]!.name).toBe(definition.name);
      expect(district.name).toBe(`${definition.name} Sunday League`);
      expect(divisionsOf(state, district.id)).toHaveLength(DEFAULT_PYRAMID.tiers);
      expect(pyramidClubIds(state, district.id)).toHaveLength(
        DEFAULT_PYRAMID.tiers * DEFAULT_PYRAMID.clubsPerTier,
      );
      // And the manager was told, in the news the roll-over published.
      expect(
        events.some((event) => event.type === 'world' && String(event.data.headline).includes(definition.name)),
      ).toBe(true);
    }
  });

  it('founds the districts once, and spends the mark doing it', () => {
    const { state } = markedCareer('owed-once');
    const context = {
      seasonId: state.season.id,
      seasonLabel: state.season.label,
      seasonStart: state.date,
      currentYear: 2026,
    };

    const founded = activateWorldExpansion(state, context);
    expect(founded).toHaveLength(5);
    expect(state.pyramidIds).toEqual(['league', ...founded.map((district) => district.pyramidId)]);
    expect(state.worldExpansion).toEqual({ pending: false, expandedInSeasonId: context.seasonId });

    // The second call has nothing to do, and does not do it twice: no seventh
    // region, no sixth district, no re-minted clubs.
    const clubs = founded.map((district) => pyramidClubIds(state, district.pyramidId));
    const towns = state.world.townIds.length;
    expect(activateWorldExpansion(state, context)).toEqual([]);
    expect(state.pyramidIds).toHaveLength(6);
    expect(Object.keys(state.world.regions)).toHaveLength(6);
    for (const [index, district] of founded.entries()) {
      expect(pyramidClubIds(state, district.pyramidId)).toEqual(clubs[index]);
    }
    expect(state.world.townIds).toHaveLength(towns);

    // And the mark is not re-armed by a later migration: a career that has the
    // whole county is owed nothing, whatever asked.
    markWorldExpansion(state);
    expect(state.worldExpansion).toEqual({ pending: false, expandedInSeasonId: context.seasonId });
  });

  it('gives a career with two districts the four it is missing, and a career with six none', () => {
    // A career founded when the county had two ladders — every save the game has
    // written since the district next door existed — is owed the four districts
    // the map has always drawn beside them.
    const { state } = createTestGame('owed-already-two');
    expect(state.pyramidIds).toHaveLength(2);
    state.worldExpansion = { pending: true };
    const context = {
      seasonId: state.season.id,
      seasonLabel: state.season.label,
      seasonStart: state.date,
      currentYear: 2026,
    };

    const founded = activateWorldExpansion(state, context);
    expect(founded).toHaveLength(4);
    expect(state.worldExpansion).toEqual({ pending: false, expandedInSeasonId: context.seasonId });
    expect(state.pyramidIds).toHaveLength(6);
    expect(Object.keys(state.world.regions)).toHaveLength(6);
    expect(state.world.regions[SECOND_REGION_ID]!.name).toBe('Westbrook Valley');
    expect(oneLadderWorld(state)).toBe(false);

    // A career founded with the whole county is owed nothing at all, and the
    // roll-over of one is never interrupted by a district being founded.
    const whole = createTestGame('owed-already-six', 0, 2026, 6);
    expect(whole.state.worldExpansion).toBeUndefined();
    markWorldExpansion(whole.state);
    expect(whole.state.worldExpansion).toEqual({ pending: false });
    expect(activateWorldExpansion(whole.state, { ...context, seasonId: whole.state.season.id })).toEqual([]);
  });

  it('rolls the county into the whole-county world without moving the county', () => {
    // The same career twice: one that is owed the district, and one that is not
    // and so stays the county it was. Whatever the two have in common after the
    // boundary is exactly what founding a district did not touch.
    const owed = markedCareer('owed-continuity');
    const alone = createTestGame('owed-continuity', 0, 2026, 1);

    const before = {
      clubIds: Object.keys(owed.state.clubs).sort(),
      townIds: [...owed.state.world.townIds],
      grounds: Object.values(owed.state.world.grounds)
        .map((ground) => ({ id: ground.id, name: ground.name, townId: ground.townId, tenantClubId: ground.tenantClubId }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      clubs: Object.values(owed.state.clubs)
        .map((club) => ({
          id: club.id,
          name: club.identity.name,
          nickname: club.identity.nickname,
          townId: club.townId,
          groundId: club.groundId,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      towns: Object.values(owed.state.world.towns)
        .map((town) => ({ id: town.id, name: town.name, regionId: town.regionId, x: town.x, y: town.y }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    };

    playAndRoll(owed.state);
    playAndRoll(alone.state);

    expect(alone.state.pyramidIds).toEqual(['league']);
    expect(owed.state.pyramidIds).toHaveLength(6);

    // Nothing the county already had was re-minted, renamed or re-homed.
    expect(Object.keys(owed.state.clubs).filter((id) => before.clubIds.includes(id)).sort()).toEqual(
      before.clubIds,
    );
    for (const club of before.clubs) {
      const after = owed.state.clubs[club.id]!;
      expect(after.identity.name).toBe(club.name);
      expect(after.identity.nickname).toBe(club.nickname);
      expect(after.townId).toBe(club.townId);
      expect(after.groundId).toBe(club.groundId);
    }
    for (const town of before.towns) {
      const after = owed.state.world.towns[town.id]!;
      expect(after.name).toBe(town.name);
      expect(after.regionId).toBe(town.regionId);
      expect(after.x).toBe(town.x);
      expect(after.y).toBe(town.y);
    }
    for (const ground of before.grounds) {
      const after = owed.state.world.grounds[ground.id]!;
      expect(after.name).toBe(ground.name);
      expect(after.townId).toBe(ground.townId);
      expect(after.tenantClubId).toBe(ground.tenantClubId);
    }
    // A rollover retires people, empties a folded club's dressing room and trims
    // the pool of men between jobs — and a county with a district in it has a
    // deeper pool, so which of the idle men the trim keeps can differ. Nobody a
    // club still holds may be lost, though: every squad, committee and backroom
    // in the county is the same list of real people in both worlds.
    for (const clubId of Object.keys(alone.state.clubs)) {
      const county = alone.state.clubs[clubId]!;
      const held = [
        ...county.squadIds,
        ...(county.managerId ? [county.managerId] : []),
        ...(county.chairmanId ? [county.chairmanId] : []),
        ...Object.values(county.staff).flat().filter((id): id is string => typeof id === 'string'),
      ];
      for (const personId of held) {
        expect(owed.state.people[personId], `${clubId}: ${personId}`).toBeDefined();
      }
    }
    for (const personId of Object.keys(alone.state.people)) {
      if (owed.state.people[personId]) continue;
      // The only people who left the world are men who belonged to no club.
      expect(alone.state.people[personId]!.clubId ?? null, personId).toBeNull();
    }
    expect(owed.state.userClubId).toBe(alone.state.userClubId);
    expect(owed.state.managerProfile).toEqual(alone.state.managerProfile);

    // The county in the expanded career is the county of the one that never got
    // its districts — same clubs, same standing, same managers, same honours. The
    // clubs the districts added are the *only* clubs the two do not share.
    const districtClubs = new Set(
      districtsFounded(owed.state).flatMap((district) => pyramidClubIds(owed.state, district.id)),
    );
    expect(districtClubs.size).toBe(5 * DEFAULT_PYRAMID.tiers * DEFAULT_PYRAMID.clubsPerTier);
    expect(Object.keys(owed.state.clubs).filter((id) => !alone.state.clubs[id]).sort()).toEqual(
      [...districtClubs].sort(),
    );
    for (const clubId of Object.keys(alone.state.clubs)) {
      const expanded = owed.state.clubs[clubId]!;
      const county = alone.state.clubs[clubId]!;
      expect(expanded.active, clubId).toBe(county.active);
      expect(expanded.reputation, clubId).toBe(county.reputation);
      // The manager's carousel turns through a county of six ladders, where it
      // turned through one, so a post that came free in both worlds can be filled
      // here by a man poached off a district club — that is what a market is, and
      // it turns at this boundary in the one-ladder county too. The post is
      // therefore not compared; what is compared is that *expansion* dropped
      // nobody, which the test below holds it to directly. A man who is not in
      // post here is between jobs, or has moved to another club.
      if (county.managerId && expanded.managerId !== county.managerId) {
        const left = owed.state.people[county.managerId];
        if (left) expect(left.clubId === null || left.clubId !== clubId, clubId).toBe(true);
      }
      expect(expanded.chairmanId, clubId).toBe(county.chairmanId);
      expect(expanded.squadIds, clubId).toEqual(county.squadIds);
      expect(expanded.staff, clubId).toEqual(county.staff);
      expect([...expanded.history.honours], clubId).toEqual([...county.history.honours]);
    }

    // And the football is the football the county would have played on its own:
    // every competition it has, and every fixture in it, entry for entry.
    for (const competition of Object.values(alone.state.competitions)) {
      expect(owed.state.competitions[competition.id], competition.id).toEqual(competition);
    }
    for (const [matchId, match] of Object.entries(alone.state.matches)) {
      expect(owed.state.matches[matchId], matchId).toEqual(match);
    }
  });

  it('founds districts whose ids, towns, grounds and squads all hold together', () => {
    const { state } = markedCareer('owed-ids');
    const before = {
      towns: new Set(state.world.townIds),
      grounds: new Set(state.world.groundIds),
      clubs: new Set(Object.keys(state.clubs)),
      people: new Set(Object.keys(state.people)),
      regions: new Map(Object.entries(state.world.regions)),
    };
    const idsBefore = allIds(state);
    expect(new Set(idsBefore).size).toBe(idsBefore.length);

    playAndRoll(state);

    // Nothing was renumbered: the county's ids are all still there.
    for (const townId of before.towns) expect(state.world.towns[townId]).toBeDefined();
    for (const groundId of before.grounds) expect(state.world.grounds[groundId]).toBeDefined();
    for (const regionId of before.regions.keys()) expect(state.world.regions[regionId]).toBeDefined();

    // And no id is used twice anywhere in the world, including the ones the
    // district has just minted.
    const ids = allIds(state);
    expect(new Set(ids).size).toBe(ids.length);
    expect(state.world.townIds).toEqual(Object.keys(state.world.towns));
    expect(state.world.groundIds).toEqual(Object.keys(state.world.grounds));
    expect(Object.keys(state.world.towns).length).toBeGreaterThan(before.towns.size);
    for (const definition of ALDERFORDSHIRE_DISTRICTS) {
      expect(state.world.regions[definition.regionId], definition.name).toBeDefined();
    }

    const districts = districtsFounded(state);
    for (const district of districts) {
      const districtClubs = pyramidClubIds(state, district.id);
      expect(districtClubs).toHaveLength(DEFAULT_PYRAMID.tiers * DEFAULT_PYRAMID.clubsPerTier);
      for (const clubId of districtClubs) {
        const club = state.clubs[clubId]!;
        expect(before.clubs.has(clubId)).toBe(false);
        // Its own prefix, so no later migration can mint an id it already holds.
        expect(clubId.startsWith(`club_${district.id}_`)).toBe(true);
        // A town of the district's own, and a ground on that town that the club
        // either holds the tenancy of or shares — sharing a pitch with a club from
        // the same village is what a Sunday league is.
        const town = state.world.towns[club.townId]!;
        const ground = state.world.grounds[club.groundId]!;
        expect(town.regionId).toBe(district.regionId);
        expect(ground.townId).toBe(town.id);
        expect(ground.tenantClubId === clubId || ground.sharedWith.includes(clubId)).toBe(true);
        // A squad, a manager and a committee, all real people of this club.
        expect(club.squadIds.length).toBeGreaterThanOrEqual(18);
        for (const playerId of club.squadIds) {
          const player = state.people[playerId]!;
          expect(before.people.has(playerId)).toBe(false);
          expect(isPlayer(player)).toBe(true);
          expect(player.clubId).toBe(clubId);
        }
        expect(club.managerId ? state.people[club.managerId] : undefined).toBeDefined();
        expect(club.chairmanId ? state.people[club.chairmanId] : undefined).toBeDefined();
        expect(club.active).toBe(true);
        // It is in the season that is about to be played, with a record opened.
        expect(club.history.seasons.some((entry) => entry.seasonId === state.season.id)).toBe(true);
      }
    }

    // Every club in the county is in exactly one division, of exactly one ladder.
    const memberships = leagueCompetitions(state).flatMap((division) =>
      division.clubIds.map((clubId) => [clubId, division.id] as const),
    );
    expect(leagueCompetitions(state)).toHaveLength(6 * DEFAULT_PYRAMID.tiers);
    expect(new Set(memberships.map(([clubId]) => clubId)).size).toBe(memberships.length);
    for (const [clubId, divisionId] of memberships) {
      expect(divisionOf(state, clubId)?.id).toBe(divisionId);
    }
  });

  it('founds the districts beside the county, never through it', () => {
    // The expansion on its own: no season played, no market turned, the rest of
    // the boundary's work done elsewhere. What it does to the county can then be
    // read with nothing else in the world moving — and what a played career
    // relies on is exactly this, that a district is *appended* and every record
    // the county already held is the record it still holds, field for field:
    // clubs, towns, grounds, regions, people, committees, squads and the man in
    // each dugout.
    const { state } = markedCareer('owed-in-place');
    const context = {
      seasonId: state.season.id,
      seasonLabel: state.season.label,
      seasonStart: state.date,
      currentYear: 2026,
    };
    const before = {
      clubs: structuredClone(state.clubs),
      towns: structuredClone(state.world.towns),
      grounds: structuredClone(state.world.grounds),
      regions: structuredClone(state.world.regions),
      people: structuredClone(state.people),
      competitions: structuredClone(state.competitions),
      pyramidIds: [...state.pyramidIds],
      managers: Object.fromEntries(Object.entries(state.clubs).map(([id, club]) => [id, club.managerId])),
    };

    const founded = activateWorldExpansion(state, context);
    expect(founded.map((ladder) => ladder.pyramidId)).toHaveLength(ALDERFORDSHIRE_DISTRICTS.length - 1);

    for (const [clubId, club] of Object.entries(before.clubs)) expect(state.clubs[clubId], clubId).toEqual(club);
    for (const [townId, town] of Object.entries(before.towns)) {
      expect(state.world.towns[townId], townId).toEqual(town);
    }
    for (const [groundId, ground] of Object.entries(before.grounds)) {
      expect(state.world.grounds[groundId], groundId).toEqual(ground);
    }
    for (const [regionId, region] of Object.entries(before.regions)) {
      expect(state.world.regions[regionId], regionId).toEqual(region);
    }
    for (const [personId, person] of Object.entries(before.people)) {
      expect(state.people[personId], personId).toEqual(person);
    }
    for (const [competitionId, competition] of Object.entries(before.competitions)) {
      expect(state.competitions[competitionId], competitionId).toEqual(competition);
    }
    // The ladders the county had are its first, in its own order, and every
    // manager post is held by the same man.
    expect(state.pyramidIds.slice(0, before.pyramidIds.length)).toEqual(before.pyramidIds);
    for (const [clubId, managerId] of Object.entries(before.managers)) {
      expect(state.clubs[clubId]!.managerId, clubId).toBe(managerId);
    }
    // And the day itself is the county's: what the expansion adds is a region,
    // its settlements and its football, and not one fixture, result or record the
    // county has already played.
    expect(state.world.regionIds[0]).toBe(FOUNDING_REGION_ID);
    expect(state.world.regions[FOUNDING_REGION_ID]).toEqual(before.regions[FOUNDING_REGION_ID]);
    expect(Object.keys(state.world.towns).length).toBeGreaterThan(Object.keys(before.towns).length);
  });

  it('founds the same districts from the same career twice', () => {
    const first = markedCareer('owed-determinism');
    const second = markedCareer('owed-determinism');
    playAndRoll(first.state);
    playAndRoll(second.state);

    const foundedA = districtsFounded(first.state);
    const foundedB = districtsFounded(second.state);
    expect(foundedB.map((district) => district.id)).toEqual(foundedA.map((district) => district.id));
    expect(foundedB.map((district) => district.name)).toEqual(foundedA.map((district) => district.name));
    expect(foundedB.map((district) => district.regionId)).toEqual(foundedA.map((district) => district.regionId));
    expect(second.state.world.regions).toEqual(first.state.world.regions);

    // The same towns, the same grounds, the same clubs with the same men in
    // them: every district is drawn from the career's own seed, so the same
    // career gets the same five districts every time.
    expect(second.state.world.townIds).toEqual(first.state.world.townIds);
    expect(second.state.world.groundIds).toEqual(first.state.world.groundIds);
    for (const [index, district] of foundedA.entries()) {
      const clubsA = pyramidClubIds(first.state, district.id);
      const clubsB = pyramidClubIds(second.state, foundedB[index]!.id);
      expect(clubsB).toEqual(clubsA);
      for (const clubId of clubsA) {
        expect(second.state.clubs[clubId]!.identity).toEqual(first.state.clubs[clubId]!.identity);
        expect(second.state.clubs[clubId]!.squadIds).toEqual(first.state.clubs[clubId]!.squadIds);
        expect(second.state.clubs[clubId]!.reputation).toBe(first.state.clubs[clubId]!.reputation);
      }
    }
  });

  it('gives the expanded county thirteen competitions and one clean calendar', () => {
    const { state } = markedCareer('owed-calendar');
    playAndRoll(state);
    const districts = districtsFounded(state);

    // Thirteen competitions: each ladder's own League Cup and Plate, and the
    // county cup drawn from all six ladders and owned by none of them.
    const ladderCups = districts.flatMap((district) => [
      cupCompetitionId(district.id, 'cup'),
      cupCompetitionId(district.id, 'plate'),
    ]);
    expect(cupCompetitions(state).map((cup) => cup.id).sort()).toEqual(
      [LEAGUE_CUP_ID, PLATE_ID, COUNTY_CUP_ID, ...ladderCups].sort(),
    );
    expect(pyramidOf(state, 'league').cupIds).toEqual([LEAGUE_CUP_ID, PLATE_ID]);
    const countyCup = state.competitions[COUNTY_CUP_ID]!;
    expect(cupFieldOf(countyCup.cup)).toEqual({ kind: 'county' });
    expect(pyramidIdOf(state, countyCup)).toBeNull();
    expect(countyCup.clubIds).toHaveLength(6 * DEFAULT_PYRAMID.tiers * DEFAULT_PYRAMID.clubsPerTier);
    expect(new Set(countyCup.clubIds)).toEqual(new Set(countyClubIds(state)));
    for (const district of districts) {
      expect(pyramidOf(state, district.id).cupIds).toEqual([
        cupCompetitionId(district.id, 'cup'),
        cupCompetitionId(district.id, 'plate'),
      ]);
      // A district's cups are its own clubs and nobody else's, so two ladders'
      // rounds could share an afternoon even when the county cup cannot.
      for (const kind of ['cup', 'plate'] as const) {
        const cup = state.competitions[cupCompetitionId(district.id, kind)]!;
        expect(cupFieldOf(cup.cup)).toEqual({ kind: 'pyramid', pyramidId: district.id });
        for (const clubId of cup.clubIds) expect(pyramidClubIds(state, district.id)).toContain(clubId);
      }
    }
    expect(cupFieldOf(state.competitions[LEAGUE_CUP_ID]!.cup)).toEqual({
      kind: 'pyramid',
      pyramidId: 'league',
    });

    // Every calendar entry is a real Sunday; the entries are in date order; every
    // matchday is numbered once, and the season ends on the last afternoon on the
    // calendar. Two rounds may share a Sunday — that is what the lanes are for —
    // but no two entries may claim the same matchday number.
    const dates = state.season.calendar.map((entry) => entry.date);
    expect(dates).toEqual([...dates].sort());
    for (const date of dates) expect(toDate(date).getUTCDay(), date).toBe(0);
    expect(state.season.endDate).toBe(dates[dates.length - 1]!);
    expect(state.season.calendar.map((entry) => entry.matchday).sort((a, b) => a - b)).toEqual(
      state.season.calendar.map((_, index) => index + 1),
    );

    // No club is asked to play twice on one afternoon, and every competitive
    // fixture is dated by the season's own calendar. (Pre-season friendlies are
    // dated by their own, before it begins.)
    const onADate = new Map<string, string[]>();
    for (const match of Object.values(state.matches)) {
      const competition = state.competitions[match.competitionId];
      if (competition && !dates.includes(match.date)) {
        throw new Error(`${match.id} is dated ${match.date}, which is not on the calendar.`);
      }
      if (!isActiveFixture(match)) continue;
      onADate.set(match.date, [...(onADate.get(match.date) ?? []), match.homeClubId, match.awayClubId]);
    }
    for (const [date, clubs] of onADate) expect(new Set(clubs).size, date).toBe(clubs.length);

    // Every cup tie knows the round it was drawn for, and every league fixture is
    // a league Sunday.
    for (const match of Object.values(state.matches)) {
      const competition = state.competitions[match.competitionId];
      if (!competition) continue;
      if (competition.kind === 'cup') expect(match.cupRound, match.id).toBeGreaterThanOrEqual(1);
      if (competition.kind === 'league') expect(isLeagueMatchday(state, match.matchday), match.id).toBe(true);
    }
  });

  it('plays its first whole-county season and rolls over again without growing a seventh ladder', () => {
    const { state } = markedCareer('owed-second-boundary');
    settleLeague(state);
    finishSeason(state);
    startNextSeason(state);

    const founded = districtsFounded(state);
    const firstSeason = state.season.id;
    const towns = Object.keys(state.world.towns).length;
    const playerCount = Object.keys(state.people).length;
    const clubCounts = founded.map((district) => pyramidClubIds(state, district.id).length);
    expect(state.worldExpansion).toEqual({ pending: false, expandedInSeasonId: firstSeason });

    // Its first season is played out, and the boundary settles each ladder
    // against its own tables — all five districts' included.
    settleLeague(state);
    finishSeason(state);
    const movements = state.promotionHistory.filter((movement) => movement.seasonId === firstSeason);
    for (const district of founded) {
      expect(movements.some((movement) => movement.competitionId === `comp_${district.id}_t2`)).toBe(true);
    }
    expect(movements.some((movement) => movement.competitionId.startsWith('comp_league_'))).toBe(true);

    startNextSeason(state);

    // Still exactly six ladders, six regions and the same five districts:
    // nothing was founded a second time, and no settlement or club was added to
    // the map.
    expect(state.pyramidIds).toHaveLength(6);
    expect(state.world.regionIds).toEqual(ALDERFORDSHIRE_DISTRICTS.map((district) => district.regionId));
    expect(Object.keys(state.world.regions)).toHaveLength(6);
    expect(Object.keys(state.pyramids)).toHaveLength(6);
    expect(Object.keys(state.world.towns)).toHaveLength(towns);
    expect(Object.keys(state.clubs)).toHaveLength(6 * DEFAULT_PYRAMID.tiers * DEFAULT_PYRAMID.clubsPerTier);
    expect(expansionPending(state)).toBe(false);
    expect(state.worldExpansion?.expandedInSeasonId).toBe(firstSeason);
    // The summer ages squads and retires men, so the people in the world change;
    // what cannot change is that no district gained a club it did not have.
    expect(Object.keys(state.people).length).toBeGreaterThan(0);
    expect(playerCount).toBeGreaterThan(0);
    for (const [index, district] of founded.entries()) {
      expect(pyramidClubIds(state, district.id)).toHaveLength(clubCounts[index]!);
    }

    // Every ladder is rebuilt full, and the county cup was drawn again for the
    // new season rather than left as last year's competition.
    expect(leagueCompetitions(state)).toHaveLength(6 * DEFAULT_PYRAMID.tiers);
    for (const division of leagueCompetitions(state)) {
      expect(division.clubIds, division.id).toHaveLength(DEFAULT_PYRAMID.clubsPerTier);
      expect(division.seasonId).toBe(state.season.id);
    }
    expect(cupCompetitions(state)).toHaveLength(13);
    expect(state.competitions[COUNTY_CUP_ID]!.seasonId).toBe(state.season.id);
  });

  it('founds the county’s own districts, whether they are founded all at once or one boundary at a time', () => {
    // The districts are data, and this is what says so: the five a played career
    // is given at its boundary are the county's own five districts — the same
    // regions, in the same order, under the same names, standing in the same
    // places, with the same shape of football in each — because both worlds read
    // them from the county's own list rather than from a special case for the
    // ladder next door.
    //
    // The one thing a district has that cannot be shared between two careers is
    // its *id*, and it is not supposed to be: an id is the valley the career's
    // own stream drew (`foundDistrictPyramid`), and a county founded with a
    // district beside it drew one valley while a county founded with all six drew
    // another. So the ids are held to what they must be — a district's own, and
    // nobody else's — and everything the district *is* is compared.
    const { state } = markedCareer('owed-definitions');
    playAndRoll(state);
    const fresh = createTestGame('owed-definitions', 0, 2026, 6);

    const expanded = districtsFounded(state);
    const fromBirth = districtsFounded(fresh.state);
    expect(fromBirth).toHaveLength(ALDERFORDSHIRE_DISTRICTS.length - 1);
    expect(expanded).toHaveLength(fromBirth.length);

    for (const [index, district] of expanded.entries()) {
      const mine = fromBirth[index]!;
      const authored = ALDERFORDSHIRE_DISTRICTS[index + 1]!;
      // The authored district: the map's key for it, the map's name, the level of
      // football the map gives it and the shape of football it is authored with.
      // Its region is named from the same authored name in both worlds, and its
      // ladder wears it (`<region> Sunday League` — see the naming helpers).
      const region = state.world.regions[district.regionId]!;
      expect(district.regionId).toBe(authored.regionId);
      expect(district.regionId).toBe(mine.regionId);
      expect(region.name).toBe(authored.name);
      expect(district.name).toBe(`${authored.name} Sunday League`);
      expect(district.name).toBe(mine.name);
      expect(district.level).toBe(authored.level);
      expect(district.level).toBe(mine.level);
      expect(district.config).toEqual(mine.config);
      // And the region is the district's own, in the county, where the map puts
      // it: two worlds agree about the place even when their ladders are drawn
      // under different valleys.
      const here = state.world.regions[district.regionId]!;
      const there = fresh.state.world.regions[mine.regionId]!;
      expect(here.name).toBe(there.name);
      expect(here.countyId).toBe(FOUNDING_COUNTY_ID);
      // Where the district stands: every district the map has *added* stands
      // where the map draws it, and a district founded at a boundary stands there
      // too. The two the county has always had are the other way round — the world
      // draws their ground for them, from the career's own stream — so which
      // corner of the map they end up in is each career's own draw, and only the
      // map's districts are compared.
      if (!authored.legacy) expect(here.centre).toEqual(there.centre);
      // Three divisions of twelve, in both worlds, ranked the same way up.
      expect(divisionsOf(state, district.id).map((division) => division.clubIds.length)).toEqual([
        DEFAULT_PYRAMID.clubsPerTier,
        DEFAULT_PYRAMID.clubsPerTier,
        DEFAULT_PYRAMID.clubsPerTier,
      ]);
      // Every club in the district plays in a town of the district's own region,
      // and every one of those towns is the county's: what a district is given at
      // a boundary is a district, not a set of clubs bolted onto the county.
      const regionTowns = new Set(
        Object.values(state.world.towns)
          .filter((town) => town.regionId === district.regionId)
          .map((town) => town.id),
      );
      expect(regionTowns.size).toBeGreaterThanOrEqual(5);
      for (const clubId of pyramidClubIds(state, district.id)) {
        const club = state.clubs[clubId]!;
        expect(regionTowns.has(club.townId), `${clubId} plays outside ${district.name}`).toBe(true);
        expect(state.world.grounds[club.groundId]!.townId).toBe(club.townId);
      }
    }

    // The two worlds hold the same six districts, in the map's own order, and no
    // district is founded twice or left out.
    expect(state.world.regionIds).toEqual(fresh.state.world.regionIds);
    expect(expanded.map((district) => district.regionId)).toEqual(
      fromBirth.map((district) => district.regionId),
    );
    expect(new Set(expanded.map((district) => district.id)).size).toBe(expanded.length);
    for (const district of expanded) expect(state.pyramids[district.id]).toBe(district);
  });
});
