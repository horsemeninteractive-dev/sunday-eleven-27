import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match } from '@/domain/match';
import { createTestGame } from '@/simulation/testSupport';
import { matchEnvironment, prepareMatchday } from '@/simulation/matchday';
import { nextMatchday } from '@/simulation/timeline';
import { cloneMatch } from '../testHelpers';
import { createMatchEngine } from './engine';
import { commentaryFor, recordCommentary } from './narrate';

/** The human's own fixture on the next matchday, with lineups prepared. */
function userMatch(state: GameState): Match {
  const matchday = nextMatchday(state);
  const fixture = Object.values(state.matches).find(
    (candidate) =>
      candidate.matchday === matchday &&
      (candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId),
  );
  if (!fixture) throw new Error('no fixture');
  prepareMatchday(state, fixture.matchday);
  return cloneMatch(state.matches[fixture.id]!);
}

describe('the match narrator', () => {
  it('tells the ordinary play as well as the incidents', () => {
    const { state } = createTestGame('narrate-ordinary');
    const match = userMatch(state);
    const env = matchEnvironment(state, match, { autoManageAllBenches: true });
    createMatchEngine(match, env).runToCompletion();

    const lines = commentaryFor(match.events, match, env);

    // Every event the engine wrote is told: nothing is dropped as too ordinary.
    expect(lines.length).toBe(match.events.length);

    // The weave of the match is on the record and in the words, not only the
    // goals and the cards.
    const passing = lines.filter((line) => line.category === 'passing');
    const movement = lines.filter((line) => line.category === 'movement');
    expect(passing.length).toBeGreaterThan(0);
    expect(movement.length).toBeGreaterThan(0);

    // A pass names the man it found — the line is a move, not an anonymous kick.
    expect(passing.some((line) => / finds /.test(line.text))).toBe(true);
    // And a carry reads as a man driving the ball forward.
    expect(movement.some((line) => /drives/.test(line.text))).toBe(true);
  });

  it('numbers the transcript once, in the order it was told', () => {
    // The transcript is the told version of the record, and every line carries an
    // id a reader can key a list on. Written in two batches — which is what the
    // drain does, a few seconds of football at a time — the ids must run on from
    // each other rather than starting again, or the second batch is a duplicate.
    const { state } = createTestGame('narrate-transcript');
    const match = userMatch(state);
    const env = matchEnvironment(state, match, { autoManageAllBenches: true });
    createMatchEngine(match, env).runToCompletion();

    const lines = commentaryFor(match.events.slice(0, 20), match, env);
    recordCommentary(match, lines.slice(0, 8));
    recordCommentary(match, lines.slice(8, 14));

    const told = match.commentary ?? [];
    expect(told.length).toBe(14);
    expect(told[0]!.id).toBe(`${match.id}_c1`);
    expect(told[13]!.id).toBe(`${match.id}_c14`);
    expect(new Set(told.map((entry) => entry.id)).size).toBe(14);
    // The words are the ones handed over, in the order they were handed over.
    expect(told.map((entry) => entry.text)).toEqual(lines.slice(0, 14).map((entry) => entry.text));
  });
});
