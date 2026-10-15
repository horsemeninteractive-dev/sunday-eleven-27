import { describe, expect, it } from 'vitest';
import {
  cupFieldOf,
  FOUNDING_PYRAMID_ID,
  FRIENDLY_COMPETITION_ID,
  storedCupField,
  type CupState,
  type Pyramid,
} from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { ClubId, CompetitionId, MatchId, PyramidId } from '@/domain/ids';
import { FOUNDING_COUNTY_ID } from '@/domain/world';
import type { Match } from '@/domain/match';
import {
  cupCompetitionId,
  divisionsOf,
  LEAGUE_CUP_ID,
  leagueCompetitions,
  PLATE_ID,
  pyramidIdOf,
  pyramidsOf,
  regionNameFor,
} from './pyramid';
import { buildSeasonStructure, fieldClubs, type SeasonCupRequest } from './seasonStructure';
import { createTestGame } from './testSupport';

/**
 * A world of two ladders, and the season built for both at once.
 *
 * One call used to build one pyramid and replace the world's competition,
 * fixture, match and calendar records doing it, so a second ladder's season
 * erased the first's. The proof that it no longer does is a world with two
 * pyramids in it.
 *
 * A career founded with two ladders now has the real thing, district, region and
 * all — see `worldExpansion.test.ts`, which plays the county the world generator
 * actually builds. This file keeps its own second ladder instead, because it is
 * about the *builder*: two ladders the world generator did not make, cut from the
 * county's own clubs, so that a build is held against a world it cannot have been
 * shaped by.
 *
 * The two ladders are cut from the county's own clubs: six divisions of six, each
 * pyramid keeping three tiers of its own, every entrant a real club with a town,
 * a squad and a ground, and no club in two divisions. Regions and towns are not
 * reassigned here, so the Vale's clubs still live in the founding region's towns
 * — which is exactly why cup eligibility has to be read from a field rather than
 * inferred from geography.
 */
const VALE: PyramidId = 'vale';
const COUNTY_CUP: CompetitionId = 'comp_county_cup';
const INVITATION_CUP: CompetitionId = 'comp_champions_cup';
const OPENING_SUNDAY = '2026-09-06';

interface TwoPyramids {
  state: GameState;
  /** The founding ladder's divisions, tier 1 first. */
  founding: ClubId[][];
  /** The Vale's divisions, tier 1 first. */
  vale: ClubId[][];
}

function twoPyramidWorld(seed = 'world-build'): TwoPyramids {
  const { state } = createTestGame(seed);
  const clubs = divisionsOf(state).flatMap((division) => [...division.clubIds]);
  const founding = [clubs.slice(0, 6), clubs.slice(6, 12), clubs.slice(12, 18)];
  const vale = [clubs.slice(18, 24), clubs.slice(24, 30), clubs.slice(30, 36)];

  const pyramid: Pyramid = {
    id: VALE,
    name: 'Vale District League',
    regionId: 'region_vale',
    level: 2,
    config: { ...state.pyramids[FOUNDING_PYRAMID_ID]!.config, clubsPerTier: 6 },
    competitionIds: [],
    cupIds: [],
  };
  state.world.regionIds.push(pyramid.regionId);
  // A hand-built second ladder, not a second county: the Vale is a region of the
  // founding county, and its clubs are the county's own clubs cut a second way.
  // That is exactly the case a county cup has to include both ladders of.
  state.world.regions[pyramid.regionId] = {
    id: pyramid.regionId,
    name: 'Vale',
    centre: { x: 12, y: 12 },
    countyId: FOUNDING_COUNTY_ID,
  };
  state.pyramids[VALE] = pyramid;
  state.pyramidIds.push(VALE);
  return { state, founding, vale };
}

/**
 * The match ids the season build owns.
 *
 * The pre-season friendlies are arranged by the game, not by the season build —
 * they are football without a competition — so a build compared against the game
 * it replaced has none of them, and comparing the two means setting them aside.
 */
