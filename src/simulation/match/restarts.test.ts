/**
 * Dead balls, and whether they are actually on the pitch.
 *
 * Every set piece used to be an incident rather than a passage. A corner was a
 * line in the event log and a change of possession; a throw-in was the ball
 * appearing forty yards upfield; a free kick was a foul event followed by a shot
 * from somewhere else. The simulation was doing the thing and the picture was not
 * showing it, which is most of what "it simulates but it doesn't look like
 * football" means when you watch it.
 *
 * These tests are about the *shape* of a restart, which is what makes one
 * legible: the ball is on its spot and dead, the men walk to the places the
 * routine needs them in, and the taker plays the ball. A corner whose setup takes
 * no time is a flag with a cross attached to it.
 *
 * The last one is the one that matters most, and it is a constraint rather than a
 * feature. A restart is *presentation of a passage the possession model already
 * decided*. If showing the corner could change the corner, this whole slice would
 * be a second football with its own ideas, and every number in the game would be
 * a number from whichever of the two rolled. So a match played with restarts
 * switched off has to produce exactly the same events — and that is asserted
 * here rather than assumed.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match, MatchEvent, MatchSpatial } from '@/domain/match';
import type { MatchEnvironment } from './engine';
import { advanceMinute, beginMatch } from './engine';
import { buildContext } from './core';
import { stream } from '../rng';
import { createTestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { advanceSpatial, ensureSpatial, installRestart, SPATIAL_SECONDS_PER_MINUTE } from './spatial';
import { goalKick, takeCorner, takePenalty, takeThrowIn, type RoutineOutcome } from './setPieces';
import { buildPossessionPlan } from './continuousPossession';
import { SETUP_SECONDS, TOUCHLINE_Y, penaltyBox, sixYardBox } from './restarts';
import { otherSide } from './core';

/** The browser's own spatial step: one thirtieth of a second of football. */
const STEP = 1 / 30;

function fixture(seed: string): { state: GameState; base: Match } {
  const { state, draft } = createTestGame(seed);
  const home = state.clubs[draft.divisionClubIds[0]!]!;
  const away = state.clubs[draft.divisionClubIds[3]!]!;
  prepareMatchday(state, 1);
  const match = Object.values(state.matches).find((m) => m.homeClubId === home.id && m.awayClubId === away.id)!;
  prepareMatchday(state, match.matchday);
  return { state, base: state.matches[match.id]! };
}

/** A pitch with the whistle gone and the opening kick-off out of the way. */
function stage(seed: string, gameSeed = 9200): { match: Match; spatial: MatchSpatial; env: MatchEnvironment } {
  const { state, base } = fixture(seed);
  const match = structuredClone(base);
  match.seed = gameSeed;
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  match.spatial = undefined;
  ensureSpatial(match, env);
  beginMatch(match, env);
  const spatial = match.spatial!;
  // Clear the opening kick-off so what is measured is the restart under test and
  // not the first three seconds of the match.
  spatial.restart = null;
  spatial.plan = null;
  spatial.pending = [];
  return { match, spatial, env };
}

/**
 * Install a routine and watch it happen, step by step.
 *
 * The routine decides the football; installing it is what makes the pitch show
 * it. Everything asserted below is read off the pitch while that plays out, so a
 * routine that decides a cross but never plays one fails here.
 */
function playRestart(
  stageResult: { match: Match; spatial: MatchSpatial; env: MatchEnvironment },
  routine: RoutineOutcome,
  steps: number,
  visit: (spatial: MatchSpatial, index: number) => void,
): void {
  const { match, spatial, env } = stageResult;
  // The delivery is built into a chain, exactly as a real minute builds one from
  // the possession model's own actions. Without a chain there is nothing to
  // deliver, and a restart with nothing to deliver is a ball on a flag — which
  // is exactly the bug this work exists to remove, so the test must not be able
  // to reproduce it by accident.
  const plan = buildPossessionPlan(routine.restart.side, routine.actions, {
    pointOf: (id) => spatial.players.find((node) => node.playerId === id),
    targetOf: (id) => {
      const node = spatial.players.find((entry) => entry.playerId === id);
      return node ? { x: node.tx, y: node.ty } : undefined;
    },
    onPitch: (id) => Boolean(id) && spatial.players.some((node) => node.playerId === id),
  });
  expect(plan, 'the routine decided a delivery but the pitch could not build a step for it').not.toBeNull();
  spatial.plan = { ...plan!, budgetSeconds: 20, toldCount: 0, narratedStep: -1, restartIndex: 0 };
  spatial.pending = [];
  installRestart(match, routine.restart);
  for (let index = 0; index < steps; index += 1) {
    advanceSpatial(match, env, STEP);
    visit(spatial, index);
  }
}

