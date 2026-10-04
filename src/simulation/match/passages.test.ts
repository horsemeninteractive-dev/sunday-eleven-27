import { describe, expect, it } from 'vitest';
import type { GameState } from '@/domain/game';
import type { Match, MatchEvent } from '@/domain/match';
import { createTestGame } from '../testSupport';
import { matchEnvironment, prepareMatchday } from '../matchday';
import { Rng } from '../rng';
import { currentScore, simulateToCompletion } from './engine';
import { buildMinuteCommentary } from './passages';
import { planPassage } from './spatial';
import { cloneMatch } from './testHelpers';

/**
 * The commentary is a presentation of the simulation, not a second simulation.
 * These tests pin the things that matter about that: the words describe the
 * passage the pitch is playing, they say more than the raw events without ever
 * inventing an outcome, and they replay exactly.
 */

function userMatch(state: GameState): Match {
  const fixture = Object.values(state.matches).find(
    (candidate) => candidate.homeClubId === state.userClubId || candidate.awayClubId === state.userClubId,
  )!;
  prepareMatchday(state, fixture.matchday);
  return cloneMatch(state.matches[fixture.id]!);
}

function playedMatch(seed: string): { state: GameState; match: Match } {
  const { state } = createTestGame(seed);
  const original = userMatch(state);
  const env = matchEnvironment(state, original, { autoManageAllBenches: true });
  simulateToCompletion(original, env);
  return { state, match: original };
}

