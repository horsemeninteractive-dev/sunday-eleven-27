import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Match, MatchEvent, MatchEventType } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { prepareMatchday } from '@/simulation/matchday';
import { cloneMatch } from '@/simulation/match/testHelpers';
import { buildReplay } from '@/presentation/matchReplay';
import { MatchTimeline, matchLengthMinutes, replayTimelineMarks, timelineMarks } from './MatchTimeline';

/**
 * The rail is the afternoon's shape, so what it marks and where it puts it is
 * worth pinning down: only incidents that happened, in the order they happened,
 * placed by the clock the match was played on rather than by the order they were
 * written down.
 */

const sheet = readFileSync('src/ui/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function preparedMatch(seed: string): Match {
  const { state } = createTestGame(seed);
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, fixture.matchday);
  return cloneMatch(state.matches[fixture.id]!);
}

let counter = 0;
function event(match: Match, type: MatchEventType, minute: number, extra: Partial<MatchEvent> = {}): MatchEvent {
  counter += 1;
  return {
    id: `t${counter}`,
    minute,
    type,
    clubId: match.homeClubId,
    playerId: null,
    secondaryPlayerId: null,
    text: `${type} at ${minute}`,
    x: 0.5,
    y: 0.5,
    scoreAfter: { home: 0, away: 0 },
    importance: 1,
    second: minute * 60,
    ...extra,
  };
}

