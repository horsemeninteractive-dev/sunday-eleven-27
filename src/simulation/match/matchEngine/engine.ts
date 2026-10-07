import type { Match, MatchEvent, MatchResult } from '@/domain/match';
import { hashString, Rng, stream } from '../../rng';
import { buildContext, STOPPAGE_BOUNDS, type MatchEnvironment } from '../core';
import { conditionEffects } from '../tacticsModel';
import { BASE_INJURY_RATE, INJURY_CHECK_SECONDS, pickInjury } from './injuries';
import { updateDecisions, type DecisionWorld } from './decisions';
import { giveBallTo } from './ball';
import { drainEvents, emitEvent, statsFor } from './events';
import { celebrateGoal, settleMovement, stepMovement } from './movement';
import { clamp } from './pitch';
import { resolveInteractions } from './resolve';
import { advanceSetPiece, beginSetPiece } from './setPieces';
import { createEngineState, ensurePerformances } from './state';
import { refreshFormation, reviewBenches, substitute } from './management';
import {
  addedTimeBefore,
  displayedMinuteFor,
  periodEndSecond,
  periodStartSecond,
  periodStoppage,
  specFor,
  type MatchPeriod,
  type PeriodSpec,
} from './periods';
import { emptyStats, type MatchEngineState, type Side } from './types';

/**
 * Touchline — the detailed resolution: the match engine a manager watches.
 *
 * **Touchline decides what happens. Presentation shows what happened.** This is
 * where the football happens. It owns the clock, the phase of play, the players,
 * the ball, possession, set pieces, the score and the events; everything else — a
 * renderer, the commentary, the statistics, a future 3D view — observes the state
 * it produces and never decides anything of its own. The abstract resolution of
 * the same Touchline is `src/simulation/fastMatch/`; `TOUCHLINE_ARCHITECTURE.md` is the audit
 * of the whole system.
 *
 * The engine advances in fixed steps of football, never in browser frames. A
 * renderer may draw at 30, 60 or 144 frames a second and a manager may watch at
 * 1x or 8x; the football is the same either way, because an outcome depends only
 * on the sequence of steps and never on how often anybody drew a picture.
 */

/** How long the goal celebration holds before the kick-off. */
const GOAL_HOLD_SECONDS = 3;
/**
 * The small stoppages the engine does not model — fetching the ball, a word with
 * the referee, a lace being tied — allowed on top of the time a half actually
 * spent dead. Added time is the measured dead time plus this, not a guess.
 */
const STOPPAGE_BASE_SECONDS: Record<1 | 2, number> = { 1: 25, 2: 45 };
/** How often team strength and tactics are recomputed, in football seconds. */
const CONTEXT_REFRESH_SECONDS = 12;
/** Stamina spent per football second, for an outfield player, at full tilt. */
const STAMINA_PER_SECOND = 0.014;

export interface MatchEngineOptions {
  /**
   * Whether dead balls are arranged at all. A debug switch for tests, not a
   * product feature: it exists so a test can prove that showing a set piece
   * cannot change one, by driving two fixtures identically with restarts refused
   * in one of them.
   */
  setPiecesEnabled?: boolean;
}

export class MatchEngine {
  readonly match: Match;
  readonly env: MatchEnvironment;
  readonly state: MatchEngineState;

  private world: DecisionWorld;
  private contextAt = -Infinity;
  private benchAt = -Infinity;
  /** The clock at which the injuries were last rolled for. */
  private injuryAt = -Infinity;
  /** The shootout score, once one has been taken, for the result. */
  private penalties: { home: number; away: number } | null = null;
  private stepIndex = 0;
  /** The last whole minute the stamina pass wrote minutes-played for. */
  private staminaMinute = -1;
  /** The period the cached added-time-before figure belongs to. */
  private addedBeforePeriod: MatchPeriod | null = null;
  private addedBeforeMinutes = 0;
  /**
   * The FNV state of the `seed::engine::` prefix, folded once.
   *
   * Every step draws from a generator whose seed is derived from the step's own
   * index, so the football at step n never depends on how many steps came first.
   * Building that seed by hashing the whole string each step was measurable; the
   * hash is sequential, so the prefix is folded once and only the step's digits
   * are folded after it — the same number, a fraction of the work.
   */
  private readonly engineSeedPrefix: number;
  /**
   * A read-only observer, called after every fixed step.
   *
   * Presentation only. The step's football is already settled by the time it
   * runs, and it may not change any of it — the watched match uses it to remember
   * the movement at the simulation's own cadence rather than at the screen's, so
   * a recording is the same whatever speed it was watched at (see `observe`).
   */
  private onStep: ((state: MatchEngineState) => void) | null = null;
  /** The generator the step loop draws from, reset to each step's seed. */
  private readonly engineRng: Rng;
  /** Scratch for the step index's decimal digits, reused instead of a string. */
  private readonly stepDigits: number[] = [];