describe('commentary passages', () => {
  it('tells more of the match than the events alone, in order, without repeating an id', () => {
    const { match } = playedMatch('passages-richer');
    const transcript = match.commentary ?? [];

    expect(transcript.length).toBeGreaterThan(match.events.length);
    const ids = new Set(transcript.map((line) => line.id));
    expect(ids.size).toBe(transcript.length);
    // Ordered within each half. The engine plays stoppage time under the first
    // half's minute numbers, so the second half legitimately opens below them.
    for (let index = 1; index < transcript.length; index += 1) {
      const previous = transcript[index - 1]!;
      const line = transcript[index]!;
      if (previous.firstHalf === line.firstHalf) {
        expect(line.minute).toBeGreaterThanOrEqual(previous.minute);
      } else {
        expect(previous.firstHalf).toBe(true);
      }
    }
  });

  it('never invents an outcome: every shot in the record is told, and nothing else is', () => {
    const { match } = playedMatch('passages-truthful');
    const transcript = match.commentary ?? [];
    const outcomes = match.events.filter((event) =>
      ['goal', 'penalty-scored', 'shot-saved', 'shot-blocked', 'shot-off-target'].includes(event.type),
    );
    for (const event of outcomes) {
      expect(transcript.some((line) => line.text === event.text)).toBe(true);
    }
    // And the goals it announces are exactly the goals that were scored.
    const told = transcript.filter((line) => line.kind === 'Goal' || line.kind === 'Penalty scored').length;
    const scored = currentScore(match).home + currentScore(match).away;
    expect(told).toBe(scored);
  });

  it('names only players who are on the pitch for the side the line belongs to', () => {
    const { match } = playedMatch('passages-cast');
    const transcript = match.commentary ?? [];
    // Everyone who appeared, which is starters plus substitutes who came on —
    // a man sent off is still a man who was out there when the line was written.
    const appeared = new Set(Object.keys(match.performances));
    const named = transcript.filter((line) => line.playerId);
    expect(named.length).toBeGreaterThan(0);
    for (const line of named) expect(appeared.has(line.playerId!)).toBe(true);
  });

  it('always finds a name for the men it writes about', () => {
    // A keeper sent off leaves the match with nobody to name in a save, and a
    // foul against a man it cannot place. The prose has to have a way of saying
    // those without falling back on "somebody".
    for (const seed of ['name-a', 'name-b', 'name-c', 'name-d', 'name-e']) {
      const { match } = playedMatch(seed);
      const anonymous = [...match.events.map((event) => event.text), ...(match.commentary ?? []).map((line) => line.text)];
      expect(anonymous.filter((text) => /somebody/i.test(text))).toEqual([]);
    }
  });

  it('replays identically from the same starting point', () => {
    const first = playedMatch('passages-replay');
    const second = playedMatch('passages-replay');
    expect((second.match.commentary ?? []).map((line) => line.text)).toEqual(
      (first.match.commentary ?? []).map((line) => line.text),
    );
  });

  it('survives a save and a load, because it lives on the match', () => {
    const { match } = playedMatch('passages-persist');
    const restored = JSON.parse(JSON.stringify(match)) as Match;
    expect((restored.commentary ?? []).length).toBe((match.commentary ?? []).length);
    expect(restored.commentary![0]!.text).toBe(match.commentary![0]!.text);
  });

  it('describes the very passage the pitch is about to play', () => {
    const { state } = createTestGame('passages-plan');
    const match = userMatch(state);
    const shooter =
      match.lineups.home.starting.find((slot) => slot.position === 'ST') ?? match.lineups.home.starting[0]!;
    const save: MatchEvent = {
      id: 'test-save',
      minute: 30,
      type: 'shot-saved',
      clubId: match.homeClubId,
      playerId: shooter.playerId,
      secondaryPlayerId: null,
      text: 'Smith forces a superb save from the keeper.',
      x: 0.82,
      y: 0.5,
      scoreAfter: { home: 0, away: 0 },
      importance: 2,
    };
    match.minute = 30;
    match.half = 1;
    const env = matchEnvironment(state, match);
    const passage = planPassage(match, env, 'home', [], [save], new Rng('plan'));
    const lines = buildMinuteCommentary(match, env, 'home', [save], passage, new Rng('buildup'));

    expect(lines.length).toBeGreaterThanOrEqual(2);
    // The engine's own sentence is the last word, exactly as it wrote it.
    expect(lines[lines.length - 1]!.text).toBe(save.text);
    expect(lines[lines.length - 1]!.kind).toBe('Save');
    // Everything before it is build-up, and no line claims an outcome.
    expect(lines.slice(0, -1).every((line) => line.kind === null)).toBe(true);
    // And the names in the build-up are the ones the plan actually plays.
    const planned = new Set(passage.steps.flatMap((step) => [step.playerId, step.targetId]).filter(Boolean));
    expect(lines.slice(0, -1).every((line) => planned.has(line.playerId!))).toBe(true);
    expect(passage.steps[passage.steps.length - 1]!.playerId).toBe(shooter.playerId);
  });

  it('says every step the pitch plays, and skips none', () => {
    const { state } = createTestGame('passages-every-step');
    const match = userMatch(state);
    match.minute = 22;
    match.half = 1;
    const env = matchEnvironment(state, match);
    const passage = planPassage(match, env, 'home', [], [], new Rng('every-step-plan'));
    const lines = buildMinuteCommentary(match, env, 'home', [], passage, new Rng('every-step-words'));

    // Every step the pitch is going to play is described, in order. A step used
    // to go unspoken whenever its player could not be named, whenever a pass had
    // no resolvable receiver, and every shot of every move — which is exactly
    // when the bar goes quiet while the ball is still moving.
    const passageLines = lines.filter((line) => typeof line.progress === 'number');
    expect(passageLines.length).toBe(passage.steps.length);

    // And they line up with the steps one for one, so the bar is never a step
    // ahead of or behind the football.
    const fractions = passageLines.map((line) => line.progress!);
    expect(fractions.length).toBe(passage.steps.length);
    for (let index = 0; index < fractions.length; index += 1) {
      expect(fractions[index]!).toBeGreaterThanOrEqual(0);
      expect(fractions[index]!).toBeLessThanOrEqual(1);
    }
  });

  it('says each line at the point in the move the pitch has reached', () => {
    const { state } = createTestGame('passages-progress');
    const match = userMatch(state);
    match.minute = 18;
    match.half = 1;
    const env = matchEnvironment(state, match);
    const passage = planPassage(match, env, 'home', [], [], new Rng('progress-plan'));
    const lines = buildMinuteCommentary(match, env, 'home', [], passage, new Rng('progress-words'));

    const paced = lines.filter((line) => typeof line.progress === 'number');
    expect(paced.length).toBeGreaterThan(0);
    const values = paced.map((line) => line.progress!);
    // Every line knows where it belongs in the move, inside the minute.
    expect(values.every((value) => value >= 0 && value <= 1)).toBe(true);
    // And they run in order, so the bar can never walk backwards.
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]!).toBeGreaterThanOrEqual(values[index - 1]!);
    }
  });

  it('keeps the ball with the side that has it between lines', () => {
    const { state } = createTestGame('passages-possession');
    const match = userMatch(state);
    match.minute = 12;
    match.half = 1;
    const env = matchEnvironment(state, match);
    const firstPassage = planPassage(match, env, 'home', [], [], new Rng('poss-a'));
    const first = buildMinuteCommentary(match, env, 'home', [], firstPassage, new Rng('poss-a'));
    match.commentary = first;
    // Same side again: it should not be told as a turnover.
    const secondPassage = planPassage(match, env, 'home', [], [], new Rng('poss-b'));
    const second = buildMinuteCommentary(match, env, 'home', [], secondPassage, new Rng('poss-b'));
    const texts = [...first, ...second].map((line) => line.text).join(' ');
    expect(texts).not.toMatch(/wins (it|the ball) back/i);
  });

  it('says the celebration after a goal, and only for the side that scored it', () => {
    const { state } = createTestGame('passages-celebration');
    const match = userMatch(state);
    const shooter = match.lineups.home.starting.find((slot) => slot.position === 'ST')!;
    const goal: MatchEvent = {
      id: 'test-goal',
      minute: 23,
      type: 'goal',
      clubId: match.homeClubId,
      playerId: shooter.playerId,
      secondaryPlayerId: null,
      text: 'Smith buries it from six yards.',
      x: 0.94,
      y: 0.5,
      scoreAfter: { home: 1, away: 0 },
      importance: 3,
    };
    match.minute = 23;
    match.half = 1;
    const env = matchEnvironment(state, match);
    const passage = planPassage(match, env, 'home', [], [goal], new Rng('celebrate-plan'));
    const lines = buildMinuteCommentary(match, env, 'home', [goal], passage, new Rng('celebrate-words'));

    // The goal is announced once, and the celebration follows it.
    const announced = lines.findIndex((line) => line.text === goal.text);
    expect(announced).toBeGreaterThanOrEqual(0);
    expect(lines.filter((line) => line.kind === 'Goal')).toHaveLength(1);

    const celebration = lines.slice(announced + 1);
    expect(celebration.length).toBeGreaterThan(0);
    // It is prose about the moment, not a second announcement of the goal.
    expect(celebration.every((line) => line.kind === null)).toBe(true);
    expect(celebration.every((line) => line.side === 'home')).toBe(true);
    // It names the scorer and nobody else, so it can never put a word in the
    // mouth of a player who was not even in the passage.
    expect(celebration.every((line) => line.playerId === shooter.playerId)).toBe(true);
    // And the goal count is still the goal count.
    expect(lines.filter((line) => line.kind === 'Goal' || line.kind === 'Penalty scored')).toHaveLength(1);
  });
});
