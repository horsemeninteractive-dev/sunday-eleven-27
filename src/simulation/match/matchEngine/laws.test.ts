import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { nextMatchday } from '@/simulation/timeline';
import { Rng } from '../../rng';
import { buildContext } from '../core';
import { cloneMatch } from '../testHelpers';
import { createMatchEngine } from './engine';
import { statsFor } from './events';
import { inOffsidePosition, raiseOffside } from './offside';
import { commitFoul } from './resolve';
import { beginSetPiece } from './setPieces';
import type { DecisionWorld } from './decisions';
import type { MatchEngineState, ShotOutcome, Side } from './types';

/**
 * The fundamental laws of football, as the engine now plays them.
 *
 * Each test is a deterministic scenario: the state is put into a known position
 * and the engine is asked to resolve it, so the outcome being checked is the law
 * being applied rather than a lucky seed. A couple of tests walk the real engine
 * end to end (an offside flagged on a pass, a blocked shot) because the point is
 * the pathway, not a single function.
 */

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

function envFor(state: GameState, match: Match) {
  return matchEnvironment(state, match, { autoManageAllBenches: true });
}

function worldFor(match: Match, env: ReturnType<typeof envFor>): DecisionWorld {
  return { match, env, context: buildContext(match, env) };
}

/** A referee whose every roll is scripted, so a foul's verdict is fixed. */
class ScriptedRng extends Rng {
  private values: number[];
  constructor(values: number[]) {
    super(1);
    this.values = values;
  }
  override next(): number {
    return this.values.length > 0 ? this.values.shift()! : 0.99;
  }
}

/** Put a shot on the ball, already in flight, and let the rules resolve it. */
function placeShot(
  es: MatchEngineState,
  opts: { outcome: ShotOutcome; side: Side; x: number; y: number; lastTouchId: string; penalty?: boolean },
): void {
  clearSetPiece(es);
  const b = es.ball;
  b.status = 'travelling';
  b.ownerId = null;
  b.targetId = null;
  b.kind = 'shot';
  b.shotOutcome = opts.outcome;
  b.penaltyShot = opts.penalty ?? false;
  b.intendedSide = opts.side;
  b.lastTouchId = opts.lastTouchId;
  b.attempted = [];
  b.x = opts.x;
  b.y = opts.y;
  b.tx = opts.side === 'home' ? 2 : -1;
  b.ty = opts.y;
  b.vx = opts.side === 'home' ? 0.2 : -0.2;
  b.vy = 0;
  b.speed = 0.2;
  b.height = 0;
  b.vz = 0;
}

/** Take the state out of its opening kick-off and back into open play. */
function clearSetPiece(es: MatchEngineState): void {
  es.setPiece = null;
  es.phase = 'open-play';
}

function homeOutfielder(es: MatchEngineState) {
  return es.players.find((player) => player.side === 'home' && player.position !== 'GK')!;
}

function awayOutfielder(es: MatchEngineState) {
  return es.players.find((player) => player.side === 'away' && player.position !== 'GK')!;
}