  constructor(match: Match, env: MatchEnvironment, options: MatchEngineOptions = {}) {
    this.match = match;
    this.env = env;
    this.engineSeedPrefix = hashString(`${String(match.seed)}::engine::`);
    this.engineRng = new Rng(0);
    ensurePerformances(match, env);
    this.state = createEngineState(match, env);
    this.state.setPiecesEnabled = options.setPiecesEnabled ?? true;
    this.world = { match, env, context: buildContext(match, env) };

    match.status = 'in-progress';
    match.half = 1;
    match.period = 'first-half';
    match.played = false;

    // The whistle goes and the ball is put down on the centre spot: the match
    // begins at a kick-off, not halfway through somebody's possession.
    this.setStatePiece('kickoff', 'home', { x: 0.5, y: 0.5 });
    emitEvent(this.state, match, {
      type: 'kick-off',
      side: 'home',
      text: 'Kick-off.',
      x: 0.5,
      y: 0.5,
      importance: 1,
    });
  }

  get finished(): boolean {
    return this.state.finished;
  }

  /** The engine's own authoritative state, for renderers and consumers. */
  getState(): MatchEngineState {
    return this.state;
  }

  /**
   * Register a read-only observer, called after every fixed step.
   *
   * It exists so a consumer can *remember* what happened — the watched match
   * records its movement this way — at the engine's own step cadence rather than
   * at whatever rate the screen happens to draw. A recording therefore does not
   * depend on the frame rate or the playback speed: the same football is sampled
   * at the same instants whether it was watched at 1x, at 8x or skipped through.
   *
   * The observer is handed the live state and must not mutate it. Nothing it does
   * can change a result.
   */
  observe(observer: (state: MatchEngineState) => void): void {
    this.onStep = observer;
  }

  /** Drain the events emitted since the last read. */
  drain(): MatchEvent[] {
    this.mirrorPossession();
    return drainEvents(this.state);
  }

  /**
   * Bring the match's possession ticks level with the engine's own clock.
   *
   * `match.possessionTicks` is what the statistics panel reads, and the engine
   * counts possession in seconds, so the two are reconciled here — at the one
   * moment the engine is handing the outside world everything it has decided.
   *
   * The engine is the **only** writer of that field. It used to have a second
   * one: the store mirrored the running total onto the match once per drain
   * (`liveEngine.syncEnginePossession`), which worked but left one field of the
   * record with two authors. Draining *is* the hand-over, so the reconciliation
   * lives inside the engine now, and nothing outside it writes this again — see
   * `TOUCHLINE_ARCHITECTURE.md` § "State ownership".
   *
   * Ticks only ever increase, so a caller that drains twice cannot move them
   * backwards, and a drain before kick-off leaves them at zero.
   */
  private mirrorPossession(): void {
    const stats = this.state.stats;
    const home = Math.round(stats.home.possessionSeconds);
    const away = Math.round(stats.away.possessionSeconds);
    if (home > this.match.possessionTicks.home) this.match.possessionTicks.home = home;
    if (away > this.match.possessionTicks.away) this.match.possessionTicks.away = away;
  }

  /**
   * Bring a substitute on. The manager's own change, carried out by the engine.
   *
   * Returns false when it could not be made — no changes left, or the men are
   * not where the caller thinks they are — so a caller can tell the manager.
   */
  substitute(side: Side, outgoingId: string, incomingId: string): boolean {
    return substitute(this.state, this.world, side, outgoingId, incomingId);
  }

  /**
   * Re-read a side's shape from its lineup.
   *
   * Called after a tactical change: the formation the manager picked is already
   * on the lineup, and this is what makes the engine's players play it.
   */
  refreshFormation(side: Side): void {
    refreshFormation(this.state, this.match, side);
  }

  /**
   * Advance the football by one fixed step.
   *
   * The randomness of a step is derived from the step's own index, so the
   * football at step n is the same whether the caller drove it one step at a
   * time or in a dozen frames — which is the guarantee that frame rate and
   * presentation speed cannot change a result.
   */
  step(dt: number): void {
    this.advanceStep(dt);
    if (!this.state.finished) this.onStep?.(this.state);
  }