describe('the match timeline', () => {
  it('marks the incidents and leaves the weave of the match off the rail', () => {
    const match = preparedMatch('timeline-marks');
    match.events = [
      event(match, 'kick-off', 0, { text: 'Under way.' }),
      event(match, 'pass', 3),
      event(match, 'corner', 9, { text: 'A corner, cleared.' }),
      event(match, 'yellow-card', 20, { text: 'Booked.', importance: 2 }),
      event(match, 'goal', 33, { text: 'GOAL!', importance: 3, scoreAfter: { home: 1, away: 0 } }),
      event(match, 'injury', 55, { text: 'Down and staying down.', importance: 2, clubId: match.awayClubId }),
      event(match, 'substitution', 60, { text: 'A change.', importance: 2 }),
      event(match, 'half-time', 47, { text: 'Half time.', clubId: null, importance: 3, minute: 47 }),
      event(match, 'full-time', 92, { text: 'That is that.', clubId: null, importance: 3 }),
    ];
    match.events.sort((a, b) => a.minute - b.minute);
    match.commentary = undefined;

    const marks = timelineMarks(match);
    // Oldest first: the rail is read left to right. The kick-off is not an
    // incident and was never asked for — the rail's own start is the kick-off.
    expect(marks.map((mark) => mark.minute)).toEqual(['20', '33', '45+2', '55', '60', '90+2']);
    expect(marks.map((mark) => mark.kind)).toEqual(['card', 'goal', 'whistle', 'injury', 'substitution', 'whistle']);
    // A corner is not on it, and neither is a pass.
    expect(marks.some((mark) => mark.text === 'A corner, cleared.')).toBe(false);
    // The side is the side that did it, so a goal can be marked in that shirt.
    expect(marks.find((mark) => mark.kind === 'goal')?.side).toBe('home');
    expect(marks.find((mark) => mark.kind === 'injury')?.side).toBe('away');
    expect(marks.find((mark) => mark.kind === 'goal')?.scoreAfter).toEqual({ home: 1, away: 0 });
  });

  it('places a mark by the minute it happened on, on a rail the whole match long', () => {
    const match = preparedMatch('timeline-place');
    match.events = [
      event(match, 'yellow-card', 10, { text: 'An early one.', importance: 2 }),
      event(match, 'half-time', 45, { text: 'Half time.', clubId: null, importance: 3 }),
      event(match, 'goal', 90, { text: 'A late one.', importance: 3 }),
    ];
    match.commentary = undefined;
    const marks = timelineMarks(match);
    const early = marks.find((mark) => mark.rawMinute === 10)!;
    const late = marks.find((mark) => mark.rawMinute === 90)!;
    // A tenth of the way along for the tenth minute, and the last minute of the
    // ninety at the very end of the rail — the mark's place is its minute.
    expect(early.fraction).toBeCloseTo(10 / 90, 5);
    expect(late.fraction).toBeCloseTo(1, 5);
    expect(marks.map((mark) => mark.rawMinute)).toEqual([10, 45, 90]);
  });

  it('reads a knockout tie against the two hours that could be played', () => {
    const match = preparedMatch('timeline-knockout');
    expect(matchLengthMinutes(match)).toBe(90);
    match.knockout = true;
    expect(matchLengthMinutes(match)).toBe(120);
    match.events = [event(match, 'goal', 100, { text: 'In extra time.', importance: 3 })];
    match.commentary = undefined;
    expect(timelineMarks(match)[0]!.fraction).toBeCloseTo(100 / 120, 5);
  });

  it('draws a marker per incident, and every one of them can be pressed', () => {
    const match = preparedMatch('timeline-markup');
    match.events = [
      event(match, 'goal', 33, { text: 'GOAL!', importance: 3, scoreAfter: { home: 1, away: 0 } }),
      event(match, 'yellow-card', 44, { text: 'Booked.', importance: 2 }),
    ];
    match.commentary = undefined;
    const marks = timelineMarks(match);

    const live = renderToStaticMarkup(
      createElement(MatchTimeline, {
        marks,
        minute: 50,
        length: 90,
        homeColour: '#c33',
        awayColour: '#33c',
        onJump: () => {},
      }),
    );
    // A pressable marker names the incident it stands for rather than showing a
    // dot nobody can read out loud.
    expect(live.match(/class="mtl__mark mtl__mark--goal[^"]*"/g)).toHaveLength(1);
    expect(live).toMatch(/aria-label="Goal — 33[^"]*GOAL!"/);
    expect(live).toContain('mtl__mark--card');
    // Fifty of ninety minutes, so the played part of the rail is 5/9 of it.
    expect(live).toMatch(/width:55\.55/);

    // With nowhere to jump to the rail is still the shape of the afternoon, so
    // it is drawn — and nothing on it pretends to be a control.
    const report = renderToStaticMarkup(createElement(MatchTimeline, { marks, minute: 90, length: 90 }));
    expect(report).not.toContain('<button');
    expect(report).toContain('mtl__mark--goal');
  });

  it('puts the playhead where the caller says, for a clock that is not match time', () => {
    const match = preparedMatch('timeline-progress');
    match.events = [event(match, 'goal', 45, { text: 'GOAL!', importance: 3 })];
    match.commentary = undefined;
    const html = renderToStaticMarkup(
      createElement(MatchTimeline, { marks: [], minute: 0, length: 90, progress: 0.25 }),
    );
    expect(html).toContain('left:25%');
  });

  it('is a button, a rail and a playhead in the sheet, in the game’s own tokens', () => {
    expect(sheet).toMatch(/\.mtl__mark \{[\s\S]*?cursor: pointer;/);
    for (const kind of ['goal', 'miss', 'card', 'injury', 'substitution', 'whistle']) {
      expect(sheet, `no mark for ${kind}`).toContain(`.mtl__mark--${kind}`);
    }
    // The band the rail sits in on the live screen, and the room it takes in the
    // replay transport.
    expect(sheet).toContain('.matchday__rail');
    expect(sheet).toMatch(/\.replaybar \.mtl/);
  });
});

describe('the replay rail', () => {
  it('places its marks on the replay clock, so a press lands on the incident', () => {
    const match = preparedMatch('timeline-replay');
    match.events = [
      event(match, 'kick-off', 0, { text: 'Under way.', clubId: null }),
      event(match, 'goal', 30, { text: 'GOAL!', importance: 3, scoreAfter: { home: 1, away: 0 } }),
      event(match, 'yellow-card', 70, { text: 'Booked.', importance: 2, clubId: match.awayClubId }),
      event(match, 'full-time', 92, { text: 'That is that.', clubId: null, importance: 3 }),
    ];
    const replay = buildReplay(match)!;
    const marks = replayTimelineMarks(replay, match);

    expect(marks).toHaveLength(4);
    const goal = marks.find((mark) => mark.kind === 'goal')!;
    expect(goal.side).toBe('home');
    expect(goal.label).toBe('Goal — 30\'');
    expect(goal.scoreAfter).toEqual({ home: 1, away: 0 });
    expect(marks.find((mark) => mark.kind === 'card')?.side).toBe('away');

    // Every mark is exactly where the transport has to be taken, so the rail and
    // the scrub bar cannot disagree about where the afternoon is.
    for (const mark of marks) {
      const cue = replay.cues.find((entry) => entry.minute === mark.rawMinute)!;
      expect(mark.fraction * replay.duration).toBeCloseTo(cue.at, 6);
    }
    // In order along the rail.
    expect(marks.map((mark) => mark.rawMinute)).toEqual([0, 30, 70, 92]);
  });

  it('says nothing about a match that has no record to draw', () => {
    const match = preparedMatch('timeline-replay-empty');
    match.events = [];
    expect(buildReplay(match)).toBeNull();
  });
});