describe('dead balls', () => {
  it('a corner takes at least 6 spatial seconds to set up', () => {
    const setup = stage('restart-corner-setup');
    const routine = takeCorner(
      setup.match,
      setup.env,
      buildContext(setup.match, setup.env),
      'home',
      stream(setup.match.seed, 'restart', 'corner'),
      [],
    );

    let setupSteps = 0;
    playRestart(setup, routine, Math.ceil(12 * 30), (spatial) => {
      if (spatial.ball.status === 'out-of-play') setupSteps += 1;
    });

    const seconds = setupSteps * STEP;
    expect(
      seconds,
      `the ball was dead for only ${seconds.toFixed(2)}s of a corner's setup, which is ` +
        `shorter than the ${SETUP_SECONDS.corner}s the routine asked for`,
    ).toBeGreaterThanOrEqual(6);
  });

  it('the ball is out-of-play throughout the setup', () => {
    const setup = stage('restart-ball-dead');
    const routine = takeCorner(
      setup.match,
      setup.env,
      buildContext(setup.match, setup.env),
      'home',
      stream(setup.match.seed, 'restart', 'dead'),
      [],
    );

    let frames = 0;
    let alive = 0;
    let moved = 0;
    // From where the ball was *placed*, not from where it happened to be before
    // the placement. Measuring from before would book the corner taker's walk to
    // the flag as the ball moving, which is the opposite of the claim.
    let previous = { x: routine.restart.ballX, y: routine.restart.ballY };
    playRestart(setup, routine, Math.ceil(6 * 30), (spatial) => {
      if (!spatial.restart) return;
      frames += 1;
      if (spatial.ball.status !== 'out-of-play') alive += 1;
      moved += Math.hypot(spatial.ball.x - previous.x, spatial.ball.y - previous.y);
      previous = { x: spatial.ball.x, y: spatial.ball.y };
    });

    expect(frames, 'the corner was over before the first frame of setup').toBeGreaterThan(30);
    expect(alive, `the ball was not out of play for ${alive} of ${frames} setup frames`).toBe(0);
    // A dead ball that drifts is not a dead ball, and this is the assertion that
    // would catch a ball being carried off the flag by a man who arrived early.
    expect(moved, `the ball moved ${moved.toFixed(5)} pitch-lengths while it was dead`).toBeLessThan(1e-6);
  });

  it('the taker reaches the ball before the delivery is played', () => {
    // A *real* corner, taken in a real match, rather than one forced at kick-off.
    //
    // This matters more than it looks. A corner awarded on the whistle has no
    // taker anywhere near the flag — everybody is on the halfway line, forty
    // yards from it — and no amount of setup time closes that, because men here
    // run at four metres a second like everybody else. Staging a corner there is
    // a fiction, and asserting against it measures the fiction rather than the
    // engine. So this drives the match until the game actually awards one.
    const { state, base } = fixture('restart-taker');
    const match = structuredClone(base);
    match.seed = 9210;
    const env = matchEnvironment(state, match, { autoManageAllBenches: true });
    match.spatial = undefined;
    ensureSpatial(match, env);
    beginMatch(match, env);
    const spatial = match.spatial!;

    let corner: { ballX: number; ballY: number; takerId: string | null } | null = null;
    let worstAtDelivery = Infinity;
    let delivered = 0;

    for (let guard = 0; guard < 120_000 && delivered < 3; guard += 1) {
      const before = spatial.restart?.kind ?? null;
      advanceSpatial(match, env, STEP);
      const after = spatial.restart?.kind ?? null;

      if (before === 'corner' && corner === null && spatial.restart) {
        corner = {
          ballX: spatial.restart.ballX,
          ballY: spatial.restart.ballY,
          takerId: spatial.restart.takerId,
        };
      }
      if (corner && before === 'corner' && after !== 'corner') {
        // The setup is over: this is the instant the delivery is played, and the
        // taker has to be standing on the spot for it to be a corner.
        const node = spatial.players.find((entry) => entry.playerId === corner!.takerId);
        if (node) {
          worstAtDelivery = Math.min(
            worstAtDelivery,
            Math.hypot(node.x - corner.ballX, node.y - corner.ballY),
          );
          delivered += 1;
        }
        corner = null;
      }

      const decided = match.footballSeconds ?? 0;
      const idle = !spatial.plan && (spatial.pending?.length ?? 0) === 0 && !spatial.restart;
      if (
        spatial.stalled ||
        spatial.clock >= decided + SPATIAL_SECONDS_PER_MINUTE ||
        (idle && decided - spatial.clock < SPATIAL_SECONDS_PER_MINUTE)
      ) {
        if (advanceMinute(match, env).finished) break;
      }
    }

    expect(delivered, 'the match awarded no corner that was ever delivered').toBeGreaterThan(0);
    expect(
      worstAtDelivery,
      `the closest any corner taker stood to the flag when he crossed was ${worstAtDelivery.toFixed(3)} ` +
        `pitch-lengths; a corner struck from further away than a yard is not a corner`,
    ).toBeLessThanOrEqual(0.02);
  });

  it('a penalty has the keeper on his line and no other player inside the box at delivery', () => {
    const setup = stage('restart-penalty');
    const routine = takePenalty(
      setup.match,
      setup.env,
      buildContext(setup.match, setup.env),
      'home',
      stream(setup.match.seed, 'restart', 'penalty'),
      [],
    );

    let keeperDistance = Infinity;
    let intrudersInside = 0;
    let checkedAtDelivery = false;
    const takerId = routine.restart.takerId;
    // The box at the end the penalty is taken at: the *defending* side's.
    const box = penaltyBox(otherSide(routine.restart.side));

    playRestart(setup, routine, Math.ceil(20 * 30), (spatial) => {
      // Sampled at the instant the ball is struck, and only then. Reading it on
      // every later frame measures the *rebound* — men following a ball into the
      // box after it has been taken is the opposite of the claim, and it made a
      // correct penalty look like a mass invasion.
      if (spatial.ball.status === 'out-of-play') return;
      if (checkedAtDelivery) return;
      const keeper = spatial.players.find((node) => node.position === 'GK' && node.side === 'away');
      if (!keeper) return;
      keeperDistance = Math.abs(keeper.x - 1);
      // Nobody but the taker and the keeper may be inside the area. The taker is
      // excluded because he is standing *on the spot*, which is inside it by
      // definition, and the keeper because he is defending it.
      intrudersInside = spatial.players.filter(
        (node) =>
          node.position !== 'GK' &&
          node.playerId !== takerId &&
          node.x >= box.minX &&
          node.x <= box.maxX &&
          node.y >= box.minY &&
          node.y <= box.maxY,
      ).length;
      checkedAtDelivery = true;
    });

    expect(checkedAtDelivery, 'the penalty was never taken, so nobody was checked').toBe(true);
    // The keeper is on his line: within six yards of his own goal.
    expect(keeperDistance, `the keeper was ${keeperDistance.toFixed(3)} from his goal line`).toBeLessThanOrEqual(0.12);
    expect(
      intrudersInside,
      `${intrudersInside} players were inside the penalty area when the penalty was taken`,
    ).toBe(0);
  });

  it('a throw-in places the ball within 0.02 of the touchline', () => {
    const setup = stage('restart-throw');
    const routine = takeThrowIn(
      setup.match,
      setup.env,
      buildContext(setup.match, setup.env),
      'home',
      stream(setup.match.seed, 'restart', 'throw'),
      [],
      { x: 0.5, y: 0.02 },
    );

    let nearestEdge = Infinity;
    playRestart(setup, routine, Math.ceil(6 * 30), (spatial) => {
      if (!spatial.restart) return;
      const edge = Math.min(spatial.ball.y, 1 - spatial.ball.y);
      nearestEdge = Math.min(nearestEdge, edge);
    });

    expect(
      nearestEdge,
      `the throw-in was placed ${nearestEdge.toFixed(4)} from the touchline; a throw is taken ` +
        `from the line and this one was ${TOUCHLINE_Y} away from it at best`,
    ).toBeLessThanOrEqual(0.02);
  });

  it('a goal kick places the ball inside the six-yard box', () => {
    const setup = stage('restart-goalkick');
    const routine = goalKick(setup.match, 'home', stream(setup.match.seed, 'restart', 'gk'));

    let inside = false;
    let keeperPlaced = false;
    playRestart(setup, routine, Math.ceil(6 * 30), (spatial) => {
      if (!spatial.restart) return;
      const { x, y } = spatial.ball;
      const six = sixYardBox('home');
      if (x >= six.minX && x <= six.maxX && y >= six.minY && y <= six.maxY) inside = true;
      const keeper = spatial.players.find((node) => node.position === 'GK' && node.side === 'home');
      if (keeper && Math.hypot(keeper.x - spatial.restart.ballX, keeper.y - spatial.restart.ballY) <= 0.02) {
        keeperPlaced = true;
      }
    });

    expect(inside, 'the ball was never placed inside the six-yard box for a goal kick').toBe(true);
    // A goal kick is the one restart taken by the keeper, which is what makes it
    // read differently from every other one.
    expect(keeperPlaced, 'the goalkeeper was not at the ball for his own goal kick').toBe(true);
  });

  it('a restart does not change the match result', () => {
    const { state, base } = fixture('restart-no-result-change');

    /**
     * Play a stretch of one fixture and report the events.
     *
     * `restarts` is the debug switch on the spatial state. Both arms are driven
     * *identically* — same seed, same fixed steps, same minutes, same
     * `advanceMinute` calls — and the only difference is that one of them refuses
     * to arrange dead balls. Anything else would prove nothing: a comparison
     * between a driven match and an undriven one would differ for a hundred
     * reasons that have nothing to do with restarts.
     *
     * So the claim under test is the one that matters: the restart is a way of
     * *showing* a passage the possession model already decided, and switching it
     * on cannot decide a different one. The records must be identical — not the
     * same goals, the same events, in the same order, at the same minutes.
     */
    const MINUTES = 14;
    const play = (gameSeed: number, restarts: boolean): MatchEvent[] => {
      const match = structuredClone(base);
      match.seed = gameSeed;
      const env = matchEnvironment(state, match, { autoManageAllBenches: true });
      match.spatial = undefined;
      ensureSpatial(match, env);
      beginMatch(match, env);
      const spatial: MatchSpatial = match.spatial!;
      spatial.restartsEnabled = restarts;

      for (let minute = 0; minute < MINUTES; minute += 1) {
        const decided = match.footballSeconds ?? 0;
        for (let step = 0; step < 4000; step += 1) {
          advanceSpatial(match, env, STEP);
          const idle = !spatial.plan && (spatial.pending?.length ?? 0) === 0 && !spatial.restart;
          if (
            spatial.stalled ||
            spatial.clock >= decided + SPATIAL_SECONDS_PER_MINUTE ||
            (idle && decided - spatial.clock < SPATIAL_SECONDS_PER_MINUTE)
          ) {
            break;
          }
        }
        advanceMinute(match, env);
      }
      return match.events;
    };

    for (const gameSeed of [9301, 9302]) {
      const withRestarts = play(gameSeed, true);
      const withoutRestarts = play(gameSeed, false);
      const shape = (events: MatchEvent[]) =>
        events.map((event) => `${event.minute}:${event.type}:${event.clubId ?? '-'}:${event.playerId ?? '-'}`);
      expect(
        shape(withRestarts),
        `restarts changed the match record for seed ${gameSeed}: showing a set piece must not ` +
          `decide a different one`,
      ).toEqual(shape(withoutRestarts));
    }
  });
});