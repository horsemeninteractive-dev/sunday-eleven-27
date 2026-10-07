import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_RADIUS,
  RESTING_SPEED,
  SIMULATION_STEP_SECONDS,
  advanceMovement,
  simulationAlpha,
  type MovementState,
} from './state';

/**
 * The rules that move a footballer, and the reading a renderer interpolates with.
 *
 * Both are pure, and both are shared with the engine: `MatchEngine` walks every
 * man on the pitch through `advanceMovement`, one fixed step at a time, and hands
 * a renderer `simulationAlpha` so it can draw between those steps without ever
 * running football of its own. Neither can decide anything — there is no ball, no
 * player and no random stream in this file — which is the property these tests
 * pin: the same mover, mark and `dt` always produce the same answer, a man never
 * travels further in a step than his legs allow, and a man who has arrived stays
 * arrived.
 */

const STEP = SIMULATION_STEP_SECONDS;
/** An ordinary outfield pace: 0.036 of the pitch a second, which is a run. */
const SPEED = 0.036;

function mover(patch: Partial<MovementState> = {}): MovementState {
  return { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, speed: SPEED, vx: 0, vy: 0, ...patch };
}

describe('simulation time', () => {
  it('reads the fraction of the next step the simulation has reached', () => {
    expect(simulationAlpha({ stepSeconds: STEP, residual: STEP / 2 })).toBeCloseTo(0.5, 10);
    expect(simulationAlpha({ stepSeconds: STEP, residual: 0 })).toBe(0);
    expect(simulationAlpha({ stepSeconds: STEP, residual: STEP })).toBe(1);
    // A state that has not declared its step falls back to the fixed one rather
    // than dividing by zero, and a residual outside the step is clamped.
    expect(simulationAlpha({ stepSeconds: 0, residual: STEP / 2 })).toBeCloseTo(0.5, 10);
    expect(simulationAlpha({ stepSeconds: STEP, residual: -1 })).toBe(0);
    expect(simulationAlpha({ stepSeconds: STEP, residual: STEP * 3 })).toBe(1);
  });

  it('gives the same fraction however finely the frame is drawn', () => {
    // Ten small frames and one big one are the same slice of football: the clock
    // is the simulation's, so what the renderer interpolates with cannot depend
    // on how often it happens to draw.
    const fine = { stepSeconds: STEP, residual: 0 };
    const coarse = { stepSeconds: STEP, residual: 0 };
    for (let frame = 0; frame < 10; frame += 1) fine.residual += STEP / 10;
    coarse.residual += STEP;
    expect(simulationAlpha(fine)).toBeCloseTo(simulationAlpha(coarse), 6);
  });
});

