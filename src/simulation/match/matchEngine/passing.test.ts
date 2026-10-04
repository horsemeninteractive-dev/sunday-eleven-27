import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import type { Mentality, PassingStyle } from '@/domain/tactics';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { nextMatchday } from '@/simulation/timeline';
import { Rng } from '../../rng';
import { buildContext } from '../core';
import { cloneMatch } from '../testHelpers';
import { createMatchEngine } from './engine';
import { evaluatePassTargets, passRiskAppetite, type DecisionWorld } from './decisions';
import type { MatchEngineState, PlayerMatchState } from './types';

/**
 * The deepening of on-ball intelligence: *who* a passer looks for.
 *
 * The same football situation — a man on the ball with a forward option and a
 * safe one — must come out differently for a different passer, a different set
 * of instructions and a different match context. These tests pin exactly that,
 * without a hidden percentage anywhere: they read the ranking the model actually
 * produces and show it moving with the man, the tactics and the scoreline.
 *
 * A scripted generator makes the comparison arithmetic rather than lucky: it
 * always returns the middle of the range, so the model's own noise contributes
 * nothing and the difference under test is the only difference.
 */

class MiddleRng extends Rng {
  constructor() {
    super(1);
  }
  override next(): number {
    return 0.5;
  }
}

function userMatch(state: GameState): Match {
  const matchday = nextMatchday(state);
  const fixture = Object.values(state.matches).find(
    (candidate) =>
      candidate.matchday === matchday &&
      (candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId),
  );
  if (!fixture) throw new Error('no fixture');
  prepareMatchday(state, fixture.matchday);
  return cloneMatch(state.matches[fixture.id]!);
}

function worldFor(match: Match, env: ReturnType<typeof matchEnvironment>): DecisionWorld {
  return { match, env, context: buildContext(match, env) };
}

function homeOutfielders(es: MatchEngineState): PlayerMatchState[] {
  return es.players.filter((player) => player.side === 'home' && player.position !== 'GK');
}

/** Park everyone who is not part of the scenario out of range of the ball. */
function clearPitch(es: MatchEngineState): void {
  for (const player of es.players) {
    if (player.position === 'GK') continue;
    if (player.side === 'home') {
      player.x = 0;
      player.y = 0;
    } else {
      player.x = 1;
      player.y = 1;
    }
  }
}

function setTactics(match: Match, mentality: Mentality, passingStyle: PassingStyle = 'mixed'): void {
  match.lineups.home.tactics.mentality = mentality;
  match.lineups.home.tactics.passingStyle = passingStyle;
}

function setAttributes(state: GameState, playerId: string, patch: Record<string, number>): void {
  const person = state.people[playerId]!;
  if (person.kind !== 'player') throw new Error('not a player');
  for (const [key, value] of Object.entries(patch)) {
    const [group, attribute] = key.split('.') as ['technical' | 'mental' | 'physical', string];
    (person.attributes[group] as unknown as Record<string, number>)[attribute] = value;
  }
}

/** Score of one named teammate in a ranking. */
function scoreOf(scores: ReturnType<typeof evaluatePassTargets>, mate: PlayerMatchState): number {
  return scores.find((entry) => entry.mate.playerId === mate.playerId)!.score;
}

function bestOf(scores: ReturnType<typeof evaluatePassTargets>): PlayerMatchState {
  return scores.reduce((best, entry) => (entry.score > best.score ? entry : best)).mate;
}

/**
 * A back-three scenario: a passer, a forward option and a backward one, with
 * every other player parked out of the model's range. Openness and the passing
 * lane are equal by construction, so the only terms that differ are the ones
 * under test.
 */
function scenario(seed: string) {
  const { state } = createTestGame(seed);
  const match = userMatch(state);
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  const engine = createMatchEngine(match, env);
  const es = engine.getState();

  const [passer, forward, back] = homeOutfielders(es) as [PlayerMatchState, PlayerMatchState, PlayerMatchState];
  clearPitch(es);
  passer.x = 0.5;
  passer.y = 0.5;
  forward.x = 0.9;
  forward.y = 0.5;
  back.x = 0.34;
  back.y = 0.5;
  es.ball.x = 0.5;
  es.ball.y = 0.5;
  es.ball.status = 'controlled';
  es.ball.ownerId = passer.playerId;

  return { state, match, env, es, passer, forward, back };
}

