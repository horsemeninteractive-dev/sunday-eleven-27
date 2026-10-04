import { describe, expect, it } from 'vitest';
import type { Match } from '@/domain/match';
import { addDays } from '@/simulation/calendar';
import { nextMatchday } from '@/simulation/timeline';
import { ensureClubTrained } from '@/simulation/training/session';
import { createTestGame } from '@/simulation/testSupport';
import { markNotifiedThrough } from '@/simulation/schedule';
import type { MatchSession } from '@/state/gameStore';
import { commandStateFor, isScreenIntent } from './commandState';

/**
 * The command state is the single source of truth for "what is happening" and
 * "what can be done about it". If these rules drift, the header, the Continue
 * button, the mobile strip and the overview all drift with them.
 */

type State = ReturnType<typeof createTestGame>['state'];

function userFixture(state: State) {
  const matchday = nextMatchday(state);
  const match = Object.values(state.matches).find(
    (candidate) =>
      candidate.matchday === matchday &&
      (candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId),
  );
  if (!match) throw new Error('the test game has no fixture for the current matchday');
  return match;
}

function sessionFor(match: Match, side: 'home' | 'away', phase: MatchSession['phase'] = 'in-progress'): MatchSession {
  return {
    matchId: match.id,
    live: { ...match, minute: 34, half: 1, period: 'first-half', status: 'in-progress' },
    side,
    speed: 1,
    viewingMode: 'full',
    paused: phase === 'full-time',
    phase,
    revision: 0,
    lastMinuteEvents: 0,
    teamTalk: null,
    halfTimeTalk: null,
    fullTimeTalk: null,
    warmUp: 'normal',
  };
}

describe('command state', () => {
  it('leads with the next match and offers to move time on from a Monday', () => {
    const { state } = createTestGame('command-progress');
    const command = commandStateFor(state, null);

    expect(command.phase).toBe('upcoming');
    expect(command.eyebrow).toBe('Next match');
    expect(command.action.intent).toEqual({ kind: 'action', action: 'continue' });
    expect(command.action.label).toMatch(/^Continue to /);
    expect(command.progress.matchday).toBe(1);
    expect(command.continueHint).toBe('In 3 days');
  });

  it('asks for the session on the day it falls, without running it for him', () => {
    const { state } = createTestGame('command-training');
    const match = userFixture(state);
    state.date = addDays(match.date, -3);

    const command = commandStateFor(state, null);
    expect(command.phase).toBe('training-tonight');
    expect(command.action.intent).toEqual({ kind: 'action', action: 'run-training' });
    expect(command.secondary.map((action) => action.intent)).toContainEqual({ kind: 'view', view: 'training' });
  });

  it('moves on to the match once the session has been run', () => {
    const { state, clubId } = createTestGame('command-match');
    ensureClubTrained(state, clubId, nextMatchday(state));
    const match = userFixture(state);
    state.date = match.date;

    const command = commandStateFor(state, null);
    expect(command.phase).toBe('matchday');

    if (command.action.intent.kind === 'action') {
      expect(command.action.intent).toEqual({ kind: 'action', action: 'start-match' });
      expect(command.eyebrow).toBe('Matchday');
      expect(command.lines.some((line) => line.includes('Kick-off'))).toBe(true);
    } else {
      // Not ready means the selection is not legal, so the action must take the
      // manager to the screen where it can be fixed rather than kicking off.
      expect(command.action.intent).toEqual({ kind: 'view', view: 'team' });
    }
  });

  it('stops on a matchday until it has been played, and moves on afterwards', () => {
    const { state, clubId } = createTestGame('command-matchday-done');
    ensureClubTrained(state, clubId, nextMatchday(state));
    const match = userFixture(state);
    state.date = match.date;
    markNotifiedThrough(state, match.date);

    expect(commandStateFor(state, null).phase).toBe('matchday');

    match.played = true;
    match.status = 'finished';
    const after = commandStateFor(state, null);
    expect(after.action.intent).toEqual({ kind: 'action', action: 'continue' });
    expect(after.phase).not.toBe('matchday');
  });

  it('still offers the match when a side cannot be fielded, so the day can pass', () => {
    const { state, clubId } = createTestGame('command-short-side');
    const match = userFixture(state);
    state.date = match.date;
    // Five players on the books: below the minimum, so playing forfeits the game
    // — but the manager must still be able to press something, or the clock
    // would never move again.
    const club = state.clubs[clubId]!;
    club.squadIds = club.squadIds.slice(0, 5);

    const command = commandStateFor(state, null);
    expect(command.phase).toBe('matchday');
    expect(command.action.intent).toEqual({ kind: 'action', action: 'start-match' });
    expect(command.detail).toMatch(/abandons/i);
  });

  it('hands the manager back to a match in progress, and to the report when it ends', () => {
    const { state } = createTestGame('command-live');
    const match = userFixture(state);

    const live = commandStateFor(state, sessionFor(match, 'home'));
    expect(live.phase).toBe('match-live');
    expect(live.action.intent).toEqual({ kind: 'action', action: 'resume-match' });
    expect(live.urgency).toBe('now');
    expect(live.lines[0]).toContain('First half');

    // The period is labelled from the record, not guessed from the half: extra
    // time is extra time, not a "second half".
    const extra: MatchSession = {
      ...sessionFor(match, 'home'),
      live: { ...match, minute: 92, half: 3, period: 'extra-first', status: 'in-progress' },
    };
    expect(commandStateFor(state, extra).lines[0]).toContain('Extra time');

    const finished = commandStateFor(state, sessionFor(match, 'home', 'full-time'));
    expect(finished.phase).toBe('match-finished');
    expect(finished.action.intent).toEqual({ kind: 'action', action: 'resume-match' });
    expect(finished.secondary.map((action) => action.intent)).toContainEqual({
      kind: 'action',
      action: 'continue',
    });
  });

  it('starts pre-season when the season is over', () => {
    const { state } = createTestGame('command-season-end');
    state.phase = 'complete';

    const command = commandStateFor(state, null);
    expect(command.phase).toBe('season-complete');
    expect(command.action.intent).toEqual({ kind: 'action', action: 'rollover-season' });
  });

  it('treats screens as doors, and everything that moves the game on as not one', () => {
    // The overview may only offer screens: advancing belongs to the command
    // bar, so there is never a second Continue button on the page.
    expect(isScreenIntent({ kind: 'view', view: 'team' })).toBe(true);
    expect(isScreenIntent({ kind: 'action', action: 'open-planner' })).toBe(true);
    for (const action of ['continue', 'advance-day', 'run-training', 'start-match', 'instant-result', 'rollover-season'] as const) {
      expect(isScreenIntent({ kind: 'action', action })).toBe(false);
    }
  });

  it('always names a primary action and a matchday position', () => {
    const { state } = createTestGame('command-invariants');
    const match = userFixture(state);
    const phases = [
      commandStateFor(state, null),
      commandStateFor(state, sessionFor(match, 'away')),
      commandStateFor({ ...state, phase: 'complete' }, null),
    ];
    for (const command of phases) {
      expect(command.action.label.length).toBeGreaterThan(0);
      expect(command.action.short.length).toBeGreaterThan(0);
      expect(command.eyebrow.length).toBeGreaterThan(0);
      expect(command.title.length).toBeGreaterThan(0);
      expect(command.progress.matchday).toBeGreaterThanOrEqual(1);
      expect(command.progress.of).toBeGreaterThanOrEqual(1);
    }
  });
});
