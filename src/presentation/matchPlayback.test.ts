import { describe, expect, it } from 'vitest';
import type { MatchEvent, MatchEventType } from '@/domain/match';
import { buildTimeline } from './matchTimeline';
import {
  beginSkip,
  createCursor,
  estimatedWatchSeconds,
  MAX_SKIP_STEP_SECONDS,
  passageShown,
  realSecondsPerSimSecond,
  simSecondsForRealDelta,
  tickPlayback,
  type ViewingMode,
} from './matchPlayback';

/**
 * The presentation layer's contract with the simulation.
 *
 * The point of the split is that the football does not depend on how it is
 * watched. These tests pin the other half: the presentation *does* depend on the
 * football, spending more real time on a chance than on a throw-in, and never
 * changing what happened.
 */

const TEAMS = { homeClubId: 'h', awayClubId: 'a' };
let nextId = 0;

function event(type: MatchEventType, second: number, clubId: string | null, importance: 1 | 2 | 3 = 1): MatchEvent {
  nextId += 1;
  return {
    id: `e${nextId}`,
    minute: Math.floor(second / 60),
    second,
    type,
    clubId,
    playerId: null,
    secondaryPlayerId: null,
    text: type,
    x: 0.5,
    y: 0.5,
    scoreAfter: { home: 0, away: 0 },
    importance,
  };
}

/** A match with one quiet spell, then a chance, then a goal. */
function sampleTimeline() {
  return buildTimeline(
    [
      event('kick-off', 0, null, 1),
      event('note', 5, TEAMS.homeClubId, 1),
      event('note', 6, TEAMS.homeClubId, 1),
      event('shot-saved', 100, TEAMS.homeClubId, 2),
      event('goal', 200, TEAMS.homeClubId, 3),
    ],
    TEAMS,
  );
}

