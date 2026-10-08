import { describe, expect, it } from 'vitest';
import type { Match } from '@/domain/match';
import type { Tactics } from '@/domain/tactics';
import { defaultTactics } from '@/domain/tactics';
import { isPlayer } from '@/domain/person';
import { createTestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { fixtureIdsOnMatchday } from '../pyramid';
import { nextMatchday } from '../timeline';
import { cloneMatch } from '../match/testHelpers';
import { buildContext, type MatchEnvironment } from '../match/core';
import { createMatchEngine, simulateMatchHeadless } from '../match/matchEngine';
import { autoManageBench } from '../match/matchEngine/management';
import { simulateMatchFast } from '../fastMatch/simulate';
import { autoPickLineup } from '../selection';
import { Rng } from '../rng';
import { mentalityIndex } from './manager';
import { roleCandidates } from './style';

/**
 * What the football intelligence layer *does*, rather than what it decides.
 *
 * The unit tests next door prove the manager makes the right call; these prove
 * the call reaches the pitch. Two claims are being checked, and both are the ones
 * the phase is judged on: an AI side that is winning late really does end up
 * playing differently from one that is level, and two sides with different
 * instructions really do produce different football — more chances, more of the
 * ball, a different man on the end of things — in *both* resolutions of the one
 * simulation, not merely in the settings screen.
 */

function fixtures(seed: string, count: number): Array<{ match: Match; env: MatchEnvironment }> {
  const { state } = createTestGame(seed);
  const matchday = nextMatchday(state);
  prepareMatchday(state, matchday);
  return fixtureIdsOnMatchday(state, matchday)
    .filter((id) => {
      const match = state.matches[id]!;
      return match.homeClubId !== state.userClubId && match.awayClubId !== state.userClubId;
    })
    .slice(0, count)
    .map((id) => {
      const match = state.matches[id]!;
      return { match, env: matchEnvironment(state, match, { autoManageAllBenches: true }) };
    });
}

/**
 * A full match with both sides' instructions set by hand.
 *
 * Everything else about the fixture — the men, the pitch, the referee — is the
 * same in both arms of a comparison, so any difference between them is the
 * instructions and nothing else.
 */
function playFull(match: Match, env: MatchEnvironment, home: Tactics, away: Tactics): Match {
  const clone = cloneMatch(match);
  clone.lineups.home.tactics = { ...home };
  clone.lineups.away.tactics = { ...away };
  simulateMatchHeadless(clone, env);
  return clone;
}

/** The same comparison, played through the abstract resolution. */
function playFast(match: Match, env: MatchEnvironment, home: Tactics, away: Tactics, seed: number): Match {
  const clone = cloneMatch(match);
  clone.lineups.home.tactics = { ...home };
  clone.lineups.away.tactics = { ...away };
  clone.seed = seed;
  simulateMatchFast(clone, env);
  return clone;
}

const BALANCED: Tactics = { ...defaultTactics('4-4-2') };
/** One instruction set, four decisions: everything a side does to win a game. */
const GOING_FOR_IT: Tactics = {
  ...defaultTactics('4-4-2'),
  mentality: 'very-attacking',
  tempo: 'high',
  pressing: 'high',
  defensiveLine: 'high',
};
/** And the mirror image: everything a side does to protect one. */
const SITTING_ON_IT: Tactics = {
  ...defaultTactics('4-4-2'),
  mentality: 'very-defensive',
  tempo: 'slow',
  pressing: 'low',
  defensiveLine: 'deep',
};

describe('an AI side plays differently because of the afternoon it is having', () => {
  const { state } = createTestGame('ai-reaction-wiring');
  const matchday = nextMatchday(state);
  prepareMatchday(state, matchday);
  const id = fixtureIdsOnMatchday(state, matchday).find((candidate) => {
    const match = state.matches[candidate]!;
    return match.homeClubId !== state.userClubId && match.awayClubId !== state.userClubId;
  })!;

  it('drops deeper and says so when it is two up with ten minutes left', () => {
    const prepared = cloneMatch(state.matches[id]!);
    const env = matchEnvironment(state, prepared, { autoManageAllBenches: true });
    prepared.lineups.home.tactics = { ...BALANCED };
    prepared.lineups.away.tactics = { ...BALANCED };
    const engine = createMatchEngine(prepared, env);
    const engineState = engine.getState();
    engineState.score.home = 2;
    prepared.minute = 80;

    autoManageBench(engineState, { match: prepared, env, context: buildContext(prepared, env) }, 'home', new Rng('bench-a'));

    expect(mentalityIndex(prepared.lineups.home.tactics.mentality)).toBeLessThan(mentalityIndex('balanced'));
    expect(prepared.lineups.home.tactics.defensiveLine).toBe('deep');
    // The change is in the record, because it is the reason what happens next
    // looks different: the commentary has to be able to say so.
    expect(prepared.events.some((event) => event.type === 'note' && event.clubId === prepared.homeClubId)).toBe(true);
    // And the side that is *not* in front has not been touched by it.
    expect(prepared.lineups.away.tactics.mentality).toBe('balanced');
  });

  it('rearranges itself when it is a man down', () => {
    const prepared = cloneMatch(state.matches[id]!);
    const env = matchEnvironment(state, prepared, { autoManageAllBenches: true });
    prepared.lineups.home.tactics = { ...BALANCED };
    const engine = createMatchEngine(prepared, env);
    const engineState = engine.getState();
    engineState.players.find((player) => player.side === 'home')!.sentOff = true;
    prepared.minute = 12;

    autoManageBench(engineState, { match: prepared, env, context: buildContext(prepared, env) }, 'home', new Rng('bench-b'));

    expect(prepared.lineups.home.tactics.defensiveLine).toBe('deep');
    expect(prepared.lineups.home.tactics.pressing).toBe('low');
    expect(mentalityIndex(prepared.lineups.home.tactics.mentality)).toBeLessThan(mentalityIndex('balanced'));
  });

  it('never rewrites the human manager\u2019s own instructions', () => {
    const userState = createTestGame('ai-reaction-user').state;
    const userMatchday = nextMatchday(userState);
    prepareMatchday(userState, userMatchday);
    const userMatch = Object.values(userState.matches).find(
      (candidate) => candidate.homeClubId === userState.userClubId || candidate.awayClubId === userState.userClubId,
    )!;
    const prepared = cloneMatch(userMatch);
    const env = matchEnvironment(userState, prepared, { autoManageAllBenches: true });
    const side = prepared.homeClubId === userState.userClubId ? 'home' : 'away';
    prepared.lineups[side].tactics = { ...BALANCED };
    const engine = createMatchEngine(prepared, env);
    const engineState = engine.getState();
    engineState.score[side] = 2;
    prepared.minute = 80;

    autoManageBench(engineState, { match: prepared, env, context: buildContext(prepared, env) }, side, new Rng('bench-c'));

    expect(prepared.lineups[side].tactics).toEqual(BALANCED);
  });
});

describe('two instruction sets produce two kinds of football', () => {
  it('makes going for it create more than sitting on it, in the abstract resolution', () => {
    const first = fixtures('ai-style-fast', 1)[0]!;
    let aggressive = 0;
    let cautious = 0;
    for (let seed = 1; seed <= 24; seed += 1) {
      aggressive += playFast(first.match, first.env, GOING_FOR_IT, BALANCED, seed).result!.homeShots;
      cautious += playFast(first.match, first.env, SITTING_ON_IT, BALANCED, seed).result!.homeShots;
    }
    expect(aggressive).toBeGreaterThan(cautious);
    expect(aggressive).toBeGreaterThan(cautious * 1.1);
  });

  it('keeps more of the ball with a side that passes it short', () => {
    const first = fixtures('ai-style-possession', 1)[0]!;
    const short: Tactics = { ...defaultTactics('4-4-2'), passingStyle: 'short' };
    const direct: Tactics = { ...defaultTactics('4-4-2'), passingStyle: 'direct' };
    let shortBall = 0;
    let directBall = 0;
    for (let seed = 1; seed <= 24; seed += 1) {
      shortBall += playFast(first.match, first.env, short, BALANCED, seed).result!.homePossession;
      directBall += playFast(first.match, first.env, direct, BALANCED, seed).result!.homePossession;
    }
    expect(shortBall).toBeGreaterThan(directBall);
  });

  it('lets a job decide who gets on the end of things', () => {
    const first = fixtures('ai-roles-fast', 1)[0]!;
    const strikerId = first.match.lineups.home.starting.find((slot) => slot.position === 'ST')!.playerId;

    const tally = (role: 'st-poacher' | 'st-target-man'): number => {
      let shots = 0;
      for (let seed = 1; seed <= 30; seed += 1) {
        const played = cloneMatch(first.match);
        played.seed = seed;
        played.lineups.home.starting.find((entry) => entry.position === 'ST')!.role = role;
        simulateMatchFast(played, first.env);
        shots += played.performances[strikerId]?.shots ?? 0;
      }
      return shots;
    };

    // The same man, the same eleven, the same instructions: only the job changes.
    expect(tally('st-poacher')).toBeGreaterThan(tally('st-target-man'));
  });

  it('moves the real engine, not only the abstraction', () => {
    let aggressive = 0;
    let cautious = 0;
    for (const { match, env } of fixtures('ai-style-full', 2)) {
      aggressive += playFull(match, env, GOING_FOR_IT, BALANCED).result!.homeShots;
      cautious += playFull(match, env, SITTING_ON_IT, BALANCED).result!.homeShots;
    }
    expect(aggressive).toBeGreaterThan(cautious);
  });

  it('counts the men it sends on, and never more than the law allows', () => {
    const first = fixtures('ai-subs-fast', 1)[0]!;
    let total = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const played = playFast(first.match, first.env, GOING_FOR_IT, SITTING_ON_IT, seed);
      total += played.substitutions.home + played.substitutions.away;
      expect(played.substitutions.home).toBeLessThanOrEqual(3);
      expect(played.substitutions.away).toBeLessThanOrEqual(3);
      // Every change is on the record, with a man each way: nobody vanishes off
      // the pitch and nobody appears on it out of nothing.
      const changes = played.events.filter((event) => event.type === 'substitution');
      expect(changes.length).toBe(played.substitutions.home + played.substitutions.away);
      for (const change of changes) {
        expect(change.playerId).toBeTruthy();
        expect(change.secondaryPlayerId).toBeTruthy();
      }
    }
    expect(total).toBeGreaterThan(0);
  });
});

describe('the same men, picked for different systems', () => {
  it('sends out a side whose jobs match the instructions it was given', () => {
    const { state } = createTestGame('ai-lineup-identity');
    const club = state.clubs[state.userClubId]!;
    club.tactics = { ...defaultTactics('4-4-2'), passingStyle: 'direct', attackingFocus: 'wide', mentality: 'defensive' };
    const squad = club.squadIds.map((id) => state.people[id]).filter(isPlayer);
    const selection = autoPickLineup(squad, club.tactics.formation, { tactics: club.tactics });
    for (const slot of selection.starting) {
      expect(roleCandidates(slot.position, club.tactics)).toContain(slot.role);
    }
  });
});