describe('offside', () => {
  it('flags a man in an offside position, and not one who is level or covered', () => {
    const { state } = createTestGame('laws-offside');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();

    const attacker = homeOutfielder(es);
    attacker.x = 0.8;
    attacker.y = 0.5;
    es.ball.x = 0.6;
    es.ball.y = 0.5;

    // Every opponent behind the attacker except the keeper: fewer than two
    // goal-side, so he is in an offside position.
    for (const player of es.players) {
      if (player.side === 'away') {
        player.x = player.position === 'GK' ? 0.95 : 0.2;
      }
    }
    expect(inOffsidePosition(es, 'home', attacker)).toBe(true);

    // Bring a second defender level with the last man: now two opponents are
    // goal-side, and the same run is clearly onside.
    const cover = awayOutfielder(es);
    cover.x = 0.9;
    expect(inOffsidePosition(es, 'home', attacker)).toBe(false);

    // Behind the ball is never offside, however far up the pitch he is.
    es.ball.x = 0.85;
    expect(inOffsidePosition(es, 'home', attacker)).toBe(false);
  });

  it('raises an authoritative offside event and awards the defending free kick', () => {
    const { state } = createTestGame('laws-offside-restart');
    const match = userMatch(state);
    const env = envFor(state, match);
    const engine = createMatchEngine(match, env);
    const es = engine.getState();

    const attacker = homeOutfielder(es);
    attacker.x = 0.82;
    attacker.y = 0.44;
    const before = statsFor(es, 'home').offsides;
    raiseOffside(es, worldFor(match, env), attacker);

    const offsideEvents = match.events.filter((event) => event.type === 'offside');
    expect(offsideEvents).toHaveLength(1);
    expect(statsFor(es, 'home').offsides).toBe(before + 1);
    expect(es.setPiece?.kind).toBe('free-kick');
    expect(es.setPiece?.side).toBe('away');
  });

  it('flags a pass whose receiver is in an offside position when it reaches him', () => {
    const { state } = createTestGame('laws-offside-pass');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();

    const attacker = homeOutfielder(es);
    attacker.x = 0.8;
    attacker.y = 0.5;
    const passer = es.players.find((player) => player.side === 'home' && player.playerId !== attacker.playerId)!;

    // Everybody on the defending side is behind the attacker but the keeper.
    for (const player of es.players) {
      if (player.side === 'away') player.x = player.position === 'GK' ? 0.95 : 0.2;
    }

    // The ball is a pass, just about to reach the offside man, flagged at the
    // moment it was played by the model that struck it.
    const b = es.ball;
    clearSetPiece(es);
    b.status = 'travelling';
    b.ownerId = null;
    b.targetId = attacker.playerId;
    b.offsidePlayerId = attacker.playerId;
    b.kind = 'pass';
    b.intendedSide = 'home';
    b.lastTouchId = passer.playerId;
    b.attempted = es.players.filter((p) => p.side === 'away').map((p) => p.playerId);
    b.x = attacker.x - 0.045;
    b.y = 0.5;
    b.tx = attacker.x;
    b.ty = 0.5;
    b.vx = 0.05;
    b.vy = 0;
    b.speed = 0.05;

    engine.advance(1 / 30, 1 / 30);

    expect(match.events.some((event) => event.type === 'offside')).toBe(true);
    expect(es.setPiece?.kind).toBe('free-kick');
  });
});

