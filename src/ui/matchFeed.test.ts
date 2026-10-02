import { describe, expect, it } from 'vitest';
import type { Match, MatchEvent, MatchEventType } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { prepareMatchday } from '@/simulation/matchday';
import { cloneMatch } from '@/simulation/match/testHelpers';
import { buildMatchFeed, FEED_LIMIT, latestLine } from './matchFeed';

/**
 * The transcript is the manager's memory of the match, so what it keeps and
 * what it prefers is a design decision worth pinning down: the newest incident
 * must always be first, the match's own narration must win over the raw events
 * when both exist, and a requested window must still contain the latest line.
 */

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
    id: `e${counter}`,
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
    ...extra,
  };
}

describe('the match feed', () => {
  it('leads with the newest incident', () => {
    const match = preparedMatch('feed-order');
    match.events = [
      event(match, 'kick-off', 0, { text: 'We are under way.' }),
      event(match, 'foul', 12, { text: 'A trip in midfield.' }),
      event(match, 'goal', 18, { text: 'GOAL! It is in.', importance: 3, scoreAfter: { home: 1, away: 0 } }),
    ];
    const feed = buildMatchFeed(match);

    expect(feed.entries[0]!.text).toBe('GOAL! It is in.');
    expect(feed.entries[0]!.kind).toBe('Goal');
    expect(feed.entries[0]!.tone).toBe('major');
    expect(feed.entries[0]!.scoreAfter).toEqual({ home: 1, away: 0 });
    expect(feed.entries[feed.entries.length - 1]!.text).toBe('We are under way.');
  });

  it('can be bounded to a window, keeping the newest end', () => {
    const match = preparedMatch('feed-bounded');
    match.events = Array.from({ length: FEED_LIMIT * 3 }, (_, index) =>
      event(match, 'note', index + 1, { text: `comment ${index + 1}`, clubId: null }),
    );
    const feed = buildMatchFeed(match, { limit: FEED_LIMIT });

    expect(match.events.length).toBeGreaterThan(FEED_LIMIT);
    expect(feed.entries).toHaveLength(FEED_LIMIT);
    // Still the newest at the top, and still going back the right distance.
    expect(feed.entries[0]!.text).toBe(`comment ${FEED_LIMIT * 3}`);
    expect(feed.entries[FEED_LIMIT - 1]!.text).toBe(`comment ${FEED_LIMIT * 2 + 1}`);
  });

  it('drops the ordinary business when asked for key incidents', () => {
    const match = preparedMatch('feed-key-only');
    match.events = [
      event(match, 'corner', 5, { text: 'A corner, cleared.' }),
      event(match, 'yellow-card', 20, { text: 'Booking.', importance: 2 }),
      event(match, 'goal', 30, { text: 'GOAL!', importance: 3 }),
    ];
    const keys = buildMatchFeed(match, { keyOnly: true });

    expect(keys.entries.map((entry) => entry.kind)).toEqual(['Goal', 'Yellow card']);
    expect(keys.entries.some((entry) => entry.text === 'A corner, cleared.')).toBe(false);
    // And the full feed still has everything.
    expect(buildMatchFeed(match).entries).toHaveLength(3);
  });

  it('tells first-half stoppage from the second half, minute by minute', () => {
    const match = preparedMatch('feed-minutes');
    match.events = [
      event(match, 'note', 47, { text: 'Stoppage-time scramble.', clubId: null }),
      event(match, 'half-time', 47, { text: 'Half-time.', clubId: null, importance: 3 }),
      event(match, 'note', 47, { text: 'Second half under way.', clubId: null }),
    ];
    const feed = buildMatchFeed(match);
    const labels = feed.entries.map((entry) => entry.minute);

    // Newest first: the second half reads plainly, the first-half one does not.
    expect(labels).toEqual(['47', '45+2', '45+2']);
  });

  it('hands the newest incident to whoever asks for the current line', () => {
    const match = preparedMatch('feed-strip');
    match.events = [
      event(match, 'note', 10, { text: 'The first thing.', clubId: null }),
      event(match, 'goal', 20, { text: 'GOAL!', importance: 3, scoreAfter: { home: 1, away: 0 } }),
    ];
    const feed = buildMatchFeed(match);
    expect(latestLine(feed)?.text).toBe('GOAL!');
    expect(feed.entries[0]!.text).toBe('GOAL!');
    expect(feed.entries.slice(1).map((entry) => entry.text)).toEqual(['The first thing.']);
  });

  it('prefers the match\'s own narration to the raw events', () => {
    const match = preparedMatch('feed-narrated');
    match.events = [event(match, 'goal', 20, { text: 'GOAL!', importance: 3 })];
    match.commentary = [
      {
        id: 'c1',
        minute: 20,
        firstHalf: true,
        side: 'home',
        category: 'movement',
        priority: 'developing',
        kind: null,
        text: 'Jackson carries it forward.',
        x: 0.6,
        y: 0.5,
        scoreAfter: null,
        playerId: null,
      },
      {
        id: 'c2',
        minute: 20,
        firstHalf: true,
        side: 'home',
        category: 'major',
        priority: 'major',
        kind: 'Goal',
        text: 'GOAL!',
        x: 0.8,
        y: 0.5,
        scoreAfter: { home: 1, away: 0 },
        playerId: null,
      },
    ];
    const feed = buildMatchFeed(match);

    expect(feed.narrated).toBe(true);
    expect(feed.entries.map((entry) => entry.text)).toEqual(['GOAL!', 'Jackson carries it forward.']);
    expect(feed.entries[0]!.scoreAfter).toEqual({ home: 1, away: 0 });
    // The build-up is developing, so a reader asking for key incidents alone
    // is left with the goal.
    expect(buildMatchFeed(match, { keyOnly: true }).entries.map((entry) => entry.text)).toEqual(['GOAL!']);
  });

  it('falls back to the events when a match carries no narration', () => {
    const match = preparedMatch('feed-fallback');
    match.events = [event(match, 'goal', 20, { text: 'GOAL!', importance: 3 })];
    match.commentary = undefined;
    const feed = buildMatchFeed(match);
    expect(feed.narrated).toBe(false);
    expect(feed.entries.map((entry) => entry.text)).toEqual(['GOAL!']);
  });
});
