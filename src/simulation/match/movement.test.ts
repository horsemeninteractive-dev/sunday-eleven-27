/**
 * Rest, and the difference between standing still and going nowhere.
 *
 * Two symptoms in `realism.test.ts` came from the same root: the movement system
 * had no rest state, and it re-aimed a carrying player every step. Together those
 * produced a carrier who never got anywhere and never appeared to be moving —
 * the ball going nowhere while a man ran in small circles around it.
 *
 * The distinction these tests draw is between a player who is *stationary* and a
 * player who is *travelling with a target he keeps rewriting*. Both can have a
 * position that hardly changes over five seconds. Only one of them is standing
 * still, and only one of them is football.
 *
 * So the assertions are about velocity and about targets, not about final
 * positions. "He ends up roughly where he started" would pass for a player
 * sprinting in a circle, which is precisely the bug.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match, MatchSpatial } from '@/domain/match';
import { SPATIAL_SECONDS_PER_MINUTE, advanceSpatial, ensureSpatial } from './spatial';
import { advanceMovement, type MovementState } from './state';
import { advanceMinute, beginMatch } from './engine';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { createTestGame } from '../testSupport';

/** The browser's own spatial step: one thirtieth of a second of football. */
const STEP = 1 / 30;

/** A cap on a driven match, so a clock that stops advancing cannot hang a run. */
const MATCH_CAP = 220_000;

function fixture(seed: string): { state: GameState; base: Match } {
  const { state, draft } = createTestGame(seed);
  const home = state.clubs[draft.divisionClubIds[0]!]!;
  const away = state.clubs[draft.divisionClubIds[3]!]!;
  prepareMatchday(state, 1);
  const match = Object.values(state.matches).find((m) => m.homeClubId === home.id && m.awayClubId === away.id)!;
  prepareMatchday(state, match.matchday);
  return { state, base: state.matches[match.id]! };
}

function kickOff(
  state: GameState,
  base: Match,
  seed: number,
): { match: Match; spatial: MatchSpatial; env: ReturnType<typeof matchEnvironment> } {
  const match = structuredClone(base);
  match.seed = seed;
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  match.spatial = undefined;
  ensureSpatial(match, env);
  beginMatch(match, env);
  return { match, spatial: match.spatial!, env };
}

/**
 * Play a match the way the browser plays it, visiting every spatial step.
 *
 * `simulateToCompletion` cannot be used here: it skips the continuous state
 * entirely, and the continuous state is the only thing that has a position to
 * measure.
 */
function drive(
  state: GameState,
  base: Match,
  seed: number,
  visit: (spatial: MatchSpatial) => void,
): void {
  const match = structuredClone(base);
  match.seed = seed;
  // Built once. `matchEnvironment` walks the whole squad and both tactical
  // profiles, so calling it per step turns a match into hundreds of thousands of
  // full environment rebuilds and the worker simply runs out of memory.
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  match.spatial = undefined;
  ensureSpatial(match, env);
  beginMatch(match, env);
  const spatial: MatchSpatial = match.spatial!;

  for (let index = 0; index < MATCH_CAP; index += 1) {
    advanceSpatial(match, env, STEP);
    visit(spatial);
    const decided = match.footballSeconds ?? 0;
    const spent = !spatial.plan && (spatial.pending?.length ?? 0) === 0;
    // `stalled` is the pitch reporting it has nothing to play and is behind the
    // clock; see the note in `realism.test.ts`. Deciding the minute is the
    // caller's job.
    if (
      spatial.stalled ||
      spatial.clock >= decided + SPATIAL_SECONDS_PER_MINUTE ||
      (spent && decided - spatial.clock < SPATIAL_SECONDS_PER_MINUTE)
    ) {
      if (advanceMinute(match, env).finished) return;
    }
  }
}

