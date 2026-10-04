import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import type { PossessionChain } from './possession';
import type { CommentaryEvent } from '@/domain/match';
import { createTestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { cloneMatch } from './testHelpers';
import { advanceMinute, beginMatch } from './engine';
import { splitCommentaryByChain } from './passages';
import {
  SPATIAL_SECONDS_PER_MINUTE,
  advanceSpatial,
  ensureSpatial,
  flushUntoldCommentary,
  installPossessionChains,
} from './spatial';
import type { TimelineAction } from './actionTimeline';

/**
 * The words are said as the football happens.
 *
 * A minute's commentary used to be written and shown the instant the minute was
 * decided — a full minute before the picture had played any of it, so the bar
 * was narrating a move the pitch had not started. The words are now dealt out
 * to the chains the pitch plays and told as each chain takes it, which is what
 * these pin down.
 */

function userMatch(state: GameState): Match {
  const fixture = Object.values(state.matches).find(
    (c) => c.homeClubId === state.userClubId || c.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, fixture.matchday);
  return cloneMatch(state.matches[fixture.id]!);
}

function staged(seed: string) {
  const { state } = createTestGame(seed);
  const match = userMatch(state);
  const env = matchEnvironment(state, match, { autoManageAllBenches: true });
  match.spatial = undefined;
  ensureSpatial(match, env);
  beginMatch(match, env);
  return { match, env, spatial: match.spatial! };
}

function chain(seconds: number, side: 'home' | 'away', player: string, target: string | null): PossessionChain {
  const action: TimelineAction = {
    kind: target ? 'pass' : 'carry',
    decision: target ? 'pass' : 'carry',
    side,
    playerId: player,
    targetPlayerId: target,
    fromX: 0.5,
    fromY: 0.5,
    toX: 0.6,
    toY: 0.5,
    startSecond: 0,
    duration: 3,
    outcome: target ? 'completed' : 'carry',
  };
  return { side, seconds, receivers: [], actions: [action], goal: false };
}

function line(text: string, progress: number | null): CommentaryEvent {
  return {
    id: `draft-${text}`,
    minute: 1,
    firstHalf: true,
    category: 'passing',
    priority: 'routine',
    kind: null,
    text,
    x: 0.5,
    y: 0.5,
    scoreAfter: null,
    playerId: null,
    side: 'home',
    progress: progress ?? undefined,
  } as CommentaryEvent;
}

describe('commentary is told as its chain is played', () => {
  it('says one line per step, not the whole chain at once', () => {
    // A chain of several steps spends seconds on screen playing them. Announcing
    // all of its words the instant it arrives put the bar seconds ahead of the
    // football, so the manager was reading about a pass that had not been played.
    const { match, env, spatial } = staged('one-line-per-step');
    const home = spatial.players.filter((n) => n.side === 'home' && n.position !== 'GK');
    const ids = home.slice(0, 4).map((n) => n.playerId);
    const actions: TimelineAction[] = [
      { kind: 'carry', decision: 'carry', side: 'home', playerId: ids[0]!, targetPlayerId: null, fromX: 0.4, fromY: 0.5, toX: 0.45, toY: 0.5, startSecond: 0, duration: 3, outcome: 'carry' },
      { kind: 'pass', decision: 'pass', side: 'home', playerId: ids[0]!, targetPlayerId: ids[1]!, fromX: 0.45, fromY: 0.5, toX: 0.55, toY: 0.5, startSecond: 3, duration: 3, outcome: 'completed' },
      { kind: 'carry', decision: 'carry', side: 'home', playerId: ids[1]!, targetPlayerId: null, fromX: 0.55, fromY: 0.5, toX: 0.6, toY: 0.5, startSecond: 6, duration: 3, outcome: 'carry' },
      { kind: 'pass', decision: 'pass', side: 'home', playerId: ids[1]!, targetPlayerId: ids[2]!, fromX: 0.6, fromY: 0.5, toX: 0.7, toY: 0.5, startSecond: 9, duration: 3, outcome: 'completed' },
    ];
    const chain: PossessionChain = { side: 'home', seconds: 12, receivers: [], actions, goal: false };
    const lines = [
      line('Turner collects.', 0.0),
      line('Turner finds Jackson.', 0.3),
      line('Jackson carries it forward.', 0.6),
      line('And plays it on.', 0.9),
    ];

    const before = match.commentary?.length ?? 0;
    installPossessionChains(match, env, [chain], [lines]);

    // The chain is on the pitch but its first step is a carry that has to gather
    // the ball first, so it has not begun and nothing has been said about it.
    expect((match.commentary?.length ?? 0) - before).toBe(0);

    // Once the ball is at his feet the step begins, and exactly one line — the
    // one about that step — is said. Not all four.
    let frames = 0;
    while ((match.commentary?.length ?? 0) === before && frames < 40) {
      advanceSpatial(match, env, 0.2);
      frames += 1;
    }
    expect((match.commentary?.length ?? 0) - before).toBe(1);
    expect(match.commentary![before]!.text).toBe('Turner collects.');
    expect(spatial.untold?.length ?? 0).toBe(3);

    // The rest are still waiting, to be said as their own steps are played — the
    // bar is never told about a pass that has not been played yet.
    for (let index = 0; index < 120; index += 1) {
      advanceSpatial(match, env, 0.2);
      expect((match.commentary?.length ?? 0) - before).toBeLessThanOrEqual(4);
    }
  });

  it('never lets the bar fall behind what the pitch has already said', () => {
    // The bar can only show one line, so a busy minute will overrun its hold and
    // skip lines. What it must never do is fall *behind*: the newest line told
    // has to be reachable in one step from wherever the bar was, because the
    // manager should be reading about the pass being played right now.
    const { match, env, spatial } = staged('never-behind');
    const frame = 0.16;
    let maxUnread = 0;
    let told = 0;
    for (let index = 0; index < 2000; index += 1) {
      advanceSpatial(match, env, frame);
      const decided = match.footballSeconds ?? 0;
      const spent = !spatial.plan && (spatial.pending?.length ?? 0) === 0;
      if (spatial.clock >= decided + SPATIAL_SECONDS_PER_MINUTE || (spent && decided - spatial.clock < SPATIAL_SECONDS_PER_MINUTE)) {
        advanceMinute(match, env);
      }
      // The bar snaps to the newest line, so the most it can ever be behind is
      // the single line it is currently holding.
      maxUnread = Math.max(maxUnread, (spatial.untold?.length ?? 0));
      told = match.commentary?.length ?? 0;
    }
    expect(told).toBeGreaterThan(0);
    // Nothing is held back waiting for the bar: the queue the bar could not keep
    // up with is empty, because the bar no longer walks.
    expect(maxUnread).toBeLessThan(40);
  });

  it('says nothing at all until a chain takes the pitch', () => {
    const { match, env, spatial } = staged('tell-when-played');
    const home = spatial.players.filter((n) => n.side === 'home' && n.position !== 'GK');
    const a = home[0]!;
    const b = home[1]!;

    const alreadyTold = match.commentary?.length ?? 0;
    const lines = [line('First move.', 0.0), line('Then the second.', 0.9)];
    const perChain = splitCommentaryByChain([chain(10, 'home', a.playerId, b.playerId), chain(10, 'home', b.playerId, null)], lines);

    // Written, and held.
    installPossessionChains(match, env, [
      chain(10, 'home', a.playerId, b.playerId),
      chain(10, 'home', b.playerId, null),
    ], perChain);

    // The first chain is on the pitch, so its own words have been said, and the
    // second chain's have not.
    const told = (match.commentary ?? []).length - alreadyTold;
    // The second chain is still waiting, so its words are still waiting too.
    expect(spatial.untold?.length ?? 0).toBeGreaterThan(0);
    expect(told).toBeGreaterThan(0);
    expect(told).toBeLessThan(lines.length);
  });

  it('divides the words by the length of the chains, not evenly', () => {
    const lines = [line('a', 0.05), line('b', 0.5), line('c', 0.95)];
    // A long first chain and a short second one: two thirds of the football
    // comes first, so the words about the middle of the minute belong to it.
    const buckets = splitCommentaryByChain(
      [chain(20, 'home', 'p', null), chain(10, 'home', 'p', null)],
      lines,
    );
    // The first chain owns two thirds of the football, so the words for the
    // first two thirds of the minute are its own.
    expect(buckets[0]!.map((l) => l.text)).toEqual(['a', 'b']);
    expect(buckets[1]!.map((l) => l.text)).toEqual(['c']);
  });

  it('loses nothing: everything decided is told by the end', () => {
    const { match, env, spatial } = staged('tell-nothing-lost');
    // Play a whole half the way the store drives it, and check the record ends
    // holding everything that was written.
    const frame = 0.16;
    let backlog = 0;
    let longestBacklog = 0;
    let toldAsWeWatched = 0;
    for (let index = 0; index < 2500; index += 1) {
      advanceSpatial(match, env, frame);
      const decided = match.footballSeconds ?? 0;
      const spent = !spatial.plan && (spatial.pending?.length ?? 0) === 0;
      if (spatial.clock >= decided + SPATIAL_SECONDS_PER_MINUTE || (spent && decided - spatial.clock < SPATIAL_SECONDS_PER_MINUTE)) {
        advanceMinute(match, env);
      }
      backlog = spatial.untold?.length ?? 0;
      longestBacklog = Math.max(longestBacklog, backlog);
      toldAsWeWatched = match.commentary?.length ?? 0;
    }
    flushUntoldCommentary(match);

    // Words are being said while the football is being played, not all at the
    // end, and the queue of untold ones never builds up into a backlog that the
    // bar would have to race through.
    expect(toldAsWeWatched).toBeGreaterThan(0);
    expect(longestBacklog).toBeLessThan(40);
    expect(spatial.untold?.length ?? 0).toBe(0);
    // Ids are unique, which is what tells a transcript apart from a pile.
    const ids = new Set((match.commentary ?? []).map((entry) => entry.id));
    expect(ids.size).toBe(match.commentary!.length);
  });
});