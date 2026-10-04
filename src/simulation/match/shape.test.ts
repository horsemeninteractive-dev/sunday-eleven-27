/**
 * The shape model, and what it is supposed to buy.
 *
 * The old model was three line heights and a compactness number, which is not
 * enough to produce the three things a shape exists to produce: wide players who
 * stay wide, a back four that steps up as a unit, and a block that leans toward
 * the ball. One set of heights has to average over every position the ball can be
 * in, and an average is always in the wrong place — which is why there were no
 * wing dribbles into crosses, because the shape never actually put a winger on
 * the touchline in the final third.
 *
 * Almost every assertion here is written as a *comparison between two states of
 * the same side*. That is deliberate. A shape model can be made to pass an
 * absolute test while doing nothing at all — a team that always stands at 0.24
 * satisfies "the back line is at 0.24" perfectly — so the only claims worth making
 * are relative ones: the same side, the same instructions, the ball in two
 * different places.
 *
 * The last test is the one that keeps the model honest about what it is. The
 * shape is presentation *of intent*: it decides where players stand, and where
 * players stand changes what the possession model chooses to do. It must never
 * itself decide anything. A shape model that consumed a random number would make
 * every match unrepeatable and would quietly become a second simulation sitting
 * beside the first one.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match, MatchSpatial, PlayerSpatial } from '@/domain/match';
import type { MatchContext, Side } from './core';
import { linesFor, shapeFor } from './field';
import { shapePositionFor } from './spatial';
import { advanceMinute, beginMatch } from './engine';
import { buildContext } from './core';
import { advanceSpatial, ensureSpatial } from './spatial';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { createTestGame } from '../testSupport';

/** The browser's own spatial step: one thirtieth of a second of football. */
const STEP = 1 / 30;

/**
 * A side's shape under given tactics, at a given point in the match.
 *
 * The energy and urgency are pinned rather than sampled because these tests are
 * about the shape and not about the match: a tired side late on legitimately
 * holds a different shape, and letting that vary would make every comparison
 * below a comparison of two things at once.
 */
function shapeUnder(
  context: MatchContext,
  side: Side,
  tactics: Partial<MatchContext['home']['tactics']>,
  options: { inPossession: boolean; energy?: number; urgency?: number } = { inPossession: false },
) {
  return shapeFor(
    { ...context, [side]: { ...context[side], tactics: { ...context[side].tactics, ...tactics } } },
    side,
    { inPossession: options.inPossession, energy: options.energy ?? 100, urgency: options.urgency ?? 0 },
  );
}

/** The back line a side is holding with the ball at `x`, in its own frame. */
function backLineAt(shape: ReturnType<typeof shapeFor>, x: number, side: Side, inPossession: boolean): number {
  return linesFor(shape, { inPossession, progress: side === 'home' ? x : 1 - x }).back;
}

// --- Fixtures --------------------------------------------------------------

function fixture(seed: string): { state: GameState; base: Match; context: MatchContext } {
  const { state, draft } = createTestGame(seed);
  const home = state.clubs[draft.divisionClubIds[0]!]!;
  const away = state.clubs[draft.divisionClubIds[3]!]!;
  prepareMatchday(state, 1);
  const match = Object.values(state.matches).find((m) => m.homeClubId === home.id && m.awayClubId === away.id)!;
  prepareMatchday(state, match.matchday);
  const prepared = state.matches[match.id]!;
  return { state, base: prepared, context: buildContext(prepared, matchEnvironment(state, prepared)) };
}

/**
 * A synthetic outfield node.
 *
 * Built by hand rather than taken from a live match so that a test can vary one
 * thing — the role, the slot, the ball — and be certain nothing else moved with
 * it. A real match would drag eleven other players and the scoreline into every
 * comparison.
 */
function node(overrides: Partial<PlayerSpatial> & { position: PlayerSpatial['position']; side: Side }): PlayerSpatial {
  return {
    playerId: overrides.playerId ?? 'p1',
    baseX: overrides.baseX ?? 0.2,
    baseY: overrides.baseY ?? 0.86,
    x: overrides.baseX ?? 0.2,
    y: overrides.baseY ?? 0.86,
    px: overrides.baseX ?? 0.2,
    py: overrides.baseY ?? 0.86,
    tx: 0.5,
    ty: 0.5,
    speed: 0.25,
    vx: 0,
    vy: 0,
    action: 'shape',
    actionKind: null,
    actionStartedAt: null,
    actionEndsAt: null,
    possession: false,
    ...overrides,
  };
}

// --- The model -------------------------------------------------------------