describe('moving a player', () => {
  it('sets off from a standstill rather than teleporting', () => {
    const man = mover({ tx: 0.9 });
    advanceMovement(man, STEP);
    const moved = man.x - 0.5;
    expect(moved).toBeGreaterThan(0);
    // One step is one step: he has not crossed the pitch in a frame.
    expect(moved).toBeLessThan(man.speed * STEP);
  });

  it('never exceeds his top speed, however long he runs', () => {
    const man = mover({ tx: 0.98 });
    for (let step = 0; step < 600; step += 1) {
      advanceMovement(man, STEP);
      expect(Math.sqrt(man.vx * man.vx + man.vy * man.vy)).toBeLessThanOrEqual(man.speed + 1e-9);
    }
  });

  it('arrives, stands on his mark, and comes to rest', () => {
    const man = mover({ tx: 0.62 });
    for (let step = 0; step < 400; step += 1) advanceMovement(man, STEP);
    expect(man.x).toBeCloseTo(0.62, 9);
    expect(man.y).toBeCloseTo(0.5, 9);
    // Arriving is an event, not an asymptote: he is not still creeping.
    expect(Math.abs(man.vx)).toBeLessThanOrEqual(RESTING_SPEED);
  });

  it('is a fixed point while his mark has not moved', () => {
    const man = mover({ x: 0.37, y: 0.61, tx: 0.37, ty: 0.61, vx: 0.01, vy: -0.01 });
    for (let step = 0; step < 120; step += 1) advanceMovement(man, STEP);
    expect(man.x).toBe(0.37);
    expect(man.y).toBe(0.61);
    expect(man.vx).toBe(0);
    expect(man.vy).toBe(0);
  });

  it('does not vibrate when his mark barely moves', () => {
    // Once a man has settled, his mark is a function of where the ball is and
    // drifts by a hair every step. He does travel the last few inches onto it —
    // slowly, because the arrival ramp scales his pace with the ground left — but
    // what must never happen is the picture vibrating: reversing direction every
    // frame or two over a man who has not gone anywhere.
    const man = mover({ tx: 0.5 });
    advanceMovement(man, STEP);
    expect(man.x).toBe(0.5);

    man.tx = 0.5 + 0.004;
    let previous = man.x;
    let reversals = 0;
    for (let step = 0; step < 400; step += 1) {
      advanceMovement(man, STEP);
      if (man.x < previous - 1e-12) reversals += 1;
      previous = man.x;
    }
    expect(reversals).toBe(0);
    expect(man.x).toBeGreaterThanOrEqual(0.5);
    expect(man.x).toBeLessThanOrEqual(man.tx);
  });

  it('does set off when his mark actually goes somewhere', () => {
    const man = mover({ tx: 0.5 });
    advanceMovement(man, STEP);
    man.tx = 0.6;
    for (let step = 0; step < 60; step += 1) advanceMovement(man, STEP);
    expect(man.x).toBeGreaterThan(0.5);
  });

  it('slows into his mark instead of running through it', () => {
    // Just inside the arrival radius, a man at full pace is already being held
    // back: the ramp scales his speed with the ground left, so he eases onto the
    // mark rather than overshooting it and turning round.
    const man = mover({ x: 0.5, tx: 0.5 + ARRIVAL_RADIUS * 0.08, vx: SPEED });
    advanceMovement(man, STEP);
    expect(man.vx).toBeLessThan(SPEED);
  });

  it('takes the last of his stride and stands on the mark', () => {
    // A mark within one stride is taken rather than walked towards: the ramp
    // alone would leave him sliding at an inch out for several seconds.
    const man = mover({ x: 0.5, tx: 0.509, speed: 0.3 });
    advanceMovement(man, STEP);
    expect(man.x).toBe(man.tx);
  });

  it('stands still for as long as he has been told to', () => {
    const man = mover({ x: 0.3, tx: 0.9, vx: 0.01, restUntil: 10 });
    for (let clock = 0; clock < 10; clock += STEP) advanceMovement(man, STEP, clock);
    expect(man.x).toBe(0.3);
    expect(man.vx).toBe(0);
    // And then the pause ends, because it always does.
    advanceMovement(man, STEP, 10);
    expect(man.vx).toBeGreaterThan(0);
  });

  it('never walks off the pitch, however far away his mark is', () => {
    const man = mover({ tx: 1.5, ty: 1.5, speed: 0.1 });
    for (let step = 0; step < 200; step += 1) advanceMovement(man, STEP);
    expect(man.x).toBeLessThanOrEqual(0.98);
    expect(man.y).toBeLessThanOrEqual(0.97);
    expect(man.x).toBeGreaterThanOrEqual(0.02);
    expect(man.y).toBeGreaterThanOrEqual(0.03);
  });

  it('gives the same afternoon for the same mover', () => {
    const a = mover({ tx: 0.9 });
    const b = mover({ tx: 0.9 });
    for (let step = 0; step < 200; step += 1) {
      advanceMovement(a, STEP);
      advanceMovement(b, STEP);
    }
    expect(a).toEqual(b);
  });

  it('does nothing at all for a step of no time', () => {
    const man = mover({ tx: 0.9, vx: 0.02 });
    advanceMovement(man, 0);
    expect(man).toEqual(mover({ tx: 0.9, vx: 0.02 }));
  });
});