function builtMatchIds(order: readonly MatchId[], matches: Record<MatchId, Match>): MatchId[] {
  return order.filter((id) => matches[id]?.competitionId !== FRIENDLY_COMPETITION_ID);
}

/**
 * Build one season for both ladders.
 *
 * `dateCupRounds` is off by default, which builds the world's *competitions* —
 * every ladder's divisions, every cup's field and ownership, and one set of
 * fixtures and matches across the lot — without asking the calendar to date the
 * cup rounds. Turned on, the rounds are dated too, which is the other half of it:
 * two ladders' cups are laid out in lanes and share their Sundays.
 */
function buildWorld(world: TwoPyramids, cups: SeasonCupRequest[] = [], dateCupRounds = false) {
  const { state, founding, vale } = world;
  return buildSeasonStructure({
    state,
    seasonId: state.season.id,
    seasonLabel: state.season.label,
    firstLeagueDate: OPENING_SUNDAY,
    pyramids: [
      { pyramidId: FOUNDING_PYRAMID_ID, regionName: regionNameFor(state, FOUNDING_PYRAMID_ID), divisions: founding },
      { pyramidId: VALE, regionName: regionNameFor(state, VALE), divisions: vale },
    ],
    cups,
    dateCupRounds,
  });
}

describe('a cup that says nothing about its field', () => {
  it('is the founding pyramid’s own, and is stored that way', () => {
    const { state } = createTestGame('legacy-field');
    const legacy: CupState = { round: 1, winnerClubId: null, runnerUpClubId: null, complete: false };

    // Every cup written before fields existed reads as the founding ladder's, and
    // so does a cup with no record at all.
    expect(cupFieldOf(legacy)).toEqual({ kind: 'pyramid', pyramidId: FOUNDING_PYRAMID_ID });
    expect(cupFieldOf(undefined)).toEqual({ kind: 'pyramid', pyramidId: FOUNDING_PYRAMID_ID });

    // Read as a field, that is the founding ladder's clubs — the world's own
    // divisions, because this build is not the one writing them.
    const founding = divisionsOf(state, FOUNDING_PYRAMID_ID).flatMap((division) => [...division.clubIds]);
    expect(new Set(fieldClubs(state, cupFieldOf(legacy)))).toEqual(new Set(founding));

    // Written: the founding pyramid's own is left unsaid, so a save keeps the
    // shape it has always had. Everything else has to be said, because silence
    // would mean the wrong ladder.
    expect(storedCupField({ kind: 'pyramid', pyramidId: FOUNDING_PYRAMID_ID })).toBeUndefined();
    expect(storedCupField({ kind: 'county' })).toEqual({ kind: 'county' });
    expect(storedCupField({ kind: 'pyramid', pyramidId: VALE })).toEqual({ kind: 'pyramid', pyramidId: VALE });
  });
});