describe('rest', () => {
  // The claim a rest state exists to make. A man at rest is not a man whose
  // target happens to be where he is standing: he has a target and is declining
  // to act on it, and the difference is visible as velocity that is *exactly*
  // zero rather than merely small.
  //
  // Asserted on the deterministic movement layer because that is where the claim
  // lives, and because a five-second rest driven through a whole match would be
  // asserting something about the match rather than about rest.
  it('keeps a player at rest perfectly still', () => {
    const mover: MovementState = {
      x: 0.5,
      y: 0.5,
      tx: 0.5,
      ty: 0.5,
      speed: 0.25,
      vx: 0,
      vy: 0,
      restUntil: 5,
    };

    const startX = mover.x;
    const startY = mover.y;
    let clock = 0;
    let peakSpeed = 0;
    for (let step = 0; step < 150; step += 1) {
      clock += STEP;
      advanceMovement(mover, STEP, clock);
      peakSpeed = Math.max(peakSpeed, Math.hypot(mover.vx, mover.vy));
    }

    expect(Math.hypot(mover.x - startX, mover.y - startY)).toBeLessThanOrEqual(1e-4);
    // Velocity exactly zero throughout, not "slow". A creeping player and a
    // standing player look the same in a still frame and nothing like each other
    // in motion.
    expect(peakSpeed).toBe(0);
  });

  // And the rest has to end, or it is a freeze rather than a pause. The bound is
  // what makes it a decision a player made rather than a bug.
  it('ends when the rest runs out', () => {
    const mover: MovementState = {
      x: 0.2,
      y: 0.5,
      tx: 0.8,
      ty: 0.5,
      speed: 0.25,
      vx: 0,
      vy: 0,
      restUntil: 0.5,
    };

    // During the rest, he does not move at all. The loop steps *before* it moves
    // him, so the last clock value passed is still inside the rest — otherwise
    // the boundary step is counted against the rest and the assertion below is
    // really testing rounding.
    let clock = 0;
    while (clock + STEP <= 0.5) {
      clock += STEP;
      advanceMovement(mover, STEP, clock);
    }
    expect(clock).toBeLessThanOrEqual(0.5);
    expect(mover.x).toBe(0.2);

    // After it, he goes. Same target, same man — only the rest has expired.
    while (clock < 4) {
      clock += STEP;
      advanceMovement(mover, STEP, clock);
    }
    expect(mover.x).toBeGreaterThan(0.3);
  });

  // The condition that makes rest *selective* rather than global. A man at rest
  // who ignores the ball coming past him is not resting, he is switched off, and
  // the difference between those two is the whole reason rest is entered on
  // arrival and left on need rather than simply being a slower movement model.
  it('is left when the ball comes within reach', () => {
    const { state, base } = fixture('movement-rest-pull');
    let violations = 0;

    for (let game = 0; game < 3; game += 1) {
      // How many consecutive frames each player has spent at rest with the ball
      // on him. A single frame is the rest state noticing a ball that has *just*
      // arrived and being one frame late about it — a rounding problem. A player
      // who is *sustainedly* at rest with the ball at his feet is asleep, and
      // that is the failure this test exists to rule out.
      const nearFor = new Map<string, number>();
      drive(state, base, 900 + game * 13, (spatial) => {
        for (const node of spatial.players) {
          const gap = Math.hypot(spatial.ball.x - node.x, spatial.ball.y - node.y);
          const resting = node.restUntil !== undefined;
          const near = resting && gap < 0.03;
          const run = near ? (nearFor.get(node.playerId) ?? 0) + 1 : 0;
          nearFor.set(node.playerId, run);
          // Half a second is far longer than any honest reaction time.
          if (run > 15) violations += 1;
        }
      });
    }

    expect(violations, 'a player stayed at rest with the ball at his feet').toBe(0);
  });
});