  /** The football of one fixed step, without the observer. */
  private advanceStep(dt: number): void {
    const state = this.state;
    if (state.finished) return;

    // Watch the clock for the time the referee will add back on. A restart being
    // arranged or a goal being celebrated is football time nobody played, and it
    // is measured as it happens rather than guessed at before kick-off.
    this.trackStoppedPlay(dt);

    // Refresh the tactical reading on a slow cadence: a substitution or an
    // instruction change is felt within a few seconds, and the strength of both
    // sides is not recomputed thirty times a second for nothing.
    if (state.clock - this.contextAt >= CONTEXT_REFRESH_SECONDS) {
      this.world = { match: this.match, env: this.env, context: buildContext(this.match, this.env) };
      this.contextAt = state.clock;
    }

    // The bench is reviewed on its own slow cadence and its own random stream,
    // so a management decision can never perturb the football's own draws.
    if (state.clock - this.benchAt >= 30) {
      reviewBenches(
        state,
        this.world,
        stream(this.match.seed, 'management', this.stepIndex),
        state.clock - this.benchAt,
      );
      this.benchAt = state.clock;
    }

    // A match can hurt a man. The roll is made on its own slow cadence and its
    // own random stream, so a knock can never perturb the football's draws or
    // the bench's — and it is a fact of the football, not a presentation whim.
    if (state.clock - this.injuryAt >= INJURY_CHECK_SECONDS) {
      this.resolveInjuries();
      this.injuryAt = state.clock;
    }

    // The step's own generator, reset in place: the same draws `new Rng` seeded
    // from this step's index would produce, without the allocation.
    const rng = this.engineRng;
    rng.reset(this.engineStepSeed(this.stepIndex));
    this.stepIndex += 1;

    const phaseBefore = state.phase;

    // --- Non-football phases ------------------------------------------------
    // None of these steps the movement, so the positions the renderer
    // interpolates from are settled onto the real ones each step: without it, a
    // goal hold (or the interval, or the final whistle) leaves `px/py` frozen
    // while `x/y` moves on, and the picture shudders between the two.
    if (state.phase === 'goal') {
      state.phaseElapsed += dt;
      this.stepStamina(dt);
      if (state.phaseElapsed >= GOAL_HOLD_SECONDS) {
        // The hold is over: the restart lays everybody out afresh, so the
        // celebration is cleared and the drawn positions are settled onto the
        // real ones before the ball is placed on the centre spot.
        const conceding = state.concedingSide ?? 'home';
        state.celebration = null;
        this.setStatePiece('kickoff', conceding, { x: 0.5, y: 0.5 });
        settleMovement(state);
      } else {
        // The seconds after a goal are real movement: the scorers run for the
        // corner, the conceding side holds its ground. The ball is out of play,
        // so it rests in the net while they go.
        celebrateGoal(state, dt);
      }
      this.advanceClock(dt);
      this.afterStep(phaseBefore);
      return;
    }
    if (state.phase === 'half-time') {
      // The interval: the clock is stopped until the caller resumes. A watched
      // match waits for the manager in the changing room; a match run straight
      // out to the whistle is resumed by `runToCompletion` itself.
      state.phaseElapsed += dt;
      settleMovement(state);
      return;
    }
    if (state.phase === 'full-time') {
      settleMovement(state);
      return;
    }

    // --- The football -------------------------------------------------------
    if (state.setPiece) {
      advanceSetPiece(state, this.world, state.setPiece, dt, rng);
    } else {
      state.phase = 'open-play';
      updateDecisions(state, this.world, rng);
    }

    stepMovement(state, dt);
    resolveInteractions(state, this.world, rng);
    this.stepStamina(dt);
    this.advanceClock(dt);
    this.advancePossessionClock(dt);
    this.afterStep(phaseBefore);

    this.checkPeriodEnd();
  }

  /**
   * Advance the football by `deltaSeconds` of real time.
   *
   * Real time is converted into whole fixed steps and a carried remainder, so
   * the same span of football takes the same number of steps however it arrived.
   * A tab returning from the background hands over a huge delta; a match resumes
   * where it was rather than replaying minutes nobody watched.
   */
  advance(deltaSeconds: number, maxCatchUpSeconds = 1, collect = true): MatchEvent[] {
    const state = this.state;
    if (state.finished || !(deltaSeconds > 0)) return [];
    const step = state.stepSeconds;
    const clamped = Math.min(deltaSeconds, maxCatchUpSeconds);
    state.residual += clamped;
    let guard = 0;
    const maxSteps = Math.ceil(clamped / step) + 1;
    while (state.residual >= step && guard < maxSteps && !state.finished && state.phase !== 'half-time') {
      state.residual -= step;
      this.step(step);
      guard += 1;
    }
    // A match being run straight out to the whistle has nobody to hand its
    // events to, so it does not gather them into a fresh array every few seconds.
    return collect ? this.drain() : [];
  }