describe('the founding world, rebuilt from its own record', () => {
  it('builds the same season it was built with', () => {
    // One ladder: the county as it was before the district next door existed,
    // and the season the game builds for it when there is nothing else to build.
    const { state } = createTestGame('founding-rebuild', 0, 2026, 1);
    const before = {
      calendar: state.season.calendar.map((entry) => ({ ...entry })),
      order: builtMatchIds(state.matchOrder, state.matches),
      cup: structuredClone(state.competitions[LEAGUE_CUP_ID]!.cup),
      entrants: [...state.competitions[LEAGUE_CUP_ID]!.clubIds],
      names: divisionsOf(state).map((competition) => competition.name),
    };
    // 396 league fixtures and the main cup's opening four ties, plus the three
    // pre-season friendlies the build does not own.
    expect(before.order).toHaveLength(400);
    expect(Object.keys(state.matches)).toHaveLength(403);

    // The season the game generated, built again from the divisions it wrote: one
    // ladder, passed as a ladder rather than as a flat list of divisions.
    buildSeasonStructure({
      state,
      seasonId: state.season.id,
      seasonLabel: state.season.label,
      firstLeagueDate: state.season.calendar[0]!.date,
      pyramids: [
        {
          pyramidId: FOUNDING_PYRAMID_ID,
          regionName: regionNameFor(state, FOUNDING_PYRAMID_ID),
          divisions: divisionsOf(state).map((competition) => [...competition.clubIds]),
        },
      ],
    });

    // The same dates, the same fixtures in the same order, and the same cup:
    // entrants, plan, round numbering and first draw all unchanged.
    expect(state.season.calendar).toEqual(before.calendar);
    // As a set rather than a sequence: the game re-sorts its own order by date
    // once the friendlies are in (`arrangePreSeason`), so the build's order — by
    // competition — is the same fixtures, listed the way the build lists them.
    expect([...builtMatchIds(state.matchOrder, state.matches)].sort()).toEqual([...before.order].sort());
    expect(state.matchOrder).toHaveLength(400);
    expect(state.competitions[LEAGUE_CUP_ID]!.cup).toEqual(before.cup);
    // The same entrants, though not necessarily seeded in the same order: the
    // seed order is ranked by the world's live divisions (`seedOrder`), and this
    // build ran in a world that already held last season's. The field is the
    // ladder either way, and the draw itself is a bag.
    expect(new Set(state.competitions[LEAGUE_CUP_ID]!.clubIds)).toEqual(new Set(before.entrants));
    expect(before.entrants).toHaveLength(36);
    expect(divisionsOf(state).map((competition) => competition.name)).toEqual(before.names);

    // Its divisions are named after its own region, and its cup carries no field,
    // because an absent one already means the founding pyramid.
    const region = regionNameFor(state, FOUNDING_PYRAMID_ID);
    expect(region).toBe(state.world.regionName);
    expect(divisionsOf(state).map((competition) => competition.name)).toEqual([
      `${region} Sunday League Division One`,
      `${region} Sunday League Division Two`,
      `${region} Sunday League Division Three`,
    ]);
    expect(state.competitions[LEAGUE_CUP_ID]!.cup!.field).toBeUndefined();
  });
});

