import { describe, expect, it } from 'vitest';
import type { MatchEvent, MatchEventType } from '@/domain/match';
import { buildTimeline, highlightPassages, nextPassageAfter, passageAt } from './matchTimeline';

/**
 * The timeline is the presentation's reading of the engine's record: it turns a
 * flat list of events into the passages a manager would recognise. These tests
 * pin the rules that make it predictable — a change of side, a long lull or a
 * hard break opens a new passage — because everything downstream (the viewing
 * modes, the highlight selector) is only as trustworthy as this grouping.
 */

const TEAMS = { homeClubId: 'club-home', awayClubId: 'club-away' };

let nextId = 0;

function event(
  type: MatchEventType,
  second: number,
  clubId: string | null,
  importance: 1 | 2 | 3 = 1,
): MatchEvent {
  nextId += 1;
  return {
    id: `e${nextId}`,
    minute: Math.floor(second / 60),
    second,
    type,
    clubId,
    playerId: null,
    secondaryPlayerId: null,
    text: `${type} at ${second}`,
    x: 0.5,
    y: 0.5,
    scoreAfter: { home: 0, away: 0 },
    importance,
  };
}

describe('match timeline', () => {
  it('groups a side’s continuous play into one passage', () => {
    const timeline = buildTimeline(
      [
        event('kick-off', 0, null, 1),
        event('note', 1, TEAMS.homeClubId),
        event('note', 3, TEAMS.homeClubId),
        event('note', 5, TEAMS.homeClubId),
      ],
      TEAMS,
    );

    // The kick-off is its own neutral passage; the home side's play is the next.
    expect(timeline.passages).toHaveLength(2);
    const play = timeline.passages[1]!;
    expect(play.side).toBe('home');
    expect(play.startSecond).toBe(1);
    expect(play.startSecond).toBe(1);
    expect(play.endSecond).toBe(5);
    expect(play.events).toHaveLength(3);
  });

  it('keeps a passage together even as the two sides exchange events', () => {
    // The engine names the man who *did* each thing, so a tackle by the
    // defending side lands inside the attacking passage that provoked it. The
    // grouping must not split on that, or every event becomes its own passage.
    const timeline = buildTimeline(
      [
        event('note', 1, TEAMS.homeClubId),
        event('note', 2, TEAMS.awayClubId),
        event('note', 3, TEAMS.homeClubId),
        event('note', 4, TEAMS.awayClubId),
      ],
      TEAMS,
    );

    expect(timeline.passages).toHaveLength(1);
    // The side the passage belongs to is read from the loudest moment, and with
    // no key event it falls back to whoever caused most of it.
    expect(timeline.passages[0]!.events).toHaveLength(4);
  });

  it('names a passage after the side its key moment belongs to', () => {
    const timeline = buildTimeline(
      [
        event('note', 1, TEAMS.awayClubId),
        event('shot-saved', 2, TEAMS.awayClubId, 2),
      ],
      TEAMS,
    );
    expect(timeline.passages[0]!.side).toBe('away');
  });

  it('opens a new passage when the ball changes hands', () => {
    // The on-ball events the engine now writes — pass, carry, tackle — are what
    // make a possession legible. A run of them by one side is the move; the first
    // one by the other side is where it ended, even with no pause between them.
    const timeline = buildTimeline(
      [
        event('pass', 1, TEAMS.homeClubId),
        event('pass', 3, TEAMS.homeClubId),
        event('carry', 4, TEAMS.homeClubId),
        event('tackle', 5, TEAMS.awayClubId),
        event('pass', 6, TEAMS.awayClubId),
      ],
      TEAMS,
    );

    expect(timeline.passages).toHaveLength(2);
    expect(timeline.passages[0]!.events).toHaveLength(3);
    expect(timeline.passages[0]!.side).toBe('home');
    // The tackle begins the other side's passage, so it is theirs.
    expect(timeline.passages[1]!.events.map((e) => e.type)).toEqual(['tackle', 'pass']);
    expect(timeline.passages[1]!.side).toBe('away');
    expect(timeline.passages[1]!.outcome).toBe('turnover');
  });

  it('does not split a move on a non-ball event that names the other side', () => {
    // An interception is recorded against the man who made it, but the move is
    // still the passer's until an on-ball event changes hands.
    const timeline = buildTimeline(
      [
        event('pass', 1, TEAMS.homeClubId),
        event('note', 2, TEAMS.awayClubId),
        event('pass', 3, TEAMS.homeClubId),
      ],
      TEAMS,
    );
    expect(timeline.passages).toHaveLength(1);
    expect(timeline.passages[0]!.events).toHaveLength(3);
  });

  it('ends a passage after a lull longer than the gap', () => {
    const timeline = buildTimeline(
      [event('note', 1, TEAMS.homeClubId), event('note', 30, TEAMS.homeClubId)],
      TEAMS,
    );

    expect(timeline.passages).toHaveLength(2);
    expect(timeline.passages[0]!.endSecond).toBe(1);
    expect(timeline.passages[1]!.startSecond).toBe(30);
  });

  it('ends the passage on a goal, keeping the move that made it', () => {
    const timeline = buildTimeline(
      [
        event('note', 1, TEAMS.homeClubId),
        event('note', 2, TEAMS.homeClubId),
        event('goal', 3, TEAMS.homeClubId, 3),
        event('note', 4, TEAMS.homeClubId),
      ],
      TEAMS,
    );

    // The goal closes the move that produced it — the build-up and the finish are
    // one passage, because that is the highlight — and the play after it opens a
    // new one.
    expect(timeline.passages).toHaveLength(2);
    const goal = timeline.passages[0]!;
    expect(goal.goal).toBe(true);
    expect(goal.outcome).toBe('goal');
    expect(goal.importance).toBe(3);
    expect(goal.events).toHaveLength(3);
    expect(goal.events[goal.events.length - 1]!.type).toBe('goal');
    expect(goal.keyEventId).toBe(goal.events[2]!.id);
    expect(timeline.passages[1]!.startSecond).toBe(4);
  });

  it('rates a passage by its loudest event and names its key moment', () => {
    const timeline = buildTimeline(
      [
        event('note', 1, TEAMS.awayClubId, 1),
        event('shot-saved', 2, TEAMS.awayClubId, 2),
        event('note', 3, TEAMS.awayClubId, 1),
      ],
      TEAMS,
    );

    const passage = timeline.passages[0]!;
    expect(passage.importance).toBe(2);
    expect(passage.outcome).toBe('shot');
    // The key event is the shot, not the last routine note.
    expect(passage.events.find((e) => e.id === passage.keyEventId)!.type).toBe('shot-saved');
  });

  it('reads a whole match from the engine without inventing anything', () => {
    // A synthetic but complete record: a goal, a booking, the whistles.
    const timeline = buildTimeline(
      [
        event('kick-off', 0, null, 1),
        event('note', 20, TEAMS.homeClubId),
        event('half-time', 45 * 60, null, 3),
        event('goal', 72 * 60 + 31, TEAMS.homeClubId, 3),
        event('foul', 80 * 60, TEAMS.awayClubId, 2),
        event('yellow-card', 80 * 60 + 2, TEAMS.awayClubId, 2),
        event('full-time', 90 * 60, null, 3),
      ],
      TEAMS,
    );

    // Every event is accounted for exactly once, in order.
    const flat = timeline.passages.flatMap((passage) => passage.events);
    expect(flat).toHaveLength(7);
    expect(flat.map((e) => e.second)).toEqual([0, 20, 45 * 60, 72 * 60 + 31, 80 * 60, 80 * 60 + 2, 90 * 60]);
    // The goal is preserved with its second, not rounded to a minute.
    expect(flat.find((e) => e.type === 'goal')!.second).toBe(72 * 60 + 31);
  });

  it('finds the passage at and after a second', () => {
    const timeline = buildTimeline(
      [
        event('note', 1, TEAMS.homeClubId),
        event('goal', 2, TEAMS.homeClubId, 3),
        event('note', 40, TEAMS.awayClubId),
      ],
      TEAMS,
    );

    // Before the first event there is no passage yet.
    expect(passageAt(timeline, 0)).toBeNull();
    expect(passageAt(timeline, 1)?.side).toBe('home');
    expect(passageAt(timeline, 2)?.goal).toBe(true);
    expect(passageAt(timeline, 39)?.goal).toBe(true);
    expect(nextPassageAfter(timeline, 2)?.startSecond).toBe(40);
    expect(nextPassageAfter(timeline, 100)).toBeNull();
  });

  it('selects only the passages worth a highlight reel', () => {
    const timeline = buildTimeline(
      [
        event('note', 1, TEAMS.homeClubId, 1),
        // A lull, then the move that ended in the goal: two passages, the second
        // loud.
        event('shot-saved', 20, TEAMS.homeClubId, 2),
        event('goal', 21, TEAMS.homeClubId, 3),
      ],
      TEAMS,
    );

    expect(timeline.passages).toHaveLength(2);
    expect(highlightPassages(timeline, 1)).toHaveLength(2);
    expect(highlightPassages(timeline, 2)).toHaveLength(1);
    expect(highlightPassages(timeline, 3)).toHaveLength(1);
    expect(highlightPassages(timeline, 3)[0]!.goal).toBe(true);
  });

  it('falls back to the minute for events recorded before seconds existed', () => {
    const legacy: MatchEvent = { ...event('note', 0, TEAMS.homeClubId), second: undefined, minute: 3 };
    const timeline = buildTimeline([legacy], TEAMS);
    expect(timeline.passages[0]!.startSecond).toBe(180);
    expect(timeline.durationSeconds).toBe(180);
  });
});