  /**
   * Send them out for the second half.
   *
   * The interval is the one moment the engine deliberately stops: nothing plays
   * until this is called, so a watched match waits for the manager and a match
   * run out without one calls this itself.
   */
  startSecondHalf(): void {
    const state = this.state;
    if (state.phase !== 'half-time' || state.finished) return;
    // The clock keeps counting: the interval does not stop football time, it
    // stops *watching*, and `second` on an event is seconds since kick-off.
    // Rewinding it to 45:00 would let a second-half event be stamped earlier
    // than the half-time whistle that preceded it, which would put the record
    // out of order for every reader of it — the timeline, a replay, a report.
    this.beginPeriod('second-half');
  }

  /**
   * Begin a period on the same unbroken clock.
   *
   * The periods tile the clock, so the second the last one ended on is the
   * second this one begins on; nothing is rewound. The ball goes back on the
   * centre spot for a kick-off, and `match.period`/`half` are kept in step for
   * the rest of the game.
   */
  private beginPeriod(period: MatchPeriod): void {
    const state = this.state;
    state.period = period;
    this.match.period = period;
    this.match.half = specFor(period).half;
    state.clock = periodStartSecond(period, addedTimeBefore(this.match, period));
    state.phaseElapsed = 0;
    state.residual = 0;
    this.setStatePiece('kickoff', period === 'extra-second' ? 'away' : 'home', { x: 0.5, y: 0.5 });
  }

  /** Run the match out without anybody watching. */
  runToCompletion(): void {
    // The limit is the theoretical maximum of a match — every period it could
    // reach, to 120 minutes for a knockout tie, plus the most added time the
    // halves could carry — because the real figure is not known until each half
    // has been measured, and this only guards against a runaway.
    const limitSeconds =
      60 * (120 + STOPPAGE_BOUNDS[1].max + STOPPAGE_BOUNDS[2].max) + 600;
    let elapsed = 0;
    while (!this.state.finished && elapsed < limitSeconds) {
      // A few seconds of football at a time; the step loop inside `advance`
      // keeps the fixed-step guarantee. Nobody is in the changing room, so the
      // interval is released immediately.
      if (this.state.phase === 'half-time') this.startSecondHalf();
      this.advance(5, 5, false);
      elapsed += 5;
    }
  }

  // --- Internals -----------------------------------------------------------