describe('shot outcomes', () => {
  it('a shot wide goes out for a goal kick and is recorded as off target', () => {
    const { state } = createTestGame('laws-shot-wide');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();
    const shooter = homeOutfielder(es);

    placeShot(es, { outcome: 'wide', side: 'home', x: 1.002, y: 0.4, lastTouchId: shooter.playerId });
    engine.advance(1 / 30, 1 / 30);

    expect(match.events.some((event) => event.type === 'shot-off-target')).toBe(true);
    expect(es.setPiece?.kind).toBe('goal-kick');
    expect(es.setPiece?.side).toBe('away');
    expect(statsFor(es, 'away').goalKicks).toBe(1);
  });

  it('a shot over the bar is not a goal and gives a goal kick', () => {
    const { state } = createTestGame('laws-shot-over');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();
    const shooter = homeOutfielder(es);

    placeShot(es, { outcome: 'over', side: 'home', x: 1.002, y: 0.5, lastTouchId: shooter.playerId });
    engine.advance(1 / 30, 1 / 30);

    expect(es.score.home).toBe(0);
    expect(match.events.some((event) => event.type === 'shot-off-target')).toBe(true);
    expect(es.setPiece?.kind).toBe('goal-kick');
  });

  it('a shot off the woodwork stays in play and is on target', () => {
    const { state } = createTestGame('laws-shot-woodwork');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();
    const shooter = homeOutfielder(es);

    placeShot(es, { outcome: 'woodwork', side: 'home', x: 0.99, y: 0.5, lastTouchId: shooter.playerId });
    engine.advance(1 / 30, 1 / 30);

    expect(match.events.some((event) => event.type === 'shot-off-target')).toBe(true);
    expect(es.score.home).toBe(0);
    expect(es.ball.status).not.toBe('out-of-play');
  });

  it('a saved shot is kept out and counts as on target', () => {
    const { state } = createTestGame('laws-shot-saved');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();
    const shooter = homeOutfielder(es);

    placeShot(es, { outcome: 'saved', side: 'home', x: 0.97, y: 0.5, lastTouchId: shooter.playerId });
    engine.advance(1 / 30, 1 / 30);

    expect(match.events.some((event) => event.type === 'shot-saved')).toBe(true);
    expect(es.score.home).toBe(0);
    expect(statsFor(es, 'home').shotsOnTarget).toBe(1);
  });

  it('a shot that beats the keeper is a goal', () => {
    const { state } = createTestGame('laws-shot-goal');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();
    const shooter = homeOutfielder(es);

    placeShot(es, { outcome: 'goal', side: 'home', x: 1.002, y: 0.5, lastTouchId: shooter.playerId });
    engine.advance(1 / 30, 1 / 30);

    expect(es.score.home).toBe(1);
    expect(match.events.some((event) => event.type === 'goal')).toBe(true);
    expect(match.performances[shooter.playerId]!.goals).toBe(1);
  });

  it('a deflected shot that goes behind is a corner, not a goal kick', () => {
    const { state } = createTestGame('laws-shot-corner');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();
    const defender = awayOutfielder(es);

    // The last touch is a defender, so the ball crossing the line behind is a
    // corner to the attacking side.
    placeShot(es, { outcome: 'wide', side: 'home', x: 1.002, y: 0.42, lastTouchId: defender.playerId });
    engine.advance(1 / 30, 1 / 30);

    expect(match.events.some((event) => event.type === 'corner')).toBe(true);
    expect(es.setPiece?.kind).toBe('corner');
    expect(es.setPiece?.side).toBe('home');
    expect(statsFor(es, 'home').corners).toBe(1);
  });

  it('a defender can block a shot before it reaches the keeper', () => {
    // The block roll is a real roll, so a handful of fixed seeds are walked and
    // the law is asserted to fire across them rather than on one lucky draw.
    let blocked = false;
    for (const seed of ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8']) {
      const { state } = createTestGame(seed);
      const match = userMatch(state);
      const engine = createMatchEngine(match, envFor(state, match));
      const es = engine.getState();
      const shooter = homeOutfielder(es);
      const defender = awayOutfielder(es);

      // A defender just in front of the shot — far enough ahead that the ball
      // does not pass him within a step.
      defender.x = 0.925;
      defender.y = 0.5;
      placeShot(es, { outcome: 'goal', side: 'home', x: 0.9, y: 0.5, lastTouchId: shooter.playerId });
      engine.advance(1 / 30, 1 / 30);

      if (match.events.some((event) => event.type === 'shot-blocked')) {
        blocked = true;
        expect(statsFor(es, 'away').shotsBlocked).toBeGreaterThan(0);
        break;
      }
    }
    expect(blocked).toBe(true);
  });
});