describe('pass target selection', () => {
  it('is deterministic for the same state and the same draws', () => {
    const { match, env, es, passer } = scenario('passing-determinism');
    const world = worldFor(match, env);
    const a = evaluatePassTargets(es, world, passer, new MiddleRng(), 'pass');
    const b = evaluatePassTargets(es, world, passer, new MiddleRng(), 'pass');
    expect(a.map((entry) => [entry.mate.playerId, entry.score])).toEqual(
      b.map((entry) => [entry.mate.playerId, entry.score]),
    );
    // And it derives only from what is on the pitch: no side effects on state.
    expect(es.ball.ownerId).toBe(passer.playerId);
  });

  it('sends the same ball forward for an attacking side and safely for a defensive one', () => {
    const { match, env, es, passer, forward, back } = scenario('passing-tactics');

    setTactics(match, 'balanced');
    const balanced = evaluatePassTargets(es, worldFor(match, env), passer, new MiddleRng(), 'pass');

    setTactics(match, 'very-attacking', 'direct');
    const attacking = evaluatePassTargets(es, worldFor(match, env), passer, new MiddleRng(), 'pass');

    const marginBalanced = scoreOf(balanced, forward) - scoreOf(balanced, back);
    const marginAttacking = scoreOf(attacking, forward) - scoreOf(attacking, back);

    // The forward ball is worth materially more to the attacking side, and the
    // safe ball no more — the *choice* moved, not an outcome.
    expect(marginAttacking).toBeGreaterThan(marginBalanced + 0.1);
  });

  it('reads risk appetite from tactics and the scoreline, not from a roll', () => {
    const { match, env } = scenario('passing-risk');
    const world = worldFor(match, env);

    setTactics(match, 'very-defensive', 'short');
    const defensive = passRiskAppetite(world, 'home', 0, 0);
    setTactics(match, 'very-attacking', 'direct');
    const attacking = passRiskAppetite(world, 'home', 0, 0);
    expect(attacking).toBeGreaterThan(defensive);

    // Chasing a game late pushes the ball forward; protecting a lead late does not.
    setTactics(match, 'balanced');
    const chasing = passRiskAppetite(world, 'home', 80, -1);
    const protecting = passRiskAppetite(world, 'home', 80, 1);
    expect(chasing).toBeGreaterThan(passRiskAppetite(world, 'home', 0, 0));
    expect(protecting).toBeLessThan(passRiskAppetite(world, 'home', 0, 0));
  });

  it('lets a bigger passer see and play the longer ball', () => {
    const { state, match, env, es, passer, forward, back } = scenario('passing-vision');
    setTactics(match, 'balanced');
    const world = worldFor(match, env);

    setAttributes(state, passer.playerId, {
      'technical.passing': 4,
      'mental.decisions': 4,
      'mental.composure': 4,
    });
    const limited = evaluatePassTargets(es, world, passer, new MiddleRng(), 'pass');

    setAttributes(state, passer.playerId, {
      'technical.passing': 20,
      'mental.decisions': 20,
      'mental.composure': 20,
    });
    const ballplayer = evaluatePassTargets(es, world, passer, new MiddleRng(), 'pass');

    const limitedMargin = scoreOf(limited, forward) - scoreOf(limited, back);
    const ballplayerMargin = scoreOf(ballplayer, forward) - scoreOf(ballplayer, back);
    // Distance puts the limited passer off the longer forward ball; the
    // ball-player is willing to make it.
    expect(ballplayerMargin).toBeGreaterThan(limitedMargin);
  });

  // A man already high up the pitch turns the ball back less readily than a man
  // building from the back: a square or backward ball on the edge of the box lets
  // the defence set, which is how a striker ends up passing to his partner
  // instead of having a go. The forward option is worth the same in both cases;
  // the *backward* one is worth less to the advanced passer.
  it('makes an advanced passer less willing to turn the ball backwards', () => {
    const { match, env, es, passer, forward, back } = scenario('passing-advanced-backward');
    setTactics(match, 'balanced');
    const world = worldFor(match, env);
    // Park the away keeper in a corner: otherwise he marks the forward option and
    // the comparison measures his positioning rather than the backward penalty.
    for (const player of es.players) {
      if (player.position === 'GK') player.x = player.side === 'away' ? 1 : 0;
      if (player.position === 'GK') player.y = player.side === 'away' ? 0.02 : 0.98;
    }

    // Advanced: ball and passer on the edge of the final third, a forward option
    // ahead and a square/backward one behind, both level in openness and lane.
    es.ball.x = 0.8;
    passer.x = 0.8;
    forward.x = 0.9;
    back.x = 0.7;
    const advanced = evaluatePassTargets(es, world, passer, new MiddleRng(), 'pass');

    // Deep: the identical arrangement, halfway inside his own half.
    es.ball.x = 0.3;
    passer.x = 0.3;
    forward.x = 0.4;
    back.x = 0.2;
    const deep = evaluatePassTargets(es, world, passer, new MiddleRng(), 'pass');

    const advancedMargin = scoreOf(advanced, forward) - scoreOf(advanced, back);
    const deepMargin = scoreOf(deep, forward) - scoreOf(deep, back);
    expect(advancedMargin).toBeGreaterThan(deepMargin + 0.3);
  });

  it('looks for a man who can keep it when he is being closed down', () => {
    const { state, match, env, es, passer } = scenario('passing-pressure');

    const [left, right] = homeOutfielders(es).filter(
      (player) => player.playerId !== passer.playerId,
    ) as [PlayerMatchState, PlayerMatchState];
    // Two symmetric options, level with the ball, so openness and lane are equal.
    left.x = 0.5;
    left.y = 0.3;
    right.x = 0.5;
    right.y = 0.7;
    // An opponent right on the ball: real pressure.
    const marker = es.players.find((player) => player.side === 'away' && player.position !== 'GK')!;
    marker.x = 0.52;
    marker.y = 0.5;

    setAttributes(state, left.playerId, { 'technical.ballControl': 20 });
    setAttributes(state, right.playerId, { 'technical.ballControl': 4 });

    const scores = evaluatePassTargets(es, worldFor(match, env), passer, new MiddleRng(), 'pass');
    expect(bestOf(scores).playerId).toBe(left.playerId);
  });
});
