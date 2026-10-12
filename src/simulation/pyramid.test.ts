import { describe, expect, it } from 'vitest';
import { DEFAULT_PYRAMID, FOUNDING_PYRAMID_ID, type Competition, type Pyramid } from '@/domain/competition';
import type { GameState } from '@/domain/game';
import type { CompetitionId } from '@/domain/ids';
import {
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
  tierOf,
} from './pyramid';
import { createTestGame } from './testSupport';

/**
 * The founding pyramid, and one that is not.
 *
 * Every career starts with exactly one ladder, so the interesting questions —
 * can a lookup walk into the wrong one? — cannot be asked of a real world. They
 * are asked of a state built here instead: the world the game actually generates,
 * with a second ladder standing beside the founding one with the same tier
 * numbers. Nothing about the game's own football changes; the second pyramid
 * exists to be *not* selected.
 */
function foundingGame(seed = 'one-pyramid') {
  return createTestGame(seed);
}

const VALE_T1 = 'comp_vale_t1';
const VALE_T2 = 'comp_vale_t2';

/** Put a second ladder in the world, with a division at each of two tiers. */
function withSecondPyramid(state: GameState): GameState {
  const founding = state.pyramids[FOUNDING_PYRAMID_ID]!;
  const vale: Pyramid = {
    id: 'vale',
    name: 'Vale District League',
    regionId: 'region_vale',
    level: 2,
    config: { ...founding.config },
    competitionIds: [VALE_T1, VALE_T2],
    cupIds: [cupCompetitionId('vale', 'cup')],
  };
  state.world.regionIds.push(vale.regionId);
  state.world.regions[vale.regionId] = { id: vale.regionId, name: 'Vale', centre: { x: 12, y: 12 } };
  state.pyramids[vale.id] = vale;
  state.pyramidIds.push(vale.id);

  const division = (id: CompetitionId, tier: number): Competition => ({
    id,
    name: `Vale District Division ${tier}`,
    kind: 'league',
    tier,
    seasonId: state.season.id,
    clubIds: [`club_vale_t${tier}`],
  });
  state.competitions[VALE_T1] = division(VALE_T1, 1);
  state.competitions[VALE_T2] = division(VALE_T2, 2);
  return state;
}

describe('the one pyramid a career begins with', () => {
  it('owns the whole ladder, and its towns are all in the one region', () => {
    const state = foundingGame().state;

    expect(Object.values(state.world.regions)).toHaveLength(1);
    const regionId = state.world.regionIds[0]!;
    for (const town of Object.values(state.world.towns)) expect(town.regionId).toBe(regionId);

    expect(state.pyramidIds).toEqual([FOUNDING_PYRAMID_ID]);
    const pyramid = state.pyramids[FOUNDING_PYRAMID_ID]!;
    expect(pyramid.id).toBe(FOUNDING_PYRAMID_ID);
    expect(pyramid.regionId).toBe(regionId);
    expect(pyramid.level).toBe(1);
    expect(pyramid.config).toEqual(DEFAULT_PYRAMID);
    expect(pyramid.name).toBe(`${state.world.regionName} Sunday League`);
    expect(pyramidsOf(state)).toHaveLength(1);
    expect(pyramidOf(state)).toBe(pyramid);

    // Three divisions, tier 1 first, all of them the pyramid's own.
    expect(pyramid.competitionIds).toEqual(['comp_league_t1', 'comp_league_t2', 'comp_league_t3']);
    expect(divisionsOf(state).map((competition) => competition.id)).toEqual(pyramid.competitionIds);
    expect(divisionsOf(state).map((competition) => competition.tier)).toEqual([1, 2, 3]);
    expect(pyramid.cupIds).toEqual([LEAGUE_CUP_ID, PLATE_ID]);

    for (const competition of [...divisionsOf(state), ...pyramid.cupIds.map((id) => state.competitions[id]!)]) {
      expect(pyramidForCompetition(state, competition)?.id).toBe(FOUNDING_PYRAMID_ID);
      expect(pyramidIdOf(state, competition)).toBe(FOUNDING_PYRAMID_ID);
    }
    // And every club that plays is in exactly one division of it.
    for (const club of Object.values(state.clubs)) {
      if (!club.active) continue;
      const memberships = leagueCompetitions(state).filter((competition) =>
        competition.clubIds.includes(club.id),
      );
      expect(memberships).toHaveLength(1);
      expect(divisionOf(state, club.id)!.id).toBe(memberships[0]!.id);
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

describe('two pyramids', () => {
  it('never steps into the other ladder at the same tier', () => {
    const state = withSecondPyramid(foundingGame('two-pyramids').state);
    const founded = state.competitions;
    const [top, second, bottom] = divisionsOf(state, FOUNDING_PYRAMID_ID) as [Competition, Competition, Competition];

    // The founding pyramid's own steps stay on the founding pyramid even though
    // the Vale has a division at the tier next door.
    expect(divisionAbove(state, second)?.id).toBe('comp_league_t1');
    expect(divisionBelow(state, top)?.id).toBe('comp_league_t2');
    expect(divisionAbove(state, second)?.id).not.toBe(VALE_T1);
    expect(divisionBelow(state, top)?.id).not.toBe(VALE_T2);
    // And the bottom of the founding ladder does not fall into the other one.
    expect(divisionBelow(state, bottom)).toBeUndefined();
    expect(divisionAbove(state, top)).toBeUndefined();

    // The Vale's steps are its own, at its own level.
    expect(divisionAbove(state, founded[VALE_T2]!)?.id).toBe(VALE_T1);
    expect(divisionAbove(state, founded[VALE_T1]!)).toBeUndefined();
    expect(divisionBelow(state, founded[VALE_T1]!)?.id).toBe(VALE_T2);

    // Ownership, not the shape of an id, is what says whose a division is.
    expect(pyramidIdOf(state, founded[VALE_T1]!)).toBe('vale');
    expect(pyramidForCompetition(state, founded['comp_league_t1']!)?.id).toBe(FOUNDING_PYRAMID_ID);
    expect(divisionsOf(state, 'vale').map((competition) => competition.id)).toEqual([VALE_T1, VALE_T2]);
    expect(leagueCompetitions(state)).toHaveLength(5);
    // A pyramid nobody has heard of owns nothing rather than something wrong.
    expect(divisionsOf(state, 'nowhere')).toEqual([]);
  });

  it('separates a rung of a ladder from a level of football', () => {
    const state = withSecondPyramid(foundingGame('two-levels').state);
    const founded = state.competitions;

    // Tier is the rung; level is where that rung sits in the county. Both
    // pyramids start at tier 1, and the Vale's is a level below.
    expect(tierOf(state, 'club_vale_t1')).toBe(1);
    expect(levelOf(state, 'club_vale_t1')).toBe(2);
    expect(tierOf(state, 'club_vale_t2')).toBe(2);
    expect(levelOf(state, 'club_vale_t2')).toBe(3);

    const founding = divisionsOf(state, FOUNDING_PYRAMID_ID);
    const clubOf = (competition: Competition) => competition.clubIds[0]!;
    expect(tierOf(state, clubOf(founding[0]!))).toBe(1);
    expect(levelOf(state, clubOf(founding[0]!))).toBe(1);
    expect(levelOf(state, clubOf(founding[2]!))).toBe(3);
    expect(levelOf(state, 'club_nowhere')).toBeNull();
    expect(levelOf(state, clubOf(founded[VALE_T1]!))).toBe(2);
  });
});

describe('a career with no pyramid record', () => {
  it('reads the founding ladder out of the world it already has', () => {
    const state = foundingGame('no-record').state;
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
});
