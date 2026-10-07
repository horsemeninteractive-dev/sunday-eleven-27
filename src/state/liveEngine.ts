import type { Match, MatchEvent } from '@/domain/match';
import type { MatchEnvironment } from '@/simulation/match/core';
// The engine is obtained from Touchline's boundary rather than from the
// resolution's own directory — see `TOUCHLINE_ARCHITECTURE.md` §"Presentation
// boundary". Nothing here decides football; it creates the engine, drives it and
// relays what it already decided.
import { createMatchEngine, MatchEngine } from '@/simulation/touchline';
import { commentaryFor, recordCommentary } from '@/simulation/match/matchEngine/narrate';
import { recordEngineKeyframe } from '@/simulation/match/recording';
import { buildTimeline, type MatchTimeline } from '@/presentation/matchTimeline';

/**
 * The presentation's own state, held beside the engine.
 *
 * Only the parts that are not already in the session: the cursor in simulation
 * seconds, and whether it is fast-forwarding. The viewing mode and the speed are
 * the manager's, and live on the session; keeping them there means the controls
 * and the pump read the same value.
 */
export interface LivePlayback {
  /** Simulation seconds the presentation has reached. */
  cursor: number;
  /** True while fast-forwarding to the next thing worth watching. */
  skipping: boolean;
}

/**
 * The one live match engine, held while a match is being watched.
 *
 * A `MatchEngine` is not serialisable — it carries a closure over the decision
 * world and a step index — so it cannot live in the store's saved state. It is
 * held here instead, beside the session, keyed on the live match object: the
 * session's `live` is replaced only when a match is replaced, so the engine and
 * the match it is playing stay in step.
 *
 * Nothing here decides football. It creates the engine, hands it the real time
 * the match view has spent, and drains the events it produced into the
 * commentary transcript. It writes nothing onto the match's record: the engine
 * is the sole author of what happened, including the possession clock, which the
 * drain brings level with the engine's own (see `MatchEngine.drain`).
 */

let live: {
  match: Match;
  engine: MatchEngine;
  env: MatchEnvironment;
  timeline: MatchTimeline;
  timelineAt: number;
  playback: LivePlayback;
} | null = null;

/** The engine for a live match, created the first time it is asked for. */
export function liveEngineFor(match: Match, env: MatchEnvironment): MatchEngine {
  if (!live || live.match !== match) {
    const engine = createMatchEngine(match, env);
    // A watched match is played by the full engine, and the record says so. The
    // mode is written here, at the one place the engine is chosen, rather than
    // left to be inferred from the fact that a session exists.
    match.simulationMode = 'full';
    // Remember the movement while the match is watched, at the engine's own step
    // cadence — so the replay can play back the afternoon that was actually seen,
    // rather than draw a version of it afterwards.
    engine.observe((state) => recordEngineKeyframe(match, state));
    live = {
      match,
      engine,
      env,
      timeline: buildTimeline(match.events, match),
      timelineAt: match.events.length,
      playback: { cursor: 0, skipping: false },
    };
  }
  return live.engine;
}

/** The engine already playing this match, if one is. */
export function currentLiveEngine(): MatchEngine | null {
  return live?.engine ?? null;
}

/** The environment the live engine was built with, so a caller can adjust it. */
export function liveEngineEnv(): MatchEnvironment | null {
  return live?.env ?? null;
}

/**
 * Hand the human's bench to the AI for the rest of the match.
 *
 * Used when the manager skips to the whistle: somebody has to make the changes
 * while he is in the tea hut. It flips the flag the engine's bench review reads,
 * and nothing else about the match changes.
 */
export function setAutoManageBenches(value: boolean): void {
  if (live) live.env.autoManageAllBenches = value;
}

/** Forget the engine — a new match, a loaded save, or a return to the menu. */
export function forgetLiveEngine(): void {
  live = null;
}

/**
 * The match as passages, rebuilt only when the engine has written new events.
 *
 * The timeline is a pure reading of `match.events`, but reading a couple of
 * thousand events sixty times a second is work for nothing, so it is cached on
 * the count of events and rebuilt only when the football has said something new.
 */
export function liveTimelineFor(match: Match): MatchTimeline {
  if (!live || live.match !== match) return buildTimeline(match.events, match);
  if (live.timelineAt !== match.events.length) {
    live.timeline = buildTimeline(match.events, match);
    live.timelineAt = match.events.length;
  }
  return live.timeline;
}

/** The presentation's own state — the cursor and whether it is skipping. */
export function livePlayback(): LivePlayback | null {
  return live?.playback ?? null;
}

/** Replace the presentation state. Presentation only; it never touches the football. */
export function setLivePlayback(playback: LivePlayback): void {
  if (live) live.playback = playback;
}

/**
 * Write the engine's freshly-drained events into the match's commentary.
 *
 * The engine writes terse events because they are the record; the transcript is
 * the telling, written here from the record so the engine never has to know a
 * presenter exists. Only a watched fixture gets one — nobody reads the rest.
 */
export function narrateDrained(match: Match, env: MatchEnvironment, events: readonly MatchEvent[]): void {
  if (!env.recordCommentary || events.length === 0) return;
  recordCommentary(match, commentaryFor(events, match, env));
}

/** How many seconds of football the engine has played, for a caller keeping time. */
export function engineClock(engine: MatchEngine): number {
  return engine.getState().clock;
}
