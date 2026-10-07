import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { nextMatchday } from '@/simulation/timeline';
import { cloneMatch } from '@/simulation/match/testHelpers';
import { Rng } from '@/simulation/rng';
import { beginSetPiece, type SetPieceKind } from '@/simulation/match/matchEngine';
import {
  CHANGES_PER_MATCH,
  RESTART_KINDS,
  RESTART_SETUP_SECONDS,
  RESTART_STRIKES,
  RESTART_TAKER,
  cardForFoul,
  changesAllowed,
  createMatchEngine,
  penaltyTaker,
  restartSpotFor,
  simulationAlpha,
  simulationModeFor,
  strikeOutcome,
  type MatchPhase,
} from './index';

/**
 * The Touchline architecture, enforced rather than described.
 *
 * **Touchline decides what happens. Presentation shows what happened.**
 *
 * `TOUCHLINE_ARCHITECTURE.md` is the document; this file is the part of it a
 * machine can check. Four claims are tested, and each one is a claim about the
 * *architecture* rather than about the football:
 *
 *  1. one authoritative match state carries a whole match, phase by phase, from
 *     the kick-off through a restart and a goal to the final whistle — and the
 *     engine is the one thing that advances it;
 *  2. how a match is *watched* cannot change what happens: a renderer reading and
 *     interpolating between steps, at whatever frame rate, leaves the record
 *     identical to a run nobody looked at;
 *  3. the laws a match obeys are stated once and both resolutions read them —
 *     the restarts, the strike ladders, the card ladder and the changes allowed;
 *  4. the boundary is real: nothing in the presentation or the store writes the
 *     match record, and no presentation file rolls a dice.
 *
 * It lives in the slow half of the suite because it plays whole matches — see
 * `vitest.patterns.ts`.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The human's own fixture on the next matchday, with lineups prepared. */
function userMatch(state: GameState): Match {
  const matchday = nextMatchday(state);
  const fixture = Object.values(state.matches).find(
    (candidate) =>
      candidate.matchday === matchday &&
      (candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId),
  );
  if (!fixture) throw new Error('no user fixture');
  prepareMatchday(state, fixture.matchday);
  return cloneMatch(state.matches[fixture.id]!);
}

/** A fixture between two clubs that are not the human's. */
function neutralMatch(state: GameState): Match {
  const matchday = nextMatchday(state);
  const fixture = Object.values(state.matches).find(
    (candidate) =>
      candidate.matchday === matchday &&
      candidate.homeClubId !== state.userClubId &&
      candidate.awayClubId !== state.userClubId,
  );
  if (!fixture) throw new Error('no neutral fixture');
  prepareMatchday(state, fixture.matchday);
  return cloneMatch(state.matches[fixture.id]!);
}

function envFor(state: GameState, match: Match) {
  return matchEnvironment(state, match, { autoManageAllBenches: true });
}

/** Every phase the laws allow a match to be in. */
const LEGAL_PHASES: readonly MatchPhase[] = [
  'kickoff',
  'open-play',
  'goal-kick',
  'corner',
  'free-kick',
  'throw-in',
  'penalty',
  'goal',
  'half-time',
  'full-time',
];

// ---------------------------------------------------------------------------
// 1. One authoritative state through the whole lifecycle
// ---------------------------------------------------------------------------

