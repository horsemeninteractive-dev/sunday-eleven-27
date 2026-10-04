/**
 * What the pitch is actually doing, frame by frame.
 *
 * `tools/balance.ts` reads a match the way a manager does: the scoreline, the
 * shots, the possession, the mix of actions. That is the right level for asking
 * *whether the numbers are right*. It is the wrong level for asking *whether the
 * football is right*, because every one of those numbers is written by the
 * decision layer — the model that decided a striker was through on goal — and
 * none of them can see the continuous state that then plays those decisions out.
 *
 * So the two can disagree, and they do. A match can report three shots on target
 * while the trace shows all three were struck from inside his own half; it can
 * report eleven corners while the ball spends ninety minutes under nobody's
 * feet; it can write a foul three quarters of a pitch away from the players it
 * is about. Every one of those is a scoreline that looks fine.
 *
 * This walks the spatial clock — the same fixed step the browser's frame loop
 * pumps — and measures the continuous state directly, so the two layers can be
 * compared against each other and against football. Everything below is a
 * measurement of the engine as it stands today. It changes no simulation code,
 * asserts nothing, and is not part of the test suite: it exists to make the
 * weirdness *specific* before anybody tries to fix it, because "the passing
 * looks wrong" is not a number anyone can prove a fix against.
 *
 *   npm run match-readout
 *   npm run match-readout -- --seed=riverbank --games=20
 *
 * The measures, and what a healthy engine would show:
 *
 *  - **Support.** A player with the ball should have a teammate within a pass.
 *    Isolated carriers — nobody on his own side within 0.4 pitch-lengths — are
 *    counted against the frames the ball was actually under control, so this is
 *    a rate, not a raw total that just tracks how long the match was.
 *  - **Shot entry.** Where shots are struck from, binned across the pitch. A
 *    shot taken in the shooter's own half is not football; there should be none,
 *    and the histogram says how many there are and how far out they are.
 *  - **Event placement.** For fouls, corners, throw-ins and penalties: the ball's
 *    status and position in the nearest spatial frame to the event being
 *    written. A foul should have a defender and an attacker standing on it, and
 *    a throw-in should be written while the ball is out of play.
 *  - **Carry stutter.** A carrier whose destination jumps while he stands
 *    still — the signature of a player re-deciding every frame, which reads on
 *    screen as a player twitching rather than running.
 *  - **Dead ball.** Frames where the ball is out of play or nobody moved. This
 *    is the hours-of-football-not-played measure.
 *
 * It is a developer tool. Nothing in the game imports it, it is outside the test
 * suite, and it is typechecked with everything else so it cannot rot.
 */

import type { Club } from '@/domain/club';
import type { GameState } from '@/domain/game';
import type { Match, MatchEventType } from '@/domain/match';
import type { PlayerState } from '@/domain/matchState';
import { advanceMinute, beginMatch } from '@/simulation/match/engine';
import { SPATIAL_SECONDS_PER_MINUTE, advanceSpatial, ensureSpatial } from '@/simulation/match/spatial';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { createTestGame } from '@/simulation/testSupport';

// --- Arguments -------------------------------------------------------------

interface Options {
  seed: string;
  games: number;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { seed: 'readout', games: 8 };
  for (const arg of argv) {
    const [name, value] = arg.replace(/^--/, '').split('=');
    switch (name) {
      case 'seed':
        options.seed = (value ?? '').trim() || 'readout';
        break;
      case 'games':
        options.games = Math.max(1, Number(value ?? 8) || 8);
        break;
      default:
        break;
    }
  }
  return options;
}

// --- Thresholds ------------------------------------------------------------

/**
 * The fixed step the trace is taken at.
 *
 * The browser pumps the same 1/30 of a second of football every frame, so the
 * trace is taken at the same resolution: anything smaller would see frames the
 * game never draws, and anything larger would miss motion inside a frame.
 */
const STEP = 1 / 30;

/** A carrier further than this from his nearest teammate has nobody to pass to. */
const ISOLATED = 0.4;