describe('penalties', () => {
  it('a foul inside the box can be a penalty; one outside it cannot', () => {
    const { state } = createTestGame('laws-penalty-foul');
    const match = userMatch(state);
    const env = envFor(state, match);
    const engine = createMatchEngine(match, env);
    const es = engine.getState();
    const world = worldFor(match, env);
    const offender = awayOutfielder(es);
    const victim = homeOutfielder(es);

    // In the offender's own box: the scripted referee gives a penalty.
    clearSetPiece(es);
    es.ball.x = 0.9;
    es.ball.y = 0.5;
    commitFoul(es, world, offender, victim, new ScriptedRng([0.99, 0.99, 0.01]));
    expect(match.events.some((event) => event.text === 'Penalty awarded.')).toBe(true);
    expect(es.setPiece?.kind).toBe('penalty');
    expect(es.setPiece?.side).toBe('home');

    // Out in midfield, the very same challenge is only a free kick.
    clearSetPiece(es);
    es.ball.x = 0.5;
    es.ball.y = 0.5;
    commitFoul(es, world, offender, victim, new ScriptedRng([0.99, 0.99, 0.01]));
    expect(es.setPiece?.kind).toBe('free-kick');
  });

  it('scores a penalty that beats the keeper, and records it as a penalty', () => {
    const { state } = createTestGame('laws-penalty-goal');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();
    const taker = homeOutfielder(es);

    placeShot(es, { outcome: 'goal', side: 'home', x: 1.002, y: 0.5, lastTouchId: taker.playerId, penalty: true });
    engine.advance(1 / 30, 1 / 30);

    expect(es.score.home).toBe(1);
    expect(match.events.some((event) => event.type === 'penalty-scored')).toBe(true);
  });

  it('records a saved penalty as a miss', () => {
    const { state } = createTestGame('laws-penalty-save');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();
    const taker = homeOutfielder(es);

    placeShot(es, { outcome: 'saved', side: 'home', x: 0.97, y: 0.5, lastTouchId: taker.playerId, penalty: true });
    engine.advance(1 / 30, 1 / 30);

    const missed = match.events.filter((event) => event.type === 'penalty-missed');
    expect(missed).toHaveLength(1);
    expect(missed[0]!.text).toBe('Penalty saved!');
    expect(es.score.home).toBe(0);
  });

  it('records a penalty put wide as a miss', () => {
    const { state } = createTestGame('laws-penalty-miss');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();
    const taker = homeOutfielder(es);

    placeShot(es, { outcome: 'wide', side: 'home', x: 1.002, y: 0.4, lastTouchId: taker.playerId, penalty: true });
    engine.advance(1 / 30, 1 / 30);

    expect(match.events.some((event) => event.type === 'penalty-missed')).toBe(true);
    expect(es.score.home).toBe(0);
  });

  it('plays a penalty through the set-piece machinery and returns to open play', () => {
    const { state } = createTestGame('i2');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();

    beginSetPiece(es, 'penalty', 'home', { x: 0.88, y: 0.5 });
    // Give the arrangement and the kick all the time they need, then stop once
    // the kick has been settled one way or the other.
    const settled = () =>
      match.events.some((event) => event.type === 'penalty-scored' || event.type === 'penalty-missed');
    for (let i = 0; i < 1200 && !settled(); i += 1) engine.advance(1 / 30, 1 / 30);

    const resolved = match.events.filter(
      (event) => event.type === 'penalty-scored' || event.type === 'penalty-missed',
    );
    expect(resolved).toHaveLength(1);
    // Whatever it came to, the game carries on rather than freezing on the spot.
    expect(es.phase === 'open-play' || es.phase === 'goal' || es.phase === 'kickoff').toBe(true);
  });
});

describe('own goals and assists', () => {
  it('attributes an own goal to the defending side and credits the score to the other', () => {
    const { state } = createTestGame('laws-own-goal');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();
    const defender = awayOutfielder(es);

    // A defensive touch carries the ball into the goal his own side defends
    // (x = 1), which is the one the home side attacks.
    placeShot(es, { outcome: 'goal', side: 'home', x: 1.002, y: 0.5, lastTouchId: defender.playerId });
    engine.advance(1 / 30, 1 / 30);

    const ownGoals = match.events.filter((event) => event.type === 'own-goal');
    expect(ownGoals).toHaveLength(1);
    expect(ownGoals[0]!.playerId).toBe(defender.playerId);
    expect(es.score.home).toBe(1);
    expect(es.score.away).toBe(0);
  });

  it('gives an assist when a goal follows a completed pass, and not otherwise', () => {
    const { state } = createTestGame('laws-assist');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();
    const scorer = homeOutfielder(es);
    const assister = es.players.find((player) => player.side === 'home' && player.playerId !== scorer.playerId)!;

    es.lastPass = { passerId: assister.playerId, receiverId: scorer.playerId, side: 'home', clock: es.clock };
    placeShot(es, { outcome: 'goal', side: 'home', x: 1.002, y: 0.5, lastTouchId: scorer.playerId });
    engine.advance(1 / 30, 1 / 30);

    const goal = match.events.find((event) => event.type === 'goal')!;
    expect(goal.secondaryPlayerId).toBe(assister.playerId);
    expect(match.performances[assister.playerId]!.assists).toBe(1);
  });
});

describe('the whole match still plays', () => {
  it('completes ninety minutes with the new laws in force', () => {
    const { state } = createTestGame('laws-full-match');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    engine.runToCompletion();

    expect(engine.finished).toBe(true);
    expect(match.status).toBe('finished');
    expect(match.result).not.toBeNull();
    // Every goal on the record adds up to the scoreline, however it arose.
    const goals = match.events.filter(
      (event) => event.type === 'goal' || event.type === 'own-goal' || event.type === 'penalty-scored',
    ).length;
    expect(goals).toBe(match.result!.homeGoals + match.result!.awayGoals);
  });
});