describe('two ladders built in one call', () => {
  it('keeps each ladder’s divisions, ids and ownership to itself', () => {
    const world = twoPyramidWorld();
    const { state } = world;
    buildWorld(world);

    // Six divisions, and each ladder still has its own three tiers: a flat list
    // would have been cut into one six-tier ladder.
    expect(leagueCompetitions(state)).toHaveLength(6);
    expect(divisionsOf(state, FOUNDING_PYRAMID_ID).map((competition) => competition.tier)).toEqual([1, 2, 3]);
    expect(divisionsOf(state, VALE).map((competition) => competition.tier)).toEqual([1, 2, 3]);

    // The founding pyramid's ids are exactly what they always were.
    expect(state.pyramids[FOUNDING_PYRAMID_ID]!.competitionIds).toEqual([
      'comp_league_t1',
      'comp_league_t2',
      'comp_league_t3',
    ]);
    expect(state.pyramids[VALE]!.competitionIds).toEqual(['comp_vale_t1', 'comp_vale_t2', 'comp_vale_t3']);
    expect(state.pyramids[FOUNDING_PYRAMID_ID]!.cupIds).toEqual([LEAGUE_CUP_ID, PLATE_ID]);
    expect(state.pyramids[VALE]!.cupIds).toEqual([cupCompetitionId(VALE, 'cup'), cupCompetitionId(VALE, 'plate')]);

    // Each ladder's divisions are named after its own region.
    expect(divisionsOf(state, VALE).map((competition) => competition.name)).toEqual([
      'Vale Sunday League Division One',
      'Vale Sunday League Division Two',
      'Vale Sunday League Division Three',
    ]);

    // No club is in two divisions, and neither ladder holds a club of the other.
    const foundingClubs = new Set(world.founding.flat());
    for (const clubId of world.vale.flat()) expect(foundingClubs.has(clubId)).toBe(false);
    for (const clubId of [...foundingClubs, ...world.vale.flat()]) {
      expect(leagueCompetitions(state).filter((competition) => competition.clubIds.includes(clubId))).toHaveLength(1);
    }

    // One set of fixtures and one match order, not one per ladder: six divisions
    // of six, each playing its home and away season across ten matchdays.
    expect(state.matchOrder).toHaveLength(180);
    expect(state.matchOrder).toHaveLength(Object.keys(state.matches).length);
    expect(state.matchOrder.every((id) => state.matches[id]!.date !== undefined)).toBe(true);
  });

  it('gives each ladder’s cup the clubs of that ladder and no others', () => {
    const world = twoPyramidWorld('pyramid-fields');
    const { state } = world;
    buildWorld(world);

    const foundingCup = state.competitions[LEAGUE_CUP_ID]!;
    const valeCup = state.competitions[cupCompetitionId(VALE, 'cup')]!;

    expect(new Set(foundingCup.clubIds)).toEqual(new Set(world.founding.flat()));
    expect(new Set(valeCup.clubIds)).toEqual(new Set(world.vale.flat()));
    // Eighteen each, no club twice, and nothing from the other ladder.
    expect(foundingCup.clubIds).toHaveLength(18);
    expect(valeCup.clubIds).toHaveLength(18);
    expect(new Set(foundingCup.clubIds).size).toBe(foundingCup.clubIds.length);
    expect(foundingCup.clubIds.filter((clubId) => world.vale.flat().includes(clubId))).toEqual([]);

    // The cup says where its field is: the Vale's in writing, the founding
    // pyramid's by saying nothing.
    expect(valeCup.cup!.field).toEqual({ kind: 'pyramid', pyramidId: VALE });
    expect(foundingCup.cup!.field).toBeUndefined();
    expect(cupFieldOf(foundingCup.cup)).toEqual({ kind: 'pyramid', pyramidId: FOUNDING_PYRAMID_ID });

    // And ownership follows the ladder, not the shape of the id.
    expect(pyramidIdOf(state, foundingCup)).toBe(FOUNDING_PYRAMID_ID);
    expect(pyramidIdOf(state, valeCup)).toBe(VALE);
  });

  it('dates two ladders’ cups on one set of Sundays, since their fields are disjoint', () => {
    const world = twoPyramidWorld('two-lanes');
    // Twenty-two cup rounds want a Sunday each and the season's league calendar
    // has about ten to give. Both ladders' rounds are dated anyway, because they
    // are not competing for the same afternoons: the two fields have no club in
    // common, so a round of one can be played on the same Sunday as a round of the
    // other — which is what Stage 3's lanes are for, and what makes a second
    // ladder's cups possible at all.
    const structure = buildWorld(world, [], true);
    const { state } = world;
    const roundsOf = (competitionId: CompetitionId) => state.competitions[competitionId]!.cup!.plan!.length;
    // Every round of both ladders' cups was asked for and every one of them was
    // given a Sunday — nothing was dropped to make the two large ladders fit.
    expect(structure.cupSlots).toHaveLength(
      roundsOf(LEAGUE_CUP_ID) +
        roundsOf(PLATE_ID) +
        roundsOf(cupCompetitionId(VALE, 'cup')) +
        roundsOf(cupCompetitionId(VALE, 'plate')),
    );
    expect(structure.cupSlots.every((slot) => slot.date !== null)).toBe(true);

    const datesOf = (competitionId: CompetitionId) =>
      Object.values(state.matches)
        .filter((match) => match.competitionId === competitionId)
        .map((match) => match.date)
        .sort();
    const founding = datesOf(LEAGUE_CUP_ID);
    const vale = datesOf(cupCompetitionId(VALE, 'cup'));
    expect(founding.length).toBeGreaterThan(0);
    expect(vale.length).toBeGreaterThan(0);
    expect(vale).toEqual(founding);
  });
});

