/**
 * What the engine claims, against what the pitch does.
 *
 * These are not tests of behaviour anybody intended. Every one of them is a
 * symptom that has been seen on screen, written down here so it can be watched
 * fail, and so that each later fix has something to prove itself against. Until
 * a test here passes, the thing it names has not been fixed — and until they all
 * pass, the engine is not producing football.
 *
 * The reason they are written against the *spatial* layer rather than the match
 * record is the whole point. `tools/balance.ts` reads the record: goals, shots,
 * possession, the mix of actions. That is the decision layer's own account of
 * itself, and it can be entirely self-consistent while the picture underneath it
 * shows a striker shooting at his own goal. A match can report eleven corners
 * and eleven events at the halfway line with nobody near them. Only the
 * continuous state — the twenty-two positions, the ball, the timed actions — is
 * an independent witness, so that is what these measure.
 *
 * **They are expected to fail.** That is the state of this file. Do not read a
 * failure here as a broken test: read it as the symptom, measured. The failure
 * messages carry the numbers behind them, so a fix can be shown to have moved
 * them rather than merely to have turned a test green.
 *
 * The one thing these do not do is guess. Where a fact the assertion needs is
 * not recorded — a shot does not store the shooter's pitch position, only the
 * decision layer knows where it *thinks* it happened — it is read from the
 * spatial frame nearest the event being written, and that is said in the test.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match, MatchEvent, MatchSpatial, MatchEventType } from '@/domain/match';
import type { MatchEnvironment } from './engine';
import { advanceMinute, beginMatch } from './engine';
import { buildContext } from './core';
import { SPATIAL_SECONDS_PER_MINUTE, advanceSpatial, ensureSpatial } from './spatial';
import { takeCorner, takeThrowIn } from './setPieces';
import { stream } from '../rng';
import { createTestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';

/** The browser's own spatial step: one thirtieth of a second of football. */
const STEP = 1 / 30;

/** A cap on a driven match, so a clock that stops advancing cannot hang a run. */
const MATCH_CAP = 220_000;

// --- Fixtures --------------------------------------------------------------

/**
 * One generated world, prepared once.
 *
 * The world is used as generated — nobody is normalised to a rating — because
 * these tests are about the engine, not about a synthetic squad, and rewriting
 * every attribute would be measuring the test. Each game is a fresh clone of the
 * same kick-off with its own seed, so a run of games is the engine's own
 * variance and costs one world build rather than one per game.
 */
function world(seed: string): { state: GameState; base: Match } {
  const { state, draft } = createTestGame(seed);
  const home = state.clubs[draft.divisionClubIds[0]!]!;
  const away = state.clubs[draft.divisionClubIds[3]!]!;
  prepareMatchday(state, 1);
  const fixture = Object.values(state.matches).find(
    (match) => match.homeClubId === home.id && match.awayClubId === away.id,
  )!;
  prepareMatchday(state, fixture.matchday);
  return { state, base: state.matches[fixture.id]! };
}

/** A single kick-off from `base`, seeded, with a pitch and the whistle gone. */
function kickOff(state: GameState, base: Match, gameSeed: number): { match: Match; env: MatchEnvironment } {
  const match = structuredClone(base);
  match.seed = gameSeed;
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  match.spatial = undefined;
  ensureSpatial(match, env);
  beginMatch(match, env);
  return { match, env };
}

/**
 * Play a match the way the browser plays it — a fixed step at a time, with a
 * minute decided whenever the pitch has played out what it was given — and hand
 * every spatial step to `visit`.
 *
 * `simulateToCompletion` cannot be used for anything in this file: it skips the
 * continuous state entirely, and the continuous state is the only witness here.
 */
function drive(match: Match, env: MatchEnvironment, visit: (spatial: MatchSpatial, index: number) => void): void {
  const spatial = match.spatial!;
  for (let index = 0; index < MATCH_CAP; index += 1) {
    advanceSpatial(match, env, STEP);
    visit(spatial, index);
    const decided = match.footballSeconds ?? 0;
    const spent = !spatial.plan && (spatial.pending?.length ?? 0) === 0;
    // `stalled` is the pitch saying it has nothing left to play and is behind the
    // clock. Without it the two conditions below cannot both be met — the pitch
    // is not a minute ahead, and it is too far behind for the "spent" case — so
    // the ball sits still for the rest of the match. Deciding a minute is the
    // caller's job; the spatial layer only reports that it needs one.
    if (
      spatial.stalled ||
      spatial.clock >= decided + SPATIAL_SECONDS_PER_MINUTE ||
      (spent && decided - spatial.clock < SPATIAL_SECONDS_PER_MINUTE)
    ) {
      if (advanceMinute(match, env).finished) return;
    }
  }
}