/** How far a carrier's destination may jump in one step before it counts. */
const TARGET_JUMP = 0.02;

/** How far a player may move in one step before the step counts as movement. */
const PLAYER_MOVE = 0.002;

/** How far anybody may move in a step before the frame counts as dead. */
const DEAD_MOVE = 0.001;

/**
 * The same measure at several thresholds.
 *
 * One number for "dead" is not a baseline, it is a constant with a number next
 * to it: a step is 1/30 of a second, so 0.001 pitch-lengths is a walking pace
 * of 0.03, which a lot of footballers on a Sunday afternoon genuinely are. The
 * sensitivity is reported alongside the headline figure so that a change in the
 * dead-ball number can be read as a change in the football rather than as a
 * change in where somebody drew the line.
 */
const DEAD_THRESHOLDS = [0.001, 0.002, 0.005, 0.01] as const;

/** A foul should have both sides standing on it. */
const FOUL_REACH = 0.05;

/** Shot-entry histogram bins, across the length of the pitch. */
const SHOT_BINS = 20;

// --- The trace -------------------------------------------------------------

/** One spatial frame, flattened: everything a measure needs, nothing more. */
interface Frame {
  x: number;
  y: number;
  status: Match['spatial'] extends null ? never : string;
  ownerId: string | null;
  /** [playerId, x, y, side, tx, ty] per player, in the spatial order. */
  players: Array<[string, number, number, 'home' | 'away', number, number]>;
}

interface EventMark {
  type: MatchEventType;
  minute: number;
  clubId: string | null;
  playerId: string | null;
  /** The frame this event was written against. */
  frame: Frame;
  /** How many frames the match had run when it was written. */
  frameIndex: number;
}

interface ShotMark {
  side: 'home' | 'away';
  playerId: string | null;
  /** The shooter's own x, in the match's fixed orientation. */
  x: number;
  y: number;
}

interface GameTrace {
  frames: number;
  /** Frames the ball was actually at somebody's feet. */
  controlled: number;
  isolated: number;
  /** Isolated carriers, and how far their nearest teammate was. */
  isolatedDistances: number[];
  shots: ShotMark[];
  events: EventMark[];
  stutters: number;
  carriedFrames: number;
  deadBall: number;
  outOfPlayFrames: number;
  /** Steps in which some player moved at all — the denominator for dead ball. */
  moved: number;
  /** Largest single-player movement in each step, for the threshold sweep. */
  maxMoves: number[];
}