describe('a county cup', () => {
  it('enters every active club in the county, from both ladders', () => {
    const world = twoPyramidWorld('county-cup');
    const { state } = world;
    // One club of the Vale's bottom division has folded.
    const folded = world.vale[2]![5]!;
    state.clubs[folded]!.active = false;
    const active = Object.values(state.clubs)
      .filter((club) => club.active)
      .map((club) => club.id);

    buildWorld(world, [{ id: COUNTY_CUP, name: 'County Cup', field: { kind: 'county' } }]);
    const county = state.competitions[COUNTY_CUP]!;

    expect(new Set(county.clubIds)).toEqual(new Set(active));
    expect(county.clubIds).not.toContain(folded);
    expect(county.clubIds.some((clubId) => world.founding.flat().includes(clubId))).toBe(true);
    expect(county.clubIds.some((clubId) => world.vale.flat().includes(clubId))).toBe(true);
    // Its field is the whole county, and its plan is sized by that field rather
    // than by the founding ladder's thirty-six.
    expect(county.cup!.field).toEqual({ kind: 'county' });
    expect(county.cup!.plan![0]!.field).toBe(county.clubIds.length);

    // It belongs to no ladder, and entering clubs in it changed no ladder's
    // membership.
    expect(pyramidIdOf(state, county)).toBeNull();
    for (const pyramid of pyramidsOf(state)) expect(pyramid.cupIds).not.toContain(COUNTY_CUP);
    expect(divisionsOf(state, FOUNDING_PYRAMID_ID).map((competition) => [...competition.clubIds])).toEqual(
      world.founding,
    );
    expect(divisionsOf(state, VALE).map((competition) => [...competition.clubIds])).toEqual(world.vale);
  });

  it('selects the same clubs from the same world', () => {
    const first = twoPyramidWorld('county-cup-repeat');
    const second = twoPyramidWorld('county-cup-repeat');
    const folded = first.vale[2]![5]!;
    first.state.clubs[folded]!.active = false;
    second.state.clubs[folded]!.active = false;

    buildWorld(first, [{ id: COUNTY_CUP, name: 'County Cup', field: { kind: 'county' } }]);
    buildWorld(second, [{ id: COUNTY_CUP, name: 'County Cup', field: { kind: 'county' } }]);

    expect(second.state.competitions[COUNTY_CUP]!.clubIds).toEqual(first.state.competitions[COUNTY_CUP]!.clubIds);
  });
});

describe('a cup by invitation', () => {
  it('enters the clubs it names, in the order it names them, and nobody else', () => {
    const world = twoPyramidWorld('invitation-cup');
    const { state } = world;
    const named = world.founding[0]![1]!;
    const alsoNamed = world.vale[0]![0]!;
    const folded = world.founding[1]![0]!;
    const unknown = 'club_nowhere' as ClubId;
    state.clubs[folded]!.active = false;

    buildWorld(world, [
      {
        id: INVITATION_CUP,
        name: 'Champions Cup',
        field: { kind: 'invitation', clubIds: [named, alsoNamed, named, unknown, folded] },
      },
    ]);

    // The field itself: the declared order, each club once, and only clubs the
    // world can actually enter.
    expect(fieldClubs(state, { kind: 'invitation', clubIds: [named, alsoNamed, named, unknown, folded] })).toEqual([
      named,
      alsoNamed,
    ]);
    // Nothing from either ladder is added to it, and no club that folded.
    const cup = state.competitions[INVITATION_CUP]!;
    expect(new Set(cup.clubIds)).toEqual(new Set([named, alsoNamed]));
    expect(cup.clubIds).not.toContain(world.founding[0]![0]!);
    expect(cup.clubIds).not.toContain(folded);
    expect(cup.cup!.field).toEqual({
      kind: 'invitation',
      clubIds: [named, alsoNamed, named, unknown, folded],
    });
  });
});