function playerAt(spatial: MatchSpatial, id: string): { x: number; y: number } | null {
  const node = spatial.players.find((p) => p.playerId === id);
  return node ? { x: node.x, y: node.y } : null;
}

const HEAVY = 900_000;

// --- The symptoms ----------------------------------------------------------

describe('the engine against the pitch', () => {
  // SYMPTOM: shots are struck from the shooter's own half, in numbers, and the
  // result still looks like football because the record never says where they
  // were taken from.
  it('never takes a shot from the shooter’s own half', () => {
    const events: MatchEventType[] = ['shot-saved', 'shot-blocked', 'shot-off-target', 'goal', 'penalty-scored'];
    const { state, base } = world('realism-own-half');
    const entries: Array<{ game: number; type: string; playerX: number }> = [];

    for (let game = 0; game < 30; game += 1) {
      const { match, env } = kickOff(state, base, 4000 + game * 31);
      let seen = match.events.length;
      drive(match, env, (spatial) => {
        // A shot event does not record where the shooter was standing, so the
        // shooter's x is read from the spatial frame nearest the event being
        // written. That is the only independent record of where it happened.
        if (match.events.length <= seen) return;
        for (const event of match.events.slice(seen)) {
          if (!events.includes(event.type) || !event.playerId) continue;
          const shooter = playerAt(spatial, event.playerId);
          if (shooter) entries.push({ game, type: event.type, playerX: shooter.x });
        }
        seen = match.events.length;
      });
    }

    const fromOwnHalf = entries.filter((entry) => entry.playerX < 0.45);
    expect(
      fromOwnHalf.length,
      `${fromOwnHalf.length} of ${entries.length} shots were struck from x < 0.45. ` +
        `Worst: ${JSON.stringify(fromOwnHalf.slice(0, 8))}`,
    ).toBe(0);
  }, HEAVY);

  // SYMPTOM: a corner is awarded, an event is written, and nobody is ever placed
  // at the flag — so there is no cross and the corner exists only on paper.
  it('plays a corner from the corner taker, at the flag', () => {
    const { state, base } = world('realism-corner');
    const { match, env } = kickOff(state, base, 4100);
    const sink: MatchEvent[] = [];
    takeCorner(match, env, buildContext(match, env), 'home', stream(match.seed, 'realism', 'corner'), sink);

    const corner = sink.find((event) => event.type === 'corner');
    expect(corner, 'takeCorner wrote no corner event').toBeDefined();
    const taker = corner!.playerId!;
    const flag = { x: corner!.x, y: corner!.y };

    let attempts = 0;
    let nearest = Infinity;
    drive(match, env, (spatial) => {
      for (const action of spatial.actions) {
        if (action.kind !== 'pass' && action.kind !== 'cross') continue;
        if (action.playerId !== taker) continue;
        const node = playerAt(spatial, taker);
        if (!node) continue;
        attempts += 1;
        nearest = Math.min(nearest, Math.hypot(node.x - flag.x, node.y - flag.y));
      }
    });

    expect(attempts, 'the corner taker never attempted a pass or a cross').toBeGreaterThan(0);
    expect(
      nearest,
      `the taker's closest pass or cross was ${nearest.toFixed(3)} pitch-lengths from the flag ` +
        `(needs to be within 0.06); flag at x=${flag.x.toFixed(2)} y=${flag.y.toFixed(2)}`,
    ).toBeLessThanOrEqual(0.06);
  }, HEAVY);

  // SYMPTOM: the ball goes out for a throw and play simply continues — the ball
  // is never out of play, so nobody watching can see that it left the pitch.
  it('puts the ball out of play before a throw-in', () => {
    const { state, base } = world('realism-throwin');
    const { match, env } = kickOff(state, base, 4200);
    const sink: MatchEvent[] = [];
    takeThrowIn(match, env, buildContext(match, env), 'home', stream(match.seed, 'realism', 'throw'), sink);

    // Nothing is asserted about the sink. `takeThrowIn` deliberately writes no
    // event — the ball "goes back into play where it went out and nobody writes
    // it down" — so a test that insisted on one would be testing the opposite of
    // this symptom. The claim under test is about the pitch, not the record.

    // Ten seconds of football after the throw is staged. That is the window in
    // which the ball should be lying out of play, waiting to be thrown back in.
    // Counting out-of-play frames across the whole match instead would prove
    // nothing: the ball does eventually go out of play for a corner or a goal
    // kick somewhere in a match, and that has nothing to do with this throw.
    const WINDOW = 10 * 30;
    let outOfPlay = 0;
    let steps = 0;
    drive(match, env, (spatial, index) => {
      if (index >= WINDOW) return;
      steps += 1;
      if (spatial.ball.status === 'out-of-play') outOfPlay += 1;
    });

    expect(
      outOfPlay,
      `of ${steps} spatial steps in the ten seconds after a throw-in was staged, the ball was ` +
        `out of play for none of them — the restart is decided and play simply carries on`,
    ).toBeGreaterThan(0);
  }, HEAVY);

  // SYMPTOM: fouls are written down with an offender and a victim, and the two
  // are a long way apart on the pitch — the event is written from the field
  // model, which never saw either man.
  it('puts a defender and an attacker in contact when it fouls', () => {
    const { state, base } = world('realism-foul');
    const { match, env } = kickOff(state, base, 4300);
    const gaps: number[] = [];
    let seen = match.events.length;

    drive(match, env, (spatial) => {
      if (match.events.length <= seen) return;
      for (const event of match.events.slice(seen)) {
        if (event.type !== 'foul' || !event.playerId || !event.secondaryPlayerId) continue;
        const offender = playerAt(spatial, event.playerId);
        const victim = playerAt(spatial, event.secondaryPlayerId);
        if (offender && victim) gaps.push(Math.hypot(offender.x - victim.x, offender.y - victim.y));
      }
      seen = match.events.length;
    });

    expect(gaps.length, 'the match produced no foul with both a player and a victim').toBeGreaterThan(0);
    const worst = Math.max(...gaps);
    const inContact = gaps.filter((gap) => gap <= 0.04).length;
    expect(
      worst,
      `only ${inContact} of ${gaps.length} fouls had both men within 0.04 pitch-lengths; ` +
        `worst was ${worst.toFixed(3)}`,
    ).toBeLessThanOrEqual(0.04);
  }, HEAVY);

  // SYMPTOM: the ball goes dead while the match is in progress — a player holds
  // it and the whole game stops moving, with the clock still running.
  //
  // Measured as the *distance travelled*, not as the distance from where the
  // window started to where it ended. Those are different questions, and only
  // one of them is this symptom.
  //
  // The straight line between the two ends of a window reads 0.0000 for a
  // genuine end-to-end move that happens to finish where it began — a clearance
  // upfield, a challenge thirty yards away, a free kick from the same patch of
  // grass the ball left. That is football, and measuring it as a dead window
  // meant this test could only be satisfied by a pitch where the ball never
  // came back, which is not a property of football at all.
  //
  // Path length has no such blind spot, and it is *stricter* about the symptom
  // rather than looser: a ball that is genuinely dead travels nothing, so it
  // scores zero here exactly as it did before. A restart's setup is the case that
  // matters — the ball is pinned for seconds, and those seconds must show up as
  // no movement rather than being cancelled out by the football either side.
  it('keeps the ball moving through every ten seconds of an in-progress match', () => {
    const { state, base } = world('realism-ball-moves');
    const WINDOW = 10 * 30; // ten match-seconds, at the engine's own step
    let deadest = Infinity;
    let deadestGame = -1;
    let windows = 0;

    for (let game = 0; game < 5; game += 1) {
      const { match, env } = kickOff(state, base, 4400 + game * 17);
      let fromX = 0.5;
      let fromY = 0.5;
      let travelled = 0;
      let since = 0;
      drive(match, env, (spatial) => {
        if (since === 0) {
          fromX = spatial.ball.x;
          fromY = spatial.ball.y;
          travelled = 0;
        }
        travelled += Math.hypot(spatial.ball.x - fromX, spatial.ball.y - fromY);
        fromX = spatial.ball.x;
        fromY = spatial.ball.y;
        since += 1;
        if (since < WINDOW) return;
        windows += 1;
        if (travelled < deadest) {
          deadest = travelled;
          deadestGame = game;
        }
        since = 0;
      });
    }

    expect(
      deadest,
      `the deadest ten-second window of football in ${windows} across 5 matches moved the ball ` +
        `only ${deadest.toFixed(4)} pitch-lengths in total (game ${deadestGame})`,
    ).toBeGreaterThanOrEqual(0.02);
  }, HEAVY);

  // SYMPTOM: a player on the ball is re-aimed several times a second while
  // standing still, which is the twitching that reads as a bug on the pitch.
  it('does not re-aim a carrying player more than twice in thirty steps', () => {
    const { state, base } = world('realism-carry');
    const { match, env } = kickOff(state, base, 4500);
    const SPAN = 30;
    const REAIM = 0.02;

    // The target a carrier is being sent to, sampled every step, so the sequence
    // can be walked looking for the worst thirty-step run anywhere in the match.
    const carrier: Array<{ id: string | null; tx: number; ty: number }> = [];
    drive(match, env, (spatial) => {
      if (!spatial.ball.ownerId) return;
      const node = spatial.players.find((p) => p.playerId === spatial.ball.ownerId);
      if (!node) return;
      carrier.push({ id: node.playerId, tx: node.tx, ty: node.ty });
    });

    let worst = 0;
    let windows = 0;
    for (let start = 0; start + SPAN <= carrier.length; start += 1) {
      const run = carrier.slice(start, start + SPAN);
      // Strictly consecutive: the same man at the ball for all thirty steps, not
      // merely at the first and the last.
      if (run.some((entry) => entry.id !== run[0]!.id)) continue;
      windows += 1;
      let reaims = 0;
      for (let i = 1; i < run.length; i += 1) {
        if (Math.hypot(run[i]!.tx - run[i - 1]!.tx, run[i]!.ty - run[i - 1]!.ty) > REAIM) reaims += 1;
      }
      if (reaims > worst) worst = reaims;
    }

    expect(windows, 'no carrier held the ball for thirty consecutive steps').toBeGreaterThan(0);
    expect(
      worst,
      `the most re-aims by one carrier in any thirty-step window was ${worst} ` +
        `(each re-aim moves his destination more than ${REAIM})`,
    ).toBeLessThanOrEqual(2);
  }, HEAVY);

  // SYMPTOM: nobody ever gets to the byline. Wingers hold the width but never
  // advance, so a side's wide players stand on the touchline supporting a
  // midfield that never goes forward.
  it('gets a wide player to the byline to cross', () => {
    const { state, base } = world('realism-byline');
    const perGame: Array<{ game: number; crosses: number; byline: boolean }> = [];

    for (let game = 0; game < 20; game += 1) {
      const { match, env } = kickOff(state, base, 4600 + game * 23);
      const seen = new Set(spatial0(match).actions.map((action) => action.id));
      let crosses = 0;
      let byline = false;
      drive(match, env, (spatial) => {
        // Only new actions are looked at, so the whole match costs a set lookup
        // per step rather than a walk of twenty-two players.
        for (const action of spatial.actions) {
          if (seen.has(action.id)) continue;
          seen.add(action.id);
          if (action.kind !== 'cross' || !action.playerId) continue;
          crosses += 1;
          const node = spatial.players.find((p) => p.playerId === action.playerId);
          if (node && node.baseY > 0.75 && node.x > 0.82) byline = true;
        }
      });
      perGame.push({ game, crosses, byline });
    }

    const without = perGame.filter((entry) => !entry.byline);
    expect(
      without.length,
      `${without.length} of 20 matches had no right-sided player (base y > 0.75) reach the byline ` +
        `(x > 0.82) and cross. Crosses seen: ${perGame.reduce((sum, e) => sum + e.crosses, 0)}`,
    ).toBe(0);
  }, HEAVY);

  // SYMPTOM: there is no kick-off. The whistle goes and the ball is already at
  // a player's feet with a plan installed, so the match starts in the middle of
  // a possession nobody saw begin.
  it('starts from the centre spot, with the ball not yet in play', () => {
    const { state, base } = world('realism-kickoff');
    const { match, env } = kickOff(state, base, 4700);
    const spatial = match.spatial!;

    // `beginMatch` used to hand the ball straight to a midfielder. There was no
    // moment, at any step, at which it was lying on the centre spot and nobody
    // had it.
    //
    // The status is `out-of-play` rather than `loose`, and that is the more
    // honest of the two: a ball waiting on the centre spot for the whistle is not
    // merely unowned, it is not in play yet. Either way it is on the spot with
    // nobody's foot on it, which is what the symptom was about.
    expect(
      { x: spatial.ball.x, y: spatial.ball.y, status: spatial.ball.status },
      'the ball was not on the centre spot with nobody playing it when the whistle went',
    ).toEqual({ x: 0.5, y: 0.5, status: 'out-of-play' });
    expect(spatial.ball.ownerId, 'somebody already had the ball at kick-off').toBeNull();

    advanceSpatial(match, env, STEP);
    expect(
      spatial.plan,
      'a possession plan was already installed at the first step of the match',
    ).toBeNull();
  }, HEAVY);
});

/** The spatial state's actions as they stand before the match is driven. */
function spatial0(match: Match): MatchSpatial {
  return match.spatial!;
}