describe('the authoritative match state', () => {
  it('carries a whole match — kick-off, a restart, a goal, the interval, full time', () => {
    const phases = new Set<MatchPhase>();
    const restarts = new Set<SetPieceKind>();
    let delivered = false;
    let goalThenKickoff = false;
    let halfTime = false;
    let sawGoal = false;

    for (const seed of ['touchline-lifecycle-a', 'touchline-lifecycle-b', 'touchline-lifecycle-c']) {
      const { state } = createTestGame(seed);
      const match = userMatch(state);
      const engine = createMatchEngine(match, envFor(state, match));

      // One state, and the same object for the whole match: there is no second
      // match state per phase, per set piece, or per renderer.
      const authoritative = engine.getState();
      const step = authoritative.stepSeconds;
      let previousClock = -1;
      let inGoal = false;

      phases.add(authoritative.phase);
      expect(authoritative.phase).toBe('kickoff');

      // The hot loop checks with plain comparisons rather than `expect`: it runs
      // a hundred and sixty thousand times a match, and the invariants it is
      // holding are the point rather than the diagnostics.
      for (let guard = 0; guard < 400_000 && !engine.finished; guard += 1) {
        if (engine.getState().phase === 'half-time') {
          halfTime = true;
          engine.startSecondHalf();
        }
        engine.step(step);
        const now = engine.getState();
        if (now !== authoritative) throw new Error('the authoritative state was replaced mid-match');
        if (now.clock < previousClock) throw new Error(`the clock went backwards at ${now.clock}`);
        previousClock = now.clock;

        phases.add(now.phase);
        if (now.setPiece) {
          restarts.add(now.setPiece.kind);
          if (now.setPiece.phase !== 'setup') delivered = true;
        }
        // A goal is a phase of the same match, and the restart it leads to is a
        // kick-off — not a special case outside the play.
        if (now.phase === 'goal') {
          sawGoal = true;
          inGoal = true;
        } else if (inGoal && now.phase === 'kickoff') {
          goalThenKickoff = true;
          inGoal = false;
        }
      }

      expect(engine.finished).toBe(true);
      expect(authoritative.phase).toBe('full-time');
      expect(match.status).toBe('finished');
      expect(match.result).not.toBeNull();

      // The record a whole match leaves: the score is the goals on it.
      const goals = match.events.filter(
        (event) => event.type === 'goal' || event.type === 'own-goal' || event.type === 'penalty-scored',
      );
      expect(goals.length).toBe(match.result!.homeGoals + match.result!.awayGoals);

      // The engine is the only writer of the possession clock, and draining is
      // where it brings the record level with its own state — so the two agree
      // exactly, not approximately.
      engine.drain();
      expect(match.possessionTicks.home).toBe(Math.round(authoritative.stats.home.possessionSeconds));
      expect(match.possessionTicks.away).toBe(Math.round(authoritative.stats.away.possessionSeconds));
      expect(match.result!.homePossession + match.result!.awayPossession).toBe(100);
    }

    // Everything the brief's lifecycle asks for was observed across the seeds.
    for (const phase of phases) expect(LEGAL_PHASES).toContain(phase);
    expect(phases.has('open-play')).toBe(true);
    expect(phases.has('kickoff')).toBe(true);
    expect(phases.has('full-time')).toBe(true);
    expect(halfTime).toBe(true);
    expect(restarts.size).toBeGreaterThan(0);
    expect(delivered).toBe(true);
    expect(sawGoal).toBe(true);
    expect(goalThenKickoff).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Presentation independence
// ---------------------------------------------------------------------------

describe('watching cannot change the football', () => {
  it('gives the same record however the frames fall', () => {
    const { state } = createTestGame('touchline-render-independence');
    const original = userMatch(state);
    const watched = cloneMatch(original);
    const ragged = cloneMatch(original);
    const skipped = cloneMatch(original);

    // (a) A screen: a frame at a time, reading the state the renderer is handed
    // and interpolating between the step it was at and the step it is at.
    const onScreen = createMatchEngine(watched, envFor(state, watched));
    const frames = [1 / 60, 1 / 60, 0.016, 1 / 30, 1 / 45, 0.05, 1 / 12, 0.016];
    let frame = 0;
    while (!onScreen.finished && frame < 500_000) {
      if (onScreen.getState().phase === 'half-time') onScreen.startSecondHalf();
      const before = onScreen.getState();
      onScreen.advance(frames[frame % frames.length]!, 1);
      const after = onScreen.getState();

      // The renderer's whole licence: interpolate between two authoritative
      // readings. It is handed the same objects the engine owns, so it cannot
      // write anything back, and reading it cannot move a single outcome.
      const alpha = simulationAlpha(after);
      for (const player of after.players) {
        if (!Number.isFinite(player.px + (player.x - player.px) * alpha)) throw new Error('bad interpolation');
      }
      // Draining is where the engine reconciles the record with its own clock,
      // and it can only ever move it forwards.
      if (watched.possessionTicks.home !== Math.round(after.stats.home.possessionSeconds)) {
        throw new Error('the drained possession clock disagrees with the engine');
      }
      if (before.clock > after.clock) throw new Error('the clock went backwards while being watched');
      frame += 1;
    }
    expect(onScreen.finished).toBe(true);

    // (b) A jittering feed: tiny frames, occasional seconds-long ones.
    const jitter = createMatchEngine(ragged, envFor(state, ragged));
    const pattern = [0.016, 2.5, 0.016, 0.4, 6, 0.016, 0.05, 3, 0.016];
    let i = 0;
    while (!jitter.finished && i < 200_000) {
      if (jitter.getState().phase === 'half-time') jitter.startSecondHalf();
      const delta = pattern[i % pattern.length]!;
      jitter.advance(delta, Math.max(delta, 0.05));
      i += 1;
    }

    // (c) Nobody watching at all: straight to the whistle.
    createMatchEngine(skipped, envFor(state, skipped)).runToCompletion();

    const key = (match: Match) =>
      match.events.map((event) => `${event.second}:${event.type}:${event.playerId ?? ''}`);

    expect(key(watched)).toEqual(key(ragged));
    expect(key(watched)).toEqual(key(skipped));
    expect(watched.result).toEqual(ragged.result);
    expect(watched.result).toEqual(skipped.result);
    expect(watched.possessionTicks).toEqual(skipped.possessionTicks);
    expect(watched.period).toBe(skipped.period);
  });
});

// ---------------------------------------------------------------------------
// 3. One set of laws, two resolutions
// ---------------------------------------------------------------------------

describe('the laws both resolutions obey', () => {
  it('states each restart once', () => {
    expect(new Set(RESTART_KINDS).size).toBe(RESTART_KINDS.length);
    for (const kind of RESTART_KINDS) {
      expect(RESTART_SETUP_SECONDS[kind]).toBeGreaterThan(0);
      expect(RESTART_TAKER[kind]).toBeTruthy();
    }
    // The geometry is the laws', not a resolution's: a kick-off is the centre
    // spot, a throw-in is on the line the ball went out of.
    expect(restartSpotFor('kickoff', 'home', { x: 0.3, y: 0.7 })).toEqual({ x: 0.5, y: 0.5 });
    expect(restartSpotFor('throw-in', 'home', { x: 0.3, y: 0.1 }).y).toBeLessThan(0.05);
    expect(restartSpotFor('throw-in', 'away', { x: 0.3, y: 0.9 }).y).toBeGreaterThan(0.95);
  });

  it('walks a strike ladder from the top, and every ladder adds up to one', () => {
    for (const ladder of Object.values(RESTART_STRIKES)) {
      const total = ladder.reduce((sum, [, share]) => sum + share, 0);
      expect(total).toBeCloseTo(1, 10);
      expect(strikeOutcome(ladder, 0)).toBe(ladder[0]![0]);
      expect(strikeOutcome(ladder, 0.999)).toBe(ladder[ladder.length - 1]![0]);
    }
    // A penalty is mostly scored, and a free kick at goal is mostly not.
    // The penalty ladder is walked from what can go wrong: wide, then saved,
    // then in. (The order is the football's, not an accident — see `laws.ts`.)
    expect(strikeOutcome(RESTART_STRIKES.penalty, 0.05)).toBe('wide');
    expect(strikeOutcome(RESTART_STRIKES.penalty, 0.2)).toBe('saved');
    expect(strikeOutcome(RESTART_STRIKES.penalty, 0.5)).toBe('goal');
    expect(strikeOutcome(RESTART_STRIKES.penalty, 0.8)).toBe('goal');
    expect(strikeOutcome(RESTART_STRIKES['free-kick'], 0.05)).toBe('goal');
    expect(strikeOutcome(RESTART_STRIKES['free-kick'], 0.95)).toBe('over');
  });

  it('decides a foul by the law, whichever resolution asks', () => {
    const rng = new Rng('touchline-laws');
    expect(cardForFoul(rng, { straightRed: 0, yellow: 0, secondYellowShare: 1 }, false)).toBe('none');
    expect(cardForFoul(rng, { straightRed: 0, yellow: 1, secondYellowShare: 1 }, false)).toBe('yellow');
    // The law: a booking on a booked man is the sending off.
    expect(cardForFoul(rng, { straightRed: 0, yellow: 1, secondYellowShare: 1 }, true)).toBe('second-yellow');
    // A straight red is its own event, decided first.
    expect(cardForFoul(rng, { straightRed: 1, yellow: 1, secondYellowShare: 1 }, false)).toBe('straight-red');
    // The one deliberate softening, which the background resolution passes.
    expect(cardForFoul(rng, { straightRed: 0, yellow: 1, secondYellowShare: 0 }, true)).toBe('none');
  });

  it('allows the competition its changes, and never more than the game allows', () => {
    expect(changesAllowed(3)).toBe(3);
    expect(changesAllowed(5)).toBe(CHANGES_PER_MATCH);
    expect(changesAllowed(1)).toBe(1);
    expect(changesAllowed(0)).toBe(0);
  });

  it('gives a penalty to the club’s nominated taker, in the detailed resolution too', () => {
    // The rule itself: the nomination wins, and the resolution supplies only what
    // it judges the best available man to be.
    expect(penaltyTaker('nominated', () => 'best')).toBe('nominated');
    expect(penaltyTaker(undefined, () => 'best')).toBe('best');

    const { state } = createTestGame('touchline-penalty-taker');
    const match = userMatch(state);
    const engine = createMatchEngine(match, envFor(state, match));
    const es = engine.getState();
    const nominated = es.players.find((player) => player.side === 'home' && !player.sentOff && player.position !== 'GK')!;

    beginSetPiece(es, 'penalty', 'home', { x: 0.88, y: 0.5 }, { takerId: nominated.playerId });
    expect(es.setPiece?.kind).toBe('penalty');
    expect(es.setPiece?.takerId).toBe(nominated.playerId);

    // Without a nomination the football chooses, and it is never the keeper.
    beginSetPiece(es, 'penalty', 'home', { x: 0.88, y: 0.5 });
    const taker = es.players.find((player) => player.playerId === es.setPiece?.takerId);
    expect(taker).toBeTruthy();
    expect(taker?.position).not.toBe('GK');
  });
});

// ---------------------------------------------------------------------------
// 4. The boundary itself
// ---------------------------------------------------------------------------

describe('the boundary is enforced', () => {
  it('sends a fixture to the resolution the policy names', () => {
    const { state } = createTestGame('touchline-door');
    expect(simulationModeFor(state, userMatch(state))).toBe('full');
    expect(simulationModeFor(state, neutralMatch(state))).toBe('fast');
  });

  it('writes the match record from the simulation alone', () => {
    // The store and the presentation each once had a second account of the
    // match: the store mirrored the engine's possession clock onto the record,
    // and the presentation read the retired minute engine's own state for a phase
    // of play. Both are gone, and this is the guard that they do not come back.
    const write = /(?:possessionTicks(?:\.(?:home|away))?|match\.result)\s*=(?!=)|\.events\.push\(/;
    const offenders = scan(['src/state', 'src/presentation']).filter(({ source }) => write.test(source));
    expect(
      offenders.map((file) => file.rel),
      offenders.map((file) => `${file.rel} writes the match record`).join('\n'),
    ).toEqual([]);
  });

  it('rolls no dice outside the simulation', () => {
    // A renderer may interpolate, animate, move the camera and show effects. It
    // may not roll: an outcome that began as an animation has stopped being
    // football and become a second simulation.
    const dice = /Math\.random|\bstream\(|new Rng\(|\.chance\(/;
    const offenders = scan(['src/presentation', 'src/ui/match']).filter(({ source }) => dice.test(source));
    expect(
      offenders.map((file) => file.rel),
      offenders.map((file) => `${file.rel} rolls its own dice`).join('\n'),
    ).toEqual([]);
  });
});

/** Production sources under each directory, comments stripped. */
function scan(directories: readonly string[]): Array<{ rel: string; source: string }> {
  const out: Array<{ rel: string; source: string }> = [];
  const root = process.cwd();
  for (const directory of directories) {
    for (const file of walk(join(root, directory))) {
      const raw = readFileSync(file, 'utf8');
      out.push({
        rel: relative(root, file).replace(/\\/g, '/'),
        // Doc blocks name these things all the time; only code counts.
        source: raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
      });
    }
  }
  return out;
}

/** Every production TypeScript file under a directory, tests excluded. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}