function emptyTrace(): GameTrace {
  return {
    frames: 0,
    controlled: 0,
    isolated: 0,
    isolatedDistances: [],
    shots: [],
    events: [],
    stutters: 0,
    carriedFrames: 0,
    deadBall: 0,
    outOfPlayFrames: 0,
    moved: 0,
    maxMoves: [],
  };
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Play one match and record every spatial step.
 *
 * The match is driven the way the browser drives it — a fixed step of the
 * spatial clock at a time, with a minute decided whenever the pitch has played
 * out what it was given — rather than through `simulateToCompletion`, which
 * skips the continuous state entirely and so could not answer any of this.
 */
function traceMatch(seed: string, index: number): GameTrace {
  const { state, draft } = createTestGame(seed);
  const [homeId, awayId] = pickEvenSides(state, draft.divisionClubIds);
  const home = state.clubs[homeId]!;
  const away = state.clubs[awayId]!;

  prepareMatchday(state, 1);
  const fixture = Object.values(state.matches).find(
    (match) => match.homeClubId === home.id && match.awayClubId === away.id,
  )!;
  prepareMatchday(state, fixture.matchday);

  const match = state.matches[fixture.id]!;
  // Each game is its own kick-off from its own seed, so a run of them is the
  // engine's own variance rather than one world repeated.
  match.seed = 7000 + index * 17;

  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  match.spatial = undefined;
  ensureSpatial(match, env);
  beginMatch(match, env);
  const spatial = match.spatial!;

  const trace = emptyTrace();
  let previous: Frame | null = null;
  let seenEvents = match.events.length;
  let seenActions = new Set(spatial.actions.map((action) => action.id));
  let guard = 0;

  // A whole match is 90 minutes of football at 1/30 of a second a step. The
  // guard is a backstop against a clock that stops advancing rather than a
  // limit: a runaway would otherwise run until the tool was killed.
  while (match.half === 1 || (match.half === 2 && !match.result) || !match.result) {
    if (guard++ > 400_000) break;
    advanceSpatial(match, env, STEP);

    const ball = spatial.ball;
    const frame: Frame = {
      x: ball.x,
      y: ball.y,
      status: ball.status,
      ownerId: ball.ownerId,
      players: spatial.players.map((p: PlayerState) => [p.playerId, p.x, p.y, p.side, p.tx, p.ty]),
    };
    trace.frames += 1;

    // --- Support: is there anybody to pass to? ---------------------------
    if (ball.status === 'controlled' && ball.ownerId) {
      trace.controlled += 1;
      const carrier = frame.players.find((entry) => entry[0] === ball.ownerId);
      if (carrier) {
        let nearest = Infinity;
        for (const entry of frame.players) {
          if (entry[0] === ball.ownerId || entry[3] !== carrier[3]) continue;
          const gap = distance(carrier[1], carrier[2], entry[1], entry[2]);
          if (gap < nearest) nearest = gap;
        }
        if (nearest > ISOLATED) {
          trace.isolated += 1;
          trace.isolatedDistances.push(nearest);
        }
      }
    }

    // --- Shot entry: where was the ball struck from? ----------------------
    for (const action of spatial.actions) {
      if (seenActions.has(action.id)) continue;
      seenActions.add(action.id);
      if (action.kind !== 'shot' || !action.playerId) continue;
      const shooter = frame.players.find((entry) => entry[0] === action.playerId);
      if (!shooter) continue;
      trace.shots.push({ side: shooter[3], playerId: action.playerId, x: shooter[1], y: shooter[2] });
    }

    // --- Carry stutter, and dead ball -------------------------------------
    if (previous) {
      // Matched by id, never by position in the array: `spatial.players` is
      // rebuilt whenever the spatial state syncs to the match, and comparing
      // frame N to frame N+1 by index would silently compare two different
      // men — which reads as everyone standing still and would make the dead
      // ball figure meaningless.
      const before = new Map(previous.players.map((entry) => [entry[0], entry]));
      let anyoneMoved = false;
      let furthest = 0;
      let stutter = false;
      for (const now of frame.players) {
        const prior = before.get(now[0]);
        if (!prior) continue;
        const moved = distance(now[1], now[2], prior[1], prior[2]);
        if (moved > DEAD_MOVE) anyoneMoved = true;
        if (moved > furthest) furthest = moved;
        if (
          frame.ownerId === now[0] &&
          moved < PLAYER_MOVE &&
          distance(now[4], now[5], prior[4], prior[5]) > TARGET_JUMP
        ) {
          stutter = true;
        }
      }
      if (frame.ownerId) trace.carriedFrames += 1;
      if (stutter) trace.stutters += 1;
      if (anyoneMoved) trace.moved += 1;
      else trace.deadBall += 1;
      trace.maxMoves.push(furthest);
    }
    if (ball.status === 'out-of-play') trace.outOfPlayFrames += 1;

    // --- Events: the frame the nearest one was written against ------------
    if (match.events.length > seenEvents) {
      for (const event of match.events.slice(seenEvents)) {
        trace.events.push({
          type: event.type,
          minute: event.minute,
          clubId: event.clubId,
          playerId: event.playerId,
          frame,
          frameIndex: trace.frames,
        });
      }
      seenEvents = match.events.length;
    }

    previous = frame;

    // The store's own rule for owing the match another minute: when the pitch
    // has spent what it was given, or has fallen a minute behind.
    const decided = match.footballSeconds ?? 0;
    const spent = !spatial.plan && (spatial.pending?.length ?? 0) === 0;
    if (
      spatial.clock >= decided + SPATIAL_SECONDS_PER_MINUTE ||
      (spent && decided - spatial.clock < SPATIAL_SECONDS_PER_MINUTE)
    ) {
      advanceMinute(match, env);
    }
  }

  // Anything written in the last tick, after the loop's final frame.
  for (const event of match.events.slice(seenEvents)) {
    const last = previous;
    if (!last) break;
    trace.events.push({
      type: event.type,
      minute: event.minute,
      clubId: event.clubId,
      playerId: event.playerId,
      frame: last,
      frameIndex: trace.frames,
    });
  }
  return trace;
}

/**
 * Two sides of even quality, taken from the world as generated.
 *
 * Nothing here is normalised: the point of this tool is to look at the engine
 * running on a real squad, so rewriting every attribute to the same number would
 * measure the tool rather than the game. Evenness is achieved by *choosing* the
 * fixture — the two division clubs whose squads are closest in average rating —
 * which leaves every player's own strengths and weaknesses intact.
 */
function pickEvenSides(state: GameState, divisionIds: readonly string[]): [string, string] {
  const rated = divisionIds
    .map((id) => ({ id, rating: sideRating(state, id) }))
    .filter((entry) => entry.id in state.clubs)
    .sort((a, b) => a.rating - b.rating);
  let best: [string, string] = [rated[0]!.id, rated[1]!.id];
  let bestGap = Infinity;
  for (let i = 0; i < rated.length; i += 1) {
    for (let j = i + 1; j < rated.length; j += 1) {
      const gap = Math.abs(rated[i]!.rating - rated[j]!.rating);
      if (gap < bestGap) {
        bestGap = gap;
        best = [rated[i]!.id, rated[j]!.id];
      }
    }
  }
  return best;
}

/** A side's average squad rating, for picking an even fixture. */
function sideRating(state: GameState, clubId: string): number {
  const club = state.clubs[clubId];
  if (!club) return 0;
  let total = 0;
  let count = 0;
  for (const id of club.squadIds) {
    const person = state.people[id];
    if (person?.kind !== 'player') continue;
    for (const group of Object.values(person.attributes)) {
      for (const value of Object.values(group as unknown as Record<string, number>)) {
        total += value;
        count += 1;
      }
    }
  }
  return count > 0 ? total / count : 0;
}

// --- Reporting -------------------------------------------------------------

function mean(total: number, count: number, digits = 2): string {
  return count === 0 ? '—' : (total / count).toFixed(digits);
}

function percent(part: number, whole: number, digits = 1): string {
  return whole === 0 ? '—' : `${((part / whole) * 100).toFixed(digits)}%`;
}

function heading(text: string): string {
  const room = Math.max(0, 74 - text.length);
  return `\n── ${text} ${'─'.repeat(room)}`;
}

function line(label: string, value: string): string {
  return `   ${label.padEnd(30)}${value}`;
}

/** A small horizontal bar, for the histogram. */
function meter(fraction: number, width = 28): string {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return '█'.repeat(filled) + '·'.repeat(width - filled);
}

/**
 * The events whose placement is a claim about the continuous state, and what the
 * pitch was doing at the moment each was written.
 */
const PLACED: readonly MatchEventType[] = ['foul', 'corner', 'throw-in', 'penalty-scored', 'penalty-missed'];

function report(options: Options, traces: readonly GameTrace[], sides: string[]): void {
  const games = traces.length;
  const frames = traces.reduce((sum, t) => sum + t.frames, 0);
  const controlled = traces.reduce((sum, t) => sum + t.controlled, 0);
  const carried = traces.reduce((sum, t) => sum + t.carriedFrames, 0);
  const shots = traces.flatMap((t) => t.shots);
  const events = traces.flatMap((t) => t.events);
  const stutters = traces.reduce((sum, t) => sum + t.stutters, 0);
  const dead = traces.reduce((sum, t) => sum + t.deadBall, 0);
  const outOfPlay = traces.reduce((sum, t) => sum + t.outOfPlayFrames, 0);
  const moved = traces.reduce((sum, t) => sum + t.moved, 0);
  const stepsWithPrevious = moved + dead;

  console.log('\n══════════════════════════════════════════════════════════════════════════');
  console.log('  MATCH READOUT — what the pitch is doing, frame by frame');
  console.log('══════════════════════════════════════════════════════════════════════════');
  console.log(line('seed', options.seed));
  console.log(line('games', `${games}   sides ${sides.join(' v ')}`));
  console.log(line('spatial steps', `${frames.toLocaleString()}   (${mean(frames, games, 0)} a match)`));

  console.log(heading('SUPPORT — a carrier with nobody to pass to'));
  console.log(line('frames ball controlled', `${controlled.toLocaleString()}`));
  console.log(line('carrier isolated >0.4', `${traces.reduce((s, t) => s + t.isolated, 0).toLocaleString()}`));
  console.log(
    line(
      'isolation rate',
      `${percent(traces.reduce((s, t) => s + t.isolated, 0), controlled)} of controlled frames ` +
        `— expect near 0%`,
    ),
  );
  const isolatedDistances = traces.flatMap((t) => t.isolatedDistances).sort((a, b) => a - b);
  if (isolatedDistances.length > 0) {
    console.log(
      line(
        'nearest teammate when alone',
        `median ${median(isolatedDistances).toFixed(2)}   ` +
          `worst ${isolatedDistances[isolatedDistances.length - 1]!.toFixed(2)} pitch-lengths`,
      ),
    );
  }

  console.log(heading('SHOT ENTRY — where shots are struck from'));
  console.log(line('shots traced', `${shots.length}`));
  if (shots.length > 0) {
    const bins = new Array<number>(SHOT_BINS).fill(0);
    for (const shot of shots) {
      const index = Math.min(SHOT_BINS - 1, Math.max(0, Math.floor(shot.x * SHOT_BINS)));
      bins[index]! += 1;
    }
    const peak = Math.max(...bins, 1);
    console.log('   x →  0.0 is the home goal, 1.0 the away goal');
    for (const [index, count] of bins.entries()) {
      if (count === 0) continue;
      const from = (index / SHOT_BINS).toFixed(2);
      console.log(
        `   ${from.padEnd(6)}${String(count).padStart(4)}  ${meter(count / peak)}`,
      );
    }
    // Home defends x=0 and attacks x=1, so a home shooter's own half is the
    // lower half and an away shooter's is the upper. Both are reported: the raw
    // x<0.5 count is the literal measure, the side-aware one is the one that
    // means something.
    const ownHalf = shots.filter((shot) => (shot.side === 'home' ? shot.x < 0.5 : shot.x > 0.5));
    const rawLower = shots.filter((shot) => shot.x < 0.5);
    console.log(
      line(
        'shots from own half',
        `${ownHalf.length} of ${shots.length} (${percent(ownHalf.length, shots.length)}) — expect 0`,
      ),
    );
    console.log(line('shots with x < 0.5 (raw)', `${rawLower.length} of ${shots.length}`));
    if (ownHalf.length > 0) {
      const worst = ownHalf.reduce((a, b) => (Math.abs(b.x - 0.5) > Math.abs(a.x - 0.5) ? b : a), ownHalf[0]!);
      console.log(
        line(
          'worst own-half entry',
          `x=${worst.x.toFixed(2)} y=${worst.y.toFixed(2)} (${worst.side})`,
        ),
      );
    }
  }

  console.log(heading('EVENT PLACEMENT — the frame each event was written against'));
  for (const type of PLACED) {
    const marks = events.filter((event) => event.type === type);
    if (marks.length === 0) {
      console.log(line(type, 'never written'));
      continue;
    }
    const statuses = new Map<string, number>();
    for (const mark of marks) statuses.set(mark.frame.status, (statuses.get(mark.frame.status) ?? 0) + 1);
    const breakdown = [...statuses.entries()].map(([status, count]) => `${status}×${count}`).join('  ');
    const xs = marks.map((mark) => mark.frame.x).sort((a, b) => a - b);
    console.log(line(type, `${marks.length} written   ball: ${breakdown}`));
    console.log(line('  ball.x when written', `median ${median(xs).toFixed(2)}   p10 ${xs[0]!.toFixed(2)}  p90 ${xs[xs.length - 1]!.toFixed(2)}`));

    if (type === 'foul') {
      // A foul is a claim about *both* sides standing on a ball, so it is
      // measured side-agnostically: how near the ball was the nearest home
      // player, and the nearest away player. Which of the two is called the
      // offender is the decision layer's business and is deliberately not
      // assumed here — the claim under test is only that two players were there.
      const gaps: Array<{ home: number; away: number }> = [];
      for (const mark of marks) {
        const { x, y, players } = mark.frame;
        let home = Infinity;
        let away = Infinity;
        for (const entry of players) {
          const gap = distance(x, y, entry[1], entry[2]);
          if (entry[3] === 'home') home = Math.min(home, gap);
          else away = Math.min(away, gap);
        }
        gaps.push({ home, away });
      }
      const both = gaps.filter((g) => g.home <= FOUL_REACH && g.away <= FOUL_REACH);
      const one = gaps.filter((g) => g.home <= FOUL_REACH || g.away <= FOUL_REACH).length;
      const homeGaps = gaps.map((g) => g.home).sort((a, b) => a - b);
      const awayGaps = gaps.map((g) => g.away).sort((a, b) => a - b);
      console.log(
        line(
          `  within ${FOUL_REACH} of both sides`,
          `${both.length}/${gaps.length} (${percent(both.length, gaps.length)}) — expect ~100%`,
        ),
      );
      console.log(line('  at least one side within reach', `${one}/${gaps.length}`));
      console.log(
        line(
          '  nearest home / away (median)',
          `${median(homeGaps).toFixed(3)} / ${median(awayGaps).toFixed(3)}   worst ${homeGaps[homeGaps.length - 1]!.toFixed(3)} / ${awayGaps[awayGaps.length - 1]!.toFixed(3)}`,
        ),
      );
    }

    if (type === 'throw-in') {
      const out = marks.filter((mark) => mark.frame.status === 'out-of-play');
      console.log(
        line(
          '  ball out-of-play at write',
          `${out.length}/${marks.length} (${percent(out.length, marks.length)}) — expect 100%`,
        ),
      );
    }
  }

  console.log(heading('CARRY STUTTER — destination jumping while standing still'));
  console.log(line('frames with a carrier', carried.toLocaleString()));
  console.log(line('stutter steps', `${stutters.toLocaleString()}   ${percent(stutters, carried)} of carried frames`));
  console.log(line('stutters a match', mean(stutters, games, 1)));

  console.log(heading('DEAD BALL — football not being played'));
  console.log(line('steps compared', stepsWithPrevious.toLocaleString()));
  console.log(line(`nobody moved >${DEAD_MOVE}`, `${dead.toLocaleString()}   ${percent(dead, stepsWithPrevious)}`));
  console.log(line('ball out-of-play', `${outOfPlay.toLocaleString()}   ${percent(outOfPlay, frames)} of frames`));
  console.log(line('dead a match', mean(dead, games, 1)));
  const maxMoves = traces.flatMap((t) => t.maxMoves);
  console.log('   the same measure at other thresholds, so the line can be seen:');
  for (const threshold of DEAD_THRESHOLDS) {
    const still = maxMoves.filter((moved) => moved <= threshold).length;
    console.log(
      `     >${threshold.toFixed(3)} to count   ${String(still).padStart(9)}   ${percent(still, maxMoves.length)}`,
    );
  }
  console.log(line('furthest man in a step (median)', median([...maxMoves].sort((a, b) => a - b)).toFixed(4)));
}

function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

// --- Entry -----------------------------------------------------------------

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const { state, draft } = createTestGame(options.seed);
  const [homeId, awayId] = pickEvenSides(state, draft.divisionClubIds);
  const sides = [`${(state.clubs[homeId] as Club).identity.name}`, `${(state.clubs[awayId] as Club).identity.name}`];

  const traces: GameTrace[] = [];
  for (let index = 0; index < options.games; index += 1) {
    traces.push(traceMatch(options.seed, index));
  }

  report(options, traces, sides);
}

main();