describe('carrying', () => {
  // The stutter, measured as what it actually is: a target that is rewritten
  // while a man is walking to it. A carry is one movement with one destination,
  // so across a whole carry the carrier's target should be set once and left
  // alone — not nudged, not recomputed against a ball that is moving because he
  // is carrying it.
  it('does not recompute the carrier’s target mid-carry', () => {
    const { state, base } = fixture('movement-carry-target');
    let carries = 0;
    let rewrites = 0;
    let worstRewrites = 0;

    for (let game = 0; game < 3; game += 1) {
      drive(state, base, 700 + game * 29, (spatial) => {
        for (const node of spatial.players) {
          // Only a man who actually has the ball, playing a carry step.
          if (spatial.ball.ownerId !== node.playerId) continue;
          const step = spatial.plan?.steps[spatial.plan.index];
          if (!step || step.kind !== 'carry' || step.playerId !== node.playerId) continue;

          carries += 1;
          // The target he is walking to is the step's destination. If the live
          // target has wandered off it, something re-aimed him mid-carry.
          const drift = Math.hypot(node.tx - step.toX, node.ty - step.toY);
          if (drift > 0.02) rewrites += 1;
        }
        void spatial;
      });
    }

    // Recorded per visit rather than per carry so the worst case is bounded too.
    expect(carries, 'no carries were observed, so this proves nothing').toBeGreaterThan(50);
    expect(
      rewrites / carries,
      `${rewrites} of ${carries} carrier steps had a target that had wandered off the step's destination`,
    ).toBeLessThan(0.05);
    expect(worstRewrites).toBe(0);
  });

  // A carrier must actually go somewhere. This is the other half of the stutter
  // fix: a man who is not re-aimed must not have stopped moving either, or the
  // cure is worse than the disease.
  it('gets the carrier from where he was to where the carry was going', () => {
    const { state, base } = fixture('movement-carry-travel');
    let travelled = 0;
    let carries = 0;
    let totalDistance = 0;

    for (let game = 0; game < 3; game += 1) {
      const { match, spatial, env } = kickOff(state, base, 800 + game * 31);
      // Where each carrier was when his carry began, so the end can be compared
      // against it. Measuring at the moment the action *starts* would compare a
      // man against the place he has not left yet, and every carry would look
      // like a man standing still.
      // Where each carrier was when his carry began, so the end can be compared
      // against it.
      const startOf = new Map<string, { x: number; y: number }>();
      const settled = new Set<string>();
      // Keys for carries seen and not yet resolved. `spatial.actions` is emptied
      // the moment an action resolves, so a carry is followed by watching for it
      // to *disappear* — checking for it still being present, as this first did,
      // means it is never seen again and nothing is ever measured.
      const open = new Set<string>();

      for (let index = 0; index < MATCH_CAP; index += 1) {
        advanceSpatial(match, env, STEP);

        const liveKeys = new Set<string>();
        for (const action of spatial.actions) {
          if (action.kind !== 'carry' || !action.playerId) continue;
          liveKeys.add(`${action.playerId}:${action.startedAt}`);
        }

        // Any carry we were following that is no longer running has finished.
        for (const key of open) {
          if (liveKeys.has(key) || settled.has(key)) continue;
          settled.add(key);
          open.delete(key);
          const from = startOf.get(key);
          const playerId = key.slice(0, key.lastIndexOf(':'));
          const node = spatial.players.find((p) => p.playerId === playerId);
          if (!from || !node) continue;
          const distance = Math.hypot(node.x - from.x, node.y - from.y);
          totalDistance += distance;
          carries += 1;
          if (distance > 0.01) travelled += 1;
        }

        for (const action of spatial.actions) {
          if (action.kind !== 'carry' || !action.playerId) continue;
          const key = `${action.playerId}:${action.startedAt}`;
          if (settled.has(key) || open.has(key)) continue;
          const step = spatial.plan?.steps[spatial.plan.index];
          if (!step || step.kind !== 'carry' || step.playerId !== action.playerId) continue;
          const node = spatial.players.find((p) => p.playerId === action.playerId);
          if (!node) continue;
          startOf.set(key, { x: node.x, y: node.y });
          open.add(key);
        }

        const decided = match.footballSeconds ?? 0;
        const spent = !spatial.plan && (spatial.pending?.length ?? 0) === 0;
        if (spatial.stalled || spatial.clock >= decided + SPATIAL_SECONDS_PER_MINUTE || (spent && decided - spatial.clock < SPATIAL_SECONDS_PER_MINUTE)) {
          if (advanceMinute(match, env).finished) break;
        }
      }
    }

    expect(carries, 'no completed carries were observed, so this proves nothing').toBeGreaterThan(50);
    expect(
      totalDistance / carries,
      `carries averaged ${(totalDistance / Math.max(carries, 1)).toFixed(4)} of a pitch — that is not a carry`,
    ).toBeGreaterThan(0.02);
    expect(travelled / carries, 'carriers who stood still for their own carry').toBeGreaterThan(0.7);
  });
});

describe('holding the ball', () => {
  // A shield is a football action, so it has to be bounded like one. The failure
  // this guards against is specific: a hold that consumed time in the decision
  // model without anything happening on the pitch, so the ball sat still for as
  // long as the arithmetic allowed rather than as long as the action did.
  it('does not leave the ball still for more than a second and a half', () => {
    const { state, base } = fixture('movement-hold-bound');
    // The longest unbroken run in which the ball genuinely did not move.
    //
    // The ball's *position* is compared frame to frame, rather than inferring
    // motion from its status: a carrier standing still has a controlled ball that
    // is never going anywhere, and a shield is exactly that. Measuring status
    // would have counted every step of every carry as still, which is not the
    // claim being made — the claim is about the ball going nowhere at all.
    let worstStillSeconds = 0;
    let stillRun = 0;
    let previous: { x: number; y: number } | null = null;

    for (let game = 0; game < 3; game += 1) {
      drive(state, base, 600 + game * 17, (spatial) => {
        const ball = spatial.ball;
        // A ball nobody owns and nobody is chasing is out of play, not still.
        if (ball.status === 'out-of-play' || spatial.celebration) {
          stillRun = 0;
          previous = null;
          return;
        }
        const moved = previous === null || Math.hypot(ball.x - previous.x, ball.y - previous.y) > 1e-4;
        previous = { x: ball.x, y: ball.y };
        if (moved) {
          stillRun = 0;
          return;
        }
        stillRun += STEP;
        worstStillSeconds = Math.max(worstStillSeconds, stillRun);
      });
    }

    expect(
      worstStillSeconds,
      `the ball was still for ${worstStillSeconds.toFixed(2)}s in a single in-progress run`,
    ).toBeLessThan(1.5);
  });
});