describe('the shape model', () => {
  // The first claim, and the one the old model could not make at all. The same
  // side, the same instructions, the ball at the two ends of the pitch: the back
  // line should be a long way from where it was. It was not before, because one
  // set of line heights cannot be both deep and high.
  it('moves the block up and down with the ball', () => {
    const { context } = fixture('shape-lines');
    const shape = shapeUnder(context, 'home', {}, { inPossession: true });

    const deep = backLineAt(shape, 0.2, 'home', true);
    const high = backLineAt(shape, 0.8, 'home', true);

    expect(
      Math.abs(high - deep),
      `back line ${deep.toFixed(3)} -> ${high.toFixed(3)} as the ball goes x=0.2 -> x=0.8`,
    ).toBeGreaterThanOrEqual(0.15);
    // And in the right direction: a side with the ball in the opposition's half
    // steps up to meet it rather than hanging back.
    expect(high).toBeGreaterThan(deep);
  });

  // The difference between having the ball and not having it, at the same place on
  // the pitch. A side that has just lost it in its own third is at its deepest
  // and most defensive of the whole match, and the model has to be able to say so.
  it('drops a side that does not have the ball', () => {
    const { context } = fixture('shape-defending');
    const shape = shapeUnder(context, 'home', {}, { inPossession: false });

    for (const x of [0.2, 0.5, 0.8]) {
      const defending = backLineAt(shape, x, 'home', false);
      const attacking = backLineAt(shape, x, 'home', true);
      expect(
        attacking - defending,
        `at x=${x}: in possession ${attacking.toFixed(3)} vs defending ${defending.toFixed(3)}`,
      ).toBeGreaterThanOrEqual(0.08);
    }
  });

  // Orientation reads the instructions in two separate ways and both have to be
  // visible, because they are different decisions: a wide side is trying to get
  // the ball to a flank, and a pressing side is trying to hunt it, and you cannot
  // hunt sideways unless you are already turned that way.
  it('orients toward the ball more when told to attack wide or to press', () => {
    const { context } = fixture('shape-orientation');

    const balanced = shapeUnder(context, 'home', { attackingFocus: 'balanced' });
    const wide = shapeUnder(context, 'home', { attackingFocus: 'wide' });
    expect(
      wide.ballOrientation,
      `wide ${wide.ballOrientation.toFixed(3)} vs balanced ${balanced.ballOrientation.toFixed(3)}`,
    ).toBeGreaterThan(balanced.ballOrientation);

    const sitOff = shapeUnder(context, 'home', { pressing: 'low' });
    const press = shapeUnder(context, 'home', { pressing: 'high' });
    expect(press.ballOrientation).toBeGreaterThan(sitOff.ballOrientation);

    // The block also spreads and closes down differently with and without the ball,
    // which is the other half of "compactness" being two numbers rather than one:
    // in possession the side takes up more of the pitch, and out of it it closes.
    const inPossessionShape = shapeFor(context, 'home', { inPossession: true, energy: 100, urgency: 0 });
    const outOfPossessionShape = shapeFor(context, 'home', { inPossession: false, energy: 100, urgency: 0 });
    expect(inPossessionShape.width.inPossession).toBeGreaterThan(outOfPossessionShape.width.outOfPossession);
    expect(inPossessionShape.compactness.inPossession).toBeLessThan(outOfPossessionShape.compactness.outOfPossession);
  });

  // A deep line is a deep line, not a second goalkeeper. However the manager
  // sets the defensive line and however deep the ball is, the back four keeps a
  // strip of grass between itself and the net; before this floor a deep line
  // defending its own third was driven onto the goal line behind the keeper.
  it('keeps a back line off its own goal line, however deep the instruction', () => {
    const { context } = fixture('shape-floor');
    for (const defensiveLine of ['deep', 'standard', 'high'] as const) {
      const shape = shapeUnder(context, 'home', { defensiveLine }, { inPossession: false });
      // The ball on the edge of its own box, the deepest the block ever gets.
      const defending = backLineAt(shape, 0.1, 'home', false);
      expect(
        defending,
        `${defensiveLine} line sat at progress ${defending.toFixed(3)}`,
      ).toBeGreaterThanOrEqual(0.09);
    }
  });

  // The claim the brief opens with: a winger stays wide. Same slot, same side,
  // same ball — the only difference is the job, and the job is what decides
  // whether he is on the touchline or cutting inside onto the same blade of grass
  // as everybody else.
  it('puts a winger wider than an inverted winger in the same slot', () => {
    const { context } = fixture('shape-winger');
    const shape = shapeUnder(context, 'home', { attackingFocus: 'wide' }, { inPossession: true });
    const ball = { x: 0.78, y: 0.5 };

    // The slot is not on the touchline already: a winger's slot is a starting point,
    // and the claim is that the shape is what puts him out there. Starting him at
    // y=0.86 would make the test pass even if width did nothing.
    const winger = shapePositionFor(node({ position: 'RW', side: 'home', role: 'w-winger', baseY: 0.7 }), shape, ball, true);
    const inverted = shapePositionFor(
      node({ position: 'RW', side: 'home', role: 'w-inverted-winger', baseY: 0.7 }),
      shape,
      ball,
      true,
    );

    expect(
      Math.abs(winger.y - inverted.y),
      `winger y=${winger.y.toFixed(3)} vs inverted y=${inverted.y.toFixed(3)}`,
    ).toBeGreaterThanOrEqual(0.08);
    // Wider means further from the centre circle, whichever touchline he is on.
    expect(Math.abs(winger.y - 0.5)).toBeGreaterThan(Math.abs(inverted.y - 0.5));
  });

  // A back four is four men measured from the same reference line, so when the
  // lines step up they step up together. This is the assertion that would fail if
  // each defender were nudged toward the ball independently — which is what the
  // old model effectively did, and why the block never moved as a block.
  it('moves a back four as a line rather than four separate men', () => {
    const { context } = fixture('shape-back-four');
    const shape = shapeUnder(context, 'home', {}, { inPossession: true });

    // A back four's four slots: two full-backs and two centre-backs.
    //
    // The slots sit inside the touchlines rather than on them, because a man
    // standing on the touchline is already at the edge of what is legal and a
    // block leaning toward him clamps — which would show up here as the block
    // failing to move, when what is actually happening is that one of them has
    // run out of pitch. That is a real constraint but not the one under test.
    const backFour = ['RB', 'CB', 'CB', 'LB'].map((position, index) =>
      node({
        playerId: `def${index}`,
        position: position as PlayerSpatial['position'],
        side: 'home',
        // Four distinct base positions down the back, as a real back four has.
        baseX: 0.2,
        baseY: [0.2, 0.4, 0.6, 0.8][index]!,
      }),
    );

    // The ball crosses the pitch. Every defender's lateral position must move the
    // same way by the same amount, because the block leans and men do not lean
    // individually.
    const left = backFour.map((n) => shapePositionFor(n, shape, { x: 0.3, y: 0.15 }, true).y);
    const right = backFour.map((n) => shapePositionFor(n, shape, { x: 0.3, y: 0.85 }, true).y);
    const shifts = right.map((y, index) => y - left[index]!);

    for (const [index, shift] of shifts.entries()) {
      expect(shift, `defender ${index} shifted ${shift.toFixed(4)} while the block leaned`).toBeGreaterThan(0);
    }
    // Every defender moves by the same amount, so the *gap* between them is
    // unchanged. Compared as a gap rather than as a raw position because that is
    // what "as a line" means: four men keep their spacing and travel together.
    const gapsBefore = [left[1]! - left[0]!, left[2]! - left[1]!, left[3]! - left[2]!];
    const gapsAfter = [right[1]! - right[0]!, right[2]! - right[1]!, right[3]! - right[2]!];
    const spacingDrift = Math.max(
      ...gapsAfter.map((gap, index) => Math.abs(gap - gapsBefore[index]!)),
    );
    expect(
      spacingDrift,
      `the four leaned by ${shifts.map((s) => s.toFixed(4)).join(', ')} but their spacing moved by ${spacingDrift.toFixed(4)}`,
    ).toBeLessThan(1e-6);
  });
});