  /**
   * The seed number for one step's engine stream, from the folded prefix.
   *
   * The step index's decimal digits are written into a reused buffer rather than
   * built into a fresh string: the step index is folded a hundred and seventy
   * thousand times a match, and the string was the only allocation left in it.
   */
  private engineStepSeed(index: number): number {
    const digits = this.stepDigits;
    let length = 0;
    let n = index;
    if (n <= 0) {
      digits[0] = 48; // '0'
      length = 1;
    } else {
      while (n > 0) {
        digits[length] = 48 + (n % 10);
        length += 1;
        n = (n / 10) | 0;
      }
    }
    let hash = this.engineSeedPrefix;
    for (let i = length - 1; i >= 0; i -= 1) {
      hash ^= digits[i]!;
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  private setStatePiece(
    kind: 'kickoff',
    side: Side,
    spot: { x: number; y: number },
  ): void {
    if (!this.state.setPiecesEnabled) {
      // With restarts refused, the ball is simply handed to a midfielder — the
      // football starts again, but nothing is arranged to show it.
      const player = this.state.players.find((entry) => entry.side === side && entry.position !== 'GK' && !entry.sentOff);
      if (player) {
        player.x = spot.x;
        player.y = spot.y;
        giveBallTo(this.state, player.playerId);
      }
      this.state.phase = 'open-play';
      this.state.phaseElapsed = 0;
      this.state.setPiece = null;
      return;
    }
    beginSetPiece(this.state, kind, side, spot);
  }

  private stepStamina(dt: number): void {
    const minute = Math.floor(this.state.clock / 60);
    // Minutes played only changes when the whole minute does; the energy changes
    // every step and is written every step. Rewriting an unchanging figure for
    // twenty-two men thirty times a second was pure noise.
    const minuteChanged = minute !== this.staminaMinute;
    if (minuteChanged) this.staminaMinute = minute;
    for (const player of this.state.players) {
      if (player.sentOff) continue;
      const drain = (player.position === 'GK' ? 0.35 : 1) * STAMINA_PER_SECOND * dt;
      player.stamina = Math.max(0, player.stamina - drain);
      const performance = player.performance ?? this.match.performances[player.playerId];
      if (performance) {
        performance.energy = player.stamina;
        // The minutes-played figure is the record's own, read off the clock, so
        // a man who came on at sixty-five is not credited with the hour before.
        if (minuteChanged) {
          const cameOn = performance.cameOnMinute ?? 0;
          performance.minutesPlayed = Math.max(0, minute - cameOn);
        }
      }
    }
  }

  private advanceClock(dt: number): void {
    this.state.clock += dt;
    this.match.footballSeconds = this.state.clock;
    this.match.minute = this.displayMinute();
  }

  /**
   * The minute to *say*, as opposed to the second to keep.
   *
   * The clock runs straight through the interval — that is what makes `second`
   * mean seconds of football since kick-off — but a manager reads the second
   * half as starting at 45, not at 45 plus whatever the first half added. The
   * rebasing is the period's job, not the clock's: `displayedMinuteFor` takes
   * back out the added time already played, so the second half opens at 45 and an
   * extra-time period opens at 90 or 105, while the clock underneath never moves
   * backwards.
   */
  private displayMinute(): number {
    const period = this.state.period;
    return displayedMinuteFor(period, this.state.clock, this.addedBeforeNow(period));
  }

  /**
   * The added time played before the current period, remembered per period.
   *
   * It is a fact about the periods already finished, so it cannot change while
   * the period it belongs to is being played — but it is read on every step of
   * that period, so it is worked out once rather than a million times.
   */
  private addedBeforeNow(period: MatchPeriod): number {
    if (this.addedBeforePeriod !== period) {
      this.addedBeforePeriod = period;
      this.addedBeforeMinutes = addedTimeBefore(this.match, period);
    }
    return this.addedBeforeMinutes;
  }

  private advancePossessionClock(dt: number): void {
    // Possession is football time with the ball alive. While a dead ball is
    // being arranged — a corner, a goal kick, a throw-in, a free kick, a penalty
    // or the kick-off itself — the side that will take it owns the restart, but
    // it is not playing football, and that preparation must not be counted as
    // possession. Only open play counts.
    if (this.state.phase !== 'open-play') return;
    const side = this.state.possession;
    if (side) statsFor(this.state, side).possessionSeconds += dt;
  }

  /** Reset the phase timer whenever the phase has changed this step. */
  private afterStep(phaseBefore: MatchEngineState['phase']): void {
    if (this.state.phase !== phaseBefore) this.state.phaseElapsed = 0;
  }

  /**
   * Count the seconds of this step in which the ball was dead.
   *
   * The clock keeps counting straight through a stoppage — that is what makes
   * `second` mean seconds since kick-off — so this is how the engine remembers
   * how much of that counting nobody was playing football for. The interval and
   * the final whistle are not stoppages; the time before them is.
   */
  private trackStoppedPlay(dt: number): void {
    const state = this.state;
    if (state.phase === 'half-time' || state.phase === 'full-time') return;
    if (state.phase !== 'goal' && state.ball.status !== 'out-of-play') return;
    // Only the halves take added time; extra time is played the fifteen minutes
    // it is given, so there is nothing to count while it runs.
    if (state.period === 'first-half') state.stoppedSeconds.first += dt;
    else if (state.period === 'second-half') state.stoppedSeconds.second += dt;
  }

  /**
   * Roll for injuries among the men on the pitch, and note the unlucky one.
   *
   * At most one man goes down per check — an injury is a moment, not a wave —
   * and a man already carrying one is not hurt again. The odds come from the
   * conditions' injury rate, his hidden susceptibility and how tired he is, all
   * scaled down from the per-minute figure to this cadence.
   */
  private resolveInjuries(): void {
    const injuryRate = conditionEffects(this.match.conditions).injuryRate;
    const rng = stream(this.match.seed, 'injury', this.stepIndex);
    for (const player of this.state.players) {
      if (player.sentOff) continue;
      const performance = this.match.performances[player.playerId];
      if (!performance || performance.injuryDetail) continue;
      const person = this.env.getPlayer(player.playerId);
      if (!person) continue;

      const susceptibility = person.attributes.hidden.injurySusceptibility;
      const tiredness = 1 + (100 - player.stamina) / 140;
      const perMinute = BASE_INJURY_RATE * injuryRate * (0.4 + susceptibility / 12) * tiredness;
      if (!rng.chance(perMinute * (INJURY_CHECK_SECONDS / 60))) continue;

      performance.injuryDetail = pickInjury(rng, person, player.stamina, injuryRate);
      emitEvent(this.state, this.match, {
        type: 'injury',
        side: player.side,
        playerId: player.playerId,
        text: `${person.firstName.charAt(0)}. ${person.surname} pulls up — ${performance.injuryDetail.description}.`,
        x: player.x,
        y: player.y,
        importance: 2,
      });
      return;
    }
  }

  /**
   * Settle a period's added time from the stoppages actually seen, and record it.
   *
   * Called once, when the period reaches its nominal end. The seconds the ball
   * spent dead plus a small allowance become whole minutes, to the nearest — a
   * quiet half gets little, a stop-start one gets plenty — and the bounds in
   * `core` keep a freakish match from running to a twenty-minute half. Idempotent:
   * the football played *in* added time is not added to the added time.
   */
  private recordStoppage(period: MatchPeriod): number {
    const key: 'first' | 'second' | null =
      period === 'first-half' ? 'first' : period === 'second-half' ? 'second' : null;
    if (!key) return 0;
    const recorded = this.match.stoppage?.[key];
    if (typeof recorded === 'number') return recorded;
    const dead = key === 'first' ? this.state.stoppedSeconds.first : this.state.stoppedSeconds.second;
    const bounds = STOPPAGE_BOUNDS[key === 'first' ? 1 : 2];
    const minutes = Math.round((dead + STOPPAGE_BASE_SECONDS[key === 'first' ? 1 : 2]) / 60);
    const added = Math.max(bounds.min, Math.min(bounds.max, minutes));
    const stoppage = this.match.stoppage ?? (this.match.stoppage = {});
    stoppage[key] = added;
    return added;
  }

  /**
   * End the period, or play its added time out first.
   *
   * Everything is read from the period: its nominal end, the added time played
   * before it, and the added time it carries itself. The nominal end is measured
   * once the clock reaches it; the whistle goes once the clock reaches the
   * nominal end *plus* that added time.
   */
  private checkPeriodEnd(): void {
    const state = this.state;
    const spec = specFor(state.period);
    const addedBefore = this.addedBeforeNow(state.period);
    if (state.clock < periodEndSecond(state.period, addedBefore)) return;

    if (spec.takesStoppage) this.recordStoppage(state.period);
    if (state.clock < periodEndSecond(state.period, addedBefore + periodStoppage(this.match, state.period))) return;

    this.endPeriod(spec);
  }

  /**
   * The whistle at the end of a period.
   *
   * The first half gives way to the interval. The second half ends the match —
   * unless it is a knockout tie that is still level, which goes to extra time.
   * Each period of extra time follows the last without a stop (the football is
   * the same football), and a tie still level after both is decided on penalties.
   * A knockout tie can never be left undecided: that is the one thing a cup tie
   * must never be, and why `winnerOf` must never have to guess.
   */
  private endPeriod(spec: PeriodSpec): void {
    const state = this.state;
    if (spec.period === 'first-half') {
      emitEvent(state, this.match, {
        type: 'half-time',
        side: null,
        text: 'Half time.',
        x: 0.5,
        y: 0.5,
        importance: 3,
      });
      state.phase = 'half-time';
      state.phaseElapsed = 0;
      this.match.half = 2;
      this.match.period = 'second-half';
      return;
    }

    const level = state.score.home === state.score.away;
    if (spec.period === 'second-half' && this.match.knockout && level) {
      // A knockout tie level at ninety: two more periods of it, then penalties.
      emitEvent(state, this.match, {
        type: 'extra-time',
        side: null,
        text: `Extra time: ${state.score.home}-${state.score.away}.`,
        x: 0.5,
        y: 0.5,
        importance: 3,
      });
      this.beginPeriod('extra-first');
      return;
    }
    if (spec.period === 'extra-first') {
      this.beginPeriod('extra-second');
      return;
    }
    if (spec.period === 'extra-second' && level) {
      // Still level after a hundred and twenty minutes: penalties decide it.
      this.resolveShootout();
    }
    this.finish();
  }

  /**
   * Decide a level knockout tie on penalties.
   *
   * Deliberately outside the football: a shootout is a series of independent
   * kicks, decided by a stream of its own (`seed`, `'shootout'`, kick) and by
   * composure and technique, and nothing in the possession model, the tactics or
   * the pitch can reach it. It writes the winner onto the match and the score
   * onto the result, which is the one place a cup tie's decider is recorded — and
   * then the match ends, exactly as if the football had settled it.
   */
  private resolveShootout(): void {
    const state = this.state;
    const onPitch = (side: Side) => state.players.filter((player) => player.side === side && !player.sentOff);
    const take = (playerId: string | undefined, kick: number): boolean => {
      const player = playerId ? this.env.getPlayer(playerId) : undefined;
      const rng = stream(this.match.seed, 'shootout', kick);
      const composure = player ? player.attributes.mental.composure : 10;
      const technique = player ? player.attributes.technical.shooting : 10;
      return rng.chance(Math.max(0.45, Math.min(0.92, 0.68 + (composure - 11) / 90 + (technique - 11) / 180)));
    };

    const home = onPitch('home').map((player) => player.playerId);
    const away = onPitch('away').map((player) => player.playerId);
    const taker = (list: string[], round: number): string | undefined =>
      list.length === 0 ? undefined : list[Math.min(round, list.length - 1)];

    // Five kicks each, then sudden death: after both sides have taken the same
    // number, a lead settles it. The loop can always break — sudden death cannot
    // stay level for ever — and the fallback is the home side, so a career never
    // ends with an undecided tie even if something impossible happens.
    const REGULATION_KICKS = 5;
    const MAX_ROUNDS = 12;
    let kicksHome = 0;
    let kicksAway = 0;
    let kick = 0;
    let winner: Side = 'home';
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      if (take(taker(home, round), kick)) kicksHome += 1;
      kick += 1;
      if (take(taker(away, round), kick)) kicksAway += 1;
      kick += 1;
      if (round >= REGULATION_KICKS - 1 && kicksHome !== kicksAway) {
        winner = kicksHome > kicksAway ? 'home' : 'away';
        break;
      }
    }
    if (kicksHome === kicksAway) winner = 'home';

    this.match.shootoutWinnerId = winner === 'home' ? this.match.homeClubId : this.match.awayClubId;
    this.penalties = { home: kicksHome, away: kicksAway };
    emitEvent(state, this.match, {
      type: 'penalties',
      side: null,
      text: `Penalties: ${kicksHome}-${kicksAway}. ${
        winner === 'home' ? this.env.clubName(this.match.homeClubId) : this.env.clubName(this.match.awayClubId)
      } go through.`,
      x: 0.5,
      y: 0.5,
      importance: 3,
      scoreAfter: { ...state.score },
    });
  }

  private finish(): void {
    const state = this.state;
    if (state.finished) return;
    state.finished = true;
    state.phase = 'full-time';
    state.phaseElapsed = 0;
    // If the whistle caught a dead ball mid-arrangement, the set piece cannot
    // outlive the match: nothing will advance it now, and leaving it set would
    // leave the state describing a corner the match never took.
    state.setPiece = null;
    emitEvent(state, this.match, {
      type: 'full-time',
      side: null,
      text: `Full time: ${state.score.home}-${state.score.away}.`,
      x: 0.5,
      y: 0.5,
      importance: 3,
      scoreAfter: { ...state.score },
    });

    this.match.status = 'finished';
    this.match.played = true;
    this.match.minute = this.displayMinute();
    // The period the football finished in, not an assumption of two halves: a
    // cup tie can end in extra time, and the record should say so.
    this.match.half = specFor(state.period).half;
    this.match.period = state.period;
    this.match.result = this.buildResult();
    // The stats panel reads possession from the ticks kept on the match. The
    // old minute engine wrote them; the new engine must too, or a headless
    // match would read as an even split while its own result says otherwise.
    // Written at the whistle from the same seconds the result is built from, so
    // the two can never disagree.
    this.match.possessionTicks = {
      home: Math.round(state.stats.home.possessionSeconds),
      away: Math.round(state.stats.away.possessionSeconds),
    };

    for (const player of state.players) {
      const performance = this.match.performances[player.playerId];
      if (performance) performance.energy = player.stamina;
    }
    this.ratePerformances();
  }

  /**
   * Score every performance, once the whistle has gone.
   *
   * The engine writes the figures as the football happens; this turns them into
   * the one number a manager reads. It is a reading of the record, not a second
   * account of it, and it runs only at full time.
   */
  private ratePerformances(): void {
    const score = this.state.score;
    for (const performance of Object.values(this.match.performances)) {
      const isHome = performance.clubId === this.match.homeClubId;
      const conceded = isHome ? score.away : score.home;
      const scored = isHome ? score.home : score.away;
      const defWeight = performance.positionPlayed === 'GK' ? 1 : performance.positionPlayed.startsWith('D') || performance.positionPlayed === 'DM' ? 0.7 : performance.positionPlayed.startsWith('M') ? 0.5 : 0.3;

      let rating = 6.1;
      rating += performance.goals * 1.15;
      rating += performance.assists * 0.6;
      rating += performance.shotsOnTarget * 0.05;
      rating += performance.tackles * 0.035;
      rating += performance.interceptions * 0.03;
      rating += performance.saves * 0.12;
      rating += performance.passesCompleted * 0.004;
      rating -= performance.fouls * 0.02;
      rating -= performance.yellowCards * 0.35;
      rating -= performance.redCards * 1.4;
      rating -= conceded * 0.1 * defWeight * (performance.positionPlayed === 'GK' ? 1.4 : 1);
      if (conceded === 0) rating += 0.25 * (performance.positionPlayed === 'GK' ? 1.2 : defWeight);
      rating += scored > conceded ? 0.3 : scored === conceded ? 0.1 : -0.2;
      if (performance.minutesPlayed < 20) rating = 6 + (rating - 6) * 0.6;

      performance.rating = Math.max(3, Math.min(10, Math.round(rating * 10) / 10));
    }
  }

  private buildResult(): MatchResult {
    const state = this.state;
    const home = state.stats.home ?? emptyStats();
    const away = state.stats.away ?? emptyStats();
    const total = home.possessionSeconds + away.possessionSeconds;
    const homePossession = total <= 0 ? 50 : Math.round((home.possessionSeconds / total) * 100);
    return {
      homeGoals: state.score.home,
      awayGoals: state.score.away,
      homeShots: home.shots,
      awayShots: away.shots,
      homePossession,
      awayPossession: 100 - homePossession,
      attendance: Math.max(10, Math.round(this.env.expectedAttendance)),
      ...(this.penalties ? { penalties: this.penalties } : {}),
    };
  }
}

/** Build an engine for a fixture. */
export function createMatchEngine(match: Match, env: MatchEnvironment, options: MatchEngineOptions = {}): MatchEngine {
  return new MatchEngine(match, env, options);
}

/** Convenience: play a fixture straight out to the whistle. */
export function simulateMatchEngine(match: Match, env: MatchEnvironment, options: MatchEngineOptions = {}): MatchEngine {
  const engine = createMatchEngine(match, env, options);
  engine.runToCompletion();
  return engine;
}

/**
 * Play a fixture to the whistle with nobody watching — the headless path.
 *
 * This is the *only* way a match nobody is watching is decided, and it is the
 * same engine, step for step, that the manager watches: there is no simplified
 * AI simulation. It needs no renderer and no frame loop; it drives the fixed
 * step until the final whistle and returns the engine, whose authoritative
 * state and whose writes to `match` carry everything the rest of the game reads:
 *
 * - `match.result` — score, shots and possession, plus a shootout if there was
 *   one (the goals, the scoreline and the attendance are here too);
 * - `match.events` — the full record: goals, the scorer and assist on each, and
 *   the ordinary play besides;
 * - `match.performances` — per player: goals, assists, cards, shots, passes,
 *   tackles, saves, fouls, minutes, energy and the match rating, and an
 *   `injuryDetail` for anybody hurt;
 * - `match.possessionTicks`, `match.status`, `match.played`, `match.minute`,
 *   `match.half` and `match.period`.
 *
 * Substitutions are the engine's own (the bench is managed automatically when
 * the environment says so), so `match.substitutions` reflects the changes the
 * AI made. `engine.getState()` is exposed for a caller that wants the live
 * statistics, the per-side tally or the raw spatial state.
 */
export function simulateMatchHeadless(match: Match, env: MatchEnvironment, options: MatchEngineOptions = {}): MatchEngine {
  return simulateMatchEngine(match, env, options);
}

/** The possession split, for a caller that wants only the number. */
export function possessionShare(state: MatchEngineState): { home: number; away: number } {
  const home = state.stats.home.possessionSeconds;
  const away = state.stats.away.possessionSeconds;
  const total = home + away;
  if (total <= 0) return { home: 50, away: 50 };
  const homeShare = Math.round((home / total) * 100);
  return { home: homeShare, away: 100 - homeShare };
}

/** Clamped stamina, exposed for tests that want to watch a man tire. */
export function staminaFraction(state: MatchEngineState, playerId: string): number {
  const player = state.players.find((entry) => entry.playerId === playerId);
  return player ? clamp(player.stamina / 100, 0, 1) : 0;
}