describe('match playback', () => {
  it('spends more real time on an important passage than a routine one', () => {
    const timeline = sampleTimeline();
    const quiet = timeline.passages.find((p) => p.importance === 1)!;
    const chance = timeline.passages.find((p) => p.importance === 2)!;
    const goal = timeline.passages.find((p) => p.importance === 3)!;

    const filler = realSecondsPerSimSecond(quiet, 'full', 1);
    const notable = realSecondsPerSimSecond(chance, 'full', 1);
    const critical = realSecondsPerSimSecond(goal, 'full', 1);

    expect(filler).toBeGreaterThan(0);
    expect(notable).toBeGreaterThan(filler);
    expect(critical).toBeGreaterThan(notable);
  });

  it('shows a passage in detail only when the mode asks for it', () => {
    const timeline = sampleTimeline();
    const quiet = timeline.passages.find((p) => p.importance === 1)!;
    const chance = timeline.passages.find((p) => p.importance === 2)!;
    const goal = timeline.passages.find((p) => p.importance === 3)!;

    expect(passageShown(quiet, 'full')).toBe(true);
    expect(passageShown(chance, 'full')).toBe(true);
    expect(passageShown(quiet, 'extended')).toBe(false);
    expect(passageShown(chance, 'extended')).toBe(true);
    expect(passageShown(chance, 'key')).toBe(false);
    expect(passageShown(goal, 'key')).toBe(true);
  });

  it('never changes what is shown when only the speed changes', () => {
    const timeline = sampleTimeline();
    const chance = timeline.passages.find((p) => p.importance === 2)!;

    // Speed divides the real cost; it does not move the threshold.
    for (let speed = 1; speed <= 8; speed *= 2) {
      expect(passageShown(chance, 'extended')).toBe(true);
    }
    expect(realSecondsPerSimSecond(chance, 'full', 8)).toBeCloseTo(
      realSecondsPerSimSecond(chance, 'full', 1) / 8,
      6,
    );
  });

  it('spends ordinary play far faster than real time', () => {
    const timeline = sampleTimeline();
    const quiet = timeline.passages.find((p) => p.importance === 1)!;
    // One real second buys several simulation seconds of filler: the fast-forward.
    const gained = simSecondsForRealDelta(createCursor(quiet.startSecond), 'full', 1, timeline, 1);
    expect(gained).toBeGreaterThan(2);
    // And a goal is watched close to real time, not compressed away.
    const goal = timeline.passages.find((p) => p.importance === 3)!;
    const atGoal = simSecondsForRealDelta(createCursor(goal.startSecond), 'full', 1, timeline, 1);
    expect(atGoal).toBeLessThan(gained);
    expect(atGoal).toBeLessThan(2);
  });

  it('runs the cursor forward and leaves the engine to catch up', () => {
    const timeline = sampleTimeline();
    const start = createCursor(0);
    const tick = tickPlayback(start, 'full', 1, timeline, 1);
    expect(tick.cursor).toBeGreaterThan(start.cursor);
    expect(tick.skipping).toBe(false);
    expect(tick.passage).not.toBeNull();
  });

  it('skips quickly and lands on the next passage the mode shows', () => {
    const timeline = sampleTimeline();
    // Begin skipping from inside the quiet passage; the next thing worth showing
    // is the chance at 100s.
    const from = beginSkip(createCursor(6));
    let cursor = from;
    let guard = 0;
    while (guard < 1000) {
      const tick = tickPlayback({ cursor: cursor.cursor, skipping: cursor.skipping }, 'extended', 1, timeline, 0.1);
      cursor = { cursor: tick.cursor, skipping: tick.skipping };
      if (!tick.skipping) break;
      guard += 1;
    }

    expect(cursor.skipping).toBe(false);
    // Landed exactly on the chance's first second, not past it.
    expect(cursor.cursor).toBe(100);
  });

  it('never lets one skip tick run past the highlight it is heading for', () => {
    const timeline = sampleTimeline();
    // However large the frame, a skip tick is capped, so the cursor lands on the
    // chance rather than sailing through it and having to be wound back.
    const one = tickPlayback(beginSkip(createCursor(6)), 'extended', 1, timeline, 10);
    expect(one.cursor).toBeLessThanOrEqual(6 + MAX_SKIP_STEP_SECONDS);

    let state = beginSkip(createCursor(6));
    let biggestStep = 0;
    for (let guard = 0; guard < 500; guard += 1) {
      const before = state.cursor;
      const tick = tickPlayback(state, 'extended', 1, timeline, 10);
      biggestStep = Math.max(biggestStep, tick.cursor - before);
      state = { cursor: tick.cursor, skipping: tick.skipping };
      if (!tick.skipping) break;
    }
    expect(state.skipping).toBe(false);
    expect(state.cursor).toBe(100);
    expect(biggestStep).toBeLessThanOrEqual(MAX_SKIP_STEP_SECONDS);
  });

  it('reaches the same second with a big delta as with many small ones', () => {
    const timeline = sampleTimeline();
    const one = tickPlayback(createCursor(0), 'full', 1, timeline, 1);
    let many = createCursor(0);
    for (let i = 0; i < 100; i += 1) {
      const tick = tickPlayback(many, 'full', 1, timeline, 0.01);
      many = { cursor: tick.cursor, skipping: tick.skipping };
    }
    expect(many.cursor).toBeCloseTo(one.cursor, 4);
  });

  it('estimates a full match as far longer than a highlights package', () => {
    const timeline = sampleTimeline();
    const full = estimatedWatchSeconds(timeline, 'full');
    const key = estimatedWatchSeconds(timeline, 'key');
    expect(full).toBeGreaterThan(key);
  });

  it('accepts every viewing mode without dividing by zero', () => {
    const timeline = sampleTimeline();
    for (const mode of ['full', 'extended', 'key', 'commentary'] as ViewingMode[]) {
      const tick = tickPlayback(createCursor(0), mode, 1, timeline, 0.05);
      expect(Number.isFinite(tick.cursor)).toBe(true);
      expect(tick.cursor).toBeGreaterThanOrEqual(0);
    }
  });
});