// What the shape model is *not*. It is presentation of intent: it decides where
// men stand, and where men stand changes what the possession model goes on to
// choose. It must never decide anything itself.
//
// The way to prove that is not to assert that the shape does not change the match
// — it demonstrably does, because a defensive line's height feeds the offside
// chance and the counter chance. It is to show that the shape is *derived* from
// what it is given and consumes no randomness, so the whole match stays
// repeatable. A shape model that drew from the RNG would make every result
// unrepeatable and would be a second simulation sitting quietly beside the first.
describe('the shape model decides nothing', () => {
  it('derives the same shape every time from the same inputs', () => {
    const { context } = fixture('shape-pure');
    const read = () =>
      JSON.stringify(
        shapeFor(context, 'home', { inPossession: true, energy: 72, urgency: 0.4 }),
      );

    // Same arguments, many times, byte-identical output. A single `rng.float`
    // anywhere in the shape model would break this immediately.
    const first = read();
    for (let attempt = 0; attempt < 20; attempt += 1) expect(read()).toBe(first);
  });

  it('leaves a seeded match repeatable', () => {
    const play = (seed: number): string => {
      const { state, base } = fixture('shape-determinism');
      const match = structuredClone(base);
      match.seed = seed;
      const env = matchEnvironment(state, match, { autoManageAllBenches: true });
      match.spatial = undefined;
      ensureSpatial(match, env);
      beginMatch(match, env);
      const spatial: MatchSpatial = match.spatial!;
      for (let step = 0; step < 60_000; step += 1) {
        advanceSpatial(match, env, STEP);
        const decided = match.footballSeconds ?? 0;
        const spent = !spatial.plan && (spatial.pending?.length ?? 0) === 0;
        if (spatial.clock >= decided + 20 || (spent && decided - spatial.clock < 20)) {
          if (advanceMinute(match, env).finished) break;
        }
      }
      return JSON.stringify({
        // Goals counted off the event log rather than a score field, so the
        // assertion does not depend on where the score happens to be stored.
        goals: match.events.filter((e) => e.type === 'goal').map((e) => `${e.minute}:${e.playerId ?? ''}`),
        events: match.events.map((e) => `${e.minute}:${e.type}:${e.playerId ?? ''}`),
      });
    };

    // Every event, not just the score. A shape that nudged the offside roll would
    // leave the score alone on most seeds and move an event.
    expect(play(4242)).toBe(play(4242));
  }, 300_000);
});